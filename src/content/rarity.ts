// Power cards come in four rarities. A card's rarity multiplies how strong
// its tower's effects are (the shared fusion design itself never changes).
// Some powers only ever drop at Rare or better. Odds improve as the run goes
// on, and boss drafts are always Rare or better.

import type { Rng } from '../sim/rng.ts';

export interface RarityDef {
  id: 'common' | 'rare' | 'epic' | 'legendary';
  name: string;
  color: string;
  mult: number;
  /**
   * Socketing this rarity into the BASE slot costs this many times the slot's
   * base price. Later slots carry less of the fusion's strength, so the markup
   * shrinks there (see SOCKET_RARITY_WEIGHT).
   */
  socketMult: number;
  /**
   * Socket prices rise as a run goes on and income grows: +this fraction of the
   * price per wave. Rarer cards climb faster, so hoarding them gets expensive.
   */
  socketGrowth: number;
}

export const RARITIES: RarityDef[] = [
  { id: 'common', name: 'Common', color: '#b8b8b8', mult: 1, socketMult: 1, socketGrowth: 0.02 },
  { id: 'rare', name: 'Rare', color: '#00b2e1', mult: 1.2, socketMult: 2, socketGrowth: 0.03 },
  { id: 'epic', name: 'Epic', color: '#bf7ff5', mult: 1.45, socketMult: 3, socketGrowth: 0.045 },
  { id: 'legendary', name: 'Legendary', color: '#ffc629', mult: 1.75, socketMult: 5, socketGrowth: 0.065 },
];

/**
 * Minimum rarity a power can drop at. 16 powers are Common, 12 need a Rare
 * slot, 8 an Epic slot, and 4 exist only as Legendary cards.
 */
export const POWER_MIN_RARITY: Record<string, number> = {
  orbit: 1, boomerang: 1, cluster: 1, nova: 1, rain: 1, overcharge: 1, momentum: 1, executioner: 1, chaos: 1, spore: 1,
  growth: 1, mirror: 1,
  echo: 2, void: 2, siphon: 2, patience: 2, bounty: 2, jinx: 2, gamble: 2, contagion: 2,
  metronome: 3, jackpot: 3, rewind: 3, stasis: 3,
};

export function rollRarity(rng: Rng, wave: number, boss: boolean): number {
  const t = Math.min(1, wave / 45);
  let w = [68 - 42 * t, 24 + 6 * t, 7 + 22 * t, 1 + 14 * t];
  if (boss) w = [0, w[1] + w[0] * 0.55, w[2] + w[0] * 0.33, w[3] + w[0] * 0.12];
  const total = w.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return 0;
}

/** Potency multiplier of a tower from its socketed cards (base counts most). */
export function rarityFactor(rarities: readonly number[]): number {
  if (!rarities.length) return 1;
  const weights = [0.6, 0.3, 0.1];
  let sum = 0;
  let wsum = 0;
  rarities.forEach((r, i) => {
    sum += RARITIES[r].mult * weights[i];
    wsum += weights[i];
  });
  return sum / wsum;
}
