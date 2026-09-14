import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { AssistRecord, KartPublic, SessionSnapshot } from "@voltage/shared";
import { insidePad, RULES } from "@voltage/shared";
import { TrackView } from "./TrackView";

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function kartIdFromQuery(): string {
  const q = new URLSearchParams(location.search).get("kart");
  return q || "HUD-1";
}

export default function App() {
  const kartId = useMemo(kartIdFromQuery, []);
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [assist, setAssist] = useState<AssistRecord | null>(null);
  const [predict, setPredict] = useState<{ until: number; source: "predict" | "auth" } | null>(null);
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const wsRef = useRef<WebSocket | null>(null);
  const lastPad = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "hello", role: "hud", kartId, name: `Helmet ${kartId}` }));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "hello_ok" || msg.type === "snapshot") setSnap(msg.snapshot);
        if (msg.type === "assist" && msg.record.kartId === kartId) {
          setAssist(msg.record);
          if (msg.record.vfx.type === "surge") setPredict({ until: Date.now() + msg.record.vfx.durationMs, source: "auth" });
          if (msg.record.vfx.type === "cancel") setPredict(null);
        }
      };
      ws.onclose = () => {
        if (!cancelled) setTimeout(connect, 800);
      };
    };
    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [kartId]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "ArrowUp" || e.code === "KeyW") keys.current.up = true;
      if (e.code === "ArrowDown" || e.code === "KeyS") keys.current.down = true;
      if (e.code === "ArrowLeft" || e.code === "KeyA") keys.current.left = true;
      if (e.code === "ArrowRight" || e.code === "KeyD") keys.current.right = true;
      if (e.code === "KeyQ") wsRef.current?.send(JSON.stringify({ type: "use_pickup", kartId, slot: "defensive" }));
      if (e.code === "KeyE") wsRef.current?.send(JSON.stringify({ type: "use_pickup", kartId, slot: "pace" }));
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "ArrowUp" || e.code === "KeyW") keys.current.up = false;
      if (e.code === "ArrowDown" || e.code === "KeyS") keys.current.down = false;
      if (e.code === "ArrowLeft" || e.code === "KeyA") keys.current.left = false;
      if (e.code === "ArrowRight" || e.code === "KeyD") keys.current.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const iv = setInterval(() => {
      const throttle = (keys.current.up ? 1 : 0) + (keys.current.down ? -0.7 : 0);
      const steer = (keys.current.left ? -1 : 0) + (keys.current.right ? 1 : 0);
      wsRef.current?.readyState === 1 &&
        wsRef.current.send(JSON.stringify({ type: "steer", kartId, throttle, steer }));
    }, 50);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      clearInterval(iv);
    };
  }, [kartId]);

  const me: KartPublic | undefined = snap?.karts.find((k) => k.id === kartId);

  useEffect(() => {
    if (!snap || !me || snap.status !== "live" || snap.safeMode) return;
    const pad = snap.track.pads.find((p) => insidePad(me, p));
    if (pad && lastPad.current !== pad.id && me.padCooldownUntil <= snap.serverNow && me.surgeUntil <= snap.serverNow) {
      lastPad.current = pad.id;
      setPredict({ until: Date.now() + RULES.surgeVisualMs.default, source: "predict" });
    }
    if (!pad) lastPad.current = null;
  }, [snap, me]);

  const remaining = snap
    ? snap.status === "live" && snap.endsAt
      ? Math.max(0, snap.endsAt - snap.serverNow)
      : snap.heatDurationMs
    : 0;
  const surging = Boolean(predict && Date.now() < predict.until) || Boolean(me && snap && me.surgeUntil > snap.serverNow);

  return (
    <div className={`hud ${surging ? "surge" : ""} ${snap?.safeMode ? "safe" : ""}`}>
      <div className="chrome top">
        <div>
          <div className="brand">VOLTAGE LEAGUE</div>
          <div className="meta">Optical HUD stub · EyeRide-class overlay · not an opaque HMD</div>
        </div>
        <div className="clock">{fmt(remaining)}</div>
        <div className="phase">
          PHASE {snap?.phase ?? 0} · VISUAL
          <div className="meta">{snap?.localization.provider} loc · {snap?.status}</div>
        </div>
      </div>

      <TrackView snap={snap} selfId={kartId} surging={surging} />

      <div className="chrome bottom">
        <div className="chip">
          <span>POS</span>
          <b>{rankOf(snap, kartId)}</b>
        </div>
        <div className="chip">
          <span>SPD</span>
          <b>{me ? me.speedMps.toFixed(0) : "0"}</b>
        </div>
        <div className="chip">
          <span>LAPS</span>
          <b>{me?.laps ?? 0}</b>
        </div>
        <div className={`chip ${me?.inventory.defensive ? "on mag" : ""}`}>
          <span>DEF Q</span>
          <b>{me?.inventory.defensive ?? 0}/1</b>
        </div>
        <div className={`chip ${me?.inventory.pace ? "on gold" : ""}`}>
          <span>PACE E</span>
          <b>{me?.inventory.pace ?? 0}/1</b>
        </div>
        <div className={`tele ${predict?.source ?? ""}`}>
          {snap?.safeMode
            ? "SAFE MODE — boosts cancelled"
            : surging
              ? `SURGE ${predict?.source === "predict" ? "PREDICT" : "AUTH"} · visual 1.5–2.5s`
              : nextPadTelegraph(snap, me)}
        </div>
      </div>

      {assist && assist.telegraph && <div className="toast">{assist.telegraph}</div>}
      <Pad
        hold={(k, v) => {
          keys.current[k] = v;
        }}
        use={(slot) => wsRef.current?.send(JSON.stringify({ type: "use_pickup", kartId, slot }))}
      />
      <div className="help">Hold THR / steer on visor, or WASD · Q defensive · E pace · local VFX predict</div>
    </div>
  );
}

