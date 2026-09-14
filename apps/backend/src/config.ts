import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PHASE, RULES } from "@voltage/shared";

export interface Config {
  port: number;
  phase: 0;
  heatMs: number;
  dbPath: string;
  padCount: number;
  pickupNodes: number;
  host: string;
  allowGateProbe: boolean;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const heatMs = num(process.env.VOLTAGE_HEAT_MS, RULES.heatDurationMs);
  const dbPath = resolve(process.env.VOLTAGE_DB_PATH ?? "./data/voltage.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  return {
    port: num(process.env.PORT, 8080),
    phase: PHASE,
    heatMs,
    dbPath,
    padCount: num(process.env.VOLTAGE_PAD_COUNT, RULES.padCount.default),
    pickupNodes: num(process.env.VOLTAGE_PICKUP_NODES, RULES.pickupNodeCount.default),
    host: process.env.HOST ?? "0.0.0.0",
    allowGateProbe: process.env.ALLOW_GATE_PROBE === "1",
    ...overrides,
    phase: 0,
  };
}

function num(v: string | undefined, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
