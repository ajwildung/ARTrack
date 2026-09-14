import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AssistRecord, Phase0Report } from "@voltage/shared";

export interface Db {
  raw: DatabaseSync;
  insertAssist(row: AssistRecord): void;
  insertEvent(sessionId: string, kind: string, kartId: string | null, payload: unknown): void;
  insertFailsafe(row: {
    id: string;
    sessionId: string;
    ts: number;
    reason: string;
    cancelLatencyMs: number;
    cancelledCount: number;
    withinBudget: boolean;
  }): void;
  listAssist(sessionId?: string): AssistRecord[];
  listEvents(sessionId?: string): Array<{ ts: number; kind: string; kartId: string | null; payload: unknown }>;
  phase0Report(sessionId?: string): Phase0Report;
  close(): void;
}

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS assist_intents (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      ts INTEGER NOT NULL,
      kart_id TEXT,
      channel TEXT NOT NULL,
      vfx_type TEXT,
      duration_ms INTEGER,
      physical_offset TEXT,
      can_torque_nm REAL,
      motor_overlay TEXT,
      actuator_present INTEGER NOT NULL DEFAULT 0,
      rejected INTEGER NOT NULL DEFAULT 0,
      reject_reason TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      kart_id TEXT,
      payload_json TEXT
    );
    CREATE TABLE IF NOT EXISTS failsafe_trips (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      ts INTEGER NOT NULL,
      reason TEXT,
      cancel_latency_ms REAL,
      cancelled_count INTEGER,
      within_budget INTEGER
    );
  `);

  const insertAssistStmt = raw.prepare(`
    INSERT INTO assist_intents (
      id, session_id, ts, kart_id, channel, vfx_type, duration_ms,
      physical_offset, can_torque_nm, motor_overlay, actuator_present,
      rejected, reject_reason, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEventStmt = raw.prepare(
    `INSERT INTO events (session_id, ts, kind, kart_id, payload_json) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertFailsafeStmt = raw.prepare(
    `INSERT INTO failsafe_trips (id, session_id, ts, reason, cancel_latency_ms, cancelled_count, within_budget)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    raw,
    insertAssist(row) {
      insertAssistStmt.run(
        row.intentId,
        row.sessionId,
        row.ts,
        row.kartId,
        row.channel,
        row.vfx.type,
        row.vfx.durationMs,
        row.physicalOffset,
        row.canTorqueNm,
        row.motorOverlay,
        row.actuatorPresent ? 1 : 0,
        row.rejected ? 1 : 0,
        row.rejectReason,
        JSON.stringify(row),
      );
    },
    insertEvent(sessionId, kind, kartId, payload) {
      insertEventStmt.run(sessionId, Date.now(), kind, kartId, JSON.stringify(payload ?? {}));
    },
    insertFailsafe(row) {
      insertFailsafeStmt.run(
        row.id,
        row.sessionId,
        row.ts,
        row.reason,
        row.cancelLatencyMs,
        row.cancelledCount,
        row.withinBudget ? 1 : 0,
      );
    },
    listAssist(sessionId) {
      const rows = sessionId
        ? raw.prepare(`SELECT payload_json FROM assist_intents WHERE session_id = ? ORDER BY ts ASC`).all(sessionId)
        : raw.prepare(`SELECT payload_json FROM assist_intents ORDER BY ts ASC`).all();
      return rows.map((r) => JSON.parse(String(r.payload_json)) as AssistRecord);
    },
    listEvents(sessionId) {
      const rows = sessionId
        ? raw.prepare(`SELECT ts, kind, kart_id, payload_json FROM events WHERE session_id = ? ORDER BY ts ASC`).all(sessionId)
        : raw.prepare(`SELECT ts, kind, kart_id, payload_json FROM events ORDER BY ts ASC`).all();
      return rows.map((r) => ({
        ts: Number(r.ts),
        kind: String(r.kind),
        kartId: r.kart_id == null ? null : String(r.kart_id),
        payload: JSON.parse(String(r.payload_json)),
      }));
    },
    phase0Report(sessionId) {
      return computePhase0(raw, sessionId);
    },
    close() {
      raw.close();
    },
  };
}

function computePhase0(raw: DatabaseSync, sessionId?: string): Phase0Report {
  const acceptedN = count(
    raw,
    sessionId
      ? ["SELECT COUNT(*) AS c FROM assist_intents WHERE session_id = ? AND rejected = 0", sessionId]
      : ["SELECT COUNT(*) AS c FROM assist_intents WHERE rejected = 0"],
  );
  const rejectedN = count(
    raw,
    sessionId
      ? ["SELECT COUNT(*) AS c FROM assist_intents WHERE session_id = ? AND rejected = 1", sessionId]
      : ["SELECT COUNT(*) AS c FROM assist_intents WHERE rejected = 1"],
  );
  const physicalN = count(
    raw,
    sessionId
      ? [
          `SELECT COUNT(*) AS c FROM assist_intents WHERE session_id = ? AND rejected = 0
           AND (physical_offset IS NOT NULL OR can_torque_nm IS NOT NULL OR motor_overlay IS NOT NULL
                OR actuator_present != 0 OR channel != 'visual')`,
          sessionId,
        ]
      : [
          `SELECT COUNT(*) AS c FROM assist_intents WHERE rejected = 0
           AND (physical_offset IS NOT NULL OR can_torque_nm IS NOT NULL OR motor_overlay IS NOT NULL
                OR actuator_present != 0 OR channel != 'visual')`,
        ],
  );
  const trips = count(
    raw,
    sessionId
      ? ["SELECT COUNT(*) AS c FROM failsafe_trips WHERE session_id = ?", sessionId]
      : ["SELECT COUNT(*) AS c FROM failsafe_trips"],
  );
  const over = count(
    raw,
    sessionId
      ? ["SELECT COUNT(*) AS c FROM failsafe_trips WHERE session_id = ? AND within_budget = 0", sessionId]
      : ["SELECT COUNT(*) AS c FROM failsafe_trips WHERE within_budget = 0"],
  );

  const notes: string[] = [
    "Phase 0 hard gate: AssistGateway is visual-only. Actuators are absent.",
    "emittedPhysicalOffsets must be 0. Any physical CAN/torque/motor overlay = FAIL.",
  ];
  const gate: "PASS" | "FAIL" = physicalN === 0 && over === 0 ? "PASS" : "FAIL";
  if (gate === "PASS") notes.push("Audit clean: no physical offsets on accepted intents; failsafe within 500ms budget.");
  if (physicalN > 0) notes.push("FAIL: accepted assist rows contain physical channels.");
  if (over > 0) notes.push("FAIL: failsafe cancel exceeded 500ms budget.");

  return {
    phase: 0,
    physicalAssistEnabled: false,
    actuatorsPresent: false,
    acceptedIntents: acceptedN,
    rejectedPhysicalAttempts: rejectedN,
    emittedPhysicalOffsets: physicalN,
    acceptedWithForbiddenFields: physicalN,
    failsafeTrips: trips,
    failsafeOverBudget: over,
    gate,
    notes,
  };
}

function count(raw: DatabaseSync, spec: [string] | [string, string]): number {
  const [sql, arg] = spec;
  const row = arg === undefined ? raw.prepare(sql).get() : raw.prepare(sql).get(arg);
  return Number(row?.c ?? 0);
}
