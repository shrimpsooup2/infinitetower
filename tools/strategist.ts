// The Strategist: a planning bot, to find out how far good play can get.
//
// The playtest bot (bot.ts) is a floor: greedy rules, no foresight. The
// Strategist looks ahead instead. Between waves the game is fully captured by
// a snapshot, and the simulation is deterministic, so every candidate move can
// be tried on a copy of the game:
//
//   1. List candidate moves: build each tower type on its best tile (scored by
//      how much road or air lane its range covers), upgrade a tower, level a
//      busy tower, socket a card.
//   2. For each, restore a copy, make the move, and play the coming wave with
//      enemy HP raised (x1.5 by default, about three waves of growth), so the
//      plan holds up for a while and not just for the next wave.
//   3. Score the copy: lives lost count most, then how deep shapes got down
//      the road (squared, weighted by the lives each would cost).
//   4. Make the move that cuts that threat most per gold spent. Repeat until no
//      move is worth its price, then call the wave at once (early-call bonus).
//
// Pack cards are kept by rarity and by a measured rating of each power on the
// bot's own towers (the balance bench). When it has open sockets but nothing to
// put in them, it buys packs from the Shop. Fusions come from the offline
// combiner (no LLM), which is weaker than forged fusions, so real play with
// the Forge should do at least as well.
//
//   node tools/strategist.ts [maps] [difficulties] [seeds] [--stress 1.5] [--jobs 4]
//     maps: a map id, a comma list, act1 | act2 | act3 | all
//     difficulties: casual | normal | hard | brutal | all (or a comma list)
//   node tools/strategist.ts tesseract brutal 1 --trace
//   node tools/strategist.ts meadow hard 1 --record run.json [--seed 7919]
//     (then: node tools/record.ts run.json, to watch it in the real client)

import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { World, type WorldSave } from '../src/sim/world.ts';
import type { Card, DifficultyDef, MapDef } from '../src/sim/types.ts';
import { MAPS, MAP_BY_ID } from '../src/content/maps.ts';
import { TOWERS, TOWER_BY_ID } from '../src/content/towers.ts';
import { POWER_BY_ID } from '../src/content/powers.ts';
import { DIFFICULTIES } from '../src/content/rules.ts';
import { bossFor } from '../src/content/enemies.ts';
import { pathOf } from '../src/sim/combat.ts';
import { runScenario, SCENARIOS } from '../src/balance/bench.ts';

type Diff = DifficultyDef['id'];

interface Ctx {
  map: MapDef;
  diff: Diff;
  stress: number;
  trace: boolean;
  /** Candidate tiles per tower type, best first. */
  tiles: Map<string, { c: number; r: number; score: number }[]>;
  rollouts: number;
}

type Move =
  | { k: 'build'; def: string; c: number; r: number; cost: number }
  | { k: 'upgrade'; c: number; r: number; cost: number }
  | { k: 'level'; c: number; r: number; cost: number }
  | { k: 'socket'; c: number; r: number; card: number; cost: number };

function describe(m: Move, w: World): string {
  const t = m.k === 'build' ? null : w.towerAt(m.c, m.r);
  switch (m.k) {
    case 'build': return `build ${m.def} @${m.c},${m.r}`;
    case 'upgrade': return `upgrade ${t?.def.id} to tier ${(t?.tier ?? 0) + 1}`;
    case 'level': return `level ${t?.def.id} to ${(t?.level ?? 0) + 1}`;
    case 'socket': {
      const c = w.cards.find((x) => x.uid === m.card);
      return `socket ${c?.power}(${c?.rarity}) into ${t?.def.id}`;
    }
  }
}

function apply(w: World, m: Move): boolean {
  if (m.k === 'build') return typeof w.place(m.def, m.c, m.r) !== 'string';
  const t = w.towerAt(m.c, m.r);
  if (!t) return false;
  if (m.k === 'upgrade') return w.upgrade(t.id) === null;
  if (m.k === 'level') return w.levelUp(t.id) === null;
  return w.socket(t.id, m.card) === null;
}

// ------------------------------------------------------------------ placement

