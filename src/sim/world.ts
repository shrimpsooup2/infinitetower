// The World: all game state plus the fixed-step tick. Pure TypeScript, no
// DOM, deterministic for a given seed + command sequence. The browser, the
// server's balance solver and the headless playtest bot all run this.

import type {
  Card, DifficultyDef, Drone, Enemy, FxEvent, MapDef, Palette3, Projectile, SpecRuntime, SpecState, TargetMode, Tower, WaveDef, Zone,
} from './types.ts';
import { POWER_MIN_RARITY, RARITIES, rarityFactor, rollRarity } from '../content/rarity.ts';
import { PACK_BY_ID, PACK_EVERY, SCRAP_VALUE, type PackDef } from '../content/packs.ts';
import type { FusionSpec, VfxDef } from '../effects/types.ts';
import { Path } from './path.ts';
import { Rng } from './rng.ts';
import { SpatialHash } from './spatial.ts';
import { dist2, hashString } from './math.ts';
import { TOWER_BY_ID, SOCKET_COST, SOCKET_RARITY_WEIGHT, towerCostToTier } from '../content/towers.ts';
import { POWERS, POWER_BY_ID } from '../content/powers.ts';
import { BOSS_WAVES } from '../content/enemies.ts';
import { DIFFICULTY_BY_ID, RULES } from '../content/rules.ts';
import { generateWave } from '../content/waves.ts';
import { PAL, DAMAGE_COLORS } from '../content/colors.ts';
import { compileSpec, dispatch, processScheduled, resolveLook, resolveVfx, runActions, statusCtx } from '../effects/runtime.ts';
import { offlineFusion } from '../effects/combiner.ts';
import { fusionKey } from '../effects/keys.ts';
import { computeAllStats, updateTowers, baseStats, baseSting } from './towers.ts';
import { updateProjectiles, updateZones, updateDrones } from './entities.ts';
import { spawnEnemy, updateEnemies } from './enemies.ts';

export const DT = 1 / RULES.tickRate;

export interface SpecResolution {
  spec: FusionSpec;
  potency: number;
  state: SpecState;
}

/** Decides which spec a tower with a given socket list runs. The client overrides this to use the forge. */
export type SpecProvider = (w: World, t: Tower, key: string) => SpecResolution | null;

export interface WorldOptions {
  map: MapDef;
  difficulty?: DifficultyDef['id'];
  seed?: number;
  waves?: WaveDef[];
  fx?: boolean;
  /** Give the starter pack (default true). */
  packs?: boolean;
  specProvider?: SpecProvider;
  startGold?: number;
  autoStart?: boolean;
}

interface ActiveWave {
  def: WaveDef;
  groups: { spawned: number; timer: number }[];
  alive: number;
  spawning: boolean;
}

interface RecentDeath {
  def: string;
  x: number;
  y: number;
  dist: number;
  pathIdx: number;
  tick: number;
  used: boolean;
  revived: boolean;
}

/** An unopened card pack. */
export interface PackInst {
  uid: number;
  type: PackDef['id'];
  wave: number;
}

/** An opened pack waiting for the player to keep one of its cards. */
export interface PackOffer {
  uid: number;
  type: PackDef['id'];
  cards: Card[];
}

export type Phase = 'build' | 'running' | 'victory' | 'defeat';

export function colorsFor(sockets: readonly string[]): Palette3 {
  if (!sockets.length) return { base: PAL.blue, secondary: PAL.blue, tertiary: PAL.blue };
  const c = sockets.map((s) => POWER_BY_ID.get(s)?.color ?? PAL.blue);
  return { base: c[0], secondary: c[1] ?? c[0], tertiary: c[2] ?? c[1] ?? c[0] };
}

export const defaultSpecProvider: SpecProvider = (_w, t, key) => {
  if (t.sockets.length === 1) {
    const p = POWER_BY_ID.get(t.sockets[0]);
    return p ? { spec: p.spec, potency: 1, state: 'single' } : null;
  }
  const ps = t.sockets.map((s) => POWER_BY_ID.get(s)!).filter(Boolean);
  return { spec: offlineFusion(t.def, ps, key), potency: 0.9, state: 'offline' };
};

