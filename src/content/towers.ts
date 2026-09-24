// The 10 tower chassis. Each defines what counts as an "attack" and a "hit",
// so the same powers play very differently on each one. The `card` text is
// what the LLM reads about the chassis.

import type { TowerDef } from '../sim/types.ts';

export const TOWERS: TowerDef[] = [
  {
    id: 'bolt', name: 'Bolt', role: 'Single-target DPS', hotkey: '1', chassis: 'projectile',
    blurb: 'Fast, reliable homing bullets. Hits ground and air.',
    cost: 100, upgradeCost: [200, 400],
    damage: [11, 18, 30], rate: [2.0, 2.4, 3.0], range: [3.4, 3.8, 4.2],
    dtype: 'kinetic', hitsAir: true, hitsGround: true, projectileSpeed: 11, projRadius: 0.1,
    procCoef: 1, nthScale: 1,
    card: 'Bolt: a quick single-barrel turret firing small homing bullets (2-3 per second) at one target. Every bullet impact is a hit. Reliable, hits air.',
  },
  {
    id: 'cannon', name: 'Cannon', role: 'Splash damage', hotkey: '2', chassis: 'projectile',
    blurb: 'Heavy shells that explode on impact. Ground only.',
    cost: 150, upgradeCost: [300, 600],
    damage: [26, 44, 75], rate: [0.65, 0.75, 0.85], range: [3.2, 3.5, 3.8], splash: [0.95, 1.1, 1.3],
    dtype: 'kinetic', hitsAir: false, hitsGround: true, projectileSpeed: 7, projRadius: 0.17,
    procCoef: 0.7, nthScale: 1,
    card: 'Cannon: a fat-barrel destroyer firing slow shells that explode in a small blast (about 1 tile). Every enemy caught in the blast is hit. Slow, heavy, ground only.',
  },
  {
    id: 'frost', name: 'Frost', role: 'Crowd control', hotkey: '3', chassis: 'projectile',
    blurb: 'Twin barrels spit ice shards that Chill (slow) enemies.',
    cost: 120, upgradeCost: [240, 480],
    damage: [5, 9, 15], rate: [1.8, 2.1, 2.5], range: [3.0, 3.3, 3.6],
    dtype: 'frost', hitsAir: true, hitsGround: true, projectileSpeed: 10, projRadius: 0.11, onHitStatus: 'chill',
    procCoef: 1, nthScale: 1,
    card: 'Frost: twin barrels alternate firing icy shards; every hit adds a stack of Chill (slow). Low damage, strong control, hits air.',
  },
  {
    id: 'arc', name: 'Arc', role: 'Chain lightning', hotkey: '4', chassis: 'chain',
    blurb: 'Instant lightning that jumps between enemies.',
    cost: 175, upgradeCost: [350, 700],
    damage: [15, 26, 44], rate: [0.9, 1.0, 1.15], range: [3.0, 3.3, 3.6], chains: [3, 4, 5], chainRange: 1.9,
    dtype: 'shock', hitsAir: true, hitsGround: true,
    procCoef: 0.6, nthScale: 1,
    card: 'Arc: a tesla coil that strikes instantly with lightning chaining through 3-5 enemies (each jump weaker). Every link of the chain is a hit. Great vs groups, hits air.',
  },
  {
    id: 'rail', name: 'Rail', role: 'Long-range pierce', hotkey: '5', chassis: 'hitscan',
    blurb: 'A long-range line shot that pierces everything.',
    cost: 200, upgradeCost: [400, 800],
    damage: [55, 95, 170], rate: [0.42, 0.48, 0.55], range: [6.0, 6.8, 7.6],
    dtype: 'kinetic', hitsAir: true, hitsGround: true,
    procCoef: 0.8, nthScale: 1,
    card: 'Rail: a sniper with a very long barrel. Slowly fires an instant hitscan line across its whole range that pierces every enemy on the line; each pierced enemy is a hit. Huge range and damage per shot.',
  },
  {
    id: 'mortar', name: 'Mortar', role: 'Artillery', hotkey: '6', chassis: 'lob',
    blurb: 'Lobs incendiary shells at the path from very far away.',
    cost: 180, upgradeCost: [360, 720],
    damage: [34, 58, 100], rate: [0.45, 0.5, 0.58], range: [7.0, 7.8, 8.6], splash: [1.15, 1.3, 1.5],
    minRange: 1.6, flightTime: 1.1, projRadius: 0.18,
    dtype: 'fire', hitsAir: false, hitsGround: true,
    procCoef: 0.6, nthScale: 1,
    card: 'Mortar: artillery that lobs a shell in a 1-second arc onto the spot where the target will be, exploding in a wide blast. Every enemy in the blast is a hit. Enormous range but a minimum range; ground only.',
  },
  {
    id: 'flame', name: 'Flame', role: 'Short-range sweep', hotkey: '7', chassis: 'cone',
    blurb: 'Sprays a cone of fire that burns everything close.',
    cost: 140, upgradeCost: [280, 560],
    damage: [4, 7, 12], rate: [5, 5, 5], range: [2.2, 2.4, 2.6], coneAngle: 55,
    dtype: 'fire', hitsAir: false, hitsGround: true, onHitStatus: 'burn',
    procCoef: 0.25, nthScale: 1,
    card: 'Flame: a short-range flamethrower that continuously sprays a 55-degree cone, hitting every enemy in the cone 5 times per second and applying Burn. "on_attack" fires about twice per second while spraying. Ground only.',
  },
  {
    id: 'prism', name: 'Prism', role: 'Ramping beam', hotkey: '8', chassis: 'beam',
    blurb: 'A beam whose damage keeps ramping on the same target.',
    cost: 190, upgradeCost: [380, 760],
    damage: [3.2, 5.6, 9.6], rate: [5, 5, 5], range: [3.3, 3.6, 4.0],
    dtype: 'arcane', hitsAir: true, hitsGround: true,
    procCoef: 0.35, nthScale: 1,
    card: 'Prism: fires a continuous arcane beam at one enemy; damage ramps up to 3x while it stays on the same target. Each beam tick (5 per second) is a hit; "on_attack" fires about twice per second while beaming. Arcane ignores armor. Hits air.',
  },
  {
    id: 'beacon', name: 'Beacon', role: 'Support aura', hotkey: '9', chassis: 'aura',
    blurb: 'Buffs nearby towers and reveals stealth. Powers socketed here are lent to allies.',
    cost: 160, upgradeCost: [320, 640],
    damage: [12, 20, 34], rate: [0, 0, 0], range: [2.5, 2.8, 3.1], auraRate: [0.15, 0.22, 0.3], auraRange: [0.1, 0.15, 0.2],
    dtype: 'arcane', hitsAir: true, hitsGround: true,
    procCoef: 0.5, nthScale: 1,
    card: 'Beacon: a spiked support tower with NO attack of its own. Towers inside its aura attack faster and get more range, and stealthy enemies in it are revealed. CONDUIT: its on_attack/on_hit/on_kill/on_crit rules trigger whenever an ALLIED tower inside the aura attacks/hits/kills, at half strength ({dmg} uses that ally\'s damage). Its stats are shared with allies at half strength. "self" is the ally tower when triggered through the conduit.',
  },
  {
    id: 'hive', name: 'Hive', role: 'Drone swarm', hotkey: '0', chassis: 'drones',
    blurb: 'Launches seeking drones that sting enemies, including flyers.',
    cost: 210, upgradeCost: [420, 840],
    damage: [6, 9, 14], rate: [2, 2, 2], range: [3.6, 4.0, 4.4], drones: [3, 4, 6],
    dtype: 'toxic', hitsAir: true, hitsGround: true,
    procCoef: 0.5, nthScale: 1,
    card: 'Hive: an overseer that keeps 3-6 triangular drones alive; drones fly out to enemies in range and sting twice per second. Every sting is an attack and a hit ("on_attack" at most ~3 per second). Drones respawn when lost. Hits air.',
  },
];

export const TOWER_BY_ID = new Map(TOWERS.map((t) => [t.id, t]));

/** Minimum seconds between on_attack events per chassis (fast chassis are throttled). */
export const ATTACK_EVENT_MIN: Record<string, number> = { cone: 0.5, beam: 0.5, drones: 0.33 };

/**
 * Gold to fill each socket (base, secondary, tertiary) with a Common card. Rarer
 * cards cost more (RARITIES[].socketMult), so a Legendary is worth saving.
 */
export const SOCKET_COST = [80, 240, 720];
/**
 * How much of the rarity markup applies per slot. A rare card is worth most as
 * the base (about 60% of the fusion) and least as the tertiary (about 10%):
 * a Legendary costs x5 as the base, x3 as the secondary, x1.8 as the tertiary.
 */
export const SOCKET_RARITY_WEIGHT = [1, 0.5, 0.2];
export const SOCKET_ROLE = ['Base', 'Secondary', 'Tertiary'] as const;

export function towerCostToTier(def: TowerDef, tier: number): number {
  let c = def.cost;
  for (let i = 1; i < tier; i++) c += def.upgradeCost[i - 1];
  return c;
}
