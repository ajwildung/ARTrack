import type { ResultRow } from "@voltage/shared";
import type { KartState } from "./session.ts";

export class Scoring {
  padHits = new Map<string, number>();
  pickups = new Map<string, number>();

  recordPad(kartId: string): void {
    this.padHits.set(kartId, (this.padHits.get(kartId) ?? 0) + 1);
  }

  recordPickup(kartId: string): void {
    this.pickups.set(kartId, (this.pickups.get(kartId) ?? 0) + 1);
  }

  reset(): void {
    this.padHits.clear();
    this.pickups.clear();
  }

  standings(karts: KartState[]): ResultRow[] {
    const sorted = [...karts].sort((a, b) => {
      if (b.laps !== a.laps) return b.laps - a.laps;
      return b.distanceM - a.distanceM;
    });
    return sorted.map((k, i) => ({
      rank: i + 1,
      kartId: k.id,
      name: k.name,
      laps: k.laps,
      distanceM: Math.round(k.distanceM * 10) / 10,
      padHits: this.padHits.get(k.id) ?? 0,
      pickups: this.pickups.get(k.id) ?? 0,
    }));
  }
}
