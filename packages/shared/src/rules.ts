/** Voltage League M2 — Sprint Heat rules and Phase 0 hard gate. */

export const BRAND = "Voltage League" as const;
export const PHASE = 0 as const;
export const MODE = "sprint_heat" as const;

export const RULES = {
  heatDurationMs: 8 * 60 * 1000,
  padCount: { min: 2, max: 4, default: 3 },
  padCooldownMs: { min: 8_000, max: 12_000, default: 10_000 },
  surgeVisualMs: { min: 1_500, max: 2_500, default: 2_000 },
  pickupIntervalMs: { min: 22_000, max: 30_000, default: 26_000 },
  pickupNodeCount: { min: 2, max: 3, default: 3 },
  maxDefensive: 1,
  maxPace: 1,
  surgeStack: false,
  failSafeCancelBudgetMs: 500,
  vfxFeelTargetMs: { min: 100, max: 150 },
  tickMs: 50,
} as const;

export const DISABLED_M1 = [
  "horn_stun",
  "vision_blockers",
  "portals",
  "soft_motor_surge",
  "time_attack",
] as const;

/** Fields that must never appear on an *emitted* assist command in Phase 0. */
export const FORBIDDEN_ASSIST_FIELDS = [
  "canTorqueNm",
  "motorOverlay",
  "torqueOffset",
  "physicalOffset",
  "actuatorCommand",
  "currentOverlay",
  "pwmDuty",
  "canFrame",
  "motorCommand",
] as const;

export type ForbiddenAssistField = (typeof FORBIDDEN_ASSIST_FIELDS)[number];

/** Plug-in ids. M1 shipped stub; M2 adds dual-pose fusion (KartVio + HelmetVio/HmdSlam). RTK/UWB stay demoted. */
export const LOCALIZATION_PROVIDERS = [
  "stub",
  "kart_vio",
  "arcore",
  "arkit",
  "helmet_vio",
  "hmd_slam",
  "apriltag",
  "dual_fusion",
  "vio",
  "hybrid",
  "rtk",
  "uwb",
] as const;
export type LocalizationProvider = (typeof LOCALIZATION_PROVIDERS)[number];

/**
 * Kart world-anchor backends. OS-agnostic: ARCore (Android/Samsung) is first-class.
 * ARKit is an optional iOS peer (Apple-only) — never required, never the only API.
 */
export const KART_WORLD_BACKENDS = ["arcore", "arkit", "kart_vio", "apriltag", "vio"] as const;
export type KartWorldBackend = (typeof KART_WORLD_BACKENDS)[number];

export function isKartWorldBackend(id: string): id is KartWorldBackend {
  return (KART_WORLD_BACKENDS as readonly string[]).includes(id);
}

export const LOOK_SOURCES = ["none", "sim", "helmet_vio", "hmd_slam"] as const;
export type LookSource = (typeof LOOK_SOURCES)[number];

/** M1 chassis lock — visual overlay only. No OEM CAN/SDK assist on Pro 2. */
export const PLATFORM = "ninebot_gokart_pro2" as const;

/**
 * Dual display track.
 * Lab (this PR): Meta Quest OpenXR passthrough.
 * Product (out of scope): partnered waveguide optics.
 * EyeRide / CarPlay / Android Auto AR paths are closed.
 */
export const DISPLAY = {
  lab: "quest_openxr_passthrough",
  product: "waveguide_partner_future",
  eyeride: false,
  carplay: false,
  androidAuto: false,
} as const;

export const WORLD_FX_MIN_QUALITY = 0.45;
export const WORLD_FX_MAX_AGE_MS = 400;
