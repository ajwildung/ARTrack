import {
  DEFAULT_CALIB,
  fuseDualPose,
  pose2To3,
  pose3To2,
  type DualPoseSample,
  type FusedLocalization,
  type FusionCalib,
  type LocalizationPublic,
  type Pose3,
} from "@voltage/shared";
import type { LocalizationProvider, LookSource, Pose } from "@voltage/shared";

/**
 * Localization plug-in point.
 * M1 shipped `stub` (track-local). M2 adds dual-pose fusion:
 *   KartVio (kart-fixed cam + AprilTags) = world / track map
 *   HelmetVio or Quest HmdSlam           = look direction
 * World FX require a healthy kart/world pose. RTK/UWB stay demoted.
 */
export interface LocalizationEngine {
  readonly provider: LocalizationProvider;
  readonly frame: "track_local";
  readonly note: string;
  ingest(pose: Pose): Pose;
  ingestKartWorld(pose: Pose3): Pose3;
  ingestLook(pose: Pose3, source: LookSource): Pose3;
  ingestDual(sample: DualPoseSample, now?: number): FusedLocalization;
  fused(kartId: string, now?: number): FusedLocalization;
  describe(): LocalizationPublic;
}

export const LOC_NOTE_STUB =
  "STUB: track-local poses for Editor / sim. Plug KartVio + HelmetVio/HmdSlam via DualPoseFusionEngine.";

export const LOC_NOTE_FUSION =
  "DUAL FUSION: KartVio (kart-fixed cam + AprilTags) is the world/track map. HelmetVio or Quest HMD SLAM is look. World FX hide unless kart world pose is healthy. RTK/UWB demoted. Lab display is Quest passthrough — not EyeRide.";

const STUB_PROVIDERS = new Set<LocalizationProvider>(["stub", "rtk", "uwb"]);

/** Kart-fixed VIO / AprilTag world map. */
export class KartVioProvider {
  readonly id: LocalizationProvider = "kart_vio";
  last = new Map<string, Pose3>();

  ingest(pose: Pose3): Pose3 {
    const normalized: Pose3 = {
      ...pose,
      frame: "track_local",
      provider: pose.provider === "stub" ? "stub" : pose.provider || "kart_vio",
      ts: pose.ts || Date.now(),
    };
    this.last.set(pose.kartId, normalized);
    return normalized;
  }
}

/** Helmet-mounted VIO look. */
export class HelmetVioProvider {
  readonly id: LocalizationProvider = "helmet_vio";
  last = new Map<string, Pose3>();

  ingest(pose: Pose3): Pose3 {
    const normalized: Pose3 = { ...pose, provider: "helmet_vio", ts: pose.ts || Date.now() };
    this.last.set(pose.kartId, normalized);
    return normalized;
  }
}

/** Quest HMD SLAM look (lab). World origin lock is optional calib.slamOrigin. */
export class HmdSlamProvider {
  readonly id: LocalizationProvider = "hmd_slam";
  last = new Map<string, Pose3>();

  ingest(pose: Pose3): Pose3 {
    const normalized: Pose3 = { ...pose, provider: "hmd_slam", ts: pose.ts || Date.now() };
    this.last.set(pose.kartId, normalized);
    return normalized;
  }
}

/** M1-compatible planar stub. Dual-fusion can wrap it as a healthy Editor world pose. */
export class LocalizationStub implements LocalizationEngine {
  readonly provider: LocalizationProvider = "stub";
  readonly frame = "track_local" as const;
  readonly note = LOC_NOTE_STUB;
  last = new Map<string, Pose>();
  private last3 = new Map<string, Pose3>();

  ingest(pose: Pose): Pose {
    const normalized: Pose = {
      ...pose,
      frame: "track_local",
      provider: pose.provider || "stub",
      ts: pose.ts || Date.now(),
      quality: pose.quality ?? 1,
    };
    this.last.set(pose.kartId, normalized);
    this.last3.set(pose.kartId, pose2To3(normalized));
    return normalized;
  }

  ingestKartWorld(pose: Pose3): Pose3 {
    this.last3.set(pose.kartId, pose);
    this.last.set(pose.kartId, pose3To2(pose));
    return pose;
  }

  ingestLook(_pose: Pose3, _source: LookSource): Pose3 {
    return _pose;
  }

  ingestDual(sample: DualPoseSample, now = Date.now()): FusedLocalization {
    this.ingestKartWorld(sample.kartWorld);
    return fuseDualPose(sample, now);
  }

