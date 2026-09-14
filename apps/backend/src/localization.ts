import type { LocalizationProvider, Pose } from "@voltage/shared";

/**
 * Localization plug-in point.
 * M1 wires `stub` only (track-local). Preferred later lab stack:
 * kart-fixed iPhone ARKit / VIO + sparse AprilTags.
 * EyeRide is display-only — not a tracker.
 * RTK/UWB is demoted; do not hard-code outdoor GNSS.
 */
export interface LocalizationEngine {
  readonly provider: LocalizationProvider;
  readonly frame: "track_local";
  readonly note: string;
  ingest(pose: Pose): Pose;
}

export const LOC_NOTE_M1 =
  "M1 STUB: track-local poses. Next: ARKit/VIO + sparse AprilTags on a kart-fixed iPhone. EyeRide is display-only. RTK/UWB demoted — not outdoor-only.";

/** M1 implementation. Replace via createLocalization() when ARKit provider exists. */
export class LocalizationStub implements LocalizationEngine {
  readonly provider: LocalizationProvider = "stub";
  readonly frame = "track_local" as const;
  readonly note = LOC_NOTE_M1;
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

/** Factory: M1 always returns stub. ARKit/VIO/AprilTag providers plug in here later. */
export function createLocalization(_preferred?: LocalizationProvider): LocalizationEngine {
  return new LocalizationStub();
}
