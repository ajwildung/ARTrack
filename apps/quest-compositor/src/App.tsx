import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistRecord, DualPoseSample, KartPublic, SessionSnapshot } from "@voltage/shared";
import { insidePad, RULES } from "@voltage/shared";
import { PassthroughView } from "./PassthroughView";

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function kartIdFromQuery(): string {
  return new URLSearchParams(location.search).get("kart") || "QUEST-1";
}

export default function App() {
  const kartId = useMemo(kartIdFromQuery, []);
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [assist, setAssist] = useState<AssistRecord | null>(null);
  const [predict, setPredict] = useState<{ until: number; source: "predict" | "auth" } | null>(null);
  const [lookYaw, setLookYaw] = useState(0);
  const [lookPitch, setLookPitch] = useState(-0.08);
  const [unhealthy, setUnhealthy] = useState(false);
  const [lookSource, setLookSource] = useState<"hmd_slam" | "helmet_vio">("hmd_slam");
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const look = useRef({ yaw: 0, pitch: -0.08 });
  const wsRef = useRef<WebSocket | null>(null);
  const lastPad = useRef<string | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "hello", role: "headset", kartId, name: `Quest ${kartId}` }));
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
      if (e.code === "KeyH") setUnhealthy((v) => !v);
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
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: "steer", kartId, throttle, steer }));
      const me = snap?.karts.find((k) => k.id === kartId);
      const sample: DualPoseSample = {
        kartId,
        kartWorld: {
          kartId,
          frame: "track_local",
          x: me?.x ?? 46.5,
          y: 0,
          z: me?.y ?? 0,
          yawRad: me?.headingRad ?? Math.PI / 2,
          pitchRad: 0,
          rollRad: 0,
          speedMps: me?.speedMps ?? 0,
          provider: unhealthy ? "kart_vio" : "stub",
          quality: unhealthy ? 0.12 : 1,
          ts: Date.now(),
        },
        look: {
          kartId,
          frame: "kart_body",
          x: 0,
          y: 0,
          z: 0,
          yawRad: look.current.yaw,
          pitchRad: look.current.pitch,
          rollRad: 0,
          speedMps: 0,
          provider: lookSource,
          quality: 1,
          ts: Date.now(),
        },
        lookSource,
      };
      ws.send(JSON.stringify({ type: "dual_pose", sample }));
    }, 50);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      clearInterval(iv);
    };
  }, [kartId, unhealthy, lookSource, snap]);

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
  const fxOn = Boolean(me?.worldFxAllowed) && !unhealthy;

  return (
    <div className={`visor ${surging ? "surge" : ""} ${snap?.safeMode ? "safe" : ""} ${fxOn ? "" : "nofx"}`}>
      <PassthroughView snap={snap} selfId={kartId} lookYaw={lookYaw} lookPitch={lookPitch} surging={surging} forceHide={unhealthy} />

      <div className="chrome top">
        <div>
          <div className="brand">VOLTAGE LEAGUE</div>
          <div className="meta">Quest OpenXR lab · registered world FX · not a face-lock HUD</div>
        </div>
        <div className="clock">{fmt(remaining)}</div>
        <div className="phase">
          PHASE {snap?.phase ?? 0} · VISUAL
          <div className="meta">
            {snap?.localization.provider} · {lookSource} · {snap?.status}
          </div>
        </div>
      </div>

      {!fxOn && (
        <div className="hide-banner">
          WORLD FX HIDDEN
          <span>{me?.hideReason ?? "kart world pose unhealthy"} · pads/gates require KartVio</span>
        </div>
      )}

      <div className="chrome bottom">
        <div className="chip">
          <span>SPD</span>
          <b>{me ? me.speedMps.toFixed(0) : "0"}</b>
        </div>
        <div className="chip">
          <span>LAPS</span>
          <b>{me?.laps ?? 0}</b>
        </div>
        <div className={`chip ${me?.worldPoseHealthy ? "on" : ""}`}>
          <span>KART VIO</span>
          <b>{me?.worldPoseHealthy ? "OK" : "BAD"}</b>
        </div>
        <div className={`chip ${fxOn ? "on" : ""}`}>
          <span>WORLD FX</span>
          <b>{fxOn ? "ON" : "OFF"}</b>
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
            ? "SAFE MODE — boosts cancelled · visual only"
            : surging
              ? `SURGE ${predict?.source === "predict" ? "PREDICT" : "AUTH"} · visual 1.5–2.5s`
              : fxOn
                ? "PADS/GATES WORLD-LOCKED · drag to look"
                : "FAIL-SAFE: hide registered FX"}
        </div>
      </div>

      {assist && assist.telegraph && <div className="toast">{assist.telegraph}</div>}

      <div
        className="look-hit"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          look.current.yaw -= e.movementX * 0.005;
          look.current.pitch = clamp(look.current.pitch - e.movementY * 0.004, -0.9, 0.6);
          setLookYaw(look.current.yaw);
          setLookPitch(look.current.pitch);
        }}
      />

      <div className="lab-controls">
        <button type="button" className={unhealthy ? "hot" : ""} onClick={() => setUnhealthy((v) => !v)}>
          {unhealthy ? "Kart pose UNHEALTHY" : "Kart pose healthy (sim)"}
        </button>
        <button type="button" onClick={() => setLookSource((s) => (s === "hmd_slam" ? "helmet_vio" : "hmd_slam"))}>
          Look: {lookSource}
        </button>
        <button
          type="button"
          onClick={() => {
            look.current = { yaw: 0, pitch: -0.08 };
            setLookYaw(0);
            setLookPitch(-0.08);
          }}
        >
          Recenter look
        </button>
      </div>
      <div className="help">
        Drag to look (HMD SLAM sim) · WASD drive · Q/E pickups · H unhealthy KartVio · Phase 0 visual only · no motor
        assist
      </div>
    </div>
  );
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function fmt(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}
