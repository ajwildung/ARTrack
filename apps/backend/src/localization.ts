import type { LocalizationProvider, Pose } from "@voltage/shared";

/** M1 localization is STUB. Mixed/hybrid RTK+UWB later — not outdoor-only. */
export class LocalizationStub {
  readonly provider: LocalizationProvider = "stub";
  readonly frame = "track_local" as const;
  readonly note =
    "M1 STUB: poses are track-local. Later provider can be ARKit/VIO + sparse AprilTags (kart-fixed iPhone); EyeRide is display-only. Do not assume GNSS/outdoor. RTK/UWB is not required for M1.";

  last = new Map<string, Pose>();

  ingest(pose: Pose): Pose {
    const normalized: Pose = {
      ...pose,
      frame: "track_local",
      provider: pose.provider || "stub",
      ts: pose.ts || Date.now(),
    };
    this.last.set(pose.kartId, normalized);
    return normalized;
  }
}
