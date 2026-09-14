import { useEffect, useRef } from "react";
import type { SessionSnapshot } from "@voltage/shared";

export function TrackView({
  snap,
  selfId,
  surging,
}: {
  snap: SessionSnapshot | null;
  selfId: string;
  surging: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !snap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const cw = w / devicePixelRatio;
    const ch = h / devicePixelRatio;
    ctx.clearRect(0, 0, cw, ch);

    const track = snap.track;
    const scale = Math.min(cw, ch) / (track.outer.rx * 2.5);
    const ox = cw / 2;
    const oy = ch / 2;
    const tx = (x: number) => ox + x * scale;
    const ty = (y: number) => oy - y * scale;

    ctx.fillStyle = "rgba(4, 8, 14, 0.15)";
    ctx.fillRect(0, 0, cw, ch);

    ellipse(ctx, ox, oy, track.outer.rx * scale, track.outer.ry * scale, "#1b2430", "rgba(20,28,40,0.55)");
    ellipse(ctx, ox, oy, track.inner.rx * scale, track.inner.ry * scale, "#1b2430", "rgba(6,8,12,0.85)");
    ctx.setLineDash([8, 10]);
    ellipse(ctx, ox, oy, track.racing.rx * scale, track.racing.ry * scale, "rgba(46,230,255,0.35)");
    ctx.setLineDash([]);

    for (const pad of track.pads) {
      ctx.beginPath();
      ctx.arc(tx(pad.x), ty(pad.y), pad.radiusM * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "#2ee6ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(46,230,255,0.12)";
      ctx.fill();
      ctx.fillStyle = "#8befff";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(pad.id, tx(pad.x) - 14, ty(pad.y) - pad.radiusM * scale - 6);
    }
    for (const g of track.gates ?? []) {
      const hx = Math.sin(g.headingRad) * g.widthM * 0.5 * scale;
      const hy = Math.cos(g.headingRad) * g.widthM * 0.5 * scale;
      ctx.beginPath();
      ctx.moveTo(tx(g.x) - hx, ty(g.y) - hy);
      ctx.lineTo(tx(g.x) + hx, ty(g.y) + hy);
      ctx.strokeStyle = g.kind === "start_finish" ? "#e7f3ff" : "rgba(46,230,255,0.7)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    for (const p of snap.pickups) {
      ctx.beginPath();
      ctx.arc(tx(p.x), ty(p.y), p.radiusM * scale, 0, Math.PI * 2);
      ctx.fillStyle = p.kind === "defensive" ? "rgba(255,61,138,0.35)" : "rgba(255,176,32,0.35)";
      ctx.fill();
      ctx.strokeStyle = p.kind === "defensive" ? "#ff3d8a" : "#ffb020";
      ctx.stroke();
    }
    for (const k of snap.karts) {
      const x = tx(k.x);
      const y = ty(k.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-k.headingRad);
      ctx.fillStyle = k.id === selfId ? "#e7f3ff" : k.color;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-8, 6);
      ctx.lineTo(-8, -6);
      ctx.closePath();
      ctx.fill();
      if (k.id === selfId && surging) {
        ctx.strokeStyle = "#2ee6ff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [snap, selfId, surging]);

  return <canvas ref={ref} className="track" />;
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  stroke: string,
  fill?: string,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}
