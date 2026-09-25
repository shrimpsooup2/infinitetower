// The Strategist: a planning bot, to find out how far good play can get.
//
// The playtest bot (bot.ts) is a floor: greedy rules, no foresight. The
// Strategist looks ahead instead. Between waves the game is fully captured by
// a snapshot, and the simulation is deterministic, so every candidate move can
// be tried on a copy of the game:
//
//   1. List candidate moves: build each tower type on its best tiles (scored
//      by how much road or air lane its range covers), upgrade a tower, level a
//      busy tower, socket any card in hand into a busy tower.
//   2. Pick what to plan against (see objective()): a leak in the coming wave,
//      a boss due soon, or margin (the coming wave with more HP).
//   3. For each move, restore a copy, make the move and play that wave. The
//      copies run on worker threads, one per core.
//   4. Make the move that cuts the threat most per gold. Repeat until no move
//      is worth its price (or it is saving for a better one), then call the
//      wave at once (early-call bonus).
//
// On top of that sits a search. The bot plays with a policy (how much margin
// to keep, how early to prepare for bosses, whether to save, how to weigh cost).
// When it loses, it goes back to an exact save a few waves earlier and plays on
// with the next policy; when every policy fails from there, it goes back
// further. It keeps the best game it found.
//
// Pack cards are kept by rarity and by a measured rating of each power on the
// bot's own towers (the balance bench). When it has open sockets but nothing to
// put in them, it buys packs from the Shop. Fusions come from the offline
// combiner (no LLM), which is weaker than forged fusions, so real play with
// the Forge should do at least as well.
//
//   node tools/strategist.ts [maps] [difficulties] [seeds] [--jobs 4] [--tries 8]
//     maps: a map id, a comma list, act1 | act2 | act3 | all
//     difficulties: casual | normal | hard | brutal | all (or a comma list)
//   node tools/strategist.ts tesseract brutal 1 --trace
//   node tools/strategist.ts meadow hard 1 --record run.json [--seed 7919]
//     (then: node tools/record.ts run.json, to watch it in the real client)
//   --threads N  worker threads for one game (default: one per core; grid
//                games run one thread each, --jobs at a time)
//   --tries N    how many times a game may go back and try another policy (0 = never)

import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
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

/** How the bot plays; the search tries these in turn when a game goes wrong. */
interface Policy {
  name: string;
  /** Extra enemy HP the coming wave must hold against before anything else. */
  stress: number;
  /** How many waves ahead a boss is prepared for. */
  bossWindow: number;
  /** Save for a move the next wave pays for when it is this much better per gold (Infinity: never). */
  save: number;
  /** Moves are ranked by gain / cost^exp: under 1 favours big moves, 1 is plain value for gold. */
  exp: number;
  /** How many waves before a loss the search goes back to when it tries this policy. */
  back: number;
}

const POLICIES: Policy[] = [
  { name: 'balanced', stress: 1.5, bossWindow: 5, save: 1.5, exp: 0.6, back: 5 },
  { name: 'boss-first', stress: 1.5, bossWindow: 10, save: 1.3, exp: 0.6, back: 10 },
  { name: 'safe', stress: 2.2, bossWindow: 6, save: 1.5, exp: 0.6, back: 8 },
  { name: 'spender', stress: 1.5, bossWindow: 6, save: Infinity, exp: 0.8, back: 5 },
  { name: 'thrifty', stress: 1.8, bossWindow: 8, save: 1.2, exp: 1, back: 8 },
];

