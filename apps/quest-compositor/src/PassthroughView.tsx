import { useEffect, useRef } from "react";
import {
  DEFAULT_INTRINSICS,
  fuseDualPose,
  ndcToScreen,
  projectWorldPoint,
  worldFxPrimitives,
  type Pose3,
  type SessionSnapshot,
  type WorldFxPrimitive,
} from "@voltage/shared";

export function PassthroughView({
  snap,
  selfId,
  lookYaw,
  lookPitch,
  surging,
  forceHide,
}: {
  snap: SessionSnapshot | null;
  selfId: string;
  lookYaw: number;
  lookPitch: number;
  surging: boolean;
  forceHide?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const look = useRef({ yaw: lookYaw, pitch: lookPitch });
  look.current = { yaw: lookYaw, pitch: lookPitch };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext("2d");
      if (!ctx || !snap) return;
      const dpr = devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, w, h, snap, selfId, look.current.yaw, look.current.pitch, surging, forceHide);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [snap, selfId, surging, forceHide]);

  return <canvas ref={ref} className="pass" aria-label="Quest passthrough compositor" />;
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  snap: SessionSnapshot,
  selfId: string,
  lookYaw: number,
  lookPitch: number,
  surging: boolean,
  forceHide?: boolean,
) {
  const me = snap.karts.find((k) => k.id === selfId);
  const now = Date.now();
  const allowed = Boolean(me?.worldFxAllowed && me.worldPoseHealthy) && !forceHide;
  const cam = cameraOf(me, lookYaw, lookPitch, now, w / h);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#1a2738");
  sky.addColorStop(0.42, "#3a4452");
  sky.addColorStop(0.42, "#2a241c");
  sky.addColorStop(1, "#12100c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Simulated passthrough grain
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let i = 0; i < 40; i++) {
    ctx.fillRect((i * 97 + now / 30) % w, (i * 53) % h, 2, h);
  }

  drawHorizonGround(ctx, w, h, cam);

  if (allowed && cam) {
    drawRegisteredTrack(ctx, w, h, snap, cam);
    const prims = worldFxPrimitives(snap.track, snap.pickups);
    for (const p of prims) drawPrimitive(ctx, w, h, p, cam, surging && p.kind === "pad");
    for (const k of snap.karts) {
      if (k.id === selfId) continue;
      drawKart(ctx, w, h, k.x, k.y, k.headingRad, k.color, cam);
    }
  } else {
    ctx.fillStyle = "rgba(8,10,14,0.35)";
    ctx.fillRect(0, 0, w, h);
  }

  // Face-lock chrome is HTML. Tiny visor watermark only.
  ctx.fillStyle = "rgba(180,220,255,0.35)";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText("QUEST PASSTHROUGH · LAB SIM · WORLD-LOCKED FX", 16, 22);
}

function cameraOf(
  me: SessionSnapshot["karts"][number] | undefined,
  lookYaw: number,
  lookPitch: number,
  now: number,
  aspect: number,
): Pose3 | null {
  if (!me) return null;
  const fused = fuseDualPose(
    {
      kartId: me.id,
      kartWorld: {
        kartId: me.id,
        frame: "track_local",
        x: me.x,
        y: 0,
        z: me.y,
        yawRad: me.headingRad,
        pitchRad: 0,
        rollRad: 0,
        speedMps: me.speedMps,
        provider: me.worldPoseHealthy ? "kart_vio" : "kart_vio",
        quality: me.worldPoseHealthy ? Math.max(me.locQuality, 0.9) : 0.1,
        ts: now,
      },
      look: {
        kartId: me.id,
        frame: "kart_body",
        x: 0,
        y: 0,
        z: 0,
        yawRad: lookYaw,
        pitchRad: lookPitch,
        rollRad: 0,
        speedMps: 0,
        provider: "hmd_slam",
        quality: 1,
        ts: now,
      },
      lookSource: "hmd_slam",
    },
    now,
  );
  return fused.hmdInWorld;
}

