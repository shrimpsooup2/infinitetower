// Budget-based wave generator. Deterministic per (map, wave number): each
// map's waves are fixed and balanceable, and endless waves can be produced on
// demand. Waves 1-20 are Flatland (2D), 21-40 Solidspace (3D), 41-60
// Hyperspace (4D). New shapes get an introduction wave where they star.
// The HP budget grows ~15% per wave through Solidspace (13% budget, 2% HP
// creep) and ~13% in Hyperspace: fusions are how you keep up.

import type { EnemyDef, MapDef, SpawnGroup, SpawnMod, WaveDef } from '../sim/types.ts';
import { DAMAGE_TYPES } from '../effects/types.ts';
import { ENEMY_BY_ID, INTRO, bossFor, dimensionOf } from './enemies.ts';
import { RULES } from './rules.ts';
import { Rng } from '../sim/rng.ts';
import { hashString } from '../sim/math.ts';

const ENDLESS_MUTATORS = ['shielded', 'swift', 'regen', 'armored', 'swarm'];

/** Total enemy HP (before the wave HP multiplier and difficulty) a wave is built from. */
export function waveBudget(n: number): number {
  // 13% a wave through Solidspace, 11% in Hyperspace (the waves there were out of reach).
  return 260 * Math.pow(1.13, Math.min(n, 40) - 1) * Math.pow(1.11, Math.max(0, n - 40));
}

export const MOD_HP: Record<SpawnMod, number> = { swarm: 0.3, flying: 0.8, swift: 0.7, elite: 3, stealth: 0.9 };
/** The share of its budget a swift group gets: their speed makes up the rest. */
export const SWIFT_SHARE = 0.7;

function introduced(n: number): EnemyDef[] {
  return INTRO.filter(([, w]) => w <= n).map(([id]) => ENEMY_BY_ID.get(id)!);
}

/** HP a wave pays for one of these, including the shapes it splits into. */
function unitHp(def: EnemyDef, mods: SpawnMod[]): number {
  const own = def.hp * mods.reduce((a, m) => a * MOD_HP[m], 1) + def.shield * 0.6;
  let kids = 0;
  for (const a of def.abilities) {
    const child = a.kind === 'split' && a.enemy ? ENEMY_BY_ID.get(a.enemy) : undefined;
    if (child) kids += (a.count ?? 2) * unitHp(child, mods.filter((m) => m !== 'elite'));
  }
  return own + kids;
}

function interval(def: EnemyDef, mods: SpawnMod[]): number {
  if (mods.includes('swarm')) return 0.22;
  let base = Math.max(0.35, Math.min(1.6, (0.55 + def.size * 1.5) / def.speed));
  if (mods.includes('elite')) base *= 1.8;
  if (mods.includes('swift')) base *= 0.7;
  return base;
}

