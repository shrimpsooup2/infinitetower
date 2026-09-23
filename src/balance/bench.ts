// Balance by simulation. The LLM decides what a fusion DOES; this decides how
// STRONG it is. A fusion is run headlessly in 4 benchmark scenarios against
// the same tower with no powers, and a single potency multiplier (scaling all
// {dmg} values and CC durations) is searched until it lands in its band.

import { World } from '../sim/world.ts';
import type { MapDef, WaveDef } from '../sim/types.ts';
import type { FusionSpec } from '../effects/types.ts';
import { TOWER_BY_ID } from '../content/towers.ts';

const BENCH_MAP: MapDef = {
  id: 'bench', name: 'Bench', blurb: '', cols: 14, rows: 11, seed: 7, difficulty: 1, hpScale: 1, pathMode: 'first',
  paths: [[[-1, 3], [9, 3], [9, 8], [-1, 8]]],
  air: [[[-1, 5], [14, 5]]],
  blocked: [],
};
const TOWER_SPOT: [number, number] = [5, 5];
const SECONDS = 28;

const wave = (groups: WaveDef['groups'], hpMult: number): WaveDef => ({
  n: 1, groups, hpMult, boss: null, reward: 0, carapace: null, mutators: [],
});

export const SCENARIOS: { id: string; wave: WaveDef }[] = [
  { id: 'boss', wave: wave([{ enemy: 'juggernaut', count: 1, interval: 1, delay: 0, path: 0 }], 40) },
  { id: 'swarm', wave: wave([
    { enemy: 'mini', count: 36, interval: 0.3, delay: 0, path: 0 },
    { enemy: 'square', count: 12, interval: 0.6, delay: 4, path: 0 },
  ], 2.5) },
  { id: 'armored', wave: wave([{ enemy: 'pentagon', count: 12, interval: 1.2, delay: 0, path: 0 }], 2.5) },
  { id: 'mixed', wave: wave([
    { enemy: 'square', count: 8, interval: 0.8, delay: 0, path: 0 },
    { enemy: 'wisp', count: 6, interval: 1, delay: 2, path: 0 },
    { enemy: 'aegis', count: 4, interval: 1.4, delay: 4, path: 0 },
    { enemy: 'mender', count: 2, interval: 2, delay: 6, path: 0 },
  ], 1.6) },
];

export interface ScenarioResult {
  id: string;
  damage: number;
  control: number;
  gold: number;
  leaks: number;
  score: number;
}

/** Run one scenario and return the tower's contribution. */
export function runScenario(towerId: string, tier: number, spec: FusionSpec | null, sockets: string[], potency: number, sc: { id: string; wave: WaveDef }): ScenarioResult {
  const w = new World({
    map: BENCH_MAP, fx: false, draft: false, seed: 1234, waves: [sc.wave], startGold: 1e6, autoStart: false,
    specProvider: spec ? () => ({ spec, potency, state: 'ready' }) : undefined,
  });
  const t = w.place(towerId, TOWER_SPOT[0], TOWER_SPOT[1]);
  if (typeof t === 'string') throw new Error(t);
  for (let i = 1; i < tier; i++) w.upgrade(t.id);
  // A Beacon has no attack of its own: measure it through an allied Bolt.
  if (towerId === 'beacon') {
    const ally = w.place('bolt', TOWER_SPOT[0] + 1, TOWER_SPOT[1]);
    if (typeof ally !== 'string') for (let i = 1; i < tier; i++) w.upgrade(ally.id);
  }
  if (spec) {
    t.sockets = [...sockets];
    w.refreshSpec(t);
  }
  w.callWave();
  let control = 0;
  const prev = new Map<number, number>();
  const ticks = SECONDS * 60;
  for (let i = 0; i < ticks && w.phase === 'running'; i++) {
    prev.clear();
    for (const e of w.enemies) prev.set(e.id, e.dist);
    w.step();
    for (const e of w.enemies) {
      const d0 = prev.get(e.id);
      if (d0 === undefined || !e.alive) continue;
      const expected = e.speed * e.hasteMult / 60;
      control += Math.max(0, expected - (e.dist - d0));
    }
  }
  const damage = w.towers.reduce((a, x) => a + x.dmgTotal, 0);
  const leaks = w.stats.leaks;
  // Denying a tile of progress is worth about half a second of the attacker's base DPS.
  const attacker = towerId === 'beacon' ? TOWER_BY_ID.get('bolt')! : t.def;
  const dps = attacker.damage[tier - 1] * Math.max(0.5, attacker.rate[tier - 1] || 1);
  // Gold from effects (bounties are the same for everyone) and restored lives.
  const effectGold = t.goldWave;
  const score = damage + control * dps * 0.5 + effectGold * 4 + t.livesWave * 150;
  return { id: sc.id, damage, control, gold: effectGold, leaks, score: Math.max(1, score) };
}

