# EyeRide-class HUD (Unity + OpenXR) — M1 port notes

M1 ships a **web optical-HUD stub** (`apps/hud-client`) so the Sprint Heat loop is demoable on track LAN without a headset. Production visor target is **see-through** (EyeRide-class / shaded AR glasses), **not** Quest / opaque HMD.

This folder is a protocol adapter sketch, not a Unity project (no `Library/`, no Android APK).

## Why not Quest for M1

Outdoor karting needs a visor you can still see the track through. An opaque HMD is the wrong optical stack. OpenXR on a helmet HUD or shaded glasses is the right long-term client; the web stub uses the same WebSocket messages so the backend can stay frozen during the port.

## Connect

- WebSocket: `ws://<track-lan>:8080/ws`
- Hello: `{ "type": "hello", "role": "hud", "kartId": "HUD-1", "name": "Helmet 1" }`
- Pose/steer: send `{ "type": "steer", "kartId", "throttle": -1..1, "steer": -1..1 }` at ~20 Hz, **or** `{ "type": "pose", pose }` in `track_local` meters (provider `"stub"` until hybrid RTK+UWB).
- Consume `snapshot` + `assist` messages. Play VFX from `assist.vfx` only. Ignore/forbid any physical channel.

## Phase 0 client rules

- Predict pad surge locally (100–150ms feel); reconcile with `assist` AUTH.
- On `vfx.type === "cancel"` or `safeMode`, drop boosts immediately.
- Never send or apply CAN / torque / motor overlay locally.

C# envelope sketch: `VoltageProtocol.cs`.