export class World {
  readonly map: MapDef;
  readonly diff: DifficultyDef;
  readonly paths: Path[];
  readonly air: Path[];
  readonly cols: number;
  readonly rows: number;
  readonly grid: Int32Array; // 0 empty, -1 path, -2 blocked, >0 tower id
  readonly seed: number;
  rng: Rng;
  tick = 0;
  time = 0;
  enemies: Enemy[] = [];
  towers: Tower[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  drones: Drone[] = [];
  enemyById = new Map<number, Enemy>();
  towerById = new Map<number, Tower>();
  hash: SpatialHash<Enemy>;
  gold: number;
  lives: number;
  livesMax: number;
  waveN = 0;
  totalWaves: number = RULES.waves;
  endless = false;
  active: ActiveWave[] = [];
  countdown: number | null = null;
  autoStart: boolean;
  phase: Phase = 'build';
  cards: Card[] = [];
  packs: PackInst[] = [];
  offer: PackOffer | null = null;
  fx: FxEvent[] = [];
  fxOn: boolean;
  scheduled: unknown[] = [];
  deathQueue: Enemy[] = [];
  beatCount = 0;
  beatTimer = 0;
  nextId = 1;
  alternate = 0;
  stats = { kills: 0, leaks: 0, damage: 0, goldEarned: 0, fusions: 0, bossesKilled: 0 };
  recentDeaths: RecentDeath[] = [];
  livesRestoredWave = 0;
  allyHitListeners: Tower[] = [];
  readonly defaultColors: Palette3 = colorsFor([]);
  readonly emptyRt: SpecRuntime;
  specProvider: SpecProvider;
  private waveCache = new Map<number, WaveDef>();
  private fixedWaves: WaveDef[] | null;
  lastWaveStartTick = -1;
  /** Called whenever something the UI should announce happens. */
  onMessage: ((msg: string, kind: 'info' | 'good' | 'bad') => void) | null = null;

  constructor(o: WorldOptions) {
    this.map = o.map;
    this.diff = DIFFICULTY_BY_ID.get(o.difficulty ?? 'normal')!;
    this.seed = o.seed ?? hashString(o.map.id) ^ 0x5eed;
    this.rng = new Rng(this.seed);
    this.cols = o.map.cols;
    this.rows = o.map.rows;
    this.paths = o.map.paths.map((p) => new Path(p.map(([c, r]) => [c + 0.5, r + 0.5] as [number, number])));
    const airDefs = o.map.air.length ? o.map.air : [[o.map.paths[0][0], o.map.paths[0][o.map.paths[0].length - 1]]];
    this.air = airDefs.map((p) => new Path(p.map(([c, r]) => [c + 0.5, r + 0.5] as [number, number]), true));
    this.grid = new Int32Array(this.cols * this.rows);
    for (const p of o.map.paths) {
      for (let i = 0; i < p.length - 1; i++) {
        const [c0, r0] = p[i];
        const [c1, r1] = p[i + 1];
        const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
        for (let s = 0; s <= steps; s++) {
          const c = Math.round(c0 + ((c1 - c0) * s) / steps);
          const r = Math.round(r0 + ((r1 - r0) * s) / steps);
          if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.grid[r * this.cols + c] = -1;
        }
      }
    }
    for (const [c, r] of o.map.blocked) if (this.grid[r * this.cols + c] === 0) this.grid[r * this.cols + c] = -2;
    this.hash = new SpatialHash<Enemy>(this.cols, this.rows);
    this.gold = o.startGold ?? this.diff.gold;
    this.lives = this.livesMax = this.diff.lives;
    this.fxOn = o.fx ?? true;
    this.autoStart = o.autoStart ?? true;
    this.fixedWaves = o.waves ?? null;
    this.totalWaves = this.fixedWaves ? this.fixedWaves.length : o.map.waves;
    this.specProvider = o.specProvider ?? defaultSpecProvider;
    this.emptyRt = compileSpec({ dsl: 1, concept: '-', name: '-', flavor: '-', rules: [] }, 'none', 1, this.defaultColors, 'kinetic');
    if (o.packs !== false) this.grantPack('starter');
  }

  // ------------------------------------------------------------ helpers

  getWave(n: number): WaveDef {
    if (this.fixedWaves) return this.fixedWaves[Math.min(n, this.fixedWaves.length) - 1] ?? this.fixedWaves[0];
    let w = this.waveCache.get(n);
    if (!w) {
      w = generateWave(this.map, n);
      this.waveCache.set(n, w);
    }
    return w;
  }

  waveAlive(n: number, delta: number): void {
    const a = this.active.find((x) => x.def.n === n);
    if (a) a.alive += delta;
  }

  msg(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    this.onMessage?.(text, kind);
  }

  addGold(amount: number, x?: number, y?: number): void {
    if (amount <= 0) return;
    this.gold += amount;
    this.stats.goldEarned += amount;
    if (this.fxOn && x !== undefined && y !== undefined) this.fx.push({ k: 'gold', x, y, amount });
  }

  vfxAt(def: VfxDef, x: number, y: number, size = 1, colors?: Palette3): void {
    if (!this.fxOn) return;
    this.fx.push({ k: 'vfx', def, x, y, x2: x, y2: y, ang: 0, colors: colors ?? this.defaultColors, dcolor: '#ffffff', size, tint: null, text: null });
  }

  tileAt(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -3;
    return this.grid[r * this.cols + c];
  }

  canBuild(c: number, r: number): boolean {
    return this.tileAt(c, r) === 0;
  }

  // ------------------------------------------------------------ commands

  place(defId: string, c: number, r: number): Tower | string {
    const def = TOWER_BY_ID.get(defId);
    if (!def) return 'Unknown tower';
    if (!this.canBuild(c, r)) return 'Cannot build there';
    if (this.gold < def.cost) return 'Not enough gold';
    this.gold -= def.cost;
    const t: Tower = {
      id: this.nextId++, def, c, r, x: c + 0.5, y: r + 0.5, tier: 1, angle: -Math.PI / 2, targetMode: 'first', targetId: 0,
      cooldown: 0, sockets: [], cards: [], specKey: '', specState: 'none', rt: null, stats: undefined as never, invested: def.cost,
      socketGold: 0, placedTick: this.tick, kills: 0, dmgTotal: 0, dmgWave: 0, attackCount: 0, lastAttackTick: this.tick,
      disabledUntil: 0, barrel: 0, recoil: 0, beamTargets: [], beamRamp: 1, beamTimer: 0, coneOn: false, drones: [], droneTimer: 0.2,
      mods: [], inRange: null, goldWave: 0, livesWave: 0, conduits: [], aura: 0, liveSpawns: 0, eventsThisTick: 0,
      lastAttackEventTick: -9999, look: undefined as never,
    };
    t.stats = baseStats(t);
    this.refreshLook(t);
    this.towers.push(t);
    this.towerById.set(t.id, t);
    this.grid[r * this.cols + c] = t.id;
    return t;
  }

  upgradeCost(t: Tower): number | null {
    return t.tier >= 3 ? null : t.def.upgradeCost[t.tier - 1];
  }

  upgrade(id: number): string | null {
    const t = this.towerById.get(id);
    if (!t) return 'No tower';
    const cost = this.upgradeCost(t);
    if (cost === null) return 'Already max tier';
    if (this.gold < cost) return 'Not enough gold';
    this.gold -= cost;
    t.invested += cost;
    t.tier = (t.tier + 1) as 2 | 3;
    t.stats = baseStats(t);
    return null;
  }

  sellValue(t: Tower): number {
    const fresh = t.placedTick > this.lastWaveStartTick && t.dmgTotal === 0;
    return Math.floor(t.invested * (fresh ? 1 : RULES.sellRefund));
  }

  sell(id: number): string | null {
    const t = this.towerById.get(id);
    if (!t) return 'No tower';
    this.gold += this.sellValue(t);
    this.cards.push(...t.cards);
    this.towers = this.towers.filter((x) => x !== t);
    this.towerById.delete(id);
    this.grid[t.r * this.cols + t.c] = 0;
    for (const d of this.drones) if (d.tower === id) d.alive = false;
    for (const z of this.zones) if (z.tower === id) z.alive = false;
    for (const p of this.projectiles) if (p.tower === id && (p.motion === 'orbit' || p.motion === 'mine')) p.alive = false;
    return null;
  }

  setTargetMode(id: number, mode: TargetMode): void {
    const t = this.towerById.get(id);
    if (t) t.targetMode = mode;
  }

  /**
   * Gold to socket a card of this rarity into the tower's next slot. The slot
   * price climbs steeply; the rarity markup is biggest in the base slot and
   * tapers off in later slots, where a card carries less of the fusion.
   */
  socketCost(t: Tower, rarity = 0): number | null {
    const i = t.sockets.length;
    if (i >= 3) return null;
    const markup = 1 + ((RARITIES[rarity]?.socketMult ?? 1) - 1) * SOCKET_RARITY_WEIGHT[i];
    return Math.round((SOCKET_COST[i] * markup) / 5) * 5;
  }

  /** Why a power cannot be socketed right now, or null if it can. */
  socketBlocker(t: Tower, rarity = 0): string | null {
    const i = t.sockets.length;
    if (i >= 3) return 'All 3 sockets are full';
    if (t.tier < i + 1) return `Upgrade to tier ${i + 1} to open this socket`;
    const cost = this.socketCost(t, rarity)!;
    if (this.gold < cost) return `Needs ${cost} gold`;
    return null;
  }

  /** Socket a card from the hand (by card uid) into the tower's next free socket. */
  socket(id: number, cardUid: number): string | null {
    const t = this.towerById.get(id);
    if (!t) return 'No tower';
    const ci = this.cards.findIndex((c) => c.uid === cardUid);
    if (ci < 0) return 'You do not hold that card';
    const block = this.socketBlocker(t, this.cards[ci].rarity);
    if (block) return block;
    const cost = this.socketCost(t, this.cards[ci].rarity)!;
    this.gold -= cost;
    t.socketGold += cost;
    const [card] = this.cards.splice(ci, 1);
    t.cards.push(card);
    t.sockets.push(card.power);
    this.refreshSpec(t);
    return null;
  }

  /** Remove the last socketed card (order matters, so only the last one comes out). */
  unsocket(id: number): string | null {
    const t = this.towerById.get(id);
    if (!t || !t.sockets.length) return 'Nothing to remove';
    t.sockets.pop();
    this.cards.push(t.cards.pop()!);
    this.refreshSpec(t);
    return null;
  }

  /** Add a card to the hand (drafts, tests, tools). */
  giveCard(power: string, rarity = 0): Card {
    const c: Card = { uid: this.nextId++, power, rarity };
    this.cards.push(c);
    return c;
  }

  fusionKeyOf(t: Tower): string {
    return fusionKey(t.def.id, t.sockets);
  }

  refreshSpec(t: Tower): void {
    if (!t.sockets.length) {
      t.rt = null;
      t.specKey = '';
      t.specState = 'none';
      this.refreshLook(t);
      return;
    }
    const key = this.fusionKeyOf(t);
    const res = this.specProvider(this, t, key);
    if (!res) return;
    this.setSpec(t, key, res.spec, res.potency, res.state);
  }

  /** Install a spec on a tower (also used when a forge result arrives). */
  applySpec(towerId: number, key: string, spec: FusionSpec, potency: number, state: SpecState): boolean {
    const t = this.towerById.get(towerId);
    if (!t || this.fusionKeyOf(t) !== key) return false;
    this.setSpec(t, key, spec, potency, state);
    return true;
  }

  private setSpec(t: Tower, key: string, spec: FusionSpec, potency: number, state: SpecState): void {
    const oldVars = t.rt?.key === key ? t.rt.vars : null;
    const rarity = rarityFactor(t.cards.map((c) => c.rarity));
    t.rt = compileSpec(spec, key, potency * rarity, colorsFor(t.sockets), t.def.dtype);
    if (oldVars) for (const [k, v] of oldVars) if (t.rt.vars.has(k)) t.rt.vars.set(k, v);
    t.specKey = key;
    t.specState = state;
    t.mods = [];
    this.refreshLook(t);
    for (const d of this.drones) if (d.tower === t.id && d.isBase) d.color = t.look.color;
    if (state === 'ready' || state === 'offline' || state === 'provisional') this.stats.fusions++;
  }

  refreshLook(t: Tower): void {
    const rt = t.rt ?? { ...this.emptyRt, colors: this.defaultColors };
    const dcolor = DAMAGE_COLORS[t.def.dtype];
    const shape = t.def.id === 'frost' ? 'shard' : 'circle';
    t.look = resolveLook(t.rt?.spec.visual?.projectile, rt, dcolor, shape, {
      color: rt.colors.base,
      impact: resolveVfx(t.rt, t.rt?.spec.visual?.impact),
    });
  }

  /** Start the next wave. Calling during the countdown pays an early-call bonus. */
  callWave(): string | null {
    if (this.phase === 'defeat') return 'Not now';
    if (this.phase === 'victory' && !this.endless) return 'Victory!';
    if (this.phase === 'running' && this.countdown === null) return 'Wave still arriving';
    if (this.countdown !== null && this.countdown > 0) {
      const bonus = Math.round(this.countdown * RULES.earlyCallPerSec * (1 + 0.1 * this.waveN));
      if (bonus > 0) {
        this.addGold(bonus);
        this.msg(`Called early: +${bonus} gold`, 'good');
      }
    }
    this.startWave();
    return null;
  }

  continueEndless(): void {
    if (this.phase !== 'victory') return;
    this.endless = true;
    this.phase = 'running';
    this.countdown = RULES.countdown;
  }

  private startWave(): void {
    const n = this.waveN + 1;
    const def = this.getWave(n);
    this.active.push({ def, groups: def.groups.map((g) => ({ spawned: 0, timer: g.delay })), alive: 0, spawning: true });
    this.waveN = n;
    this.phase = 'running';
    this.countdown = null;
    this.lastWaveStartTick = this.tick;
    this.livesRestoredWave = 0;
    for (const t of this.towers) {
      t.dmgWave = 0;
      t.goldWave = 0;
      t.livesWave = 0;
      if (t.rt) {
        for (const [id, mode] of t.rt.varReset) if (mode === 'wave_start') t.rt.vars.set(id, 0);
        dispatch(this, t, 'on_wave_start', { depth: 0 });
      }
    }
    if (def.boss) this.msg(`Boss incoming: ${def.boss}`, 'bad');
  }

  /** Roll one card whose rarity is at least `floor`. Some powers only exist at high rarities. */
  rollCard(wave: number, floor: number, exclude: Set<string> = new Set()): Card {
    const rarity = Math.max(floor, rollRarity(this.rng, wave, false));
    const eligible = POWERS.filter((p) => (POWER_MIN_RARITY[p.id] ?? 0) <= rarity && !exclude.has(p.id));
    // Prefer powers that belong to the rolled rarity, so exclusive powers show up in their slots.
    const exact = eligible.filter((p) => (POWER_MIN_RARITY[p.id] ?? 0) === rarity);
    const pool = exact.length && this.rng.chance(0.65) ? exact : eligible.length ? eligible : POWERS;
    const p = this.rng.pick(pool);
    return { uid: this.nextId++, power: p.id, rarity };
  }

  grantPack(type: PackDef['id']): PackInst {
    const pk: PackInst = { uid: this.nextId++, type, wave: this.waveN };
    this.packs.push(pk);
    return pk;
  }

  /** Open a pack: its cards are offered, and the player keeps one (pickCard). */
  openPack(uid: number): Card[] | string {
    if (this.offer) return 'Keep a card from the open pack first';
    const i = this.packs.findIndex((p) => p.uid === uid);
    if (i < 0) return 'No such pack';
    const [pk] = this.packs.splice(i, 1);
    const def = PACK_BY_ID.get(pk.type)!;
    const seen = new Set<string>();
    const cards = def.floors.map((f) => {
      const c = this.rollCard(Math.max(pk.wave, this.waveN), f, seen);
      seen.add(c.power);
      return c;
    });
    this.offer = { uid: pk.uid, type: pk.type, cards };
    return cards;
  }

  /** Keep one card from the open pack; the others are gone. */
  pickCard(cardUid: number): Card | string {
    const o = this.offer;
    if (!o) return 'No open pack';
    const c = o.cards.find((x) => x.uid === cardUid);
    if (!c) return 'That card is not in the pack';
    this.cards.push(c);
    this.offer = null;
    return c;
  }

  packPrice(type: PackDef['id']): number | null {
    const def = PACK_BY_ID.get(type);
    return def?.price ? Math.round(def.price(Math.max(1, this.waveN))) : null;
  }

  buyPack(type: PackDef['id']): PackInst | string {
    const price = this.packPrice(type);
    if (price === null) return 'That pack cannot be bought';
    if (this.gold < price) return `Needs ${price} gold`;
    this.gold -= price;
    return this.grantPack(type);
  }

  /** Scrap a card from the hand for gold. */
  scrapCard(uid: number): number | string {
    const i = this.cards.findIndex((c) => c.uid === uid);
    if (i < 0) return 'No such card';
    const [c] = this.cards.splice(i, 1);
    const g = SCRAP_VALUE[c.rarity] ?? 10;
    this.addGold(g);
    return g;
  }

  // ------------------------------------------------------------ tick

  step(): void {
    if (this.phase === 'victory' || this.phase === 'defeat') return;
    this.tick++;
    this.time += DT;
    processScheduled(this);
    this.updateWaves();
    this.updateBeat();
    this.rebuildHash();
    computeAllStats(this);
    updateEnemies(this, DT);
    this.rebuildHash();
    updateTowers(this, DT);
    updateProjectiles(this, DT);
    updateZones(this, DT);
    updateDrones(this, DT, (t, d, e) => baseSting(this, t, d, e));
    this.processDeaths();
    this.cleanup();
    this.checkWaves();
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (const e of this.enemies) if (e.alive) this.hash.insert(e);
  }

  private updateBeat(): void {
    this.beatTimer += DT;
    if (this.beatTimer < RULES.beat) return;
    this.beatTimer -= RULES.beat;
    this.beatCount++;
    for (const t of this.towers) {
      const rules = t.rt?.byEvent.get('on_beat');
      if (!rules) continue;
      for (const rr of rules) {
        const n = (rr.rule.when as { n: number }).n;
        if (this.beatCount % n === 0) dispatch(this, t, 'on_beat', { depth: 0 });
        break;
      }
    }
  }

  private updateWaves(): void {
    for (const a of this.active) {
      if (!a.spawning) continue;
      let done = true;
      a.def.groups.forEach((g, i) => {
        const st = a.groups[i];
        const count = a.def.mutators.includes('swarm') ? Math.round(g.count * 1.5) : g.count;
        if (st.spawned >= count) return;
        done = false;
        st.timer -= DT;
        while (st.timer <= 0 && st.spawned < count) {
          spawnEnemy(this, g.enemy, g.path, a.def.n, { mods: g.mods });
          st.spawned++;
          st.timer += g.interval;
        }
      });
      if (done) {
        a.spawning = false;
        if (a.def.n === this.waveN && (this.waveN < this.totalWaves || this.endless)) this.countdown = RULES.countdown;
      }
    }
    if (this.countdown !== null && this.phase === 'running') {
      this.countdown -= DT;
      if (this.countdown <= 0) {
        this.countdown = 0;
        if (this.autoStart) this.startWave();
      }
    }
  }

  leak(e: Enemy): void {
    if (!e.alive) return;
    e.alive = false;
    e.removed = true;
    this.waveAlive(e.waveN, -1);
    this.lives -= e.lives;
    this.stats.leaks++;
    if (this.fxOn) this.fx.push({ k: 'leak', x: e.x, y: e.y, lives: e.lives });
    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'defeat';
      this.msg('Defeat', 'bad');
    }
  }

