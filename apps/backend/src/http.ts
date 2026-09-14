import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionOrchestrator } from "./session.ts";
import type { Hub } from "./hub.ts";
import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import { forbiddenHits } from "./assist.ts";
import { DISPLAY } from "@voltage/shared";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

export function createHttp(cfg: Config, session: SessionOrchestrator, hub: Hub, db: Db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    const snap = session.snapshot();
    res.json({
      ok: true,
      brand: snap.brand,
      phase: snap.phase,
      mode: snap.mode,
      physicalAssistEnabled: false,
      actuatorsPresent: false,
      platform: snap.platform,
      status: snap.status,
      localization: snap.localization,
      compositor: snap.compositor,
      display: DISPLAY,
      headsets: snap.headsets,
      disabled: snap.disabled,
    });
  });

  app.get("/api/session", (_req, res) => {
    res.json(session.snapshot());
  });

  app.get("/api/audit/assist", (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    res.json({ phase: 0, intents: db.listAssist(sessionId) });
  });

  app.get("/api/audit/events", (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    res.json({ events: db.listEvents(sessionId) });
  });

  app.get("/api/audit/phase0", (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    res.json(db.phase0Report(sessionId));
  });

  app.get("/api/compositor", (_req, res) => {
    const snap = session.snapshot();
    res.json({
      phase: snap.phase,
      physicalAssistEnabled: false,
      compositor: snap.compositor,
      localization: snap.localization,
      headsets: snap.headsets,
      karts: snap.karts.map((k) => ({
        id: k.id,
        locProvider: k.locProvider,
        locQuality: k.locQuality,
        worldPoseHealthy: k.worldPoseHealthy,
        worldFxAllowed: k.worldFxAllowed,
        lookSource: k.lookSource,
        headsetConnected: k.headsetConnected,
        kartCamConnected: k.kartCamConnected,
        hideReason: k.hideReason,
      })),
    });
  });

  app.post("/api/ops/:action", (req, res) => {
    const action = req.params.action;
    let error: string | undefined;
    if (action === "start") error = session.start().error;
    else if (action === "abort") session.abort();
    else if (action === "safe_mode" || action === "safe") error = session.safe().error;
    else if (action === "seed_sims" || action === "seed") session.seedSims(3);
    else if (action === "reset") session.reset();
    else return res.status(404).json({ ok: false, error: "unknown action" });
    hub.broadcastSnapshot();
    if (error) return res.status(409).json({ ok: false, error, snapshot: session.snapshot() });
    res.json({ ok: true, snapshot: session.snapshot() });
  });

  app.post("/api/debug/try-physical", (req, res) => {
    if (!cfg.allowGateProbe && process.env.NODE_ENV !== "test") {
      return res.status(403).json({ ok: false, error: "gate probe disabled (set ALLOW_GATE_PROBE=1)" });
    }
    const attempt = (req.body ?? {}) as Record<string, unknown>;
    const hits = forbiddenHits(attempt);
    if (hits.length === 0 && attempt.channel !== "physical") {
      return res.status(400).json({ ok: false, error: "send a physical field to probe the gate" });
    }
    const kartId = String(attempt.kartId ?? session.karts[0]?.id ?? "PROBE");
    const record = session.assist.rejectPhysicalAttempt(session.sessionId, kartId, attempt);
    hub.broadcastSnapshot();
    res.json({ ok: true, rejected: true, record, report: db.phase0Report(session.sessionId) });
  });

  const opsDist = join(repoRoot, "apps/ops-tablet/dist");
  const hudDist = join(repoRoot, "apps/hud-client/dist");
  const questDist = join(repoRoot, "apps/quest-compositor/dist");
  if (existsSync(opsDist)) {
    app.use("/ops", express.static(opsDist));
    app.use("/ops", (_req, res) => res.sendFile(join(opsDist, "index.html")));
  }
  if (existsSync(hudDist)) {
    app.use("/hud", express.static(hudDist));
    app.use("/hud", (_req, res) => res.sendFile(join(hudDist, "index.html")));
  }
  if (existsSync(questDist)) {
    app.use("/quest", express.static(questDist));
    app.use("/quest", (_req, res) => res.sendFile(join(questDist, "index.html")));
  }
  app.get("/", (_req, res) => {
    if (existsSync(opsDist)) return res.redirect("/ops");
    res.type("html").send(
      `<html><body style="background:#07080c;color:#e7f3ff;font-family:sans-serif;padding:24px">
       <h1>Voltage League M2</h1>
       <p>Build frontends with <code>npm run build</code> or run <code>npm run dev</code>.</p>
       <p><a href="/ops">/ops</a> · <a href="/hud">/hud</a> (track map) · <a href="/quest">/quest</a> (Quest lab compositor)</p>
       <p><a href="/api/health">/api/health</a> · <a href="/api/audit/phase0">/api/audit/phase0</a> · <a href="/api/compositor">/api/compositor</a></p>
       </body></html>`,
    );
  });

  return app;
}
