/** Track-local frame. M1 localization is STUB — not outdoor-only. */

export interface Vec2 {
  x: number;
  y: number;
}

export interface TrackLayout {
  id: string;
  name: string;
  frame: "track_local";
  /** Outer / inner ellipse radii in meters. */
  outer: { rx: number; ry: number };
  inner: { rx: number; ry: number };
  racing: { rx: number; ry: number };
  pads: PadDef[];
  pickupNodes: PickupNodeDef[];
}

export interface PadDef {
  id: string;
  index: number;
  x: number;
  y: number;
  radiusM: number;
}

export interface PickupNodeDef {
  id: string;
  index: number;
  x: number;
  y: number;
  radiusM: number;
}

function ellipsePoint(rx: number, ry: number, theta: number): Vec2 {
  return { x: rx * Math.cos(theta), y: ry * Math.sin(theta) };
}

export function defaultTrack(padCount = 3, pickupNodes = 3): TrackLayout {
  const padsN = Math.min(4, Math.max(2, padCount));
  const nodesN = Math.min(3, Math.max(2, pickupNodes));
  const racing = { rx: 46.5, ry: 24 };

  const pads: PadDef[] = [];
  for (let i = 0; i < padsN; i++) {
    const theta = (i / padsN) * Math.PI * 2;
    const p = ellipsePoint(racing.rx, racing.ry, theta);
    pads.push({ id: `pad-${i + 1}`, index: i, x: p.x, y: p.y, radiusM: 3.6 });
  }

  const pickup: PickupNodeDef[] = [];
  for (let i = 0; i < nodesN; i++) {
    const theta = (i / nodesN) * Math.PI * 2 + Math.PI / nodesN;
    const p = ellipsePoint(racing.rx, racing.ry, theta);
    pickup.push({ id: `node-${i + 1}`, index: i, x: p.x, y: p.y, radiusM: 2.8 });
  }

  return {
    id: "vl-stub-oval-01",
    name: "Stub Oval (track-local)",
    frame: "track_local",
    outer: { rx: 55, ry: 32 },
    inner: { rx: 38, ry: 16 },
    racing,
    pads,
    pickupNodes: pickup,
  };
}

export function racingPose(track: TrackLayout, theta: number): Vec2 & { heading: number } {
  const { rx, ry } = track.racing;
  const x = rx * Math.cos(theta);
  const y = ry * Math.sin(theta);
  const tx = -rx * Math.sin(theta);
  const ty = ry * Math.cos(theta);
  return { x, y, heading: Math.atan2(ty, tx) };
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function insidePad(pos: Vec2, pad: PadDef): boolean {
  return dist2(pos, pad) <= pad.radiusM * pad.radiusM;
}

export function insideNode(pos: Vec2, node: PickupNodeDef): boolean {
  return dist2(pos, node) <= node.radiusM * node.radiusM;
}

/** Soft walls: true if pose is on the asphalt band between inner and outer. */
export function onAsphalt(track: TrackLayout, pos: Vec2): boolean {
  const outerQ = (pos.x * pos.x) / (track.outer.rx * track.outer.rx) + (pos.y * pos.y) / (track.outer.ry * track.outer.ry);
  const innerQ = (pos.x * pos.x) / (track.inner.rx * track.inner.rx) + (pos.y * pos.y) / (track.inner.ry * track.inner.ry);
  return outerQ <= 1 && innerQ >= 1;
}

export function clampToAsphalt(track: TrackLayout, pos: Vec2): Vec2 {
  if (onAsphalt(track, pos)) return pos;
  const outerQ = (pos.x * pos.x) / (track.outer.rx * track.outer.rx) + (pos.y * pos.y) / (track.outer.ry * track.outer.ry);
  if (outerQ > 1) {
    const s = 1 / Math.sqrt(outerQ);
    return { x: pos.x * s * 0.995, y: pos.y * s * 0.995 };
  }
  const innerQ = (pos.x * pos.x) / (track.inner.rx * track.inner.rx) + (pos.y * pos.y) / (track.inner.ry * track.inner.ry);
  if (innerQ < 1) {
    const s = 1 / Math.sqrt(Math.max(innerQ, 1e-6));
    return { x: pos.x * s * 1.01, y: pos.y * s * 1.01 };
  }
  return pos;
}

export function approxLapLengthM(track: TrackLayout): number {
  const { rx, ry } = track.racing;
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}
