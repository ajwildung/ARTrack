/** Voltage League M1 — Sprint Heat rules and Phase 0 hard gate. */

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

export const LOCALIZATION_PROVIDERS = ["stub", "rtk", "uwb", "hybrid"] as const;
export type LocalizationProvider = (typeof LOCALIZATION_PROVIDERS)[number];
