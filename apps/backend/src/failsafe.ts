import { randomUUID } from "node:crypto";
import { RULES, type FailSafePublic } from "@voltage/shared";
import type { Db } from "./db.ts";
import type { AssistGateway } from "./assist.ts";
import type { KartState } from "./kart.ts";

export class FailSafe {
  public last: FailSafePublic = {
    lastReason: null,
    lastLatencyMs: null,
    lastWithinBudget: null,
    lastAt: null,
  };

  constructor(
    private db: Db,
    private assist: AssistGateway,
  ) {}

  /**
   * Cancel all visual boosts. Budget: ≤500ms from trip to cancel broadcast payload ready.
   * Feel target 100–150ms is client-predicted; this measures server cancel path.
   */
  trip(
    sessionId: string,
    reason: "abort" | "safe_mode",
    karts: KartState[],
    now = Date.now(),
  ): { latencyMs: number; cancelled: number; records: ReturnType<AssistGateway["emitVisual"]>[] } {
    const t0 = performance.now();
    const records = [];
    let cancelled = 0;
    for (const kart of karts) {
      const hadSurge = kart.surgeUntil > now;
      kart.surgeUntil = 0;
      kart.padCooldownUntil = now;
      if (hadSurge) {
        cancelled += 1;
        records.push(
          this.assist.emitVisual({
            sessionId,
            kartId: kart.id,
            vfx: "cancel",
            durationMs: 0,
            telegraph: `failsafe:${reason}`,
          }),
        );
      }
    }
    const latencyMs = performance.now() - t0;
    const withinBudget = latencyMs <= RULES.failSafeCancelBudgetMs;
    this.last = {
      lastReason: reason,
      lastLatencyMs: latencyMs,
      lastWithinBudget: withinBudget,
      lastAt: now,
    };
    this.db.insertFailsafe({
      id: randomUUID(),
      sessionId,
      ts: now,
      reason,
      cancelLatencyMs: latencyMs,
      cancelledCount: cancelled,
      withinBudget,
    });
    this.db.insertEvent(sessionId, "failsafe", null, { reason, latencyMs, cancelled, withinBudget });
    return { latencyMs, cancelled, records };
  }
}
