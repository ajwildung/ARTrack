import {
  RULES,
  defaultTrack,
  insideNode,
  insidePad,
  type PadState,
  type PickupKind,
  type PickupState,
  type TrackLayout,
  type VfxType,
} from "@voltage/shared";
import type { AssistRecord } from "@voltage/shared";
import type { AssistGateway } from "./assist.ts";
import type { Scoring } from "./scoring.ts";
import type { KartState } from "./kart.ts";
import { hasSlot } from "./kart.ts";

export class EconomyScheduler {
  track: TrackLayout;
  pads: PadState[];
  pickups: PickupState[] = [];
  nextPickupAt: number | null = null;
  frozen = false;

  constructor(
    padCount: number,
    pickupNodes: number,
    private assist: AssistGateway,
    private scoring: Scoring,
    private sessionId: () => string,
  ) {
    this.track = defaultTrack(padCount, pickupNodes);
    this.pads = this.track.pads.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      radiusM: p.radiusM,
      lastHitKartId: null,
      lastHitAt: null,
    }));
  }

  arm(now: number): void {
    this.frozen = false;
    this.pickups = [];
    this.nextPickupAt = now + jitter(RULES.pickupIntervalMs.min, RULES.pickupIntervalMs.max);
  }

  freeze(): void {
    this.frozen = true;
    this.nextPickupAt = null;
  }

  reset(): void {
    this.frozen = false;
    this.pickups = [];
    this.nextPickupAt = null;
    for (const p of this.pads) {
      p.lastHitKartId = null;
      p.lastHitAt = null;
    }
  }

  tick(karts: KartState[], now: number, live: boolean): AssistRecord[] {
    const out: AssistRecord[] = [];
    if (!live || this.frozen) return out;

    if (this.nextPickupAt != null && now >= this.nextPickupAt) {
      this.spawnPickups(now);
      this.nextPickupAt = now + jitter(RULES.pickupIntervalMs.min, RULES.pickupIntervalMs.max);
    }

    for (const kart of karts) {
      for (let i = 0; i < this.track.pads.length; i++) {
        const def = this.track.pads[i];
        if (!insidePad(kart, def)) continue;
        const rec = this.tryPad(kart, this.pads[i], now);
        if (rec) out.push(rec);
      }
      for (const pickup of [...this.pickups]) {
        const node = this.track.pickupNodes.find((n) => n.id === pickup.nodeId);
        if (!node || !insideNode(kart, node)) continue;
        const rec = this.tryCollect(kart, pickup, now);
        if (rec) out.push(rec);
      }
    }
    return out;
  }

  tryPad(kart: KartState, pad: PadState, now: number): AssistRecord | null {
    if (this.frozen) return null;
    if (kart.surgeUntil > now && !RULES.surgeStack) return null;
    if (kart.padCooldownUntil > now) return null;
    const durationMs = jitter(RULES.surgeVisualMs.min, RULES.surgeVisualMs.max);
    const cooldownMs = jitter(RULES.padCooldownMs.min, RULES.padCooldownMs.max);
    kart.surgeUntil = now + durationMs;
    kart.padCooldownUntil = now + cooldownMs;
    pad.lastHitKartId = kart.id;
    pad.lastHitAt = now;
    this.scoring.recordPad(kart.id);
    return this.assist.emitVisual({
      sessionId: this.sessionId(),
      kartId: kart.id,
      vfx: "surge",
      durationMs,
      telegraph: `PAD ${pad.id} · SURGE ${durationMs}ms · visual only`,
    });
  }

  tryCollect(kart: KartState, pickup: PickupState, now: number): AssistRecord | null {
    if (this.frozen) return null;
    if (!hasSlot(kart, pickup.kind)) return null;
    kart.inventory[pickup.kind] = 1;
    this.pickups = this.pickups.filter((p) => p.nodeId !== pickup.nodeId);
    this.scoring.recordPickup(kart.id);
    const vfx: VfxType = pickup.kind === "defensive" ? "pickup_defensive" : "pickup_pace";
    return this.assist.emitVisual({
      sessionId: this.sessionId(),
      kartId: kart.id,
      vfx,
      durationMs: 900,
      telegraph: `PICKUP ${pickup.kind.toUpperCase()} · inventory 1/${pickup.kind === "defensive" ? RULES.maxDefensive : RULES.maxPace}`,
    });
  }

  usePickup(kart: KartState, slot: PickupKind, now: number): AssistRecord | null {
    if (kart.inventory[slot] < 1) return null;
    kart.inventory[slot] = 0;
    const vfx: VfxType = slot === "defensive" ? "use_defensive" : "use_pace";
    return this.assist.emitVisual({
      sessionId: this.sessionId(),
      kartId: kart.id,
      vfx,
      durationMs: slot === "defensive" ? 1800 : 2200,
      telegraph: `USE ${slot.toUpperCase()} · visual telegraph`,
    });
  }

  spawnPickups(now: number): void {
    const nodes = this.track.pickupNodes;
    const count = jitterInt(RULES.pickupNodeCount.min, Math.min(RULES.pickupNodeCount.max, nodes.length));
    const shuffled = [...nodes].sort(() => Math.random() - 0.5).slice(0, count);
    this.pickups = shuffled.map((n) => ({
      nodeId: n.id,
      kind: Math.random() < 0.5 ? "defensive" : "pace",
      x: n.x,
      y: n.y,
      radiusM: n.radiusM,
      spawnedAt: now,
    }));
  }
}

function jitter(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

function jitterInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
