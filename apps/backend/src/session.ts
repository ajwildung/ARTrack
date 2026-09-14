import { randomUUID } from "node:crypto";
import {
  BRAND,
  DISABLED_M1,
  PHASE,
  RULES,
  approxLapLengthM,
  clampToAsphalt,
  racingPose,
  type KartPublic,
  type ResultRow,
  type SessionSnapshot,
  type SessionStatus,
} from "@voltage/shared";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { AssistGateway, type AssistRecord } from "./assist.ts";
import { EconomyScheduler } from "./economy.ts";
import { FailSafe } from "./failsafe.ts";
import { LocalizationStub } from "./localization.ts";
import { Scoring } from "./scoring.ts";
import { createKart, type KartState } from "./kart.ts";

export class SessionOrchestrator {
  sessionId = randomUUID();
  status: SessionStatus = "lobby";
  safeMode = false;
  aborted = false;
  startedAt: number | null = null;
  endsAt: number | null = null;
  karts: KartState[] = [];
  results: ResultRow[] | null = null;

  readonly scoring = new Scoring();
  readonly loc = new LocalizationStub();
  readonly assist: AssistGateway;
  readonly economy: EconomyScheduler;
  readonly failsafe: FailSafe;
  readonly lapLength: number;

  constructor(
    private cfg: Config,
    private db: Db,
  ) {
    this.assist = new AssistGateway(db);
    this.economy = new EconomyScheduler(cfg.padCount, cfg.pickupNodes, this.assist, this.scoring, () => this.sessionId);
    this.failsafe = new FailSafe(db, this.assist);
    this.lapLength = approxLapLengthM(this.economy.track);
  }

  snapshot(now = Date.now()): SessionSnapshot {
    return {
      phase: PHASE,
      brand: BRAND,
      mode: "sprint_heat",
      physicalAssistEnabled: false,
      actuatorsPresent: false,
      status: this.status,
      safeMode: this.safeMode,
      aborted: this.aborted,
      sessionId: this.sessionId,
      heatDurationMs: this.cfg.heatMs,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      serverNow: now,
      localization: {
        provider: "stub",
        frame: "track_local",
        note: this.loc.note,
      },
      disabled: DISABLED_M1,
      track: this.economy.track,
      karts: this.karts.map(publicKart),
      pads: this.economy.pads,
      pickups: this.economy.pickups,
      results: this.status === "results" ? this.results : this.scoring.standings(this.karts),
      failsafe: this.failsafe.last,
      economy: {
        nextPickupAt: this.economy.nextPickupAt,
        padCount: this.economy.track.pads.length,
        pickupNodes: this.economy.track.pickupNodes.length,
      },
    };
  }

  upsertKart(id: string, name: string, sim = false): KartState {
    const existing = this.karts.find((k) => k.id === id);
    if (existing) {
      existing.connected = true;
      existing.name = name || existing.name;
      existing.sim = sim || existing.sim;
      return existing;
    }
    const i = this.karts.length;
    const pose = racingPose(this.economy.track, (-i / 6) * 0.35);
    const kart = createKart(
      {
        id,
        name: name || id,
        sim,
        x: pose.x,
        y: pose.y,
        headingRad: pose.heading,
        theta: (-i / 6) * 0.35,
      },
      i,
    );
    this.karts.push(kart);
    this.db.insertEvent(this.sessionId, "kart_join", id, { name: kart.name, sim });
    return kart;
  }

  markDisconnected(kartId: string): void {
    const k = this.karts.find((x) => x.id === kartId);
    if (k) k.connected = false;
  }

  seedSims(count = 3): KartState[] {
    const added: KartState[] = [];
    for (let i = 0; i < count; i++) {
      const id = `SIM-${i + 1}`;
      if (this.karts.some((k) => k.id === id)) continue;
      added.push(this.upsertKart(id, `Sim ${i + 1}`, true));
    }
    return added;
  }

  start(now = Date.now()): { ok: boolean; error?: string; assists: AssistRecord[] } {
    if (this.status !== "lobby") return { ok: false, error: "Start is only available from Lobby", assists: [] };
    if (this.karts.length < 1) return { ok: false, error: "Need at least one kart in lobby", assists: [] };
    this.status = "live";
    this.safeMode = false;
    this.aborted = false;
    this.startedAt = now;
    this.endsAt = now + this.cfg.heatMs;
    this.results = null;
    this.scoring.reset();
    for (const k of this.karts) {
      k.laps = 0;
      k.distanceM = 0;
      k.lastS = 0;
      k.surgeUntil = 0;
      k.padCooldownUntil = 0;
      k.inventory = { defensive: 0, pace: 0 };
    }
    this.economy.arm(now);
    this.db.insertEvent(this.sessionId, "session_start", null, { heatMs: this.cfg.heatMs, karts: this.karts.length });
    return { ok: true, assists: [] };
  }

  abort(now = Date.now()): { ok: boolean; assists: AssistRecord[] } {
    if (this.status === "results") return { ok: false, assists: [] };
    const trip = this.failsafe.trip(this.sessionId, "abort", this.karts, now);
    this.aborted = true;
    this.economy.freeze();
    this.finish("abort", now);
    return { ok: true, assists: trip.records };
  }

