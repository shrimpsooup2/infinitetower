// Budget-based wave generator. Deterministic per (map, wave number), so each
// map's 40 waves are fixed and balanceable, and endless waves can be produced
// on demand. New enemy types get an "introduction" wave where they star alone.

import type { EnemyDef, MapDef, SpawnGroup, WaveDef } from '../sim/types.ts';
import { DAMAGE_TYPES } from '../effects/types.ts';
import { ENEMIES, ENEMY_BY_ID, BOSS_WAVES } from './enemies.ts';
import { RULES } from './rules.ts';
import { Rng } from '../sim/rng.ts';
import { hashString } from '../sim/math.ts';

const FILLER = ['square', 'crasher', 'mini'];
const ENDLESS_MUTATORS = ['shielded', 'swift', 'regen', 'armored', 'swarm'];

export function waveBudget(n: number): number {
  return 7 + 2.4 * (n - 1) + 0.035 * (n - 1) * (n - 1);
}

function interval(def: EnemyDef): number {
  if (def.id === 'mini') return 0.28;
  if (def.traits.includes('elite') || def.cost >= 8) return 2.2;
  return Math.max(0.35, Math.min(1.5, 0.9 / def.speed));
}

function group(def: EnemyDef, count: number, delay: number, path: number): SpawnGroup {
  return { enemy: def.id, count: Math.max(1, Math.round(count)), interval: interval(def), delay, path };
}

export function generateWave(map: MapDef, n: number): WaveDef {
  const rng = new Rng(hashString(`${map.id}:${map.seed}:${n}`));
  const budget = waveBudget(n);
  const pool = ENEMIES.filter((e) => e.intro > 0 && e.intro <= n);
  const groups: SpawnGroup[] = [];
  const pathCount = map.paths.length;
  const airCount = map.air.length;
  let pathToggle = rng.int(0, Math.max(0, pathCount - 1));
  const pickPath = (def: EnemyDef): number => {
    if (def.traits.includes('flying')) return rng.int(0, airCount - 1);
    if (map.pathMode === 'alternate') return -1;
    if (map.pathMode === 'per_group') return (pathToggle++) % pathCount;
    return 0;
  };
  let t = 0;
  const add = (def: EnemyDef, pts: number) => {
    const count = Math.max(1, pts / Math.max(0.3, def.cost));
    const g = group(def, count, t, pickPath(def));
    groups.push(g);
    // Next group starts partway through this one so waves feel continuous.
    t += g.count * g.interval * 0.55 + 1;
  };

  const boss = BOSS_WAVES[n] ?? null;
  if (boss) {
    // Escorts first, then the boss.
    const escorts = rng.shuffle(pool.filter((e) => e.cost <= 4)).slice(0, 2);
    for (const e of escorts) add(e, budget * 0.25);
    groups.push({ enemy: boss, count: 1, interval: 1, delay: t + 2, path: map.pathMode === 'first' ? 0 : pickPath(ENEMY_BY_ID.get(boss)!) });
  } else {
    const intro = pool.filter((e) => e.intro === n);
    if (intro.length) {
      add(ENEMY_BY_ID.get(FILLER[rng.int(0, Math.min(n >= 5 ? 2 : 1, 2))])!, budget * 0.35);
      for (const e of intro) add(e, (budget * 0.65) / intro.length);
    } else if (n % 5 === 0) {
      // Rush wave: lots of fast or swarming enemies.
      const fast = pool.filter((e) => e.traits.includes('fast') || e.id === 'mini' || e.traits.includes('flying'));
      for (const e of rng.shuffle(fast).slice(0, 2)) add(e, budget * 0.5);
    } else {
      const k = n < 8 ? 2 : rng.int(2, 3);
      const recent = pool.filter((e) => n - e.intro < 8 && e.cost < 8);
      const chosen = new Set<EnemyDef>();
      while (chosen.size < k && chosen.size < pool.length) {
        const src = recent.length && rng.chance(0.55) ? recent : pool;
        const e = rng.pick(src);
        if (e.cost >= 8 && (n < e.intro + 3 || rng.chance(0.6))) continue;
        chosen.add(e);
      }
      const shares = [...chosen].map(() => rng.range(0.6, 1.4));
      const total = shares.reduce((a, b) => a + b, 0);
      [...chosen].forEach((e, i) => add(e, (budget * shares[i]) / total));
    }
    if (n >= 15 && n % 10 === 5) add(ENEMY_BY_ID.get('juggernaut')!, 16);
  }

  const mutators: string[] = [];
  if (n > RULES.waves) {
    const k = Math.floor((n - RULES.waves - 1) / 5) + 1;
    const mrng = new Rng(hashString(`${map.id}:mutators`));
    const order = mrng.shuffle([...ENDLESS_MUTATORS]);
    for (let i = 0; i < k; i++) mutators.push(order[i % order.length]);
  }

  return {
    n,
    groups,
    hpMult: RULES.hpMult(n) * map.hpScale,
    boss,
    reward: RULES.clearBonus(n),
    carapace: DAMAGE_TYPES[rng.int(0, DAMAGE_TYPES.length - 1)],
    mutators,
  };
}

/** Summary for the next-wave preview: enemy id -> count. */
export function waveSummary(w: WaveDef): { enemy: string; count: number }[] {
  const m = new Map<string, number>();
  for (const g of w.groups) m.set(g.enemy, (m.get(g.enemy) ?? 0) + g.count);
  return [...m.entries()].map(([enemy, count]) => ({ enemy, count }));
}
