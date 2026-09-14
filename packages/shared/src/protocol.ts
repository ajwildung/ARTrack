import type { LocalizationProvider } from "./rules.ts";
import type { TrackLayout } from "./track.ts";

export type SessionStatus = "lobby" | "live" | "results";
export type ClientRole = "ops" | "hud" | "kart";
export type PickupKind = "defensive" | "pace";
export type VfxType =
  | "surge"
  | "pickup_defensive"
  | "pickup_pace"
  | "use_defensive"
  | "use_pace"
  | "cancel";

export type AssistChannel = "visual";

export interface Pose {
  kartId: string;
  frame: "track_local";
  x: number;
  y: number;
  headingRad: number;
  speedMps: number;
  provider: LocalizationProvider;
  quality: number;
  ts: number;
}

export interface KartPublic {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  sim: boolean;
  x: number;
  y: number;
  headingRad: number;
  speedMps: number;
  laps: number;
  distanceM: number;
  surgeUntil: number;
  padCooldownUntil: number;
  inventory: { defensive: number; pace: number };
  locProvider: LocalizationProvider;
}

export interface PadState {
  id: string;
  x: number;
  y: number;
  radiusM: number;
  lastHitKartId: string | null;
  lastHitAt: number | null;
}

export interface PickupState {
  nodeId: string;
  kind: PickupKind;
  x: number;
  y: number;
  radiusM: number;
  spawnedAt: number;
}

export interface ResultRow {
  rank: number;
  kartId: string;
  name: string;
  laps: number;
  distanceM: number;
  padHits: number;
  pickups: number;
}

export interface FailSafePublic {
  lastReason: string | null;
  lastLatencyMs: number | null;
  lastWithinBudget: boolean | null;
  lastAt: number | null;
}

export interface SessionSnapshot {
  phase: 0;
  brand: "Voltage League";
  mode: "sprint_heat";
  physicalAssistEnabled: false;
  actuatorsPresent: false;
  platform: "ninebot_gokart_pro2";
  status: SessionStatus;
  safeMode: boolean;
  aborted: boolean;
  sessionId: string;
  heatDurationMs: number;
  startedAt: number | null;
  endsAt: number | null;
  serverNow: number;
  localization: { provider: LocalizationProvider; frame: "track_local"; note: string };
  disabled: readonly string[];
  track: TrackLayout;
  karts: KartPublic[];
  pads: PadState[];
  pickups: PickupState[];
  results: ResultRow[] | null;
  failsafe: FailSafePublic;
  economy: {
    nextPickupAt: number | null;
    padCount: number;
    pickupNodes: number;
  };
}

export interface VisualAssistIntent {
  intentId: string;
  sessionId: string;
  kartId: string;
  ts: number;
  phase: 0;
  channel: AssistChannel;
  vfx: { type: VfxType; durationMs: number };
  telegraph?: string;
  physicalOffset: null;
  canTorqueNm: null;
  motorOverlay: null;
  actuatorPresent: false;
}

export interface AssistRecord extends VisualAssistIntent {
  rejected: boolean;
  rejectReason: string | null;
}

export type ClientMessage =
  | { type: "hello"; role: ClientRole; kartId?: string; name?: string }
  | { type: "ops"; action: "start" | "abort" | "safe_mode" | "seed_sims" | "reset" }
  | { type: "pose"; pose: Pose }
  | { type: "steer"; kartId: string; throttle: number; steer: number }
  | { type: "use_pickup"; kartId: string; slot: PickupKind };

export type ServerMessage =
  | { type: "hello_ok"; clientId: string; snapshot: SessionSnapshot }
  | { type: "snapshot"; snapshot: SessionSnapshot }
  | { type: "assist"; record: AssistRecord }
  | { type: "event"; kind: string; payload: Record<string, unknown> }
  | { type: "error"; message: string };

export interface Phase0Report {
  phase: 0;
  physicalAssistEnabled: false;
  actuatorsPresent: false;
  acceptedIntents: number;
  rejectedPhysicalAttempts: number;
  emittedPhysicalOffsets: number;
  acceptedWithForbiddenFields: number;
  failsafeTrips: number;
  failsafeOverBudget: number;
  gate: "PASS" | "FAIL";
  notes: string[];
}