  fused(kartId: string, now = Date.now()): FusedLocalization {
    const kart = this.last3.get(kartId);
    if (!kart) {
      return {
        provider: "stub",
        kartWorldHealthy: false,
        worldFxAllowed: false,
        worldAnchor: null,
        hmdInWorld: null,
        lookSource: "none",
        quality: 0,
        hideReason: "no_kart_world_pose",
      };
    }
    return fuseDualPose({ kartId, kartWorld: { ...kart, ts: now, quality: kart.quality || 1 }, lookSource: "sim" }, now);
  }

  describe(): LocalizationPublic {
    return {
      provider: "stub",
      frame: "track_local",
      note: this.note,
      fusion: "none",
      kartProvider: "stub",
      lookProvider: "none",
      worldFxPolicy: "hide_if_kart_world_unhealthy",
    };
  }
}

/**
 * Dual-pose fusion engine. Starts reporting `stub` until a KartVio / HMD / dual sample arrives,
 * then `dual_fusion`. World FX stay gated on kart world health.
 */
export class DualPoseFusionEngine implements LocalizationEngine {
  readonly frame = "track_local" as const;
  readonly note = LOC_NOTE_FUSION;
  readonly kart = new KartVioProvider();
  readonly helmet = new HelmetVioProvider();
  readonly hmd = new HmdSlamProvider();
  calib: FusionCalib;
  private planar = new Map<string, Pose>();
  private lookSource = new Map<string, LookSource>();
  private sawHardware = false;

  constructor(calib: FusionCalib = DEFAULT_CALIB) {
    this.calib = calib;
  }

  get provider(): LocalizationProvider {
    return this.sawHardware ? "dual_fusion" : "stub";
  }

  ingest(pose: Pose): Pose {
    const normalized: Pose = {
      ...pose,
      frame: "track_local",
      provider: pose.provider || "stub",
      ts: pose.ts || Date.now(),
      quality: pose.quality ?? 1,
    };
    this.planar.set(pose.kartId, normalized);
    this.kart.ingest(pose2To3(normalized));
    if (normalized.provider !== "stub") this.sawHardware = true;
    return normalized;
  }

  ingestKartWorld(pose: Pose3): Pose3 {
    if (pose.provider !== "stub") this.sawHardware = true;
    const stored = this.kart.ingest(pose);
    this.planar.set(pose.kartId, pose3To2(stored));
    return stored;
  }

  ingestLook(pose: Pose3, source: LookSource): Pose3 {
    this.sawHardware = true;
    this.lookSource.set(pose.kartId, source);
    if (source === "helmet_vio") return this.helmet.ingest(pose);
    return this.hmd.ingest(pose);
  }

  ingestDual(sample: DualPoseSample, now = Date.now()): FusedLocalization {
    this.ingestKartWorld(sample.kartWorld);
    if (sample.look && sample.lookSource !== "none") this.ingestLook(sample.look, sample.lookSource);
    if (sample.kartWorld.provider !== "stub" || (sample.lookSource !== "sim" && sample.lookSource !== "none")) {
      this.sawHardware = true;
    }
    return fuseDualPose(sample, now, this.calib);
  }

  fused(kartId: string, now = Date.now()): FusedLocalization {
    const kartWorld = this.kart.last.get(kartId);
    if (!kartWorld) {
      return {
        provider: this.provider,
        kartWorldHealthy: false,
        worldFxAllowed: false,
        worldAnchor: null,
        hmdInWorld: null,
        lookSource: "none",
        quality: 0,
        hideReason: "no_kart_world_pose",
      };
    }
    const source = this.lookSource.get(kartId) ?? "sim";
    const look = source === "helmet_vio" ? this.helmet.last.get(kartId) : this.hmd.last.get(kartId);
    return fuseDualPose({ kartId, kartWorld, look, lookSource: look ? source : "sim" }, now, this.calib);
  }

  describe(): LocalizationPublic {
    return {
      provider: this.provider,
      frame: "track_local",
      note: this.note,
      fusion: "dual_pose",
      kartProvider: this.sawHardware ? "kart_vio" : "stub",
      lookProvider: this.sawHardware ? "hmd_slam" : "none",
      worldFxPolicy: "hide_if_kart_world_unhealthy",
    };
  }
}

/** Factory: stub stays available; anything else (including default) is dual-fusion with stub-compatible ingest. */
export function createLocalization(preferred?: LocalizationProvider): LocalizationEngine {
  if (preferred && STUB_PROVIDERS.has(preferred)) return new LocalizationStub();
  return new DualPoseFusionEngine();
}