/** Tiles ranked for each tower type by how much of what it can hit lies in its range. */
function rankTiles(w: World): Map<string, { c: number; r: number; score: number }[]> {
  const ground: [number, number][] = [];
  const air: [number, number][] = [];
  const out = { x: 0, y: 0, ang: 0 };
  for (const p of w.paths) for (let d = 0; d < p.length; d += 0.5) { p.at(d, out); ground.push([out.x, out.y]); }
  for (const p of w.air) for (let d = 0; d < p.length; d += 0.5) { p.at(d, out); air.push([out.x, out.y]); }
  const res = new Map<string, { c: number; r: number; score: number }[]>();
  for (const def of TOWERS) {
    if (def.chassis === 'aura') continue;
    const R = def.range[1], min = def.minRange ?? 0;
    const list: { c: number; r: number; score: number }[] = [];
    for (let r = 0; r < w.rows; r++) {
      for (let c = 0; c < w.cols; c++) {
        if (!w.canBuild(c, r)) continue;
        let score = 0;
        const cx = c + 0.5, cy = r + 0.5;
        const within = ([x, y]: [number, number]) => { const d = Math.hypot(x - cx, y - cy); return d <= R && d >= min; };
        if (def.hitsGround) for (const p of ground) if (within(p)) score++;
        if (def.hitsAir) for (const p of air) if (within(p)) score += 0.6;
        if (score > 0) list.push({ c, r, score });
      }
    }
    res.set(def.id, list.sort((a, b) => b.score - a.score));
  }
  return res;
}

// ------------------------------------------------------------------ rollouts

/**
 * What a copy of the coming wave cost: lives lost (the copy has lives to
 * spare, so a lost game still says how badly), how much health the leaked
 * shapes still had (a boss that got through at 10% beats one at 90%), and how
 * deep shapes got down the road (squared, weighted by the lives each costs).
 */
interface Probe { lives: number; hurt: number; pen: number }

const score = (p: Probe) => p.lives * 60 + p.hurt * 30 + p.pen;

/**
 * Play the next wave on a copy of the game after `move`, with enemy HP x`stress`.
 * `wave` plays that wave instead of the next one (to see a boss coming);
 * `bound` stops early once the copy is already worse than that score.
 */
function rollout(ctx: Ctx, base: WorldSave, move: Move | null, stress: number, o: { wave?: number; bound?: number } = {}): Probe | null {
  ctx.rollouts++;
  const w = new World({ map: ctx.map, difficulty: ctx.diff, seed: base.seed, fx: false, autoStart: false, packs: false });
  w.restore(base);
  if (move && !apply(w, move)) return null;
  (w as unknown as { diff: DifficultyDef }).diff = { ...w.diff, hp: w.diff.hp * stress };
  w.lives = 1e6;
  const p: Probe = { lives: 0, hurt: 0, pen: 0 };
  const leak = w.leak.bind(w);
  w.leak = (e) => {
    if (e.alive) {
      p.lives += e.lives;
      p.hurt += (e.lives * Math.max(0, e.hp)) / e.maxHp;
    }
    leak(e);
  };
  if (o.wave) w.waveN = o.wave - 1;
  if (w.callWave() !== null) return p;
  const bound = o.bound ?? Infinity;
  const deep = new Map<number, [number, number]>();
  for (let t = 1; !w.quiescent() && w.phase === 'running' && t < 60 * 300; t++) {
    w.step();
    if (t % 6) continue;
    // Already worse than the baseline on lives alone: no need to play it out.
    if (p.lives * 60 > bound) return p;
    for (const e of w.enemies) {
      if (!e.alive) continue;
      const f = e.dist / pathOf(w, e).length;
      const cur = deep.get(e.id);
      if (!cur || f > cur[0]) deep.set(e.id, [f, e.lives]);
    }
  }
  for (const [f, l] of deep.values()) p.pen += f * f * l;
  return p;
}

// ------------------------------------------------------------------ cards

const ratingCache = new Map<string, number>();

/** How much a power adds to a tower on its own, measured on the balance bench (1 = nothing). */
function rating(tower: string, power: string): number {
  const k = `${tower}:${power}`;
  let v = ratingCache.get(k);
  if (v !== undefined) return v;
  const sc = SCENARIOS.find((s) => s.id === 'mixed')!;
  const base = runScenario(tower, 2, null, [], 1, sc).score || 1;
  const spec = POWER_BY_ID.get(power)!.spec;
  v = runScenario(tower, 2, spec, [power], 1, sc).score / base;
  ratingCache.set(k, v);
  return v;
}

