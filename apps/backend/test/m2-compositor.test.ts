import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CALIB,
  composeWorldView,
  defaultTrack,
  fuseDualPose,
  kartWorldHealth,
  projectWorldPoint,
  stubHealthyKart,
  worldFxPrimitives,
  WORLD_FX_MIN_QUALITY,
} from "@voltage/shared";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { loadConfig } from "../src/config.ts";
import { SessionOrchestrator } from "../src/session.ts";
import { createLocalization, DualPoseFusionEngine, LocalizationStub } from "../src/localization.ts";

describe("M2 dual-pose fusion", () => {
  it("keeps stub factory for stub/rtk/uwb and dual-fusion otherwise", () => {
    assert.equal(createLocalization("stub").provider, "stub");
    assert.equal(createLocalization("rtk").provider, "stub");
    const fusion = createLocalization("kart_vio");
    assert.ok(fusion instanceof DualPoseFusionEngine);
    assert.equal(fusion.provider, "stub"); // reports stub until a hardware sample
  });

  it("treats ARCore as a first-class kart world backend (ARKit is an optional iOS peer)", () => {
    const loc = createLocalization("arcore");
    assert.ok(loc instanceof DualPoseFusionEngine);
    const now = Date.now();
    const fused = loc.ingestDual(
      {
        kartId: "SAMSUNG-1",
        kartWorld: {
          kartId: "SAMSUNG-1",
          frame: "track_local",
          x: 4,
          y: 0,
          z: 1,
          yawRad: 0.1,
          pitchRad: 0,
          rollRad: 0,
          speedMps: 6,
          provider: "arcore",
          quality: 0.88,
          ts: now,
        },
        lookSource: "hmd_slam",
      },
      now,
    );
    assert.equal(fused.worldFxAllowed, true);
    assert.equal(loc.kart.last.get("SAMSUNG-1")?.provider, "arcore");
    assert.equal(loc.describe().kartProvider, "arcore");
    assert.ok(loc.note.includes("ARCore"));
    assert.ok(loc.note.includes("no iPhone-only"));

    const apple = createLocalization("arkit");
    assert.ok(apple instanceof DualPoseFusionEngine);
    apple.ingestKartWorld({
      kartId: "IOS-1",
      frame: "track_local",
      x: 0,
      y: 0,
      z: 0,
      yawRad: 0,
      pitchRad: 0,
      rollRad: 0,
      speedMps: 0,
      provider: "arkit",
      quality: 0.9,
      ts: now,
    });
    assert.equal(apple.kart.last.get("IOS-1")?.provider, "arkit");
    assert.equal(apple.describe().kartProvider, "arkit");
  });

  it("M1 planar ingest still works on the stub engine", () => {
    const loc = new LocalizationStub();
    const pose = loc.ingest({
      kartId: "K1",
      frame: "track_local",
      x: 1,
      y: 2,
      headingRad: 0.3,
      speedMps: 4,
      provider: "stub",
      quality: 1,
      ts: Date.now(),
    });
    assert.equal(pose.frame, "track_local");
    const fused = loc.fused("K1");
    assert.equal(fused.worldFxAllowed, true);
    assert.equal(fused.kartWorldHealthy, true);
  });

  it("KartVio + HmdSlam fusion places HMD at the seat and allows world FX", () => {
    const loc = new DualPoseFusionEngine();
    const now = Date.now();
    const fused = loc.ingestDual(
      {
        kartId: "QUEST-1",
        kartWorld: {
          kartId: "QUEST-1",
          frame: "track_local",
          x: 10,
          y: 0,
          z: 0,
          yawRad: 0,
          pitchRad: 0,
          rollRad: 0,
          speedMps: 8,
          provider: "kart_vio",
          quality: 0.92,
          ts: now,
        },
        look: {
          kartId: "QUEST-1",
          frame: "kart_body",
          x: 0,
          y: 0,
          z: 0,
          yawRad: 0.2,
          pitchRad: -0.05,
          rollRad: 0,
          speedMps: 0,
          provider: "hmd_slam",
          quality: 0.9,
          ts: now,
        },
        lookSource: "hmd_slam",
      },
      now,
    );
    assert.equal(loc.provider, "dual_fusion");
    assert.equal(fused.worldFxAllowed, true);
    assert.equal(fused.kartWorldHealthy, true);
    assert.ok(fused.hmdInWorld);
    assert.ok(Math.abs(fused.hmdInWorld!.x - (10 + DEFAULT_CALIB.seatForwardM)) < 0.05);
    assert.ok(Math.abs(fused.hmdInWorld!.y - DEFAULT_CALIB.seatUpM) < 0.05);
    assert.ok(Math.abs(fused.hmdInWorld!.yawRad - 0.2) < 1e-6);
  });

  it("hides world FX when kart world pose is low quality, stale, or missing", () => {
    const now = Date.now();
    const base = stubHealthyKart("K1", 0, 0, 0, now);
    assert.equal(fuseDualPose({ kartId: "K1", kartWorld: { ...base, quality: 0.1 }, lookSource: "hmd_slam" }, now).worldFxAllowed, false);
    assert.equal(fuseDualPose({ kartId: "K1", kartWorld: { ...base, ts: now - 5000 }, lookSource: "sim" }, now).worldFxAllowed, false);
    assert.equal(kartWorldHealth(null, now).ok, false);
    assert.ok(WORLD_FX_MIN_QUALITY > 0);
  });
});

