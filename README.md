# Voltage League — M1 Sprint Heat (Phase 0)

Track-LAN demo of a **Sprint Heat** session:

**Lobby → Live (8:00 time-box) → Results**

Soft-visual pads, pickups, HUD telegraphs, and ops **Start / Abort / Safe Mode**.

**Phase 0 hard gate:** `AssistGateway` is visual-only. There are **no** CAN torque, motor overlay, or physical offset commands. Any physical assist field is rejected and audited. Actuators are absent.

Chassis lock for overlay: **Ninebot Gokart Pro 2** (`platform: ninebot_gokart_pro2`). Phase 0 still has `actuatorPresent: false` — no OEM CAN/SDK assist on the Pro 2.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Backend | TypeScript / Node 22 on track LAN | SessionOrchestrator, EconomyScheduler, Scoring, AssistGateway, FailSafe, SQLite audit |
| Ops tablet | React PWA | Lobby / Live / Results only, large Start / Abort / Safe Mode |
| HUD client | Web optical-HUD stub (not Quest) | Helmet / EyeRide-class / shaded AR glasses are see-through. M1 is demoable in a browser overlay with the same protocol a Unity + OpenXR EyeRide client will consume. An opaque HMD is the wrong outdoor/visor form factor. |
| Localization | **STUB** (`LocalizationEngine`) | M1 is stub. Later: kart-fixed iPhone ARKit/VIO + AprilTags. EyeRide is display-only. RTK/UWB demoted. |

Future helmet client sketch: [`clients/eyeride-hud/README.md`](clients/eyeride-hud/README.md).

## Game rules (M1)

- Race-only: **Sprint Heat** (Time Attack is later).
- Heat clock: **8:00** (`VOLTAGE_HEAT_MS` override for local/smoke).
- Pads **2–4**, per-kart cooldown **8–12s**, surge visual **1.5–2.5s**, **no surge stack**.
- Pickups every **22–30s** at **2–3** nodes. Inventory cap: **1 defensive + 1 pace**.
- Out for M1: Horn Stun, vision blockers, portals, soft motor surge.
- Fail-safe cancel budget **≤500ms**. HUD predicts VFX locally for a **100–150ms** feel over Wi-Fi.

## How to run locally

Requires **Node 22+**.

```bash
npm install
npm run build          # ops PWA + HUD into dist (backend serves them)
npm start              # http://127.0.0.1:8080
```

- Ops tablet: http://127.0.0.1:8080/ops
- HUD stub: http://127.0.0.1:8080/hud  (add `?kart=HUD-2` for a second visor)
- Health: http://127.0.0.1:8080/api/health  (`phase: 0`)
- Phase 0 audit: http://127.0.0.1:8080/api/audit/phase0

Demo loop:

1. Open Ops. Click **Seed sim karts** (or open HUD so a helmet kart joins).
2. **Start** — Live 8:00 Sprint Heat.
3. HUD: WASD/arrows over cyan pads (surge telegraph) and pickup nodes (Q defensive / E pace).
4. **Safe Mode** cancels boosts (≤500ms server path) and freezes economy.
5. **Abort** or wait out the clock → **Results**.

Dev with HMR (three processes):

```bash
npm run dev
# API  :8080   Ops  :5173/ops   HUD  :5174/hud
```

Short heat for a desk demo:

```bash
VOLTAGE_HEAT_MS=30000 npm start
```

## Smoke test

```bash
npm test     # unit: Phase 0 gate, economy, failsafe
npm run smoke
```

Smoke starts an ephemeral server, hits a pad, probes a physical CAN/torque command (must be **rejected**), trips Safe Mode, and asserts `/api/audit/phase0` → `gate: "PASS"` with `emittedPhysicalOffsets: 0`.

## Inspect assist telemetry (QA)

| URL | What you should see |
| --- | --- |
| `GET /api/health` | `phase: 0`, `physicalAssistEnabled: false`, `localization.provider: "stub"` |
| `GET /api/audit/phase0` | `gate: "PASS"`, `emittedPhysicalOffsets: 0` |
| `GET /api/audit/assist` | Accepted rows: `channel: "visual"`, `physicalOffset/canTorqueNm/motorOverlay: null`, `actuatorPresent: false` |
| `GET /api/audit/events` | Session + failsafe + rejected physical probes |
| `POST /api/debug/try-physical` | Only with `ALLOW_GATE_PROBE=1`. Proves rejection; emitted columns stay null |

SQLite file: `data/voltage.sqlite` (override `VOLTAGE_DB_PATH`).

Handoff sheet: [`docs/QA-HANDOFF.md`](docs/QA-HANDOFF.md).

## Layout

```
apps/backend        SessionOrchestrator, EconomyScheduler, Scoring, AssistGateway, FailSafe
apps/ops-tablet     React PWA race control
apps/hud-client     Optical HUD / visor stub
packages/shared     Rules, protocol, track-local stub geometry
clients/eyeride-hud Unity/OpenXR port notes (not a Quest project)
```

Phase 1 soft-assist hardware is **not** in this tree. Do not add motor/CAN paths here.