const RARITY_WEIGHT = [1, 1.45, 2.1, 3];

function cardValue(w: World, c: Card): number {
  const towers = [...new Set(w.towers.map((t) => t.def.id))];
  const best = towers.length ? Math.max(...towers.map((t) => rating(t, c.power))) : 1.2;
  const held = w.cards.some((x) => x.power === c.power) ? 0.85 : 1;
  return RARITY_WEIGHT[c.rarity] * best * held;
}

function openPacks(w: World): void {
  while (w.packs.length || w.offer) {
    const offered = w.offer?.cards ?? w.openPack(w.packs[0].uid);
    if (typeof offered === 'string') break;
    const best = [...offered].sort((a, b) => cardValue(w, b) - cardValue(w, a))[0];
    if (typeof w.pickCard(best.uid) === 'string') break;
  }
  // Keep a hand it can use; scrap the rest for gold.
  const slots = w.towers.reduce((a, t) => a + (3 - t.sockets.length), 0);
  const keep = Math.max(2, Math.min(6, slots));
  if (w.cards.length > keep) {
    const spare = [...w.cards].sort((a, b) => cardValue(w, a) - cardValue(w, b)).slice(0, w.cards.length - keep);
    for (const c of spare) w.scrapCard(c.uid);
  }
}

/** Buy a pack when there are open sockets and nothing worth putting in them. */
function shop(w: World): boolean {
  const open = w.towers.filter((t) => t.tier > t.sockets.length);
  if (!open.length || w.cards.length >= open.length) return false;
  for (const id of ['crown', 'prism', 'twin', 'family', 'shape'] as const) {
    const price = w.packPrice(id);
    if (price === null || w.packBlocker(id)) continue;
    const socketGuess = Math.min(...open.map((t) => w.socketCost(t, 1) ?? Infinity));
    if (w.gold >= price + socketGuess) {
      w.buyPack(id);
      openPacks(w);
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ planning

function candidates(w: World, ctx: Ctx): Move[] {
  const moves: Move[] = [];
  // New towers: each type on its best free tile; only the types that cover the
  // most per gold (plus a Beacon when there is a cluster to boost) are tried.
  const promise = (id: string) => {
    const def = TOWER_BY_ID.get(id)!;
    const spot = ctx.tiles.get(id)?.find((t) => w.canBuild(t.c, t.r));
    return spot ? (spot.score * def.damage[0] * def.rate[0]) / def.cost : 0;
  };
  const tryTypes = new Set([...TOWERS].filter((d) => d.chassis !== 'aura').sort((a, b) => promise(b.id) - promise(a.id)).slice(0, 6).map((d) => d.id));
  for (const def of TOWERS) {
    if (def.cost > w.gold || (def.chassis !== 'aura' && !tryTypes.has(def.id))) continue;
    if (def.chassis === 'aura') {
      // A Beacon goes where it covers the most towers.
      let best: { c: number; r: number; n: number } | null = null;
      for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) {
        if (!w.canBuild(c, r)) continue;
        const n = w.towers.filter((t) => Math.hypot(t.x - c - 0.5, t.y - r - 0.5) <= def.range[0]).length;
        if (n >= 3 && (!best || n > best.n)) best = { c, r, n };
      }
      if (best) moves.push({ k: 'build', def: def.id, c: best.c, r: best.r, cost: def.cost });
      continue;
    }
    const spot = ctx.tiles.get(def.id)?.find((t) => w.canBuild(t.c, t.r));
    if (spot) moves.push({ k: 'build', def: def.id, c: spot.c, r: spot.r, cost: def.cost });
  }
  const busy = [...w.towers].sort((a, b) => b.dmgTotal - a.dmgTotal);
  for (const t of busy.slice(0, 7)) {
    const up = w.upgradeCost(t);
    if (up !== null && up <= w.gold) moves.push({ k: 'upgrade', c: t.c, r: t.r, cost: up });
  }
  for (const t of busy.slice(0, 3)) {
    const lv = w.levelCost(t);
    if (lv !== null && lv <= w.gold) moves.push({ k: 'level', c: t.c, r: t.r, cost: lv });
  }
  // Sockets: the two best cards for each tower with a slot open.
  let sockets = 0;
  for (const t of busy) {
    if (t.tier <= t.sockets.length || sockets >= 8) continue;
    const cards = [...w.cards].sort((a, b) => RARITY_WEIGHT[b.rarity] * rating(t.def.id, b.power) - RARITY_WEIGHT[a.rarity] * rating(t.def.id, a.power)).slice(0, 2);
    for (const c of cards) {
      const cost = w.socketCost(t, c.rarity);
      if (cost !== null && cost <= w.gold) {
        moves.push({ k: 'socket', c: t.c, r: t.r, card: c.uid, cost });
        sockets++;
      }
    }
  }
  return moves;
}

/**
 * The stress at which the defence starts to bend: the planning stress, raised
 * while the coming wave is easy. Improving the defence there buys margin for
 * the waves after, the way a strong player keeps turning gold into safety.
 */
function bendingPoint(ctx: Ctx, snap: WorldSave, from: number): { stress: number; base: Probe } {
  let stress = from;
  let base = rollout(ctx, snap, null, stress)!;
  while (base.lives === 0 && base.pen < 1.5 && stress < 8) {
    stress *= 1.6;
    base = rollout(ctx, snap, null, stress)!;
  }
  return { stress, base };
}

/** The next boss wave within `ahead` waves after the coming one, if any. */
function bossAhead(w: World, ctx: Ctx, ahead = 5): number | null {
  for (let n = w.waveN + 2; n <= Math.min(w.totalWaves, w.waveN + 1 + ahead); n++) if (bossFor(ctx.map, n)) return n;
  return null;
}

/**
 * What to plan against this step, in order:
 *   1. the coming wave at its real HP, if it would leak (exactly what will happen);
 *   2. the coming wave with a little more HP (the planning stress, x1.5), if that
 *      would leak: the next few waves are about that much harder;
 *   3. a boss due within five waves, played now against the current defence,
 *      if it would get through (bosses need building for well ahead);
 *   4. the coming wave at the HP where the defence starts to bend, for margin.
 */
function objective(w: World, ctx: Ctx, snap: WorldSave, from: number): { stress: number; base: Probe; wave?: number; why: string } {
  const truth = rollout(ctx, snap, null, 1)!;
  if (truth.lives > 0) return { stress: 1, base: truth, why: 'leak' };
  const near = rollout(ctx, snap, null, ctx.stress)!;
  if (near.lives > 0) return { stress: ctx.stress, base: near, why: `@x${ctx.stress}` };
  const boss = bossAhead(w, ctx);
  if (boss) {
    const preview = rollout(ctx, snap, null, 1, { wave: boss })!;
    if (preview.lives > 0) return { stress: 1, base: preview, wave: boss, why: `boss ${boss}` };
  }
  const bend = bendingPoint(ctx, snap, from);
  return { ...bend, why: `@x${bend.stress.toFixed(1)}` };
}

function plan(w: World, ctx: Ctx): string[] {
  const done: string[] = [];
  let from = ctx.stress;
  for (let step = 0; step < 20; step++) {
    const moves = candidates(w, ctx);
    if (!moves.length) {
      if (shop(w)) continue;
      break;
    }
    const snap = w.snapshot();
    const { stress, base, wave, why } = objective(w, ctx, snap, from);
    if (stress > ctx.stress) from = stress;
    const s0 = score(base);
    let best: { m: Move; value: number; gain: number } | null = null;
    for (const m of moves) {
      const p = rollout(ctx, snap, m, stress, { wave, bound: s0 });
      if (!p) continue;
      const gain = s0 - score(p);
      if (gain <= 0.05) continue;
      const value = gain / Math.pow(m.cost, 0.6);
      if (!best || value > best.value) best = { m, value, gain };
    }
    if (!best) {
      // Nothing worth buying: maybe a pack would give the sockets something to use.
      if (shop(w)) continue;
      break;
    }
    done.push(`${describe(best.m, w)} (-${best.gain.toFixed(1)} ${why})`);
    apply(w, best.m);
  }
  return done;
}

// ------------------------------------------------------------------ a game

export interface Result {
  map: string;
  diff: Diff;
  seed: number;
  won: boolean;
  wave: number;
  lives: number;
  towers: string;
  fused: number;
  levels: number;
  /** For a loss: the fraction of its HP the killing wave would have needed to be held (1 for a win). */
  hold: number;
  rollouts: number;
  ms: number;
}

/**
 * A recorded game: the starting state and, per wave, the exact calls made on
 * the world and the tick they were made at. The world is deterministic, so
 * replaying the calls at the same ticks plays the same game (tools/record.ts
 * does that in the real client, on video).
 */
export interface Script {
  map: string;
  diff: Diff;
  seed: number;
  start: WorldSave;
  steps: { tick: number; calls: [string, ...unknown[]][]; after: { gold: number; lives: number; waveN: number } }[];
  result?: Result;
}

/** The world methods a player uses; recording wraps them. */
export const PLAYER_CALLS = ['place', 'upgrade', 'levelUp', 'socket', 'openPack', 'pickCard', 'scrapCard', 'buyPack', 'callWave'] as const;

export function play(mapId: string, diff: Diff, seed: number, o: { stress?: number; trace?: boolean; record?: boolean } = {}): Result & { script?: Script } {
  const t0 = Date.now();
  const map = MAP_BY_ID.get(mapId)!;
  const trace = !!o.trace;
  const w = new World({ map, difficulty: diff, seed, fx: false, autoStart: false });
  const ctx: Ctx = { map, diff, stress: o.stress ?? 1.5, trace, tiles: rankTiles(w), rollouts: 0 };
  const log: [string, ...unknown[]][] = [];
  const script: Script | undefined = o.record ? { map: mapId, diff, seed, start: w.snapshot(), steps: [] } : undefined;
  if (script) {
    // Log the outermost player calls only (a call may use another inside).
    let depth = 0;
    const rec = w as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of PLAYER_CALLS) {
      const f = rec[name].bind(w);
      rec[name] = (...a: unknown[]) => {
        if (!depth) log.push([name, ...a]);
        depth++;
        try { return f(...a); } finally { depth--; }
      };
    }
  }
  let last: WorldSave | null = null;
  while (w.phase !== 'victory' && w.phase !== 'defeat') {
    const tick = w.tick;
    log.length = 0;
    openPacks(w);
    const moves = plan(w, ctx);
    const expect = trace ? rollout(ctx, w.snapshot(), null, 1)! : null;
    if (trace) console.log(`wave ${w.waveN + 1} · lives ${w.lives} · gold ${Math.round(w.gold)} · ${moves.join('; ') || 'saves'}`);
    const l0 = w.lives;
    last = w.snapshot();
    const called = w.callWave();
    script?.steps.push({ tick, calls: [...log], after: { gold: w.gold, lives: w.lives, waveN: w.waveN } });
    if (called !== null && w.quiescent()) break;
    for (let t = 0; !w.quiescent() && w.phase === 'running' && t < 60 * 600; t++) w.step();
    // Let the last shots land, so the snapshot the next plan starts from is exact.
    for (let t = 0; !w.settled() && w.phase === 'running' && t < 600; t++) w.step();
    if (expect && expect.lives !== l0 - w.lives) console.log(`  !! expected to lose ${expect.lives}, lost ${l0 - w.lives}`);
  }
  // How close a loss was: the enemy HP (x the difficulty's) at which the last defence would have held.
  let hold = 1;
  if (w.phase === 'defeat' && last) {
    const snap = last;
    const holds = (k: number) => rollout(ctx, snap, null, k)!.lives < snap.lives;
    let lo = 0, hi = 1;
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (holds(mid)) lo = mid; else hi = mid; }
    hold = lo;
  }
  const tiers = [1, 2, 3].map((k) => w.towers.filter((t) => t.tier === k).length).join('/');
  const result: Result = {
    map: mapId, diff, seed, won: w.phase === 'victory', wave: w.phase === 'victory' ? w.totalWaves : w.waveN, lives: w.lives,
    towers: `${w.towers.length} (${tiers})`, fused: w.towers.filter((t) => t.sockets.length >= 2).length,
    levels: w.towers.reduce((a, t) => a + t.level - 1, 0), hold, rollouts: ctx.rollouts, ms: Date.now() - t0,
  };
  if (script) script.result = result;
  return { ...result, script };
}