  private processDeaths(): void {
    let guard = 0;
    while (this.deathQueue.length && guard++ < 600) {
      const e = this.deathQueue.shift()!;
      if (e.removed) continue;
      e.removed = true;
      this.waveAlive(e.waveN, -1);
      this.stats.kills++;
      if (e.traitSet.has('boss')) this.stats.bossesKilled++;
      const bounty = Math.round(e.bounty * this.diff.bounty * RULES.bountyMult(Math.max(1, this.waveN)));
      this.addGold(bounty, e.x, e.y);
      const killer = this.towerById.get(e.killer) ?? null;
      for (const s of e.statuses) {
        if (s.def.onDeath && s.def.owner) runActions(this, s.def.onDeath, statusCtx(this, s.def, s, e, 'status_death'));
      }
      if (killer) {
        killer.kills++;
        const init = { target: e, px: e.x, py: e.y, depth: 0 };
        if (killer.rt) dispatch(this, killer, 'on_kill', init);
        for (const b of killer.conduits) if (b.rt) dispatch(this, b, 'on_kill', { ...init, host: killer, conduit: true });
      }
      for (const t of this.towers) {
        if (!t.rt?.byEvent.has('on_enemy_dies_in_range')) continue;
        const r = t.stats.range;
        if (dist2(t.x, t.y, e.x, e.y) <= r * r) dispatch(this, t, 'on_enemy_dies_in_range', { target: e, px: e.x, py: e.y, depth: 0 });
      }
      if (this.fxOn) {
        this.fx.push({ k: 'death', e, vfx: resolveVfx(killer?.rt ?? null, killer?.rt?.spec.visual?.kill), colors: killer?.rt?.colors ?? this.defaultColors });
      }
      for (const a of e.def.abilities) {
        if (a.kind === 'split') {
          const mods = e.mods.filter((m) => m !== 'elite');
          for (let i = 0; i < (a.count ?? 2); i++) {
            spawnEnemy(this, a.enemy ?? 'p3', e.pathIdx, e.waveN, { dist: Math.max(0, e.dist - 0.25 * i), lateral: (i - 0.5) * 0.25, mods });
          }
        }
      }
      if (!e.traitSet.has('boss')) {
        this.recentDeaths.push({ def: e.def.id, x: e.x, y: e.y, dist: e.dist, pathIdx: e.pathIdx, tick: this.tick, used: false, revived: (e.special & 1) === 1 });
        if (this.recentDeaths.length > 60) this.recentDeaths.splice(0, this.recentDeaths.length - 60);
      }
    }
  }

