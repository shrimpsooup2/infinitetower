// Economy, difficulty and pacing constants in one place for tuning.

import type { DifficultyDef } from '../sim/types.ts';

export const DIFFICULTIES: DifficultyDef[] = [
  { id: 'casual', name: 'Casual', hp: 0.7, lives: 30, gold: 350, bounty: 1.1 },
  { id: 'normal', name: 'Normal', hp: 1.0, lives: 20, gold: 300, bounty: 1.0 },
  { id: 'hard', name: 'Hard', hp: 1.3, lives: 15, gold: 275, bounty: 0.95 },
  { id: 'brutal', name: 'Brutal', hp: 1.65, lives: 10, gold: 250, bounty: 0.9 },
];
export const DIFFICULTY_BY_ID = new Map(DIFFICULTIES.map((d) => [d.id, d]));

export const RULES = {
  tickRate: 60,
  waves: 40,
  sellRefund: 0.7,
  /** Seconds between a wave finishing spawning and the next one auto-starting. */
  countdown: 15,
  /** Gold per second of countdown skipped by calling a wave early (scaled by wave). */
  earlyCallPerSec: 1.2,
  clearBonus: (n: number) => 20 + 4 * n,
  bountyMult: (n: number) => 1 + 0.035 * (n - 1),
  hpMult: (n: number) => Math.pow(1.09, n - 1) * (n > 40 ? Math.pow(1.03, n - 40) : 1),
  /** Gold a single tower's effects may grant per wave. */
  towerGoldCap: (n: number) => 30 + 5 * n,
  draftEvery: 3,
  draftOptions: 3,
  bossDraftOptions: 4,
  /** Hard caps that keep any fusion from breaking the game. */
  maxSpawnsPerTower: 60,
  maxEventsPerTowerTick: 64,
  maxScheduled: 2500,
  maxSpawnDepth: 2,
  ccImmunity: 1.2,
  slowCap: 0.3,
  bossSlowCap: 0.5,
  beat: 0.5,
};