function Pad({
  hold,
  use,
}: {
  hold: (k: "up" | "down" | "left" | "right", v: boolean) => void;
  use: (slot: "defensive" | "pace") => void;
}) {
  const bind = (k: "up" | "down" | "left" | "right") => ({
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      hold(k, true);
    },
    onPointerUp: () => hold(k, false),
    onPointerCancel: () => hold(k, false),
  });
  return (
    <div className="pad">
      <div className="stick">
        <button type="button" className="pad-btn" {...bind("left")}>
          ◀
        </button>
        <div className="stick-mid">
          <button type="button" className="pad-btn thr" {...bind("up")}>
            THR
          </button>
          <button type="button" className="pad-btn brk" {...bind("down")}>
            BRK
          </button>
        </div>
        <button type="button" className="pad-btn" {...bind("right")}>
          ▶
        </button>
      </div>
      <div className="use-row">
        <button type="button" className="pad-btn mag" onClick={() => use("defensive")}>
          DEF
        </button>
        <button type="button" className="pad-btn gold" onClick={() => use("pace")}>
          PACE
        </button>
      </div>
    </div>
  );
}

function rankOf(snap: SessionSnapshot | null, id: string): string {
  if (!snap) return "—";
  const row = (snap.results ?? []).find((r) => r.kartId === id);
  return row ? String(row.rank) : "—";
}

function nextPadTelegraph(snap: SessionSnapshot | null, me?: KartPublic): string {
  if (!snap || !me) return "WAITING FOR SESSION";
  if (snap.status === "lobby") return "LOBBY — wait for ops START";
  if (snap.status === "results") return "HEAT COMPLETE";
  let best = Infinity;
  let name = "PAD";
  for (const p of snap.track.pads) {
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d < best) {
      best = d;
      name = p.id;
    }
  }
  return `NEXT ${name.toUpperCase()}  ${best.toFixed(0)}m · pad CD 8–12s`;
}

function fmt(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}