  private cleanup(): void {
    if (this.enemies.some((e) => e.removed)) {
      this.enemies = this.enemies.filter((e) => {
        if (e.removed) this.enemyById.delete(e.id);
        return !e.removed;
      });
    }
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
    if (this.zones.some((z) => !z.alive)) this.zones = this.zones.filter((z) => z.alive);
    if (this.drones.some((d) => !d.alive)) this.drones = this.drones.filter((d) => d.alive);
    if (this.tick % 60 === 0) this.recentDeaths = this.recentDeaths.filter((d) => this.tick - d.tick < 5 * RULES.tickRate);
  }

  private checkWaves(): void {
    // A final leak can empty the last wave in the same step it ends the game.
    if (this.phase === 'defeat') return;
    for (const a of [...this.active]) {
      if (a.spawning || a.alive > 0) continue;
      this.active.splice(this.active.indexOf(a), 1);
      const n = a.def.n;
      this.addGold(a.def.reward);
      this.msg(`Wave ${n} cleared: +${a.def.reward} gold`, 'good');
      for (const t of this.towers) if (t.rt) dispatch(this, t, 'on_wave_end', { depth: 0 });
      if (n >= this.totalWaves && !this.endless && this.active.length === 0) {
        this.phase = 'victory';
        this.msg('Victory!', 'good');
        return;
      }
      if (BOSS_WAVES[n]) {
        this.grantPack('boss');
        this.msg('Boss defeated: Boss Pack earned!', 'good');
      } else if (n % PACK_EVERY === 0) {
        this.grantPack('shape');
        this.msg('Shape Pack earned!', 'good');
      }
    }
  }

