# QA handoff — Voltage League M2 (Phase 0, Quest lab)

## Build pointer

- Branch / PR: M2 Quest OpenXR lab compositor on top of M1 Sprint Heat.
- Run: `npm install && npm run build && npm start`
- Ops: `http://<lan-host>:8080/ops`
- Track map: `http://<lan-host>:8080/hud`
- **Quest visor (Editor):** `http://<lan-host>:8080/quest`
- Confirm **Phase = 0** on the ops header pills and on `GET /api/health` → `"phase": 0`.

CI-equivalent locally:

```bash
npm test
npm run smoke
```

Smoke must print `Phase 0 gate: PASS (no physical offsets)` and include headset hide/show checks.

## Phase 0 confirm

You are on the correct build when **all** of these are true:

1. `/api/health` has `phase: 0`, `physicalAssistEnabled: false`.
2. `/api/health` `compositor.labDisplay` is `quest_openxr_passthrough` and `eyeridePath` / `display.eyeride` are `false`.
3. Ops chrome shows **PHASE 0**, **VISUAL ONLY**, and **QUEST LAB**.
4. `/quest` chrome shows **PHASE 0 · VISUAL** and **Quest OpenXR lab · registered world FX**.
5. `/hud` is a track map (not the visor). `/quest` pads/gates sit on the ground in perspective — they are not glued to the face.
6. `/api/health` includes `"platform": "ninebot_gokart_pro2"` and `"actuatorsPresent": false`.
7. `/api/audit/phase0` returns `"gate": "PASS"` and `"emittedPhysicalOffsets": 0` after a live pad hit.
8. Disabled list includes `horn_stun`, `vision_blockers`, `portals`, `soft_motor_surge`, `time_attack`.

If any accepted assist row has `canTorqueNm`, `motorOverlay`, `physicalOffset`, or `actuatorPresent: true`, **fail the build**. That is a Phase 0 hard gate, not a warning.

## Compositor / fusion confirm

1. Open `/quest` (Editor simulated poses are OK). Start a heat from ops.
2. Drag to look. Pads (cyan discs) and gates (arches) must stay planted on the oval as you look around. Driving WASD moves **you** through the world; FX do not hover on the visor.
3. Click **Kart pose UNHEALTHY** (or `H`). Expect banner `WORLD FX HIDDEN` and `GET /api/compositor` → `worldFxAllowed: false` for that kart. Pads/gates gone. Look still works.
4. Restore healthy pose. FX return **registered**, not as a HUD.
5. Toggle look source `hmd_slam` / `helmet_vio` — still look-only; world origin stays KartVio/stub (`arcore` or `arkit` when a phone is publishing).
6. Unity APK path (optional this round): `clients/quest-openxr/README.md`. Same hide rule. Never parent `WorldFxRoot` to the camera.

Kart world-anchor phone may be **Samsung + ARCore**. ARKit is Apple-only and optional. Localization providers must stay OS-agnostic.

## How to inspect assist telemetry

1. Run a heat (seed sims → Start). Drive `/hud` or `/quest` over a cyan pad or wait for a sim to cross one.
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

| Step | Ops | Visor / HUD | Expect |
| --- | --- | --- | --- |
| 1 | Seed sim karts | Optional `/quest` | Lobby lists karts; headset column if `/quest` open |
| 2 | Start | — | Live, 8:00 clock (or `VOLTAGE_HEAT_MS`) |
| 3 | Watch economy | `/quest` look + drive | World-locked pads/gates; cyan surge 1.5–2.5s |
| 4 | — | Unhealthy toggle | World FX hide; no physical assist |
| 5 | — | Collect pickup Q/E | Max 1 DEF + 1 PACE; no surge stack |
| 6 | Safe Mode | Boosts die | Fail-safe ≤500ms; pads may remain if pose healthy |
| 7 | Abort or expire | Results | Results table, Reset lobby |

## Dual-track (do not mix)

- **Lab:** Quest passthrough. Development only.
- **Product:** Waveguide partner — firmware not in this tree.
- **Not a bug if missing:** EyeRide HUD, CarPlay, Android Auto AR.

## Out of scope (do not file as M2 bugs)

- Physical / CAN / motor assist (Phase 1+)
- Waveguide partner firmware
- Time Attack, Horn Stun, vision blockers, portals, soft motor surge
- Production RTK/UWB drivers
- Perfect production SLAM (stubs/sim OK; interfaces must be present)
