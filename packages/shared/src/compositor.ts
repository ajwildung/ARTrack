/**
 * World compositor math — shared by the Editor/Quest web visor and the Unity OpenXR client.
 *
 * Pads/gates live in track_local meters. They are projected into the headset view using
 * fused (KartVio world + HelmetVio/HmdSlam look) pose. World FX MUST hide when the kart
 * world pose is unhealthy. This is not a face-lock HUD.
 */
import {
  DISPLAY,
  WORLD_FX_MAX_AGE_MS,
  WORLD_FX_MIN_QUALITY,
  type LocalizationProvider,
  type LookSource,
} from "./rules.ts";
import type { GateDef, PadDef, TrackLayout } from "./track.ts";

export interface PlanarPose {
  kartId: string;
  frame: "track_local";
  x: number;
  y: number;
  headingRad: number;
  speedMps: number;
  provider: LocalizationProvider;
  quality: number;
  ts: number;
}

export type PoseFrame = "track_local" | "kart_body" | "hmd_local";

export interface Pose3 {
  kartId: string;
  frame: PoseFrame;
  /** Unity-style Y-up meters: X = track x, Y = height, Z = track y. */
  x: number;
  y: number;
  z: number;
  yawRad: number;
  pitchRad: number;
  rollRad: number;
  speedMps: number;
  provider: LocalizationProvider;
  quality: number;
  ts: number;
}

export interface DualPoseSample {
  kartId: string;
  /** Kart-fixed cam / AprilTag world pose. Required for world FX. */
  kartWorld: Pose3;
  /** Helmet cam or Quest HMD SLAM look. Optional; falls back to kart heading. */
  look?: Pose3;
  lookSource: LookSource;
}

export interface FusionCalib {
  seatForwardM: number;
  seatUpM: number;
  seatRightM: number;
  /** Slam origin in track_local once AprilTag / world-anchor lock exists. */
  slamOrigin: Pose3 | null;
  kartCamForwardM: number;
  kartCamUpM: number;
  kartCamRightM: number;
  kartCamYawRad: number;
}

export const DEFAULT_CALIB: FusionCalib = {
  seatForwardM: 0.18,
  seatUpM: 0.92,
  seatRightM: 0,
  slamOrigin: null,
  kartCamForwardM: 0.35,
  kartCamUpM: 0.28,
  kartCamRightM: 0,
  kartCamYawRad: 0,
};

export interface FusedLocalization {
  provider: LocalizationProvider;
  kartWorldHealthy: boolean;
  worldFxAllowed: boolean;
  worldAnchor: Pose3 | null;
  hmdInWorld: Pose3 | null;
  lookSource: LookSource;
  quality: number;
  hideReason: string | null;
}

export interface LocalizationPublic {
  provider: LocalizationProvider;
  frame: "track_local";
  note: string;
  fusion: "none" | "dual_pose";
  kartProvider: LocalizationProvider;
  lookProvider: LocalizationProvider | "none";
  worldFxPolicy: "hide_if_kart_world_unhealthy";
}

export interface CompositorPublic {
  labDisplay: typeof DISPLAY.lab;
  productDisplay: typeof DISPLAY.product;
  worldFxPolicy: "hide_if_kart_world_unhealthy";
  eyeridePath: false;
  carplayPath: false;
  androidAutoPath: false;
}