interface Ctx {
  map: MapDef;
  diff: Diff;
  policy: Policy;
  trace: boolean;
  /** Candidate tiles per tower type, best first. */
  tiles: Map<string, { c: number; r: number; score: number }[]>;
  rollouts: number;
  pool: Pool | null;
  /** Fewer candidates per step (for balancing, where "can a good player win" is enough). */
  light: boolean;
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
 * shapes still had (a boss that got through at 10% beats one at 90%), how
 * deep shapes got down the road (squared, weighted by the lives each costs),
 * and the gold the wave paid.
 */
interface Probe { lives: number; hurt: number; pen: number; gold: number }

const score = (p: Probe) => p.lives * 60 + p.hurt * 30 + p.pen;

/** How much game time a copy plays before counting what is left as getting through. */
const COPY_SECONDS = 900;

/**
 * One copy to play: the next wave after `move`, with enemy HP x`stress`.
 * `wave` plays that wave instead of the next one (to see a boss coming);
 * `bound` stops early once the copy is already worse than that score.
 */
interface Task { map: string; diff: Diff; snap: WorldSave; move: Move | null; stress: number; wave?: number; bound?: number }

function runTask(task: Task): Probe | null {
  const w = new World({ map: MAP_BY_ID.get(task.map)!, difficulty: task.diff, seed: task.snap.seed, fx: false, autoStart: false, packs: false });
  w.restore(task.snap);
  // A move it cannot afford yet is tried as if it could: is it worth saving for?
  if (task.move) {
    w.gold = Math.max(w.gold, task.move.cost);
    if (!apply(w, task.move)) return null;
  }
  (w as unknown as { diff: DifficultyDef }).diff = { ...w.diff, hp: w.diff.hp * task.stress };
  w.lives = 1e6;
  const gold0 = w.gold;
  const p: Probe = { lives: 0, hurt: 0, pen: 0, gold: 0 };
  const leak = w.leak.bind(w);
  w.leak = (e) => {
    if (e.alive) {
      p.lives += e.lives;
      p.hurt += (e.lives * Math.max(0, e.hp)) / e.maxHp;
    }
    leak(e);
  };
  if (task.wave) w.waveN = task.wave - 1;
  if (w.callWave() !== null) return p;
  const bound = task.bound ?? Infinity;
  const deep = new Map<number, [number, number]>();
  for (let t = 1; !w.quiescent() && w.phase === 'running' && t < 60 * COPY_SECONDS; t++) {
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
  // Shapes still going when time is up (a boss slowed to a crawl down a long
  // road) are not held: they would get through in the end.
  for (const e of w.enemies) {
    if (!e.alive) continue;
    p.lives += e.lives;
    p.hurt += (e.lives * Math.max(0, e.hp)) / e.maxHp;
  }
  for (const [f, l] of deep.values()) p.pen += f * f * l;
  p.gold = w.gold - gold0;
  return p;
}

/** Worker threads that play copies; each loads the game once and then takes tasks. */
class Pool {
  private idle: Worker[] = [];
  private all: Worker[] = [];
  private queue: { task: Task; done: (p: Probe | null) => void }[] = [];
  private busy = new Map<Worker, (p: Probe | null) => void>();

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { strategistWorker: true } });
      wk.on('message', (p: Probe | null) => {
        const done = this.busy.get(wk)!;
        this.busy.delete(wk);
        this.idle.push(wk);
        this.pump();
        done(p);
      });
      wk.on('error', (e) => { throw e; });
      this.all.push(wk);
      this.idle.push(wk);
    }
  }

  run(task: Task): Promise<Probe | null> {
    return new Promise((done) => {
      this.queue.push({ task, done });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const wk = this.idle.pop()!;
      const { task, done } = this.queue.shift()!;
      this.busy.set(wk, done);
      wk.postMessage(task);
    }
  }

  close(): void {
    for (const wk of this.all) void wk.terminate();
  }
}

if (!isMainThread && (workerData as { strategistWorker?: boolean } | null)?.strategistWorker) {
  parentPort!.on('message', (task: Task) => parentPort!.postMessage(runTask(task)));
}

/** Play copies, on the pool when there is one. */
async function probe(ctx: Ctx, tasks: Omit<Task, 'map' | 'diff'>[]): Promise<(Probe | null)[]> {
  ctx.rollouts += tasks.length;
  const full = tasks.map((t) => ({ ...t, map: ctx.map.id, diff: ctx.diff }));
  return ctx.pool ? Promise.all(full.map((t) => ctx.pool!.run(t))) : full.map(runTask);
}

const probe1 = async (ctx: Ctx, t: Omit<Task, 'map' | 'diff'>) => (await probe(ctx, [t]))[0]!;

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

