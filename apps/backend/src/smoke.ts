/**
 * M1 smoke: Lobby → Live pad surge → physical probe rejected → Safe Mode → audit PASS.
 * Run: npm run smoke
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startVoltageServer } from "./server.ts";

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "vl-smoke-"));
  const server = await startVoltageServer({
    port: 0,
    host: "127.0.0.1",
    heatMs: 8000,
    dbPath: join(dir, "smoke.sqlite"),
    allowGateProbe: true,
  });
  const base = server.url;
  const fail: string[] = [];
  const pass: string[] = [];

  const check = (name: string, cond: boolean, extra?: unknown) => {
    if (cond) pass.push(name);
    else {
      fail.push(name);
      console.error("FAIL", name, extra ?? "");
    }
  };

  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    check("health phase=0", health.phase === 0);
    check("health physicalAssistEnabled=false", health.physicalAssistEnabled === false);
    check("health brand", health.brand === "Voltage League");
    check("health platform pro2 visual-only", health.platform === "ninebot_gokart_pro2" && health.actuatorsPresent === false);
    check("health localization stub", health.localization?.provider === "stub");
    check("health compositor quest lab", health.compositor?.labDisplay === "quest_openxr_passthrough");
    check("health no eyeride path", health.display?.eyeride === false && health.compositor?.eyeridePath === false);
    check("health world FX policy", health.compositor?.worldFxPolicy === "hide_if_kart_world_unhealthy");
    check("health fusion note", typeof health.localization?.note === "string");

    await fetch(`${base}/api/ops/seed_sims`, { method: "POST" });
    const started = await (await fetch(`${base}/api/ops/start`, { method: "POST" })).json();
    check("start live", started.ok === true && started.snapshot.status === "live");
    check("heat 8:00 default overridden for smoke", started.snapshot.heatDurationMs === 8000);
    check("pads 2-4", started.snapshot.pads.length >= 2 && started.snapshot.pads.length <= 4);
    check("gates present", Array.isArray(started.snapshot.track?.gates) && started.snapshot.track.gates.length >= 1);

    const headset = await headsetDualPose(base.replace("http", "ws") + "/ws", "SMOKE-QUEST");
    check("headset hello joins session", headset.joined);
    check("unhealthy KartVio hides world FX", headset.hidden === true && headset.hideReason === "low_quality");
    check("healthy dual pose allows world FX", headset.shown === true);

    const driven = await driveKart(base.replace("http", "ws") + "/ws", "SMOKE-HUD");
    check("hud steer produces motion (no physical assist)", driven.speedMps > 2 && driven.moved);

    const kart = server.session.karts[0];
    kart.surgeUntil = 0;
    kart.padCooldownUntil = 0;
    const pad = server.session.economy.pads[0];
    kart.x = pad.x;
    kart.y = pad.y;
    const surge = server.session.economy.tryPad(kart, pad, Date.now());
    check("pad surge visual", surge?.channel === "visual" && surge.vfx.type === "surge");
    check("surge has null physicalOffset", surge?.physicalOffset === null);
    check("surge actuators absent", surge?.actuatorPresent === false);

    const probe = await (
      await fetch(`${base}/api/debug/try-physical`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kartId: kart.id,
          canTorqueNm: 80,
          motorOverlay: { enable: true },
          physicalOffset: { torqueNm: 12 },
        }),
      })
    ).json();
    check("physical probe rejected", probe.rejected === true);
    check("probe did not persist torque", probe.record?.canTorqueNm === null);

    const safe = await (await fetch(`${base}/api/ops/safe_mode`, { method: "POST" })).json();
    check("safe mode latched", safe.snapshot.safeMode === true);
    check(
      "failsafe ≤500ms",
      (safe.snapshot.failsafe.lastLatencyMs ?? 999) <= 500 && safe.snapshot.failsafe.lastWithinBudget === true,
    );

    const report = await (await fetch(`${base}/api/audit/phase0`)).json();
    check("phase0 gate PASS", report.gate === "PASS");
    check("zero emitted physical offsets", report.emittedPhysicalOffsets === 0);
    check("accepted visual intents ≥1", report.acceptedIntents >= 1);
    check("rejected physical ≥1", report.rejectedPhysicalAttempts >= 1);

    const assist = await (await fetch(`${base}/api/audit/assist`)).json();
    const accepted = assist.intents.filter((i: { rejected: boolean }) => !i.rejected);
    check(
      "every accepted intent is visual-only",
      accepted.every(
        (i: { channel: string; physicalOffset: unknown; canTorqueNm: unknown; motorOverlay: unknown; actuatorPresent: boolean }) =>
          i.channel === "visual" &&
          i.physicalOffset === null &&
          i.canTorqueNm === null &&
          i.motorOverlay === null &&
          i.actuatorPresent === false,
      ),
    );

    await fetch(`${base}/api/ops/abort`, { method: "POST" });
    const results = await (await fetch(`${base}/api/session`)).json();
    check("results screen", results.status === "results");

    console.log("\nVoltage League M2 smoke");
    console.log(`  PASS ${pass.length}  FAIL ${fail.length}`);
    for (const n of pass) console.log("  ✓", n);
    if (fail.length) {
      for (const n of fail) console.log("  ✗", n);
      process.exitCode = 1;
    } else {
      console.log("  Phase 0 gate: PASS (no physical offsets)");
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

});

async function headsetDualPose(
  wsUrl: string,
  kartId: string,
): Promise<{ joined: boolean; hidden: boolean; hideReason: string | null; shown: boolean }> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", role: "headset", kartId, name: "Smoke Quest" }));
  await new Promise((r) => setTimeout(r, 150));
  const http = wsUrl.replace("ws", "http").replace(/\/ws$/, "");
  const joinedSnap = await (await fetch(`${http}/api/session`)).json();
  const joined = Boolean(joinedSnap.karts.find((k: { id: string }) => k.id === kartId)?.headsetConnected);

  const now = Date.now();
  const me = joinedSnap.karts.find((k: { id: string; x: number; y: number; headingRad: number }) => k.id === kartId);
  const baseWorld = {
    kartId,
    frame: "track_local",
    x: me?.x ?? 46.5,
    y: 0,
    z: me?.y ?? 0,
    yawRad: me?.headingRad ?? 1.57,
    pitchRad: 0,
    rollRad: 0,
    speedMps: 0,
    ts: now,
  };
  const look = {
    kartId,
    frame: "kart_body",
    x: 0,
    y: 0,
    z: 0,
    yawRad: 0,
    pitchRad: 0,
    rollRad: 0,
    speedMps: 0,
    provider: "hmd_slam",
    quality: 1,
    ts: now,
  };
  ws.send(
    JSON.stringify({
      type: "dual_pose",
      sample: {
        kartId,
        kartWorld: { ...baseWorld, provider: "kart_vio", quality: 0.12 },
        look,
        lookSource: "hmd_slam",
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 120));
  const hiddenSnap = await (await fetch(`${http}/api/session`)).json();
  const hiddenKart = hiddenSnap.karts.find((k: { id: string }) => k.id === kartId);
  ws.send(
    JSON.stringify({
      type: "dual_pose",
      sample: {
        kartId,
        kartWorld: { ...baseWorld, provider: "stub", quality: 1, ts: Date.now() },
        look: { ...look, ts: Date.now() },
        lookSource: "hmd_slam",
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 120));
  const shownSnap = await (await fetch(`${http}/api/session`)).json();
  const shownKart = shownSnap.karts.find((k: { id: string }) => k.id === kartId);
  ws.close();
  return {
    joined,
    hidden: hiddenKart?.worldFxAllowed === false,
    hideReason: hiddenKart?.hideReason ?? null,
    shown: shownKart?.worldFxAllowed === true,
  };
}

async function driveKart(wsUrl: string, kartId: string): Promise<{ speedMps: number; moved: boolean }> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", role: "hud", kartId, name: "Smoke HUD" }));
  await new Promise((r) => setTimeout(r, 120));
  const iv = setInterval(() => {
    ws.send(JSON.stringify({ type: "steer", kartId, throttle: 1, steer: 0.15 }));
  }, 40);
  await new Promise((r) => setTimeout(r, 900));
  clearInterval(iv);
  ws.close();
  const http = wsUrl.replace("ws", "http").replace(/\/ws$/, "");
  const snap = await (await fetch(`${http}/api/session`)).json();
  const me = snap.karts.find((k: { id: string }) => k.id === kartId);
  return {
    speedMps: me?.speedMps ?? 0,
    moved: Boolean(me && (Math.abs(me.x) < 46.4 || me.y !== 0 || me.speedMps > 2)),
  };
}