export function generateWave(map: MapDef, n: number): WaveDef {
  const rng = new Rng(hashString(`${map.id}:${map.seed}:${n}`));
  const budget = waveBudget(n);
  const dim = dimensionOf(Math.min(n, 60));
  const pool = introduced(n);
  const current = pool.filter((e) => e.dim === dim);
  const older = pool.filter((e) => e.dim < dim);
  const groups: SpawnGroup[] = [];
  let pathToggle = rng.int(0, Math.max(0, map.paths.length - 1));
  const pickPath = (flying: boolean): number => {
    if (flying) return rng.int(0, Math.max(1, map.air.length) - 1);
    if (map.pathMode === 'alternate') return -1;
    if (map.pathMode === 'per_group') return (pathToggle++) % map.paths.length;
    return 0;
  };
  let t = 0;
  const add = (def: EnemyDef, pts: number, mods: SpawnMod[] = []) => {
    // Swift shapes move 1.5x as fast, so spend less of the budget on them.
    if (mods.includes('swift')) pts *= SWIFT_SHARE;
    let count = pts / unitHp(def, mods);
    if (count > 45 && !mods.includes('swarm') && !mods.includes('elite')) {
      mods = [...mods, 'elite'];
      count = pts / unitHp(def, mods);
    }
    const g: SpawnGroup = {
      enemy: def.id, count: Math.max(1, Math.min(60, Math.round(count))), interval: interval(def, mods), delay: t,
      path: pickPath(def.traits.includes('flying') || mods.includes('flying')), mods,
    };
    groups.push(g);
    t += g.count * g.interval * 0.6 + 1.2;
  };
  const randomMods = (def: EnemyDef): SpawnMod[] => {
    const m: SpawnMod[] = [];
    if (n >= 5 && !def.traits.includes('flying') && rng.chance(0.16)) m.push('flying');
    if (n >= 3 && def.hp * (dim === 2 ? 1 : 0.2) < 200 && rng.chance(0.14)) m.push('swarm');
    else if (n >= 10 && rng.chance(0.12)) m.push('elite');
    if (n >= 8 && rng.chance(0.12)) m.push('swift');
    if (n >= 24 && rng.chance(0.1)) m.push('stealth');
    return m;
  };

  const boss = bossFor(map, n);
  if (boss) {
    const escorts = rng.shuffle([...current]).slice(0, 2);
    for (const e of escorts) add(e, budget * 0.25, randomMods(e));
    const bdef = ENEMY_BY_ID.get(boss)!;
    groups.push({ enemy: boss, count: 1, interval: 1, delay: t + 2, path: pickPath(false), mods: [] });
    void bdef;
  } else {
    const fresh = current.filter((e) => e.intro === n);
    if (fresh.length) {
      // Introduction wave: the newcomer stars on its own, then a little support.
      for (const e of fresh) add(e, (budget * 0.65) / fresh.length);
      const support = current.filter((e) => e.intro < n);
      if (support.length) add(rng.pick(support), budget * 0.35);
      else add(fresh[0], budget * 0.35, n >= 3 ? ['swarm'] : []);
    } else if (n % 5 === 0) {
      // Rush wave: fast, flying or swarming variants.
      const theme: SpawnMod = rng.pick(n >= 8 ? ['swift', 'flying', 'swarm'] as SpawnMod[] : ['swarm'] as SpawnMod[]);
      const cand = rng.shuffle([...current]).slice(0, 2);
      for (const e of cand) add(e, budget * 0.5, [theme]);
    } else {
      const recent = current.filter((e) => n - e.intro < 7);
      const k = n < 6 ? 2 : rng.int(2, 3);
      const chosen = new Map<string, EnemyDef>();
      for (let guard = 0; chosen.size < k && guard < 20; guard++) {
        const src = recent.length && rng.chance(0.6) ? recent : current;
        const e = rng.pick(src);
        chosen.set(e.id, e);
      }
      const list = [...chosen.values()];
      const shares = list.map(() => rng.range(0.6, 1.4));
      const oldShare = older.length && rng.chance(0.5) ? 0.2 : 0;
      const total = shares.reduce((a, b) => a + b, 0);
      list.forEach((e, i) => add(e, (budget * (1 - oldShare) * shares[i]) / total, randomMods(e)));
      if (oldShare) {
        const o = rng.pick(older.slice(-6));
        add(o, budget * oldShare, rng.chance(0.5) ? ['swarm'] : ['elite']);
      }
    }
  }

  const mutators: string[] = [];
  if (n > 60) {
    const k = Math.floor((n - 61) / 5) + 1;
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

/** Summary for the next-wave preview: enemy id -> count, with modifiers. */
export function waveSummary(w: WaveDef): { enemy: string; count: number; mods: SpawnMod[] }[] {
  const m = new Map<string, { enemy: string; count: number; mods: SpawnMod[] }>();
  for (const g of w.groups) {
    const key = g.enemy + ':' + (g.mods ?? []).join(',');
    const cur = m.get(key);
    const count = g.count;
    if (cur) cur.count += count;
    else m.set(key, { enemy: g.enemy, count, mods: g.mods ?? [] });
  }
  return [...m.values()];
}
