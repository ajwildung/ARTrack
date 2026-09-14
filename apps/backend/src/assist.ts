import { randomUUID } from "node:crypto";
import {
  FORBIDDEN_ASSIST_FIELDS,
  PHASE,
  type AssistRecord,
  type ForbiddenAssistField,
  type VfxType,
} from "@voltage/shared";

export type { AssistRecord };
import type { Db } from "./db.ts";

export class Phase0Violation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase0Violation";
  }
}

export interface EmitVisualInput {
  sessionId: string;
  kartId: string;
  vfx: VfxType;
  durationMs: number;
  telegraph?: string;
}

/**
 * AssistGateway — Phase 0 visual-only.
 * Never emits CAN torque, motor overlay, or physical offsets.
 * Actuators are absent; any physical command is a hard fail (rejected + audited).
 */
export class AssistGateway {
  constructor(private db: Db) {}

  emitVisual(input: EmitVisualInput): AssistRecord {
    const record: AssistRecord = {
      intentId: randomUUID(),
      sessionId: input.sessionId,
      kartId: input.kartId,
      ts: Date.now(),
      phase: PHASE,
      channel: "visual",
      vfx: { type: input.vfx, durationMs: input.durationMs },
      telegraph: input.telegraph,
      physicalOffset: null,
      canTorqueNm: null,
      motorOverlay: null,
      actuatorPresent: false,
      rejected: false,
      rejectReason: null,
    };
    this.assertEmittedVisualOnly(record);
    this.db.insertAssist(record);
    this.db.insertEvent(input.sessionId, "assist_visual", input.kartId, {
      vfx: input.vfx,
      durationMs: input.durationMs,
    });
    return record;
  }

  /**
   * Probe path for QA / smoke: prove physical commands are rejected when actuators are absent.
   * Nothing physical is ever written to the emitted columns.
   */
  rejectPhysicalAttempt(sessionId: string, kartId: string, attempt: Record<string, unknown>): AssistRecord {
    const hits = forbiddenHits(attempt);
    const record: AssistRecord = {
      intentId: randomUUID(),
      sessionId,
      kartId,
      ts: Date.now(),
      phase: PHASE,
      channel: "visual",
      vfx: { type: "cancel", durationMs: 0 },
      physicalOffset: null,
      canTorqueNm: null,
      motorOverlay: null,
      actuatorPresent: false,
      rejected: true,
      rejectReason: `Phase 0 gate: refused physical assist (${hits.join(", ") || "unspecified"}). Actuators absent.`,
    };
    this.db.insertAssist(record);
    this.db.insertEvent(sessionId, "assist_physical_rejected", kartId, { attempt, hits });
    return record;
  }

  assertEmittedVisualOnly(record: AssistRecord): void {
    if (record.phase !== 0) throw new Phase0Violation("phase must be 0");
    if (record.channel !== "visual") throw new Phase0Violation("channel must be visual");
    if (record.actuatorPresent) throw new Phase0Violation("actuators must be absent in Phase 0");
    if (record.physicalOffset !== null) throw new Phase0Violation("physicalOffset must be null");
    if (record.canTorqueNm !== null) throw new Phase0Violation("canTorqueNm must be null");
    if (record.motorOverlay !== null) throw new Phase0Violation("motorOverlay must be null");
    const hits = forbiddenHits(record as unknown as Record<string, unknown>);
    if (hits.length) {
      throw new Phase0Violation(`forbidden assist fields: ${hits.join(", ")}`);
    }
  }
}

export function forbiddenHits(obj: Record<string, unknown>): ForbiddenAssistField[] {
  const hits: ForbiddenAssistField[] = [];
  for (const key of FORBIDDEN_ASSIST_FIELDS) {
    const v = obj[key];
    if (v !== undefined && v !== null) hits.push(key);
  }
  return hits;
}