function drawHorizonGround(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Pose3 | null) {
  const horizon = h * (0.42 - (cam?.pitchRad ?? 0) * 0.35);
  ctx.fillStyle = "rgba(20,18,14,0.55)";
  ctx.fillRect(0, Math.max(0, horizon), w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let i = 1; i < 8; i++) {
    const y = horizon + ((h - horizon) * i) / 8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawRegisteredTrack(ctx: CanvasRenderingContext2D, w: number, h: number, snap: SessionSnapshot, cam: Pose3) {
  const track = snap.track;
  const outer = ellipseRing(track.outer.rx, track.outer.ry, 80);
  const inner = ellipseRing(track.inner.rx, track.inner.ry, 80);
  const asphalt = [...outer, ...inner.slice().reverse()];
  fillProjected(ctx, w, h, asphalt.map((p) => ({ x: p.x, y: 0, z: p.y })), cam, "rgba(28,32,38,0.72)");
  strokeProjected(ctx, w, h, outer.map((p) => ({ x: p.x, y: 0.01, z: p.y })), cam, "rgba(80,90,100,0.8)", 2);
  strokeProjected(ctx, w, h, inner.map((p) => ({ x: p.x, y: 0.01, z: p.y })), cam, "rgba(80,90,100,0.8)", 2);
  const racing = ellipseRing(track.racing.rx, track.racing.ry, 64);
  strokeProjected(ctx, w, h, racing.map((p) => ({ x: p.x, y: 0.02, z: p.y })), cam, "rgba(46,230,255,0.22)", 1);
}

function drawPrimitive(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: WorldFxPrimitive,
  cam: Pose3,
  hot: boolean,
) {
  if (p.kind === "pad" || p.kind === "pickup") {
    const r = p.radiusM ?? 2;
    const ring = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      ring.push({ x: p.x + Math.cos(a) * r, y: 0.05, z: p.z + Math.sin(a) * r });
    }
    const col =
      p.tint === "magenta" ? "rgba(255,61,138,0.45)" : p.tint === "gold" ? "rgba(255,176,32,0.45)" : hot ? "rgba(46,230,255,0.55)" : "rgba(46,230,255,0.28)";
    const stroke = p.tint === "magenta" ? "#ff3d8a" : p.tint === "gold" ? "#ffb020" : "#2ee6ff";
    fillProjected(ctx, w, h, ring, cam, col);
    strokeProjected(ctx, w, h, ring, cam, stroke, hot ? 3 : 2);
    label(ctx, w, h, { x: p.x, y: 0.4, z: p.z }, cam, p.id.toUpperCase(), stroke);
    return;
  }
  const hw = (p.widthM ?? 4) / 2;
  const hh = p.heightM ?? 2.6;
  const yaw = p.headingRad;
  const rx = Math.sin(yaw);
  const rz = -Math.cos(yaw);
  const l = { x: p.x - rx * hw, z: p.z - rz * hw };
  const rgt = { x: p.x + rx * hw, z: p.z + rz * hw };
  const color = p.tint === "white" ? "#e7f3ff" : "#2ee6ff";
  const posts = [
    [
      { x: l.x, y: 0, z: l.z },
      { x: l.x, y: hh, z: l.z },
    ],
    [
      { x: rgt.x, y: 0, z: rgt.z },
      { x: rgt.x, y: hh, z: rgt.z },
    ],
    [
      { x: l.x, y: hh, z: l.z },
      { x: rgt.x, y: hh, z: rgt.z },
    ],
  ];
  for (const seg of posts) strokeProjected(ctx, w, h, seg, cam, color, 3);
  label(ctx, w, h, { x: p.x, y: hh + 0.2, z: p.z }, cam, p.id.toUpperCase(), color);
}

function drawKart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  x: number,
  y: number,
  heading: number,
  color: string,
  cam: Pose3,
) {
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const pts = [
    { x: x + fx * 1.2, y: 0.4, z: y + fz * 1.2 },
    { x: x - fx * 0.8 + Math.sin(heading) * 0.6, y: 0.2, z: y - fz * 0.8 - Math.cos(heading) * 0.6 },
    { x: x - fx * 0.8 - Math.sin(heading) * 0.6, y: 0.2, z: y - fz * 0.8 + Math.cos(heading) * 0.6 },
  ];
  fillProjected(ctx, w, h, pts, cam, color);
}

function ellipseRing(rx: number, ry: number, n: number): Array<{ x: number; y: number }> {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: rx * Math.cos(t), y: ry * Math.sin(t) });
  }
  return out;
}

function fillProjected(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: Array<{ x: number; y: number; z: number }>,
  cam: Pose3,
  fill: string,
) {
  const screen = [];
  let visible = 0;
  const intr = { ...DEFAULT_INTRINSICS, aspect: w / h };
  for (const p of pts) {
    const pr = projectWorldPoint(p, cam, intr);
    if (!pr.inFront) continue;
    visible += 1;
    const s = ndcToScreen(pr.nx, pr.ny, w, h);
    screen.push(s);
  }
  if (visible < 3) return;
  ctx.beginPath();
  ctx.moveTo(screen[0].x, screen[0].y);
  for (let i = 1; i < screen.length; i++) ctx.lineTo(screen[i].x, screen[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeProjected(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: Array<{ x: number; y: number; z: number }>,
  cam: Pose3,
  stroke: string,
  width: number,
) {
  const intr = { ...DEFAULT_INTRINSICS, aspect: w / h };
  ctx.beginPath();
  let started = false;
  for (const p of pts) {
    const pr = projectWorldPoint(p, cam, intr);
    if (!pr.inFront) {
      started = false;
      continue;
    }
    const s = ndcToScreen(pr.nx, pr.ny, w, h);
    if (!started) {
      ctx.moveTo(s.x, s.y);
      started = true;
    } else ctx.lineTo(s.x, s.y);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function label(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: { x: number; y: number; z: number },
  cam: Pose3,
  text: string,
  color: string,
) {
  const pr = projectWorldPoint(p, cam, { ...DEFAULT_INTRINSICS, aspect: w / h });
  if (!pr.inFront || !pr.onScreen) return;
  const s = ndcToScreen(pr.nx, pr.ny, w, h);
  ctx.fillStyle = color;
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(text, s.x - 18, s.y);
}