export const COMPOSITOR_PUBLIC: CompositorPublic = {
  labDisplay: DISPLAY.lab,
  productDisplay: DISPLAY.product,
  worldFxPolicy: "hide_if_kart_world_unhealthy",
  eyeridePath: false,
  carplayPath: false,
  androidAutoPath: false,
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Projected {
  id: string;
  kind: "pad" | "gate" | "pickup";
  nx: number;
  ny: number;
  depth: number;
  inFront: boolean;
  onScreen: boolean;
}

export interface CameraIntrinsics {
  fovYRad: number;
  aspect: number;
}

export const DEFAULT_INTRINSICS: CameraIntrinsics = {
  fovYRad: (68 * Math.PI) / 180,
  aspect: 16 / 9,
};

export function pose2To3(p: PlanarPose, heightM = 0): Pose3 {
  return {
    kartId: p.kartId,
    frame: "track_local",
    x: p.x,
    y: heightM,
    z: p.y,
    yawRad: p.headingRad,
    pitchRad: 0,
    rollRad: 0,
    speedMps: p.speedMps,
    provider: p.provider,
    quality: p.quality,
    ts: p.ts,
  };
}

export function pose3To2(p: Pose3): PlanarPose {
  return {
    kartId: p.kartId,
    frame: "track_local",
    x: p.x,
    y: p.z,
    headingRad: p.yawRad,
    speedMps: p.speedMps,
    provider: p.provider,
    quality: p.quality,
    ts: p.ts,
  };
}

export function kartWorldHealth(
  pose: Pose3 | null | undefined,
  now: number,
  opts?: { maxAgeMs?: number; minQuality?: number },
): { ok: boolean; reason: string } {
  if (!pose) return { ok: false, reason: "no_kart_world_pose" };
  if (![pose.x, pose.y, pose.z, pose.yawRad, pose.quality].every(Number.isFinite)) {
    return { ok: false, reason: "non_finite" };
  }
  const minQ = opts?.minQuality ?? WORLD_FX_MIN_QUALITY;
  if (pose.quality < minQ) return { ok: false, reason: "low_quality" };
  const maxAge = opts?.maxAgeMs ?? WORLD_FX_MAX_AGE_MS;
  if (now - pose.ts > maxAge) return { ok: false, reason: "stale" };
  return { ok: true, reason: "ok" };
}

export function fuseDualPose(sample: DualPoseSample, now: number, calib: FusionCalib = DEFAULT_CALIB): FusedLocalization {
  const health = kartWorldHealth(sample.kartWorld, now);
  const lookSource = sample.lookSource ?? "none";
  const kart = sample.kartWorld;
  const seat = kart ? offsetKartBody(kart, calib.seatForwardM, calib.seatUpM, calib.seatRightM) : null;
  const hmd = seat ? applyLook(seat, sample.look, lookSource, calib) : null;
  if (!health.ok) {
    return {
      provider: "dual_fusion",
      kartWorldHealthy: false,
      worldFxAllowed: false,
      worldAnchor: kart ?? null,
      hmdInWorld: hmd,
      lookSource,
      quality: kart?.quality ?? 0,
      hideReason: health.reason,
    };
  }

  return {
    provider: sample.kartWorld.provider === "stub" && lookSource === "sim" ? "stub" : "dual_fusion",
    kartWorldHealthy: true,
    worldFxAllowed: true,
    worldAnchor: kart,
    hmdInWorld: hmd,
    lookSource,
    quality: kart.quality,
    hideReason: null,
  };
}

function offsetKartBody(kart: Pose3, forwardM: number, upM: number, rightM: number): Pose3 {
  const { forward, right, up } = basis(kart);
  return {
    ...kart,
    x: kart.x + forward.x * forwardM + up.x * upM + right.x * rightM,
    y: kart.y + forward.y * forwardM + up.y * upM + right.y * rightM,
    z: kart.z + forward.z * forwardM + up.z * upM + right.z * rightM,
  };
}

function applyLook(seat: Pose3, look: Pose3 | undefined, source: LookSource, calib: FusionCalib): Pose3 {
  if (!look || source === "none") {
    return { ...seat, pitchRad: 0, rollRad: 0 };
  }
  if (look.frame === "track_local") {
    return { ...look, kartId: seat.kartId };
  }
  if (source === "hmd_slam" && calib.slamOrigin) {
    const origin = calib.slamOrigin;
    return {
      ...look,
      frame: "track_local",
      kartId: seat.kartId,
      x: origin.x + look.x,
      y: origin.y + look.y,
      z: origin.z + look.z,
      yawRad: origin.yawRad + look.yawRad,
      pitchRad: origin.pitchRad + look.pitchRad,
      rollRad: origin.rollRad + look.rollRad,
      provider: "hmd_slam",
    };
  }
  // Body-relative look (Editor sim, or HMD SLAM before world-anchor lock).
  return {
    ...seat,
    yawRad: seat.yawRad + look.yawRad,
    pitchRad: look.pitchRad,
    rollRad: look.rollRad,
    provider: look.provider,
    ts: Math.max(seat.ts, look.ts),
  };
}

export function basis(pose: Pose3): { forward: Vec3; right: Vec3; up: Vec3 } {
  const cy = Math.cos(pose.yawRad);
  const sy = Math.sin(pose.yawRad);
  const cp = Math.cos(pose.pitchRad);
  const sp = Math.sin(pose.pitchRad);
  const cr = Math.cos(pose.rollRad);
  const sr = Math.sin(pose.rollRad);
  // Y-up, heading 0 looks +X (track east). Pitch looks up; roll around forward.
  const forward: Vec3 = { x: cy * cp, y: sp, z: sy * cp };
  const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
  const right = normalize(cross(forward, worldUp));
  const up = normalize(cross(right, forward));
  if (Math.abs(sr) < 1e-9 && Math.abs(cr - 1) < 1e-9) return { forward: normalize(forward), right, up };
  const rolledRight = add(scale(right, cr), scale(up, sr));
  const rolledUp = add(scale(up, cr), scale(right, -sr));
  return { forward: normalize(forward), right: normalize(rolledRight), up: normalize(rolledUp) };
}

export function projectWorldPoint(
  point: Vec3,
  camera: Pose3,
  intrinsics: CameraIntrinsics = DEFAULT_INTRINSICS,
): { nx: number; ny: number; depth: number; inFront: boolean; onScreen: boolean } {
  const { forward, right, up } = basis(camera);
  const rel: Vec3 = { x: point.x - camera.x, y: point.y - camera.y, z: point.z - camera.z };
  const camX = dot(rel, right);
  const camY = dot(rel, up);
  const depth = dot(rel, forward);
  if (depth <= 0.08) return { nx: 0, ny: 0, depth, inFront: false, onScreen: false };
  const f = 1 / Math.tan(intrinsics.fovYRad / 2);
  const nx = (camX * f) / (intrinsics.aspect * depth);
  const ny = (camY * f) / depth;
  return {
    nx,
    ny,
    depth,
    inFront: true,
    onScreen: Math.abs(nx) <= 1.15 && Math.abs(ny) <= 1.15,
  };
}

export function ndcToScreen(nx: number, ny: number, width: number, height: number): { x: number; y: number } {
  return { x: (nx * 0.5 + 0.5) * width, y: (1 - (ny * 0.5 + 0.5)) * height };
}

export type WorldFxKind = "pad" | "gate" | "pickup";

export interface WorldFxPrimitive {
  id: string;
  kind: WorldFxKind;
  x: number;
  y: number;
  z: number;
  headingRad: number;
  radiusM?: number;
  widthM?: number;
  heightM?: number;
  tint: "cyan" | "magenta" | "gold" | "white";
}

export function worldFxPrimitives(
  track: TrackLayout,
  pickups: Array<{ nodeId: string; kind: "defensive" | "pace"; x: number; y: number; radiusM: number }> = [],
): WorldFxPrimitive[] {
  const out: WorldFxPrimitive[] = [];
  for (const pad of track.pads) out.push(padPrimitive(pad));
  for (const gate of track.gates ?? []) out.push(gatePrimitive(gate));
  for (const p of pickups) {
    out.push({
      id: `pickup-${p.nodeId}`,
      kind: "pickup",
      x: p.x,
      y: 0.4,
      z: p.y,
      headingRad: 0,
      radiusM: p.radiusM,
      tint: p.kind === "defensive" ? "magenta" : "gold",
    });
  }
  return out;
}

function padPrimitive(pad: PadDef): WorldFxPrimitive {
  return {
    id: pad.id,
    kind: "pad",
    x: pad.x,
    y: 0.04,
    z: pad.y,
    headingRad: 0,
    radiusM: pad.radiusM,
    tint: "cyan",
  };
}

function gatePrimitive(gate: GateDef): WorldFxPrimitive {
  return {
    id: gate.id,
    kind: "gate",
    x: gate.x,
    y: 0,
    z: gate.y,
    headingRad: gate.headingRad,
    widthM: gate.widthM,
    heightM: gate.heightM,
    tint: gate.kind === "start_finish" ? "white" : "cyan",
  };
}

/** Project primitives; empty when world FX must hide. */
export function composeWorldView(
  fused: FusedLocalization,
  primitives: WorldFxPrimitive[],
  intrinsics: CameraIntrinsics = DEFAULT_INTRINSICS,
): { allowed: boolean; hideReason: string | null; projected: Projected[] } {
  if (!fused.worldFxAllowed || !fused.hmdInWorld) {
    return { allowed: false, hideReason: fused.hideReason ?? "kart_world_unhealthy", projected: [] };
  }
  const cam = fused.hmdInWorld;
  const projected = primitives.map((p) => {
    const pr = projectWorldPoint({ x: p.x, y: p.y, z: p.z }, cam, intrinsics);
    return { id: p.id, kind: p.kind, ...pr };
  });
  return { allowed: true, hideReason: null, projected };
}

export function stubHealthyKart(kartId: string, x: number, y: number, headingRad: number, now: number): Pose3 {
  return {
    kartId,
    frame: "track_local",
    x,
    y: 0,
    z: y,
    yawRad: headingRad,
    pitchRad: 0,
    rollRad: 0,
    speedMps: 0,
    provider: "stub",
    quality: 1,
    ts: now,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / n, y: a.y / n, z: a.z / n };
}
