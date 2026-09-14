import type { LocalizationProvider, LookSource, PickupKind } from "@voltage/shared";

export const KART_COLORS = ["#3df0ff", "#ffb020", "#ff3d8a", "#5dff9a", "#b38cff", "#ff6b4a"];

export interface KartState {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  sim: boolean;
  x: number;
  y: number;
  headingRad: number;
  speedMps: number;
  theta: number;
  laps: number;
  distanceM: number;
  lastS: number;
  surgeUntil: number;
  padCooldownUntil: number;
  inventory: { defensive: number; pace: number };
  locProvider: LocalizationProvider;
  locQuality: number;
  worldPoseHealthy: boolean;
  worldFxAllowed: boolean;
  lookSource: LookSource;
  headsetConnected: boolean;
  kartCamConnected: boolean;
  hideReason: string | null;
  /** True after KartVio / dual_pose world samples — compositor then requires fresh healthy pose. */
  externalWorld: boolean;
  lastPoseAt: number;
  throttle: number;
  steer: number;
}

export function createKart(partial: Partial<KartState> & { id: string; name: string }, index = 0): KartState {
  return {
    color: KART_COLORS[index % KART_COLORS.length],
    connected: true,
    sim: false,
    x: 46.5,
    y: 0,
    headingRad: Math.PI / 2,
    speedMps: 0,
    theta: 0,
    laps: 0,
    distanceM: 0,
    lastS: 0,
    surgeUntil: 0,
    padCooldownUntil: 0,
    inventory: { defensive: 0, pace: 0 },
    locProvider: "stub",
    locQuality: 1,
    worldPoseHealthy: true,
    worldFxAllowed: true,
    lookSource: "sim",
    headsetConnected: false,
    kartCamConnected: false,
    hideReason: null,
    externalWorld: false,
    lastPoseAt: 0,
    throttle: 0,
    steer: 0,
    ...partial,
  };
}

export function hasSlot(kart: KartState, kind: PickupKind): boolean {
  return kart.inventory[kind] < 1;
}
