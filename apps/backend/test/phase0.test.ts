import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FORBIDDEN_ASSIST_FIELDS, RULES } from "@voltage/shared";
import { openDb } from "../src/db.ts";
import { forbiddenHits } from "../src/assist.ts";
import { SessionOrchestrator } from "../src/session.ts";
import { loadConfig } from "../src/config.ts";

function tmpSession() {
  const dir = mkdtempSync(join(tmpdir(), "vl-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const cfg = loadConfig({ dbPath, heatMs: 4000, port: 0, allowGateProbe: true });
  const session = new SessionOrchestrator(cfg, db);
  return { db, session };
}

describe("AssistGateway Phase 0 hard gate", () => {
  it("emits visual-only intents with null physical columns", () => {
    const { db, session } = tmpSession();
    const rec = session.assist.emitVisual({
      sessionId: session.sessionId,
      kartId: "K1",
      vfx: "surge",
      durationMs: 2000,
    });
    assert.equal(rec.phase, 0);
    assert.equal(rec.channel, "visual");
    assert.equal(rec.physicalOffset, null);
    assert.equal(rec.canTorqueNm, null);
    assert.equal(rec.motorOverlay, null);
    assert.equal(rec.actuatorPresent, false);
    assert.equal(rec.rejected, false);
    assert.deepEqual(forbiddenHits(rec as unknown as Record<string, unknown>), []);
    const report = db.phase0Report(session.sessionId);
    assert.equal(report.gate, "PASS");
    assert.equal(report.emittedPhysicalOffsets, 0);
    assert.equal(report.acceptedIntents, 1);
    db.close();
  });

  it("rejects physical / CAN / motor overlay attempts and never emits them", () => {
    const { db, session } = tmpSession();
    const attempt = {
      channel: "physical",
      canTorqueNm: 42,
      motorOverlay: { pwmDuty: 0.4 },
      physicalOffset: { torqueNm: 12 },
      actuatorCommand: { enable: true },
    };
    const rec = session.assist.rejectPhysicalAttempt(session.sessionId, "K1", attempt);
    assert.equal(rec.rejected, true);
    assert.equal(rec.physicalOffset, null);
    assert.equal(rec.canTorqueNm, null);
    assert.equal(rec.motorOverlay, null);
    assert.equal(rec.actuatorPresent, false);
    assert.equal(rec.channel, "visual");
    const report = db.phase0Report(session.sessionId);
    assert.equal(report.rejectedPhysicalAttempts, 1);
    assert.equal(report.emittedPhysicalOffsets, 0);
    assert.equal(report.gate, "PASS");
    const stored = db.listAssist(session.sessionId)[0];
    assert.equal(stored.canTorqueNm, null);
    db.close();
  });

  it("lists every forbidden field used by the gate", () => {
    assert.ok(FORBIDDEN_ASSIST_FIELDS.includes("canTorqueNm"));
    assert.ok(FORBIDDEN_ASSIST_FIELDS.includes("motorOverlay"));
    assert.ok(FORBIDDEN_ASSIST_FIELDS.includes("physicalOffset"));
  });
});

describe("Sprint Heat economy", () => {
  it("triggers a visual surge on pad hit and refuses stacking", () => {
    const { db, session } = tmpSession();
    const kart = session.upsertKart("K1", "Alpha");
    session.start();
    const pad = session.economy.pads[0];
    kart.x = pad.x;
    kart.y = pad.y;
    const a = session.economy.tryPad(kart, pad, Date.now());
    assert.equal(a?.vfx.type, "surge");
    assert.equal(a?.channel, "visual");
    const stacked = session.economy.tryPad(kart, pad, Date.now() + 100);
    assert.equal(stacked, null);
    assert.ok(kart.surgeUntil > Date.now());
    db.close();
  });

  it("caps inventory at 1 defensive + 1 pace", () => {
    const { db, session } = tmpSession();
    const kart = session.upsertKart("K1", "Alpha");
    session.start();
    const node = session.economy.track.pickupNodes[0];
    const now = Date.now();
    session.economy.pickups = [
      { nodeId: node.id, kind: "defensive", x: node.x, y: node.y, radiusM: node.radiusM, spawnedAt: now },
    ];
    kart.x = node.x;
    kart.y = node.y;
    assert.equal(session.economy.tryCollect(kart, session.economy.pickups[0], now)?.vfx.type, "pickup_defensive");
    session.economy.pickups = [
      { nodeId: node.id, kind: "defensive", x: node.x, y: node.y, radiusM: node.radiusM, spawnedAt: now },
    ];
    assert.equal(session.economy.tryCollect(kart, session.economy.pickups[0], now + 1), null);
    assert.equal(kart.inventory.defensive, 1);
    db.close();
  });
});

describe("Session + failsafe", () => {
  it("runs lobby → live → results and Safe Mode cancel ≤500ms", () => {
    const { db, session } = tmpSession();
    const kart = session.upsertKart("K1", "Alpha");
    assert.equal(session.start().ok, true);
    assert.equal(session.status, "live");
    kart.surgeUntil = Date.now() + 2000;
    const trip = session.safe();
    assert.equal(trip.ok, true);
    assert.equal(session.safeMode, true);
    assert.ok((session.failsafe.last.lastLatencyMs ?? 999) <= RULES.failSafeCancelBudgetMs);
    assert.equal(session.failsafe.last.lastWithinBudget, true);
    assert.equal(kart.surgeUntil, 0);
    session.abort();
    assert.equal(session.status, "results");
    db.close();
  });

  it("does not start without karts", () => {
    const { db, session } = tmpSession();
    assert.equal(session.start().ok, false);
    db.close();
  });
});