  // ------------------------------------------------------------ queries

  /** Is the field clear and waiting between waves (safe to save)? */
  quiescent(): boolean {
    return this.active.length === 0 && this.enemies.length === 0;
  }

  towerAt(c: number, r: number): Tower | undefined {
    const id = this.tileAt(c, r);
    return id > 0 ? this.towerById.get(id) : undefined;
  }

  // ------------------------------------------------------------ save / load

  snapshot(): WorldSave {
    return {
      v: 1, map: this.map.id, difficulty: this.diff.id, seed: this.seed, rng: this.rng.state(), tick: this.tick,
      gold: this.gold, lives: this.lives, waveN: this.waveN, endless: this.endless, cards: this.cards.map((c) => ({ ...c })),
      packs: this.packs.map((p) => ({ ...p })), offer: this.offer ? { ...this.offer, cards: this.offer.cards.map((c) => ({ ...c })) } : null,
      stats: { ...this.stats },
      phase: this.phase, countdown: this.countdown, nextId: this.nextId,
      towers: this.towers.map((t) => ({
        def: t.def.id, c: t.c, r: t.r, tier: t.tier, cards: t.cards.map((c) => ({ ...c })), targetMode: t.targetMode, invested: t.invested,
        socketGold: t.socketGold, kills: t.kills, dmgTotal: t.dmgTotal, vars: t.rt ? [...t.rt.vars.entries()] : [],
      })),
    };
  }