/** Moves worth trying that cost at most `budget`. */
function candidates(w: World, ctx: Ctx, budget: number): Move[] {
  const moves: Move[] = [];
  // New towers: every type on its best free tile, and the most promising types
  // (coverage x damage per gold) on their second-best tile too. Slows and
  // amplifiers do little damage themselves, so no type is left out.
  const free = (id: string, n: number) => (ctx.tiles.get(id) ?? []).filter((t) => w.canBuild(t.c, t.r)).slice(0, n);
  const promise = (id: string) => {
    const def = TOWER_BY_ID.get(id)!;
    const spot = free(id, 1)[0];
    return spot ? (spot.score * def.damage[0] * def.rate[0]) / def.cost : 0;
  };
  const ranked = [...TOWERS].filter((d) => d.chassis !== 'aura').sort((a, b) => promise(b.id) - promise(a.id));
  const top = new Set(ranked.slice(0, 3).map((d) => d.id));
  // Light: the four most promising types and Frost (slows count against bosses), one tile each.
  const light = new Set([...ranked.slice(0, 4).map((d) => d.id), 'frost']);
  for (const def of TOWERS) {
    if (def.cost > budget || (ctx.light && def.chassis !== 'aura' && !light.has(def.id))) continue;
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
    for (const spot of free(def.id, top.has(def.id) && !ctx.light ? 2 : 1)) moves.push({ k: 'build', def: def.id, c: spot.c, r: spot.r, cost: def.cost });
  }
  const busy = [...w.towers].sort((a, b) => b.dmgTotal - a.dmgTotal);
  for (const t of busy.slice(0, ctx.light ? 5 : 8)) {
    const up = w.upgradeCost(t);
    if (up !== null && up <= budget) moves.push({ k: 'upgrade', c: t.c, r: t.r, cost: up });
  }
  for (const t of busy.slice(0, ctx.light ? 2 : 4)) {
    const lv = w.levelCost(t);
    if (lv !== null && lv <= budget) moves.push({ k: 'level', c: t.c, r: t.r, cost: lv });
  }
  // Sockets: every card in hand into the busiest towers with a slot open, and
  // the two best-rated cards into the rest (a slow or an amp can pay off on
  // any tower, whatever its own rating).
  let sockets = 0;
  busy.filter((t) => t.tier > t.sockets.length).forEach((t, i) => {
    const ranked = [...w.cards].sort((a, b) => RARITY_WEIGHT[b.rarity] * rating(t.def.id, b.power) - RARITY_WEIGHT[a.rarity] * rating(t.def.id, a.power));
    for (const c of i < (ctx.light ? 2 : 4) ? ranked : ranked.slice(0, ctx.light ? 1 : 2)) {
      const cost = w.socketCost(t, c.rarity);
      if (cost !== null && cost <= budget && sockets < (ctx.light ? 8 : 20)) {
        moves.push({ k: 'socket', c: t.c, r: t.r, card: c.uid, cost });
        sockets++;
      }
    }
  });
  return moves;
}

/** The next boss wave within `ahead` waves after the coming one, if any. */
function bossAhead(w: World, ctx: Ctx): number | null {
  for (let n = w.waveN + 2; n <= Math.min(w.totalWaves, w.waveN + 1 + ctx.policy.bossWindow); n++) if (bossFor(ctx.map, n)) return n;
  return null;
}

/**
 * What to plan against this step, in order:
 *   1. the coming wave at its real HP, if it would leak (exactly what will happen);
 *   2. the coming wave with a little more HP (the policy's stress, x1.5 by
 *      default), if that would leak: the next few waves are about that much harder;
 *   3. a boss due within the policy's window, played now against the current
 *      defence, if it would get through (bosses need building for well ahead);
 *   4. the coming wave at the HP where the defence starts to bend, for margin.
 */
interface Objective { stress: number; base: Probe; wave?: number; why: string; kind: 'leak' | 'near' | 'boss' | 'margin'; urgent: boolean; income: number }

/**
 * `prev` is this wave's objective before the last purchase. A purchase only
 * makes the defence stronger, so the checks it already passed are not run
 * again: once the plan is about margin, one copy per step is enough.
 */