// ------------------------------------------------------------------ CLI

function pickMaps(arg: string): string[] {
  if (arg === 'all') return MAPS.map((m) => m.id);
  const act = /^act([123])$/.exec(arg);
  if (act) return MAPS.filter((m) => m.act === Number(act[1])).map((m) => m.id);
  return arg.split(',').filter((id) => MAP_BY_ID.has(id));
}

function pickDiffs(arg: string): Diff[] {
  if (arg === 'all') return DIFFICULTIES.map((d) => d.id);
  return arg.split(',').filter((d): d is Diff => DIFFICULTIES.some((x) => x.id === d));
}

const line = (r: Result) =>
  `${r.map.padEnd(12)} ${r.diff.padEnd(7)} ${String(r.seed).padStart(3)}  ${(r.won ? `WON ${r.wave}` : `lost at ${r.wave} (${Math.round(r.hold * 100)}%)`).padEnd(18)} ${String(r.lives).padStart(4)}  ${r.towers.padEnd(12)} ${String(r.fused).padStart(5)} ${String(r.levels).padStart(5)} ${String(r.rollouts).padStart(7)} ${(r.ms / 1000).toFixed(0).padStart(5)}s`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name: string, dflt: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args.splice(i, 2)[1] : dflt;
  };
  const stress = Number(flag('stress', '1.5'));
  const jobs = Number(flag('jobs', String(Math.max(1, availableParallelism()))));
  const record = flag('record', '');
  const seed = Number(flag('seed', '7919'));
  const trace = args.includes('--trace');
  const job = args.includes('--job');
  const pos = args.filter((a) => !a.startsWith('--'));
  if (job) {
    // A child: play one game and report it as JSON.
    const [map, diff, seed] = pos;
    process.stdout.write(JSON.stringify(play(map, diff as Diff, Number(seed), { stress })) + '\n');
  } else {
    const maps = pickMaps(pos[0] ?? 'all');
    const diffs = pickDiffs(pos[1] ?? 'normal');
    const seeds = Math.max(1, Number(pos[2] ?? 1));
    const header = `map          diff    seed  result (held at)   lives  towers (t1/t2/t3) fused  lvls  rollouts   time`;
    if (trace || record || (maps.length === 1 && diffs.length === 1 && seeds === 1)) {
      const { script, ...r } = play(maps[0], diffs[0], seed, { stress, trace, record: !!record });
      console.log(header);
      console.log(line(r));
      if (record) {
        writeFileSync(record, JSON.stringify(script));
        console.log(`recorded ${script!.steps.length} waves to ${record}`);
      }
    } else {
      const queue = maps.flatMap((m) => diffs.flatMap((d) => Array.from({ length: seeds }, (_, s) => [m, d, String((s + 1) * 7919)])));
      const results: Result[] = [];
      console.log(header);
      let running = 0;
      const next = () => {
        while (running < jobs && queue.length) {
          const [m, d, s] = queue.shift()!;
          running++;
          const child = fork(fileURLToPath(import.meta.url), [m, d, s, '--job', '--stress', String(stress)], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
          let out = '';
          child.stdout!.on('data', (b) => { out += b; });
          child.on('exit', () => {
            running--;
            try {
              const r = JSON.parse(out.trim().split('\n').pop()!) as Result;
              results.push(r);
              console.log(line(r));
            } catch {
              console.log(`${m} ${d} ${s}: failed`);
            }
            if (!queue.length && !running) summary(results, maps, diffs);
            else next();
          });
        }
      };
      next();
    }
  }
}

/** Furthest wave per map and difficulty (best over seeds). */
function summary(results: Result[], maps: string[], diffs: Diff[]): void {
  console.log(`\nbest over seeds (W = won; else the wave it fell on, and the share of that wave's HP it could have held):`);
  console.log(`${'map'.padEnd(12)} ${diffs.map((d) => d.padStart(10)).join('')}`);
  for (const m of maps) {
    const cells = diffs.map((d) => {
      const rs = results.filter((r) => r.map === m && r.diff === d);
      if (!rs.length) return '-'.padStart(10);
      const best = rs.reduce((a, b) => (b.won && !a.won) || (b.won === a.won && b.wave > a.wave) ? b : a);
      return (best.won ? `W${best.wave}` : `${best.wave} ${Math.round(best.hold * 100)}%`).padStart(10);
    });
    console.log(`${m.padEnd(12)} ${cells.join('')}`);
  }
}