describe("M2 world compositor", () => {
  it("projects a point ahead of the camera near NDC origin", () => {
    const cam = stubHealthyKart("K1", 0, 0, 0, Date.now());
    cam.y = 1;
    const p = projectWorldPoint({ x: 8, y: 1, z: 0 }, cam);
    assert.equal(p.inFront, true);
    assert.ok(Math.abs(p.nx) < 0.05, `nx=${p.nx}`);
    assert.ok(p.depth > 7);
  });

  it("emits pad and gate primitives and hides them when fusion is unhealthy", () => {
    const track = defaultTrack();
    assert.ok(track.gates.length >= 1);
    assert.ok(track.gates.some((g) => g.kind === "start_finish"));
    const prims = worldFxPrimitives(track, []);
    assert.ok(prims.some((p) => p.kind === "pad"));
    assert.ok(prims.some((p) => p.kind === "gate"));

    const now = Date.now();
    const healthy = fuseDualPose(
      { kartId: "K1", kartWorld: stubHealthyKart("K1", 46.5, 0, Math.PI / 2, now), lookSource: "sim" },
      now,
    );
    const shown = composeWorldView(healthy, prims);
    assert.equal(shown.allowed, true);
    assert.ok(shown.projected.length > 0);

    const sick = fuseDualPose(
      { kartId: "K1", kartWorld: { ...stubHealthyKart("K1", 46.5, 0, Math.PI / 2, now), quality: 0 }, lookSource: "hmd_slam" },
      now,
    );
    const hidden = composeWorldView(sick, prims);
    assert.equal(hidden.allowed, false);
    assert.equal(hidden.projected.length, 0);
    assert.equal(hidden.hideReason, "low_quality");
  });
});

describe("M2 headset session", () => {
  it("headset session + unhealthy KartVio hides world FX without emitting physical assist", () => {
    const dir = mkdtempSync(join(tmpdir(), "vl-m2-"));
    const db = openDb(join(dir, "t.sqlite"));
    const session = new SessionOrchestrator(loadConfig({ dbPath: join(dir, "t.sqlite"), heatMs: 4000, port: 0 }), db);
    const kart = session.upsertKart("QUEST-1", "Quest Lab", false, "headset");
    assert.equal(kart.headsetConnected, true);
    session.start();
    const now = Date.now();
    session.applyDualPose({
      kartId: "QUEST-1",
      kartWorld: {
        kartId: "QUEST-1",
        frame: "track_local",
        x: kart.x,
        y: 0,
        z: kart.y,
        yawRad: kart.headingRad,
        pitchRad: 0,
        rollRad: 0,
        speedMps: 0,
        provider: "kart_vio",
        quality: 0.12,
        ts: now,
      },
      lookSource: "hmd_slam",
      look: {
        kartId: "QUEST-1",
        frame: "kart_body",
        x: 0,
        y: 0,
        z: 0,
        yawRad: 0,
        pitchRad: 0,
        rollRad: 0,
        speedMps: 0,
        provider: "hmd_slam",
        quality: 0.9,
        ts: now,
      },
    });
    const snap = session.snapshot(now);
    const q = snap.karts.find((k) => k.id === "QUEST-1");
    assert.equal(q?.headsetConnected, true);
    assert.equal(q?.worldFxAllowed, false);
    assert.equal(q?.worldPoseHealthy, false);
    assert.equal(snap.compositor.labDisplay, "quest_openxr_passthrough");
    assert.equal(snap.compositor.eyeridePath, false);
    assert.equal(snap.phase, 0);
    assert.equal(snap.physicalAssistEnabled, false);
    const report = db.phase0Report(session.sessionId);
    assert.equal(report.emittedPhysicalOffsets, 0);
    db.close();
  });
});