async function objective(w: World, ctx: Ctx, snap: WorldSave, from: number, prev: Objective | null): Promise<Objective> {
  const s = ctx.policy.stress;
  const order = ['leak', 'near', 'boss', 'margin'];
  const skip = prev ? order.indexOf(prev.kind) : 0;
  let income = prev?.income ?? 0;
  if (prev?.kind === 'margin') {
    const base = (await probe1(ctx, { snap, move: null, stress: prev.stress }))!;
    // Still bending there: keep at it. Grown past it: look for the new bending point.
    if (base.lives > 0 || base.pen >= 1.5) return { ...prev, base };
    from = Math.max(from, prev.stress);
  }
  const boss = bossAhead(w, ctx);
  const checks: { name: 'truth' | 'near' | 'preview'; task: Omit<Task, 'map' | 'diff'> }[] = [];
  if (skip <= 0) checks.push({ name: 'truth', task: { snap, move: null, stress: 1 } });
  if (skip <= 1) checks.push({ name: 'near', task: { snap, move: null, stress: s } });
  if (boss && skip <= 2) checks.push({ name: 'preview', task: { snap, move: null, stress: 1, wave: boss } });
  const got = await probe(ctx, checks.map((c) => c.task));
  const res = (name: string) => got[checks.findIndex((c) => c.name === name)] ?? undefined;
  const truth = res('truth'), near = res('near'), preview = res('preview');
  if (truth) income = truth.gold;
  if (truth && truth.lives > 0) return { stress: 1, base: truth, why: 'leak', kind: 'leak', urgent: true, income };
  if (near && near.lives > 0) return { stress: s, base: near, why: `@x${s}`, kind: 'near', urgent: false, income };
  if (preview && preview.lives > 0) return { stress: 1, base: preview, wave: boss!, why: `boss ${boss}`, kind: 'boss', urgent: false, income };
  // The bending point: raise the HP while the wave stays easy (several guesses at once).
  const ladder = [0, 1, 2, 3].map((i) => Math.max(from, s) * 1.6 ** i).filter((x) => x < 12);
  const tries = await probe(ctx, ladder.map((stress) => ({ snap, move: null, stress })));
  let i = tries.findIndex((p) => p!.lives > 0 || p!.pen >= 1.5);
  if (i < 0) i = ladder.length - 1;
  return { stress: ladder[i], base: tries[i]!, why: `@x${ladder[i].toFixed(1)}`, kind: 'margin', urgent: false, income };
}

/** A move's identity across steps (its cost may change; what it does does not). */
const moveKey = (m: Move) => (m.k === 'build' ? `b:${m.def}:${m.c},${m.r}` : m.k === 'socket' ? `s:${m.c},${m.r}:${m.card}` : `${m.k}:${m.c},${m.r}`);

interface Ranking { buy: { m: Move; gain: number } | null; wait: Move | null; top: string[] }

/** Try each move on a copy; the best buy, whether to save instead, and the best moves in order. */
async function rank(w: World, ctx: Ctx, snap: WorldSave, moves: Move[], o: Objective): Promise<Ranking> {
  const pol = ctx.policy;
  const s0 = score(o.base);
  const probes = await probe(ctx, moves.map((m) => ({ snap, move: m, stress: o.stress, wave: o.wave, bound: s0 })));
  const scored: { m: Move; gain: number; value: number }[] = [];
  let later: { m: Move; perGold: number } | null = null;
  let nowPerGold = 0;
  moves.forEach((m, i) => {
    const p = probes[i];
    if (!p) return;
    const gain = s0 - score(p);
    if (gain <= 0.05) return;
    scored.push({ m, gain, value: gain / Math.pow(m.cost, pol.exp) });
    if (m.cost > w.gold) {
      if (!later || gain / m.cost > later.perGold) later = { m, perGold: gain / m.cost };
    } else nowPerGold = Math.max(nowPerGold, gain / m.cost);
  });
  scored.sort((a, b) => b.value - a.value);
  const buy = scored.find((x) => x.m.cost <= w.gold) ?? null;
  // Save only for something clearly better per gold than anything it can buy now.
  const l = later as { m: Move; perGold: number } | null;
  const wait = l && l.perGold > pol.save * nowPerGold ? l.m : null;
  return { buy, wait, top: scored.slice(0, 8).map((x) => moveKey(x.m)) };
}

/**
 * Spend the gold on the moves that cut the threat most per gold. Unless the
 * coming wave would leak, moves the next wave's income would pay for are
 * weighed too: when one of those is clearly better per gold than anything
 * affordable now, it saves for it rather than spending on something worse.
 *
 * Lazy greedy: after a full look at every candidate, the next few purchases
 * only re-try the previous best eight (buying one rarely makes a move that was
 * worthless worth a lot). A full look comes back every fourth purchase, when
 * the objective changes, and before stopping or saving on a stale ranking.
 */
