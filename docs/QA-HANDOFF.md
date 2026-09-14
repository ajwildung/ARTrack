# QA handoff — Voltage League M1 (Phase 0)

## Build pointer

- Branch / PR: M1 Sprint Heat soft-visual loop.
- Run: `npm install && npm run build && npm start`
- Ops: `http://<lan-host>:8080/ops`
- HUD: `http://<lan-host>:8080/hud`
- Confirm **Phase = 0** on the ops header pills and on `GET /api/health` → `"phase": 0`.

CI-equivalent locally:

```bash
npm test
npm run smoke
```

Smoke must print `Phase 0 gate: PASS (no physical offsets)`.

## Phase 0 confirm

You are on the correct build when **all** of these are true:

1. `/api/health` has `phase: 0`, `physicalAssistEnabled: false`, `localization.provider: "stub"`.
2. Ops chrome shows **PHASE 0** and **VISUAL ONLY**.
3. HUD chrome shows **PHASE 0 · VISUAL** and **Optical HUD stub · not an opaque HMD**.
4. `/api/audit/phase0` returns `"gate": "PASS"` and `"emittedPhysicalOffsets": 0` after a live pad hit.
5. Disabled list includes `horn_stun`, `vision_blockers`, `portals`, `soft_motor_surge`, `time_attack`.

If any accepted assist row has `canTorqueNm`, `motorOverlay`, `physicalOffset`, or `actuatorPresent: true`, **fail the build**. That is a Phase 0 hard gate, not a warning.

## How to inspect assist telemetry

1. Run a heat (seed sims → Start). Drive HUD over a cyan pad or wait for a sim to cross one.
2. Open `http://127.0.0.1:8080/api/audit/assist`.
3. For each object with `"rejected": false` check:
   - `"channel": "visual"`
   - `"phase": 0`
   - `"physicalOffset": null`
   - `"canTorqueNm": null`
   - `"motorOverlay": null`
   - `"actuatorPresent": false`
4. Open `http://127.0.0.1:8080/api/audit/phase0` — `gate` must be `PASS`.
5. Optional probe (dev only):

```bash
ALLOW_GATE_PROBE=1 npm start
curl -s -X POST http://127.0.0.1:8080/api/debug/try-physical \
  -H 'content-type: application/json' \
  -d '{"canTorqueNm":80,"motorOverlay":{"enable":true},"physicalOffset":{"torqueNm":12}}'
```

The response is `rejected: true` and the stored row still has null physical columns. The attempt is in `/api/audit/events` as `assist_physical_rejected`.

SQLite: `data/voltage.sqlite` tables `assist_intents`, `events`, `failsafe_trips`.

## Session script

| Step | Ops | HUD | Expect |
| --- | --- | --- | --- |
| 1 | Seed sim karts | Optional open | Lobby lists karts |
| 2 | Start | — | Live, 8:00 clock (or `VOLTAGE_HEAT_MS`) |
| 3 | Watch economy | Drive over pad | Cyan surge telegraph 1.5–2.5s, HUD may flash PREDICT then AUTH |
| 4 | — | Collect pickup, Q/E | Max 1 DEF + 1 PACE; no surge stack on re-hit |
| 5 | Safe Mode | Boosts die | Fail-safe latency ≤500ms on ops + `/api/audit/phase0` |
| 6 | Abort or expire | Results overlay | Results table, Reset lobby |

## Out of scope (do not file as M1 bugs)

- Physical / CAN / motor assist (Phase 1+)
- Time Attack
- Horn Stun, vision blockers, portals, soft motor surge
- Production RTK/UWB localization (stub only)
- Quest / opaque HMD packaging
