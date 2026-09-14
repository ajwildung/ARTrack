import type { LocalizationProvider, Pose } from "@voltage/shared";

/** M1 localization is STUB. Mixed/hybrid RTK+UWB later — not outdoor-only. */
export class LocalizationStub {
  readonly provider: LocalizationProvider = "stub";
  readonly frame = "track_local" as const;
  readonly note =
    "M1 STUB: poses are track-local. Do not assume GNSS/outdoor. Hybrid RTK+UWB is a later phase.";

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
