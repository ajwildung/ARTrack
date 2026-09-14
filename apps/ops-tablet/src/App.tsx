import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionSnapshot } from "@voltage/shared";

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

async function postOps(action: string) {
  const r = await fetch(`/api/ops/${action}`, { method: "POST" });
  return r.json();
}

function fmtClock(snap: SessionSnapshot): string {
  if (snap.status === "lobby") return formatMs(snap.heatDurationMs);
  if (snap.status === "results") return "0:00.0";
  if (!snap.endsAt) return formatMs(snap.heatDurationMs);
  return formatMs(Math.max(0, snap.endsAt - snap.serverNow));
}

function formatMs(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}

export default function App() {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phase0, setPhase0] = useState<{ gate: string; emittedPhysicalOffsets: number; acceptedIntents: number } | null>(
    null,
  );
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "ops" }));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "hello_ok" || msg.type === "snapshot") setSnap(msg.snapshot);
        if (msg.type === "error") setErr(msg.message);
      };
      ws.onclose = () => {
        if (!cancelled) setTimeout(connect, 800);
      };
    };
    connect();
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/audit/phase0");
        if (!cancelled) setPhase0(await r.json());
      } catch {
        /* LAN hiccup */
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(poll);
      wsRef.current?.close();
    };
  }, []);

  const remaining = useMemo(() => (snap ? fmtClock(snap) : "—"), [snap]);

  if (!snap) {
    return (
      <div className="boot">
        <div className="wordmark">VOLTAGE LEAGUE</div>
        <div className="muted">Waiting for track LAN backend…</div>
      </div>
    );
  }

  const screen = snap.status;
  const headline =
    screen === "results" ? (snap.aborted ? "ABORTED" : "RESULTS") : snap.safeMode ? "SAFE MODE" : screen.toUpperCase();
  return (
    <div className={`shell status-${screen} ${snap.safeMode && screen === "live" ? "safe" : ""}`}>
      <header className="top">
        <div className="brand">
          <span className="bolt" aria-hidden>
            ⚡
          </span>
          <div>
            <div className="title">VOLTAGE LEAGUE</div>
            <div className="sub">Sprint Heat · track LAN ops</div>
          </div>
        </div>
        <div className="pills">
          <span className="pill phase">PHASE {snap.phase}</span>
          <span className="pill vis">VISUAL ONLY</span>
          <span className="pill loc">LOC {snap.localization.provider.toUpperCase()}</span>
          <span className={`pill gate ${phase0?.gate === "PASS" ? "ok" : ""}`}>
            GATE {phase0?.gate ?? "…"} · phys {phase0?.emittedPhysicalOffsets ?? "–"}
          </span>
        </div>
      </header>

      <section className="hero">
        <div className="clock-block">
          <div className="clock-label">{screen === "lobby" ? "HEAT LENGTH" : screen === "live" ? "REMAINING" : "FINAL"}</div>
          <div className="clock">{remaining}</div>
        </div>
        <div className="state-block">
          <div className="state-label">SESSION</div>
          <div className="state">{headline}</div>
          <div className="muted tiny">
            {snap.karts.length} karts · {snap.pads.length} pads · {snap.pickups.length} pickups live · actuators absent
          </div>
        </div>
      </section>

      {err && <div className="banner">{err}</div>}

      {screen === "lobby" && <Lobby snap={snap} />}
      {screen === "live" && <Live snap={snap} />}
      {screen === "results" && <Results snap={snap} />}

      <footer className="actions">
        <button className="btn seed" onClick={() => postOps("seed_sims")} disabled={screen !== "lobby"}>
          Seed sim karts
        </button>
        <button className="btn start" onClick={() => postOps("start")} disabled={screen !== "lobby" || snap.karts.length < 1}>
          Start
        </button>
        <button className="btn abort" onClick={() => postOps("abort")} disabled={screen === "results"}>
          Abort
        </button>
        <button className="btn safe" onClick={() => postOps("safe_mode")} disabled={screen !== "live" || snap.safeMode}>
          Safe Mode
        </button>
        <button className="btn reset" onClick={() => postOps("reset")} disabled={screen === "live"}>
          Reset lobby
        </button>
      </footer>
    </div>
  );
}

function Lobby({ snap }: { snap: SessionSnapshot }) {
  return (
    <main className="panel">
      <h2>Lobby</h2>
      <p className="muted">
        Race-only M1: Sprint Heat. Soft-visual pads + pickups. No CAN torque / motor overlay. Localization is a track-local
        stub.
      </p>
      <KartTable snap={snap} />
      {snap.karts.length === 0 && <p className="empty">No karts yet — open the HUD or seed sims.</p>}
    </main>
  );
}

function Live({ snap }: { snap: SessionSnapshot }) {
  return (
    <main className="panel live-grid">
      <div>
        <h2>Live</h2>
        <KartTable snap={snap} />
      </div>
      <aside>
        <h2>Economy</h2>
        <ul className="econ">
          {snap.pads.map((p) => (
            <li key={p.id}>
              <span className="tag pad">PAD</span> {p.id}
              <span className="muted">
                {p.lastHitKartId ? ` last ${p.lastHitKartId}` : " idle"}
              </span>
            </li>
          ))}
          {snap.pickups.length === 0 && <li className="muted">No pickups on nodes</li>}
          {snap.pickups.map((p) => (
            <li key={p.nodeId}>
              <span className={`tag ${p.kind}`}>{p.kind}</span> {p.nodeId}
            </li>
          ))}
        </ul>
        {snap.safeMode && <div className="safe-note">Boosts cancelled. Economy frozen. Fail-safe {snap.failsafe.lastLatencyMs?.toFixed(1)}ms.</div>}
      </aside>
    </main>
  );
}

function Results({ snap }: { snap: SessionSnapshot }) {
  const rows = snap.results ?? [];
  return (
    <main className="panel">
      <h2>Results {snap.aborted ? "· aborted" : ""}</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Kart</th>
            <th>Laps</th>
            <th>Distance</th>
            <th>Pads</th>
            <th>Pickups</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kartId}>
              <td>{r.rank}</td>
              <td>{r.name}</td>
              <td>{r.laps}</td>
              <td>{r.distanceM.toFixed(1)} m</td>
              <td>{r.padHits}</td>
              <td>{r.pickups}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function KartTable({ snap }: { snap: SessionSnapshot }) {
  return (
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Kart</th>
          <th>Link</th>
          <th>Laps</th>
          <th>Speed</th>
          <th>Inv</th>
          <th>Surge</th>
        </tr>
      </thead>
      <tbody>
        {snap.karts.map((k) => (
          <tr key={k.id}>
            <td>
              <i className="swatch" style={{ background: k.color }} />
            </td>
            <td>
              {k.name} <span className="muted">{k.sim ? "sim" : k.id}</span>
            </td>
            <td>{k.connected ? "up" : "down"}</td>
            <td>{k.laps}</td>
            <td>{k.speedMps.toFixed(1)}</td>
            <td>
              D{k.inventory.defensive} P{k.inventory.pace}
            </td>
            <td>{k.surgeUntil > snap.serverNow ? "VIS" : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