export interface BenchReport {
  ratio: number;
  perScenario: { id: string; ratio: number; damage: number; control: number }[];
  ms: number;
}

const baselineCache = new Map<string, ScenarioResult[]>();

export function baseline(towerId: string, tier: number): ScenarioResult[] {
  const k = `${towerId}:${tier}`;
  let b = baselineCache.get(k);
  if (!b) {
    b = SCENARIOS.map((s) => runScenario(towerId, tier, null, [], 1, s));
    baselineCache.set(k, b);
  }
  return b;
}

/** Blended strength of a spec relative to the bare tower (1.0 = no power). */
export function measure(towerId: string, tier: number, spec: FusionSpec, sockets: string[], potency: number): BenchReport {
  const t0 = Date.now();
  const base = baseline(towerId, tier);
  const res = SCENARIOS.map((s) => runScenario(towerId, tier, spec, sockets, potency, s));
  const ratios = res.map((r, i) => r.score / base[i].score);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const max = Math.max(...ratios);
  return {
    ratio: 0.6 * mean + 0.4 * max,
    perScenario: res.map((r, i) => ({ id: r.id, ratio: ratios[i], damage: Math.round(r.damage), control: Math.round(r.control * 10) / 10 })),
    ms: Date.now() - t0,
  };
}

export const TARGETS: Record<number, { center: number; tol: number; tier: number }> = {
  1: { center: 1.3, tol: 0.15, tier: 1 },
  2: { center: 1.6, tol: 0.12, tier: 2 },
  3: { center: 1.95, tol: 0.12, tier: 3 },
};

export interface SolveResult {
  potency: number;
  ratio: number;
  status: 'ok' | 'niche' | 'too_strong';
  report: BenchReport;
  evaluations: number;
}

/** Search potency so the fusion's blended ratio lands in the band for its socket count. */
export function solvePotency(towerId: string, spec: FusionSpec, sockets: string[]): SolveResult {
  if (!TOWER_BY_ID.has(towerId)) throw new Error(`unknown tower ${towerId}`);
  const target = TARGETS[Math.min(3, Math.max(1, sockets.length))];
  const tier = target.tier;
  let lo = 0.2, hi = 2;
  let evals = 0;
  const at = (p: number) => {
    evals++;
    return measure(towerId, tier, spec, sockets, p);
  };
  const rHi = at(hi);
  if (rHi.ratio < target.center - target.tol) return { potency: hi, ratio: rHi.ratio, status: 'niche', report: rHi, evaluations: evals };
  const rLo = at(lo);
  if (rLo.ratio > target.center + target.tol) return { potency: lo, ratio: rLo.ratio, status: 'too_strong', report: rLo, evaluations: evals };
  let best = { p: hi, r: rHi };
  for (let i = 0; i < 7; i++) {
    const mid = Math.sqrt(lo * hi);
    const r = at(mid);
    if (Math.abs(r.ratio - target.center) < Math.abs(best.r.ratio - target.center)) best = { p: mid, r };
    if (Math.abs(r.ratio - target.center) <= target.tol * 0.5) break;
    if (r.ratio < target.center) lo = mid;
    else hi = mid;
  }
  return { potency: Math.round(best.p * 1000) / 1000, ratio: best.r.ratio, status: 'ok', report: best.r, evaluations: evals };
}
