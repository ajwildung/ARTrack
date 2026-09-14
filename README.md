# Voltage League — M2 Quest lab compositor (Phase 0)

Sprint Heat loop from M1, plus a **Quest OpenXR lab visor** that draws **registered** pads/gates on passthrough — not a floating face-lock HUD.

**Lobby → Live (8:00 time-box) → Results**

**Phase 0 hard gate:** `AssistGateway` is visual-only. There are **no** CAN torque, motor overlay, or physical offset commands. Any physical assist field is rejected and audited. Actuators are absent. Telemetry still proves zero physical assist.

Chassis lock: **Ninebot Gokart Pro 2** (`platform: ninebot_gokart_pro2`), electric-only prototype. `actuatorPresent: false`.

## Dual display track

| Track | Display | Status |
| --- | --- | --- |
| **Lab (this PR)** | Meta Quest, OpenXR passthrough | Development only |
| **Product** | Partnered waveguide optics | Out of scope |
| Closed | EyeRide / CarPlay / Android Auto AR | Do not build |

`apps/hud-client` is a **track-map / sim driver** for the M1 loop. The visor is `/quest` (Editor) and `clients/quest-openxr` (Unity APK).

## Dual-cam fusion

World FX (pads, gates, pickups) require a **healthy kart/world pose**. Look can come from a helmet cam **or** Quest HMD SLAM.

| Provider | Role |
| --- | --- |
| `stub` | Editor / sim. Plug-in still present from M1. |
| `kart_vio` (+ `apriltag`) | Kart-fixed cam — world / track map |
| `helmet_vio` | Helmet cam look |
| `hmd_slam` | Quest HMD SLAM look (lab) |
| `dual_fusion` | KartVio ⊕ look, after a hardware sample |

If KartVio quality &lt; 0.45 or the sample is older than 400ms, the compositor **hides** world FX. A face-lock warning is allowed; pads/gates must not snap to the HMD.

RTK/UWB stay demoted. Perfect production SLAM is out of scope — interfaces + lab path with stubs/sim.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Backend | TypeScript / Node 22 on track LAN | SessionOrchestrator, EconomyScheduler, Scoring, AssistGateway, FailSafe, dual-pose LocalizationEngine, SQLite audit |
| Ops tablet | React PWA | Lobby / Live / Results, headset + world-FX health |
| Track map | `apps/hud-client` | Desk driver for the M1 loop (WASD) |
| Lab visor | `apps/quest-compositor` + `clients/quest-openxr` | Shared compositor math; web Editor now, Unity OpenXR on device |
| Localization | Stub → **dual-pose fusion** | KartVio + HelmetVio/HmdSlam plug-ins |

## Game rules (unchanged from M1)

- Race-only: **Sprint Heat** (Time Attack is later).
- Heat clock: **8:00** (`VOLTAGE_HEAT_MS` override for local/smoke).
- Pads **2–4**, per-kart cooldown **8–12s**, surge visual **1.5–2.5s**, **no surge stack**.
- Pickups every **22–30s** at **2–3** nodes. Inventory cap: **1 defensive + 1 pace**.
- Out: Horn Stun, vision blockers, portals, soft motor surge.
- Fail-safe cancel budget **≤500ms**. HUD/visor predicts VFX locally for a **100–150ms** feel over Wi-Fi.

## How to run (Editor)

Requires **Node 22+**. Unity is **not** required for the desk demo.

```bash
npm install
npm run build          # ops + HUD + quest visor into dist (backend serves them)
npm start              # http://127.0.0.1:8080
```

- Ops tablet: http://127.0.0.1:8080/ops
- Track map / sim driver: http://127.0.0.1:8080/hud  (`?kart=HUD-2` for a second kart)
- **Quest lab visor (Editor):** http://127.0.0.1:8080/quest
- Health: http://127.0.0.1:8080/api/health  (`phase: 0`, `compositor.labDisplay: quest_openxr_passthrough`)
- Compositor: http://127.0.0.1:8080/api/compositor
- Phase 0 audit: http://127.0.0.1:8080/api/audit/phase0

Demo loop:

1. Open Ops. **Seed sim karts** (or open `/quest` / `/hud` so a kart joins).
2. **Start** — Live 8:00 Sprint Heat.
3. `/quest`: drag to look (HMD SLAM sim), WASD to drive. Cyan **pads** and **gates** sit on the track in 3D — they move with the world, not the face.
4. Click **Kart pose UNHEALTHY** (or press H). Pads/gates vanish; banner `WORLD FX HIDDEN`. Restore healthy pose — they reappear registered.
5. `/hud` still works as the 2D map. Ops shows headset + world FX columns.
6. **Safe Mode** cancels boosts (≤500ms server path) and freezes economy. **Abort** or wait out the clock → **Results**.

Dev with HMR (four processes):

```bash
npm run dev
# API :8080   Ops :5173/ops   HUD :5174/hud   Quest :5175/quest
```

Short heat:

```bash
VOLTAGE_HEAT_MS=30000 npm start
```

## How to run on Quest

Two lab paths. Same protocol (`role: "headset"`, `dual_pose`).

### A. Quest Browser / same LAN (fastest)

1. Backend on the track PC: `npm start` (listen `0.0.0.0`, default).
2. Quest Browser → `http://<lan-ip>:8080/quest`.
3. This is the **Editor compositor** inside the headset (simulated passthrough). Use it to verify fusion + hide-on-unhealthy before an APK.
4. Real camera passthrough is the Unity path below.

### B. Unity OpenXR APK (real passthrough)

See [`clients/quest-openxr/README.md`](clients/quest-openxr/README.md).

Summary: Unity 6, OpenXR + Meta Quest, passthrough **underlay**, `QuestLabBootstrap` with `wsUrl=ws://<lan>:8080/ws`. Pads/gates are world-space meshes on `WorldFxRoot` — never parented to the camera. Play Mode in Editor uses simulated poses (right-drag look, WASD).

## Calib notes

Shared defaults (`packages/shared/src/compositor.ts` `DEFAULT_CALIB`):

- Kart-fixed cam: +0.35m forward, +0.28m up in kart body, yaw 0.
- HMD seat: +0.18m forward, +0.92m up.
- Track_local: X = plan x, Y = up, Z = plan y. Heading 0 looks +X.
- AprilTag map must be authored in the same meters as `defaultTrack()`.
- Until `slamOrigin` is locked, Quest HMD SLAM look is applied **relative to the kart seat** (lab). World origin still comes from KartVio.
- Do not hard-code RTK/UWB.

## Smoke test

```bash
npm test     # unit: Phase 0 gate, economy, failsafe, dual-pose fusion, compositor hide
npm run smoke
```

Smoke starts an ephemeral server, hits a pad, joins a headset, proves unhealthy KartVio **hides** world FX and a healthy sample **shows** them, probes a physical CAN/torque command (must be **rejected**), trips Safe Mode, and asserts `/api/audit/phase0` → `gate: "PASS"` with `emittedPhysicalOffsets: 0`.

## Inspect assist telemetry (QA)

| URL | What you should see |
| --- | --- |
| `GET /api/health` | `phase: 0`, `physicalAssistEnabled: false`, `localization.provider: "stub"` until a dual-pose sample, then `"dual_fusion"`. `compositor.labDisplay: "quest_openxr_passthrough"`. `display.eyeride: false` |
| `GET /api/compositor` | Per-kart `worldFxAllowed`, `worldPoseHealthy`, `lookSource`, headset flags |
| `GET /api/audit/phase0` | `gate: "PASS"`, `emittedPhysicalOffsets: 0` |
| `GET /api/audit/assist` | Accepted rows: `channel: "visual"`, `physicalOffset/canTorqueNm/motorOverlay: null`, `actuatorPresent: false` |
| `POST /api/debug/try-physical` | Only with `ALLOW_GATE_PROBE=1`. Proves rejection |

SQLite file: `data/voltage.sqlite` (override `VOLTAGE_DB_PATH`).

Handoff sheet: [`docs/QA-HANDOFF.md`](docs/QA-HANDOFF.md).

## Layout

```
apps/backend             SessionOrchestrator, AssistGateway, FailSafe, DualPoseFusionEngine
apps/ops-tablet          React PWA race control
apps/hud-client          Track-map / sim driver (M1 loop)
apps/quest-compositor    Editor + Quest Browser visor (registered pads/gates)
packages/shared          Rules, protocol, track, compositor math
clients/quest-openxr     Unity OpenXR lab client (passthrough APK)
clients/eyeride-hud      Path closed — see README there
```

Phase 1 soft-assist hardware is **not** in this tree. Do not add motor/CAN paths here. Waveguide partner firmware is out of scope.