  restore(s: WorldSave): void {
    this.rng.restore(s.rng);
    this.tick = s.tick;
    this.gold = s.gold;
    this.lives = s.lives;
    this.waveN = s.waveN;
    this.endless = s.endless;
    this.cards = s.cards.map((c) => ({ ...c }));
    this.packs = s.packs.map((p) => ({ ...p }));
    this.offer = s.offer ? { ...s.offer, cards: s.offer.cards.map((c) => ({ ...c })) } : null;
    Object.assign(this.stats, s.stats);
    this.nextId = s.nextId;
    this.phase = s.phase === 'running' ? 'running' : s.phase;
    this.countdown = s.countdown ?? (this.waveN > 0 ? RULES.countdown : null);
    if (this.waveN === 0) this.phase = 'build';
    for (const ts of s.towers) {
      const def = TOWER_BY_ID.get(ts.def);
      if (!def) continue;
      const g = this.gold;
      this.gold = 1e9;
      const t = this.place(ts.def, ts.c, ts.r);
      this.gold = g;
      if (typeof t === 'string') continue;
      t.tier = ts.tier as 1 | 2 | 3;
      t.targetMode = ts.targetMode;
      t.invested = ts.invested;
      t.socketGold = ts.socketGold;
      t.kills = ts.kills;
      t.dmgTotal = ts.dmgTotal;
      t.placedTick = -1;
      t.stats = baseStats(t);
      t.cards = ts.cards.map((c) => ({ ...c }));
      t.sockets = t.cards.map((c) => c.power);
      this.refreshSpec(t);
      if (t.rt) for (const [k, v] of ts.vars) if (t.rt.vars.has(k)) t.rt.vars.set(k, v);
    }
  }
}

export interface WorldSave {
  v: 1;
  map: string;
  difficulty: DifficultyDef['id'];
  seed: number;
  rng: [number, number, number, number];
  tick: number;
  gold: number;
  lives: number;
  waveN: number;
  endless: boolean;
  cards: Card[];
  packs: PackInst[];
  offer?: PackOffer | null;
  stats: World['stats'];
  phase: Phase;
  countdown: number | null;
  nextId: number;
  towers: {
    def: string; c: number; r: number; tier: number; cards: Card[]; targetMode: TargetMode; invested: number;
    socketGold: number; kills: number; dmgTotal: number; vars: [string, number][];
  }[];
}

export { towerCostToTier };