async function plan(w: World, ctx: Ctx): Promise<string[]> {
  const done: string[] = [];
  const pol = ctx.policy;
  let from = pol.stress;
  let short: Set<string> | null = null;
  let lastKind = '';
  let sinceFull = 0;
  let prev: Objective | null = null;
  // Checks the coming wave passed are not re-run after each purchase, but the
  // game is not strictly monotonic: a buy that helps against 4x HP can make the
  // real wave slightly worse. So the real wave is checked once more at the end,
  // and a leak sends the plan back to fixing it.
  let boughtSinceTruth = false;
  for (let round = 0; round < 3; round++) {
  for (let step = 0; step < 24; step++) {
    const snap = w.snapshot();
    if (!prev || prev.kind === 'leak') boughtSinceTruth = false;
    const o = await objective(w, ctx, snap, from, prev);
    prev = o;
    if (o.stress > pol.stress) from = o.stress;
    const moves = candidates(w, ctx, o.urgent || pol.save === Infinity ? w.gold : w.gold + o.income);
    if (!moves.length) {
      if (shop(w)) continue;
      break;
    }
    const kind = o.why;
    let r: Ranking | null = null;
    if (short && kind === lastKind && sinceFull < 3) {
      const kept = moves.filter((m) => short!.has(moveKey(m)));
      if (kept.length >= 3) {
        r = await rank(w, ctx, snap, kept, o);
        // Stopping or saving on a ranking more than one purchase old needs a full look first.
        if ((!r.buy || r.wait) && sinceFull > 0) r = null;
        else sinceFull++;
      }
    }
    if (!r) {
      r = await rank(w, ctx, snap, moves, o);
      short = new Set(r.top);
      sinceFull = 0;
    }
    lastKind = kind;
    if (r.wait) {
      done.push(`saves for ${describe(r.wait, w)} (${o.why})`);
      break;
    }
    if (!r.buy) {
      // Nothing worth buying: maybe a pack would give the sockets something to use.
      if (shop(w)) continue;
      break;
    }
    done.push(`${describe(r.buy.m, w)} (-${r.buy.gain.toFixed(1)} ${o.why})`);
    apply(w, r.buy.m);
    boughtSinceTruth = true;
  }
  if (!boughtSinceTruth) break;
  const truth = await probe1(ctx, { snap: w.snapshot(), move: null, stress: 1 });
  if (!truth || truth.lives === 0) break;
  done.push('(the last buys let the wave leak: back to fixing it)');
  prev = null;
  short = null;
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
  /** How many times the search went back to try another policy. */
  tries: number;
  /** After a win (with `margins`): per boss wave, the HP multiple it could have had and still been survived. */
  spare?: Record<number, number>;
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
  steps: Step[];
  result?: Result;
}
type Step = { tick: number; calls: [string, ...unknown[]][]; after: { gold: number; lives: number; waveN: number } };

/** The world methods a player uses; recording wraps them. */
export const PLAYER_CALLS = ['place', 'upgrade', 'levelUp', 'socket', 'openPack', 'pickCard', 'scrapCard', 'buyPack', 'callWave'] as const;

/** Log the outermost player calls made on `w` (a call may use another inside). */
function recordCalls(w: World, log: [string, ...unknown[]][]): void {
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

/**
 * Balances the game around the bot. `ease` after a loss at `wave`, where the
 * defence would have held `hold` of that wave's HP: returns the first wave the
 * change affects (the game goes back to just before it), or null to stop.
 */
export interface Tuner {
  ease(loss: { map: MapDef; wave: number; hold: number }): { from: number; note: string } | null;
  /**
   * After a win: `spare` holds, for each wave from `raiseFrom` on, how many
   * times its HP the defence would still have survived. Returns the first wave
   * a change affects (the game goes back to just before it), or null when
   * there is nothing to raise.
   */
  raise?(win: { map: MapDef; spare: Map<number, number> }): { from: number; note: string } | null;
  raiseFrom?: number;
}

/** One line of play, from a start to victory or defeat. */
interface Line { won: boolean; wave: number; lives: number; w: World; steps: Step[]; last: WorldSave | null; timeout?: boolean }

export async function play(
  mapId: string, diff: Diff, seed: number,
  o: {
    trace?: boolean; record?: boolean; tries?: number; threads?: number; tune?: Tuner; light?: boolean;
    /** A short line per wave and per tuning step, as it plays. */
    say?: (line: string) => void;
    /** Stop at this time (ms since the epoch) and report the game so far. */
    deadline?: number;
    /** After a win, measure each boss wave's spare room (Result.spare). */
    margins?: boolean;
  } = {},
): Promise<Result & { script?: Script }> {
  const t0 = Date.now();
  const map = MAP_BY_ID.get(mapId)!;
  const trace = !!o.trace;
  const fresh = new World({ map, difficulty: diff, seed, fx: false, autoStart: false });
  const start = fresh.snapshot();
  const threads = o.threads ?? availableParallelism();
  const ctx: Ctx = { map, diff, policy: POLICIES[0], trace, tiles: rankTiles(fresh), rollouts: 0, pool: threads > 1 ? new Pool(threads) : null, light: !!o.light };
  const log: [string, ...unknown[]][] = [];

  // Checkpoints: the exact state at the start of each wave of the current line,
  // the steps played before it, and the policies already tried from there.
  const checkpoints = new Map<number, { save: WorldSave; steps: number; tried: Set<string> }>();
  // The state just before each wave was called (for measuring spare room after a win).
  const waveSnaps = new Map<number, WorldSave>();

  /** Play on from `w` with the current policy until the game ends. */
  const run = async (w: World, steps: Step[]): Promise<Line> => {
    recordCalls(w, log);
    let last: WorldSave | null = null;
    while (w.phase !== 'victory' && w.phase !== 'defeat') {
      if (o.deadline && Date.now() > o.deadline) break;
      const tick = w.tick;
      const here = w.snapshot();
      const cp = checkpoints.get(w.waveN);
      if (!cp || cp.save.tick !== here.tick) checkpoints.set(w.waveN, { save: here, steps: steps.length, tried: new Set([ctx.policy.name]) });
      log.length = 0;
      const tw = Date.now(), r0 = ctx.rollouts;
      openPacks(w);
      const moves = await plan(w, ctx);
      const expect = trace ? await probe1(ctx, { snap: w.snapshot(), move: null, stress: 1 }) : null;
      if (trace) console.log(`wave ${w.waveN + 1} · lives ${w.lives} · gold ${Math.round(w.gold)} · ${moves.join('; ') || 'saves'} [${ctx.rollouts - r0} copies, ${((Date.now() - tw) / 1000).toFixed(0)}s]`);
      o.say?.(`wave ${w.waveN + 1}, ${w.lives} lives, ${moves.filter((m) => !m.startsWith('saves')).length} buys (${((Date.now() - tw) / 1000).toFixed(0)}s)`);
      const l0 = w.lives;
      last = w.snapshot();
      waveSnaps.set(w.waveN + 1, last);
      const called = w.callWave();
      steps.push({ tick, calls: [...log], after: { gold: w.gold, lives: w.lives, waveN: w.waveN } });
      if (called !== null && w.quiescent()) break;
      // Play the wave out, however long a slowed boss takes (an hour of game time at most).
      for (let t = 0; !w.quiescent() && w.phase === 'running' && t < 60 * 3600; t++) w.step();
      // Let the last shots land, so the snapshot the next plan starts from is exact.
      for (let t = 0; !w.settled() && w.phase === 'running' && t < 600; t++) w.step();
      if (expect && expect.lives !== l0 - w.lives && (w.phase as string) !== 'defeat') console.log(`  !! expected to lose ${expect.lives}, lost ${l0 - w.lives}`);
    }
    const won = w.phase === 'victory';
    // Out of time mid-game: report it as a loss at the wave reached.
    return { won, wave: won ? w.totalWaves : w.waveN, lives: w.lives, w, steps, last, timeout: w.phase !== 'victory' && w.phase !== 'defeat' };
  };

  /** How close a loss was: the share of the killing wave's HP at which the defence would have held. */
  const holdOf = async (snap: WorldSave) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if ((await probe1(ctx, { snap, move: null, stress: mid }))!.lives < snap.lives) lo = mid; else hi = mid;
    }
    return lo;
  };
  /** Go back to the latest checkpoint at or before wave `at` and play on with the current policy. */
  const resume = async (at: number): Promise<Line | null> => {
    const key = [...checkpoints.keys()].filter((n) => n <= at).sort((a, b) => b - a)[0];
    if (key === undefined) return null;
    const cp = checkpoints.get(key)!;
    for (const n of [...checkpoints.keys()]) if (n > key) checkpoints.delete(n);
    const w = new World({ map, difficulty: diff, seed, fx: false, autoStart: false });
    w.restore(cp.save);
    return run(w, line.steps.slice(0, cp.steps));
  };

  const better = (a: Line, b: Line | null) => !b || (a.won && !b.won) || (a.won === b.won && (a.wave > b.wave || (a.wave === b.wave && a.lives > b.lives)));
  let line = await run(fresh, []);
  let best = line;
  let tries = 0;
  // Balancing: after a loss the tuner eases the game where it was lost, and the
  // bot goes back to just before the first wave that changed and plays on.
  // After a win the tuner may raise what was beaten with room to spare, and the
  // bot goes back and plays that again.
  /** How many times its HP a wave could have had and still been survived (1 to 3). */
  const spareOf = async (snap: WorldSave) => {
    let lo = 1, hi = 3;
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2;
      if ((await probe1(ctx, { snap, move: null, stress: mid }))!.lives < snap.lives) lo = mid; else hi = mid;
    }
    return lo;
  };
  for (let tunes = 0; o.tune && !line.timeout && tunes < 80; tunes++) {
    let t: { from: number; note: string } | null;
    let why: string;
    if (!line.won) {
      const hold = await holdOf(line.last!);
      t = o.tune.ease({ map, wave: line.wave, hold });
      why = `lost at wave ${line.wave} (held ${Math.round(hold * 100)}%)`;
    } else {
      if (!o.tune.raise || (o.deadline && Date.now() > o.deadline)) break;
      const spare = new Map<number, number>();
      for (const [n, snap] of waveSnaps) if (n >= (o.tune.raiseFrom ?? 1) && n <= line.wave) spare.set(n, await spareOf(snap));
      t = o.tune.raise({ map, spare });
      why = `won with ${line.lives} lives`;
    }
    if (!t) break;
    if (trace) console.log(`  <- ${why}: ${t.note}; back to wave ${t.from}`);
    o.say?.(`${why}: ${t.note}; back to wave ${t.from}`);
    const next = await resume(t.from - 1);
    if (!next) break;
    line = best = next;
  }
  // The search: after a loss, go back a few waves and play on with a policy not
  // yet tried from there (after a boss, preparing for it earlier comes first);
  // when every policy has been tried, go back further.
  while (!line.won && !line.timeout && tries < (o.tries ?? 8)) {
    const order = bossFor(map, line.wave)
      ? ['boss-first', 'safe', 'thrifty', 'spender', 'balanced']
      : ['safe', 'thrifty', 'spender', 'boss-first', 'balanced'];
    let pick: { at: number; policy: Policy } | null = null;
    for (let deeper = 0; deeper <= 20 && !pick; deeper += 5) {
      for (const name of order) {
        const policy = POLICIES.find((p) => p.name === name)!;
        const target = line.wave - policy.back - deeper;
        const at = [...checkpoints.keys()].filter((n) => n <= Math.max(0, target)).sort((a, b) => b - a)[0];
        if (at === undefined || checkpoints.get(at)!.tried.has(name)) continue;
        pick = { at, policy };
        break;
      }
    }
    if (!pick) break;
    const cp = checkpoints.get(pick.at)!;
    cp.tried.add(pick.policy.name);
    // Later checkpoints belong to the line being abandoned.
    for (const n of [...checkpoints.keys()]) if (n > pick.at) checkpoints.delete(n);
    tries++;
    if (trace) console.log(`  <- lost at wave ${line.wave}; back to wave ${pick.at + 1} to play it '${pick.policy.name}'`);
    ctx.policy = pick.policy;
    const w = new World({ map, difficulty: diff, seed, fx: false, autoStart: false });
    w.restore(cp.save);
    line = await run(w, line.steps.slice(0, cp.steps));
    if (better(line, best)) best = line;
  }

  const hold = !best.won && !best.timeout && best.last ? await holdOf(best.last) : 1;
  // For debugging a loss: STRAT_DUMP=file.json saves the state just before the killing wave.
  if (process.env.STRAT_DUMP && !best.won && best.last) writeFileSync(process.env.STRAT_DUMP, JSON.stringify(best.last));
  // After a win: how much more HP each boss wave could have had and still been survived.
  const spare: Record<number, number> = {};
  if (o.margins && best.won && best === line) {
    for (const [n, snap] of [...waveSnaps].filter(([k]) => bossFor(map, k))) {
      let lo = 1, hi = 4;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if ((await probe1(ctx, { snap, move: null, stress: mid }))!.lives < snap.lives) lo = mid; else hi = mid;
      }
      spare[n] = lo;
    }
  }
  ctx.pool?.close();
  const w = best.w;
  const tiers = [1, 2, 3].map((k) => w.towers.filter((t) => t.tier === k).length).join('/');
  const result: Result = {
    map: mapId, diff, seed, won: best.won, wave: best.wave, lives: best.lives,
    towers: `${w.towers.length} (${tiers})`, fused: w.towers.filter((t) => t.sockets.length >= 2).length,
    levels: w.towers.reduce((a, t) => a + t.level - 1, 0), hold, tries, rollouts: ctx.rollouts, ms: Date.now() - t0,
    ...(o.margins ? { spare } : {}),
  };
  const script: Script | undefined = o.record ? { map: mapId, diff, seed, start, steps: best.steps, result } : undefined;
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
  `${r.map.padEnd(12)} ${r.diff.padEnd(7)} ${String(r.seed).padStart(3)}  ${(r.won ? `WON ${r.wave}` : `lost at ${r.wave} (${Math.round(r.hold * 100)}%)`).padEnd(18)} ${String(r.lives).padStart(4)}  ${r.towers.padEnd(12)} ${String(r.fused).padStart(5)} ${String(r.levels).padStart(5)} ${String(r.tries).padStart(5)} ${String(r.rollouts).padStart(7)} ${(r.ms / 1000).toFixed(0).padStart(5)}s`;

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name: string, dflt: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args.splice(i, 2)[1] : dflt;
  };
  const jobs = Number(flag('jobs', String(Math.max(1, availableParallelism()))));
  const tries = Number(flag('tries', '8'));
  const threadsArg = flag('threads', '');
  const record = flag('record', '');
  const seed = Number(flag('seed', '7919'));
  const trace = args.includes('--trace');
  const job = args.includes('--job');
  const pos = args.filter((a) => !a.startsWith('--'));
  if (job) {
    // A child: play one game and report it as JSON.
    const [map, diff, s] = pos;
    const r = await play(map, diff as Diff, Number(s), { tries, threads: Number(threadsArg || 1) });
    process.stdout.write(JSON.stringify(r) + '\n');
  } else {
    const maps = pickMaps(pos[0] ?? 'all');
    const diffs = pickDiffs(pos[1] ?? 'normal');
    const seeds = Math.max(1, Number(pos[2] ?? 1));
    const header = `map          diff    seed  result (held at)   lives  towers (t1/t2/t3) fused  lvls tries rollouts   time`;
    if (trace || record || (maps.length === 1 && diffs.length === 1 && seeds === 1)) {
      const { script, ...r } = await play(maps[0], diffs[0], seed, { trace, record: !!record, tries, threads: threadsArg ? Number(threadsArg) : undefined });
      console.log(header);
      console.log(line(r));
      if (record) {
        writeFileSync(record, JSON.stringify(script));
        console.log(`recorded ${script!.steps.length} waves to ${record}`);
      }
    } else {
      // Longest games first (more waves, harder), so the workers finish together.
      const length = (m: string, d: string) => MAP_BY_ID.get(m)!.waves * 10 + DIFFICULTIES.findIndex((x) => x.id === d);
      const queue = maps
        .flatMap((m) => diffs.flatMap((d) => Array.from({ length: seeds }, (_, s) => [m, d, String((s + 1) * 7919)])))
        .sort((a, b) => length(b[0], b[1]) - length(a[0], a[1]));
      const results: Result[] = [];
      console.log(header);
      let running = 0;
      const next = () => {
        while (running < jobs && queue.length) {
          const [m, d, s] = queue.shift()!;
          running++;
          const child = fork(fileURLToPath(import.meta.url), [m, d, s, '--job', '--tries', String(tries), '--threads', threadsArg || '1'], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
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
