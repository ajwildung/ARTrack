# Voltage League M2 — Quest OpenXR lab client

Lab display for this milestone: **Meta Quest, OpenXR passthrough**. Pads and gates are **world-locked** (registered to KartVio / track_local). They are not a face-lock HUD.

Product display (out of scope): partnered waveguide optics. EyeRide / CarPlay / Android Auto AR paths are closed.

This folder is a Unity OpenXR drop-in (scripts + package manifest). `Library/` is not committed. The same compositor math lives in `packages/shared/src/compositor.ts` and is demoable without Unity at `/quest`.

## Editor (no headset)

Unity is optional for M2 bring-up. Prefer the web Editor visor:

```bash
npm install && npm run build && npm start
# open http://127.0.0.1:8080/quest
```

Simulated KartVio (WASD) + HMD look (drag). **Kart pose UNHEALTHY** hides pads/gates.

If you have Unity 6:

1. Hub → Open `clients/quest-openxr` (Unity 6000.x).
2. Let OpenXR + XR Plugin Management import.
3. Empty scene → GameObject `VoltageLab` → Add Component `QuestLabBootstrap`.
4. Set `wsUrl` to `ws://<lan-host>:8080/ws`.
5. Play. Right-drag look, WASD drive. Toggle `EditorSimDriver.simulateUnhealthyKartPose` — world FX must vanish, not snap to the camera.

Passthrough is a device feature. Editor Play uses a simulated camera; registration is still world-space (see `WorldCompositor.worldRoot`, never parented to the HMD).

## Quest (device)

1. XR Plug-in Management → Android → **OpenXR**.
2. OpenXR → Android → enable **Meta Quest** support / passthrough (Meta OpenXR or `XR_FB_passthrough` via the Meta XR SDK if you add it).
3. Camera: color clear + passthrough underlay (Meta: `OVRPassthroughLayer` composition **Underlay**). Do **not** draw pads on a camera-space canvas.
4. Player Settings: Android, IL2CPP, ARM64, Quest3 / Quest3S target. Minimum API 32.
5. Set `QuestLabBootstrap.wsUrl` to the track-LAN backend (`ws://192.168.x.x:8080/ws`). HTTP is fine on a trusted lab LAN; use `http://` origin for the web visor or the APK WS URL.
6. Build APK, sideload, wear the headset in the kart. Kart-fixed cam (or Editor sim) must publish `dual_pose.kartWorld`. HMD SLAM is look.

World FX stay hidden until `kartWorld.quality ≥ 0.45` and age ≤ 400ms.

## Dual-cam / fusion

| Stream | Provider | Role |
| --- | --- | --- |
| Kart-fixed cam + AprilTags | `kart_vio` / `apriltag` | World / track map. **Required** for pads/gates. |
| Helmet cam | `helmet_vio` | Look direction. |
| Quest HMD SLAM | `hmd_slam` | Look direction in the lab. |
| None / desk | `stub` + `sim` | Editor. Treated as healthy world pose. |

Until a slam origin is locked (`FusionCalib.slamOrigin` / AprilTag map), HMD SLAM look is applied **body-relative** to the kart seat (`DEFAULT_CALIB` in shared compositor).

### Calib notes

- Kart cam: forward 0.35m, up 0.28m, yaw 0 (kart body).
- HMD seat: forward 0.18m, up 0.92m.
- Track frame: X = track x, Y = up, Z = track y, heading 0 looks +X.
- AprilTag map is authored in the same track_local meters as `defaultTrack()`.
- RTK/UWB are demoted — do not hard-code outdoor GNSS.

## Phase 0

Visual only. `AssistGateway` never emits CAN / torque / motor overlay. The Unity client must ignore any non-null `canTorqueNm` / `motorOverlay` / `physicalOffset` (logged as a Phase 0 violation).

Chassis: Segway Ninebot Gokart Pro 2 prototype, electric-only, `actuatorPresent: false`.