  safe(now = Date.now()): { ok: boolean; error?: string; assists: AssistRecord[] } {
    if (this.status !== "live") return { ok: false, error: "Safe Mode is live-session only", assists: [] };
    this.safeMode = true;
    this.economy.freeze();
    const trip = this.failsafe.trip(this.sessionId, "safe_mode", this.karts, now);
    this.db.insertEvent(this.sessionId, "safe_mode", null, { latencyMs: trip.latencyMs });
    return { ok: true, assists: trip.records };
  }

  reset(): void {
    this.sessionId = randomUUID();
    this.status = "lobby";
    this.safeMode = false;
    this.aborted = false;
    this.startedAt = null;
    this.endsAt = null;
    this.results = null;
    this.scoring.reset();
    this.economy.reset();
    this.failsafe.last = { lastReason: null, lastLatencyMs: null, lastWithinBudget: null, lastAt: null };
    for (const k of this.karts) {
      k.laps = 0;
      k.distanceM = 0;
      k.surgeUntil = 0;
      k.padCooldownUntil = 0;
      k.inventory = { defensive: 0, pace: 0 };
    }
    this.db.insertEvent(this.sessionId, "session_reset", null, {});
  }

  tick(now = Date.now()): AssistRecord[] {
    const assists: AssistRecord[] = [];
    if (this.status === "live" && this.endsAt != null && now >= this.endsAt) {
      this.finish("timebox", now);
      return assists;
    }
    this.integrate(now);
    if (this.status === "live" && !this.safeMode) {
      assists.push(...this.economy.tick(this.karts, now, true));
    }
    return assists;
  }

  applySteer(kartId: string, throttle: number, steer: number): void {
    const k = this.karts.find((x) => x.id === kartId);
    if (!k) return;
    k.sim = false;
    k.throttle = clamp(throttle, -1, 1);
    k.steer = clamp(steer, -1, 1);
    k.lastPoseAt = Date.now();
    k.connected = true;
  }

  applyPose(pose: ReturnType<LocalizationStub["ingest"]>): void {
    const k = this.karts.find((x) => x.id === pose.kartId);
    if (!k) return;
    const ingested = this.loc.ingest(pose);
    k.x = ingested.x;
    k.y = ingested.y;
    k.headingRad = ingested.headingRad;
    k.speedMps = ingested.speedMps;
    k.locProvider = ingested.provider;
    k.lastPoseAt = ingested.ts;
    k.connected = true;
    k.sim = false;
    this.accumulateDistance(k);
  }

  usePickup(kartId: string, slot: "defensive" | "pace"): AssistRecord | null {
    const k = this.karts.find((x) => x.id === kartId);
    if (!k || this.status !== "live" || this.safeMode) return null;
    return this.economy.usePickup(k, slot, Date.now());
  }

  private finish(reason: string, now: number): void {
    this.status = "results";
    this.endsAt = now;
    this.economy.freeze();
    this.results = this.scoring.standings(this.karts);
    this.db.insertEvent(this.sessionId, "session_results", null, { reason, results: this.results });
  }

  private integrate(now: number): void {
    const dt = RULES.tickMs / 1000;
    const track = this.economy.track;
    for (const k of this.karts) {
      if (k.sim) {
        const base = 11 + (k.id.charCodeAt(k.id.length - 1) % 5);
        const boost = !this.safeMode && k.surgeUntil > now ? 1.08 : 1;
        k.speedMps = this.status === "live" ? base * (this.safeMode ? 0.35 : boost) : 0;
        k.theta += (k.speedMps / this.lapLength) * dt * Math.PI * 2;
        const pose = racingPose(track, k.theta);
        k.x = pose.x;
        k.y = pose.y;
        k.headingRad = pose.heading;
      } else if (k.lastPoseAt && now - k.lastPoseAt < 400) {
        const accel = k.throttle * 18;
        k.speedMps = clamp(k.speedMps + accel * dt - Math.sign(k.speedMps) * 3.2 * dt, -4, 22);
        k.headingRad += k.steer * dt * (1.1 + Math.abs(k.speedMps) * 0.12);
        const nx = k.x + Math.cos(k.headingRad) * k.speedMps * dt;
        const ny = k.y + Math.sin(k.headingRad) * k.speedMps * dt;
        const clamped = clampToAsphalt(track, { x: nx, y: ny });
        k.x = clamped.x;
        k.y = clamped.y;
      }
      if (this.status === "live" && (k.sim || k.throttle !== 0 || k.speedMps > 0.4)) {
        this.accumulateDistance(k);
      }
    }
  }

  private accumulateDistance(k: KartState): void {
    const s = (Math.atan2(k.y / this.economy.track.racing.ry, k.x / this.economy.track.racing.rx) + Math.PI * 2) % (Math.PI * 2);
    if (k.lastS > 4.5 && s < 1.5) k.laps += 1;
    k.lastS = s;
    k.distanceM = k.laps * this.lapLength + (s / (Math.PI * 2)) * this.lapLength;
  }
}

function publicKart(k: KartState): KartPublic {
  return {
    id: k.id,
    name: k.name,
    color: k.color,
    connected: k.connected,
    sim: k.sim,
    x: k.x,
    y: k.y,
    headingRad: k.headingRad,
    speedMps: k.speedMps,
    laps: k.laps,
    distanceM: Math.round(k.distanceM * 10) / 10,
    surgeUntil: k.surgeUntil,
    padCooldownUntil: k.padCooldownUntil,
    inventory: { ...k.inventory },
    locProvider: k.locProvider,
  };
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}
