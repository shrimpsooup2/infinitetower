// Interpreter for the effect language: compiles a spec into a runtime, then
// dispatches triggers, checks conditions, evaluates values, resolves selectors
// and executes actions against the World. Every action is bounded by the
// engine limits in RULES, so no spec can hang or flood the game.

import type { World } from '../sim/world.ts';
import type {
  DamageType, Enemy, Palette3, ProjLook, ProjTplRT, RuleRT, SpecRuntime, StatusDefRT, StatusInst, Tower, ZoneTplRT,
} from '../sim/types.ts';
import type {
  Action, Condition, EnemySelector, FusionSpec, PointRef, ProjectileLook, TowerSelector, Value, VfxDef, Trigger,
} from './types.ts';
import { BUILTIN_VFX } from './vfxlib.ts';
import { BUILTIN_STATUS_DEFS } from '../sim/statuses.ts';
import { RULES } from '../content/rules.ts';
import { DAMAGE_COLORS, isHex } from '../content/colors.ts';
import { clamp, dist, dist2, TAU } from '../sim/math.ts';
import {
  applyStatus, dealDamage, findStatus, killEnemy, moveAlongPath, pathOf, removeStatus, removeStatusInst, stacksOf, updatePos,
} from '../sim/combat.ts';
import { spawnProjectile, spawnZone, spawnDrone } from '../sim/entities.ts';
import { towerAttack } from '../sim/towers.ts';

const TICKS = RULES.tickRate;

export interface Ctx {
  w: World;
  rt: SpecRuntime;
  owner: Tower | null;
  host: Tower | null;
  target: Enemy | null;
  px: number;
  py: number;
  aim: number;
  consumed: number;
  stored: number;
  depth: number;
  procCoef: number;
  potency: number;
  dmgBase: number;
  dtype: DamageType;
  event: string;
  rule: RuleRT | null;
}

export interface DispatchInit {
  target?: Enemy | null;
  px?: number;
  py?: number;
  aim?: number;
  depth?: number;
  procCoef?: number;
  host?: Tower;
  conduit?: boolean;
  statusKey?: string;
  projectileId?: string;
}

// ------------------------------------------------------------------ compile

export function resolveColor(ref: string | undefined, colors: Palette3, dcolor: string, fallback: string): string {
  if (!ref) return fallback;
  if (ref === 'base') return colors.base;
  if (ref === 'secondary') return colors.secondary;
  if (ref === 'tertiary') return colors.tertiary;
  if (ref === 'damage') return dcolor;
  return isHex(ref) ? ref : fallback;
}

export function resolveVfx(rt: SpecRuntime | null, id: string | undefined): VfxDef | null {
  if (!id) return null;
  return rt?.vfx.get(id) ?? BUILTIN_VFX.get(id) ?? null;
}

export function resolveLook(
  look: ProjectileLook | undefined, rt: SpecRuntime, dcolor: string, defShape: ProjLook['shape'], defaults?: Partial<ProjLook>,
): ProjLook {
  return {
    shape: look?.shape ?? defaults?.shape ?? defShape,
    color: resolveColor(look?.color, rt.colors, dcolor, defaults?.color ?? rt.colors.base),
    trail: look?.trail ?? defaults?.trail ?? 'none',
    trailColor: resolveColor(look?.trail_color, rt.colors, dcolor, defaults?.trailColor ?? rt.colors.secondary),
    spin: look?.spin ?? defaults?.spin ?? false,
    glow: look?.glow ?? defaults?.glow ?? false,
    size: look?.size ?? defaults?.size ?? 1,
    emitter: resolveVfx(rt, look?.emitter) ?? defaults?.emitter ?? null,
    impact: defaults?.impact ?? null,
    beam: defaults?.beam ?? null,
  };
}

function statusKeyFor(rt: SpecRuntime, id: string): string {
  return id in BUILTIN_STATUS_DEFS ? id : `${rt.key}#${id}`;
}

export function statusDef(rt: SpecRuntime, id: string): StatusDefRT | null {
  return BUILTIN_STATUS_DEFS[id] ?? rt.statuses.get(id) ?? null;
}

export function compileSpec(spec: FusionSpec, key: string, potency: number, colors: Palette3, dtype: DamageType): SpecRuntime {
  const dcolor = DAMAGE_COLORS[dtype];
  const rt: SpecRuntime = {
    key, spec, potency, rules: [], byEvent: new Map(), statuses: new Map(), projectiles: new Map(), zones: new Map(),
    vars: new Map(), varMax: new Map(), varReset: new Map(), colors, vfx: new Map(), firstHits: new Set(), needsRangeTracking: false,
  };
  for (const d of spec.vfx ?? []) rt.vfx.set(d.id, d);
  for (const s of spec.statuses ?? []) {
    rt.statuses.set(s.id, {
      key: `${key}#${s.id}`, name: s.name, builtin: false, stacking: s.stacking ?? 'refresh', maxStacks: s.max_stacks ?? 1,
      duration: s.duration, speedMult: s.speed_mult ?? 1, dmgTakenMult: s.damage_taken_mult ?? 1, armorDelta: s.armor_delta ?? 0,
      hardCC: !!s.hard_cc, reverse: !!s.reverse, storesDamage: s.stores_damage ?? 0, damagePerTile: s.damage_per_tile ?? null,
      dot: s.dot ? { amount: s.dot.amount, type: s.dot.type ?? dtype } : null, tick: s.tick ?? null,
      onApply: s.on_apply ?? null, onExpire: s.on_expire ?? null, onDeath: s.on_death ?? null,
      tint: resolveColor(s.tint, colors, dcolor, colors.base), icon: s.icon ?? 'dot', overlay: s.overlay ?? 'glow',
      scale: s.scale ?? 1, vfx: resolveVfx(rt, s.vfx), owner: rt,
    });
  }
  const baseLook = spec.visual?.projectile;
  for (const p of spec.projectiles ?? []) {
    const pd = p.type ? DAMAGE_COLORS[p.type] : dcolor;
    const look = resolveLook(p.look ?? baseLook, rt, pd, p.motion === 'orbit' ? 'orb' : 'circle', {
      impact: resolveVfx(rt, p.impact ?? spec.visual?.impact),
      beam: p.beam ?? spec.visual?.beam ?? null,
    });
    rt.projectiles.set(p.id, {
      id: p.id, motion: p.motion, speed: p.speed ?? 8, size: p.size ?? 0.12, lifetime: p.lifetime ?? 3, pierce: p.pierce ?? 0,
      bounce: p.bounce ?? 0, splash: p.splash ?? 0, amount: p.amount, type: p.type ?? null, hitsAir: p.hits_air ?? true,
      onHit: p.on_hit ?? null, onEnd: p.on_end ?? null, look,
    });
  }
  rt.projectiles.set('bullet', {
    id: 'bullet', motion: 'homing', speed: 10, size: 0.1, lifetime: 2, pierce: 0, bounce: 0, splash: 0, amount: { dmg: 0.5 },
    type: null, hitsAir: true, onHit: null, onEnd: null,
    look: resolveLook(baseLook, rt, dcolor, 'circle', { impact: resolveVfx(rt, spec.visual?.impact) }),
  });
  for (const z of spec.zones ?? []) {
    rt.zones.set(z.id, {
      id: z.id, shape: z.shape, radius: z.radius, duration: z.duration, follows: z.follows ?? 'none', speedMult: z.speed_mult ?? 1,
      dmgTakenMult: z.damage_taken_mult ?? 1, tick: z.tick ?? null, onEnter: z.on_enter ?? null, onExit: z.on_exit ?? null,
      style: z.style ?? 'fill', color: resolveColor(z.color, colors, dcolor, colors.secondary), vfx: resolveVfx(rt, z.vfx),
    } satisfies ZoneTplRT);
  }
  for (const v of spec.vars ?? []) {
    rt.vars.set(v.id, 0);
    rt.varMax.set(v.id, v.max ?? 1e9);
    rt.varReset.set(v.id, v.reset ?? 'never');
  }
  spec.rules.forEach((rule, idx) => {
    const w: Trigger = rule.when;
    const rr: RuleRT = {
      idx, event: w.event, rule, cooldownUntil: 0, nthCounter: 0, attackCounter: 0, timer: 0, idleFired: false,
      statusKey: 'status' in w ? statusKeyFor(rt, w.status) : null, lastSpawnTick: -1e9,
    };
    rt.rules.push(rr);
    const list = rt.byEvent.get(w.event) ?? [];
    list.push(rr);
    rt.byEvent.set(w.event, list);
    if (w.event === 'on_enemy_enters_range' || w.event === 'on_enemy_leaves_range') rt.needsRangeTracking = true;
  });
  return rt;
}

// ------------------------------------------------------------------ contexts

export function makeCtx(w: World, rt: SpecRuntime, owner: Tower | null, init: DispatchInit, rule: RuleRT | null, event: string): Ctx {
  const host = init.host ?? owner;
  const conduit = !!init.conduit;
  const target = init.target ?? null;
  const hx = host?.x ?? target?.x ?? 0;
  const hy = host?.y ?? target?.y ?? 0;
  return {
    w, rt, owner, host, target,
    px: init.px ?? target?.x ?? hx,
    py: init.py ?? target?.y ?? hy,
    aim: init.aim ?? (target ? Math.atan2(target.y - hy, target.x - hx) : host?.angle ?? 0),
    consumed: 0,
    stored: 0,
    depth: init.depth ?? 0,
    procCoef: (init.procCoef ?? 1) * (conduit ? 0.5 : 1),
    potency: rt.potency * (conduit ? 0.5 : 1),
    dmgBase: host?.stats.damage ?? 10,
    dtype: host?.def.dtype ?? 'kinetic',
    event,
    rule,
  };
}

export function statusCtx(w: World, def: StatusDefRT, inst: StatusInst, e: Enemy, event: string): Ctx {
  const owner = w.towerById.get(inst.source) ?? null;
  const rt = def.owner!;
  return {
    w, rt, owner, host: owner, target: e, px: e.x, py: e.y, aim: e.heading, consumed: 0, stored: inst.stored, depth: 1,
    procCoef: 1, potency: inst.potency, dmgBase: owner?.stats.damage ?? inst.dmgBase,
    dtype: owner?.def.dtype ?? 'kinetic', event, rule: null,
  };
}

// ------------------------------------------------------------------ dispatch

export function dispatch(w: World, owner: Tower, event: string, init: DispatchInit): void {
  const rt = owner.rt;
  if (!rt) return;
  const rules = rt.byEvent.get(event);
  if (!rules) return;
  if (++owner.eventsThisTick > RULES.maxEventsPerTowerTick) return;
  for (const rr of rules) {
    if (rr.statusKey && rr.statusKey !== init.statusKey) continue;
    if (event === 'on_projectile_end' && (rr.rule.when as { projectile?: string }).projectile !== init.projectileId) continue;
    const ctx = makeCtx(w, rt, owner, init, rr, event);
    if (!checkConditions(w, rr, ctx)) continue;
    runActions(w, rr.rule.do, ctx);
  }
}

/** Run a single rule (used for timer-driven triggers). */
export function fireRule(w: World, owner: Tower, rr: RuleRT, init: DispatchInit): void {
  if (!owner.rt) return;
  if (++owner.eventsThisTick > RULES.maxEventsPerTowerTick) return;
  const ctx = makeCtx(w, owner.rt, owner, init, rr, rr.event);
  if (checkConditions(w, rr, ctx)) runActions(w, rr.rule.do, ctx);
}

/** Fire every_nth_attack rules (counts are per rule). */
export function dispatchNth(w: World, owner: Tower, init: DispatchInit): void {
  const rules = owner.rt?.byEvent.get('every_nth_attack');
  if (!rules || !owner.rt) return;
  for (const rr of rules) {
    const n = Math.max(2, Math.round((rr.rule.when as { n: number }).n * owner.def.nthScale));
    if (++rr.attackCounter < n) continue;
    rr.attackCounter = 0;
    const ctx = makeCtx(w, owner.rt, owner, init, rr, 'every_nth_attack');
    if (checkConditions(w, rr, ctx)) runActions(w, rr.rule.do, ctx);
  }
}

/** Beacon conduit: an ally's attack/hit/kill also triggers each covering Beacon's rules at half strength. */
export function dispatchConduits(w: World, host: Tower, event: string, init: DispatchInit): void {
  for (const b of host.conduits) {
    if (!b.rt) continue;
    if (event === 'every_nth_attack') dispatchNth(w, b, { ...init, host, conduit: true });
    else dispatch(w, b, event, { ...init, host, conduit: true });
  }
}

/** Standard fan-out for a tower event: its own rules, conduit Beacons, and nearby on_ally_hit listeners. */
export function towerEvent(w: World, t: Tower, event: string, init: DispatchInit): void {
  if (t.rt) dispatch(w, t, event, init);
  if (t.conduits.length) dispatchConduits(w, t, event, init);
  if (event === 'on_hit' && w.allyHitListeners.length) {
    for (const o of w.allyHitListeners) {
      if (o === t || !o.rt) continue;
      if (dist2(o.x, o.y, t.x, t.y) <= o.stats.range * o.stats.range) dispatch(w, o, 'on_ally_hit', { ...init, host: undefined });
    }
  }
}

// ------------------------------------------------------------------ conditions

function traitOf(e: Enemy, trait: string): boolean {
  if (trait === 'shielded') return e.maxShield > 0 && e.shield > 0;
  if (trait === 'flying') return e.air;
  if (trait === 'fast') return e.speed >= 1.5;
  return e.traitSet.has(trait);
}

function checkConditions(w: World, rr: RuleRT, ctx: Ctx): boolean {
  const conds = rr.rule.if;
  if (!conds || conds.length === 0) return true;
  let cooldown: Condition | null = null;
  let nth: Condition | null = null;
  for (const c of conds) {
    if (c.check === 'cooldown') { cooldown = c; continue; }
    if (c.check === 'every_nth') { nth = c; continue; }
    if (!checkOne(w, c, ctx)) return false;
  }
  if (nth && nth.check === 'every_nth') {
    rr.nthCounter++;
    if (rr.nthCounter < nth.n) return false;
    rr.nthCounter = 0;
  }
  if (cooldown && cooldown.check === 'cooldown') {
    if (w.tick < rr.cooldownUntil) return false;
    rr.cooldownUntil = w.tick + Math.round(cooldown.seconds * TICKS);
  }
  return true;
}

function checkOne(w: World, c: Condition, ctx: Ctx): boolean {
  const t = ctx.target;
  switch (c.check) {
    case 'chance':
      return w.rng.next() < c.p * ctx.procCoef;
    case 'target_hp_below':
      return !!t && (t.hp / t.maxHp) * 100 < c.pct;
    case 'target_hp_above':
      return !!t && (t.hp / t.maxHp) * 100 > c.pct;
    case 'target_has_status': {
      if (!t) return false;
      const s = findStatus(t, statusKeyFor(ctx.rt, c.status));
      return !!s && s.stacks >= (c.min_stacks ?? 1);
    }
    case 'target_lacks_status':
      return !!t && !findStatus(t, statusKeyFor(ctx.rt, c.status));
    case 'target_is':
      return !!t && traitOf(t, c.trait);
    case 'target_is_not':
      return !!t && !traitOf(t, c.trait);
    case 'var_at_least':
      return (ctx.rt.vars.get(c.var) ?? 0) >= c.value;
    case 'var_below':
      return (ctx.rt.vars.get(c.var) ?? 0) < c.value;
    case 'enemies_in_range_at_least':
      return inRange(w, ctx).length >= c.n;
    case 'target_distance': {
      if (!t || !ctx.host) return false;
      const d = dist(t.x, t.y, ctx.host.x, ctx.host.y);
      return d >= (c.min ?? 0) && d <= (c.max ?? 1e9);
    }
    case 'first_hit_on_target': {
      if (!t) return false;
      if (ctx.rt.firstHits.has(t.id)) return false;
      if (ctx.rt.firstHits.size > 4000) ctx.rt.firstHits.clear();
      ctx.rt.firstHits.add(t.id);
      return true;
    }
    default:
      return true;
  }
}

// ------------------------------------------------------------------ values

export function evalValue(v: Value, ctx: Ctx, target: Enemy | null = ctx.target, depth = 0): number {
  if (typeof v === 'number') return v;
  if (depth > 4 || typeof v !== 'object' || v === null) return 0;
  const o = v as Record<string, unknown>;
  let r = 0;
  if ('dmg' in o) r = (o.dmg as number) * ctx.dmgBase * ctx.potency;
  else if ('var' in o) r = ctx.rt.vars.get(o.var as string) ?? 0;
  else if ('stacks' in o) r = target ? stacksOf(target, statusKeyFor(ctx.rt, o.stacks as string)) : 0;
  else if ('consumed' in o) r = ctx.consumed;
  else if ('stored' in o) r = ctx.stored;
  else if ('target_hp_pct' in o) r = target ? (target.hp / target.maxHp) * 100 : 0;
  else if ('target_missing_hp_pct' in o) r = target ? 100 - (target.hp / target.maxHp) * 100 : 0;
  else if ('enemies_in_range' in o) r = inRange(ctxWorld(ctx), ctx).length;
  else if ('distance' in o) r = target && ctx.host ? dist(target.x, target.y, ctx.host.x, ctx.host.y) : 0;
  else if ('tier' in o) r = ctx.host?.tier ?? 1;
  else if ('wave' in o) r = ctxWorld(ctx).waveN;
  else if ('random' in o) {
    const [a, b] = o.random as [number, number];
    r = a + (b - a) * ctxWorld(ctx).rng.next();
  } else {
    for (const op of ['add', 'mul', 'min', 'max'] as const) {
      const arr = o[op] as Value[] | undefined;
      if (!arr) continue;
      const xs = arr.map((x) => evalValue(x, ctx, target, depth + 1));
      if (op === 'add') r = xs.reduce((a, b) => a + b, 0);
      else if (op === 'mul') r = xs.reduce((a, b) => a * b, 1);
      else if (op === 'min') r = Math.min(...xs);
      else r = Math.max(...xs);
      break;
    }
  }
  return Number.isFinite(r) ? clamp(r, -1e7, 1e7) : 0;
}

function ctxWorld(ctx: Ctx): World {
  return ctx.w;
}

// ------------------------------------------------------------------ selectors

function effectTargetable(w: World, e: Enemy): boolean {
  return e.alive && !e.burrowed && (!e.traitSet.has('stealth') || e.revealedUntil > w.tick);
}

function inRange(w: World, ctx: Ctx, radius?: number, cx?: number, cy?: number): Enemy[] {
  const x = cx ?? ctx.host?.x ?? ctx.px;
  const y = cy ?? ctx.host?.y ?? ctx.py;
  const r = radius ?? ctx.host?.stats.range ?? 3;
  const out: Enemy[] = [];
  for (const e of w.hash.query(x, y, r, 0.5)) {
    if (!effectTargetable(w, e)) continue;
    const rr = r + e.size * 0.5;
    if (dist2(e.x, e.y, x, y) <= rr * rr) out.push(e);
  }
  return out;
}

function anchor(ctx: Ctx, a: string | undefined): [number, number] {
  if (a === 'self' && ctx.host) return [ctx.host.x, ctx.host.y];
  if (a === 'point') return [ctx.px, ctx.py];
  if (ctx.target) return [ctx.target.x, ctx.target.y];
  return [ctx.px, ctx.py];
}

function progress(w: World, e: Enemy): number {
  return e.dist / pathOf(w, e).length;
}

export function select(w: World, sel: EnemySelector, ctx: Ctx): Enemy[] {
  if (sel === 'target') return ctx.target && ctx.target.alive ? [ctx.target] : [];
  if (sel === 'all_in_range') return inRange(w, ctx);
  switch (sel.select) {
    case 'all_in_radius': {
      const [x, y] = anchor(ctx, sel.around);
      return inRange(w, ctx, sel.radius, x, y);
    }
    case 'random_in_range': {
      const pool = inRange(w, ctx);
      w.rng.shuffle(pool);
      return pool.slice(0, sel.n);
    }
    case 'strongest_in_range':
      return inRange(w, ctx).sort((a, b) => b.hp - a.hp).slice(0, sel.n);
    case 'weakest_in_range':
      return inRange(w, ctx).sort((a, b) => a.hp - b.hp).slice(0, sel.n);
    case 'first_in_range':
      return inRange(w, ctx).sort((a, b) => progress(w, b) - progress(w, a)).slice(0, sel.n);
    case 'last_in_range':
      return inRange(w, ctx).sort((a, b) => progress(w, a) - progress(w, b)).slice(0, sel.n);
    case 'nearest': {
      const [x, y] = anchor(ctx, sel.around);
      const pool = inRange(w, ctx, 6, x, y).filter((e) => !(sel.exclude_target && e === ctx.target));
      return pool.sort((a, b) => dist2(a.x, a.y, x, y) - dist2(b.x, b.y, x, y)).slice(0, sel.n);
    }
    case 'chain': {
      const out: Enemy[] = [];
      if (!ctx.target) return out;
      const seen = new Set<number>([ctx.target.id]);
      let cur = ctx.target;
      const pts = [cur.x, cur.y];
      for (let i = 0; i < sel.n; i++) {
        let best: Enemy | null = null;
        let bd = sel.range * sel.range;
        for (const e of w.hash.query(cur.x, cur.y, sel.range, 0.5)) {
          if (seen.has(e.id) || !effectTargetable(w, e)) continue;
          const d = dist2(e.x, e.y, cur.x, cur.y);
          if (d <= bd) { bd = d; best = e; }
        }
        if (!best) break;
        seen.add(best.id);
        out.push(best);
        pts.push(best.x, best.y);
        cur = best;
      }
      if (w.fxOn && out.length) {
        const look = ctx.rt.spec.visual?.beam;
        const dcolor = DAMAGE_COLORS[ctx.dtype];
        w.fx.push({
          k: 'beam', x1: pts[0], y1: pts[1], x2: pts[pts.length - 2], y2: pts[pts.length - 1], pts,
          look: { style: 'lightning', width: [0.08, 0.06], color: 'damage', core: '#ffffff', glow: true, amplitude: 0.2, duration: 0.18, ...(look ?? {}) },
          colors: ctx.rt.colors, dcolor, dur: 0.18,
        });
      }
      return out;
    }
    case 'with_status': {
      const key = statusKeyFor(ctx.rt, sel.status);
      const pool = sel.within === 'map' ? w.enemies.filter((e) => effectTargetable(w, e)) : inRange(w, ctx);
      return pool.filter((e) => !!findStatus(e, key));
    }
  }
  return [];
}

function selectTowers(w: World, sel: TowerSelector, ctx: Ctx): Tower[] {
  const self = ctx.host ?? ctx.owner;
  if (sel === 'self') return self ? [self] : [];
  if (!self) return [];
  const r2 = sel.radius * sel.radius;
  return w.towers.filter((t) => t !== self && dist2(t.x, t.y, self.x, self.y) <= r2);
}

const tmpAt = { x: 0, y: 0, ang: 0 };

export function resolvePoint(w: World, p: PointRef, ctx: Ctx): [number, number] {
  if (p === 'target') return ctx.target ? [ctx.target.x, ctx.target.y] : [ctx.px, ctx.py];
  if (p === 'point') return [ctx.px, ctx.py];
  if (p === 'self') return ctx.host ? [ctx.host.x, ctx.host.y] : [ctx.px, ctx.py];
  if (p === 'random_in_range') {
    const pool = inRange(w, ctx);
    if (pool.length) {
      const e = w.rng.pick(pool);
      return [e.x, e.y];
    }
    const a = w.rng.next() * TAU;
    const r = (ctx.host?.stats.range ?? 2) * Math.sqrt(w.rng.next());
    return [(ctx.host?.x ?? ctx.px) + Math.cos(a) * r, (ctx.host?.y ?? ctx.py) + Math.sin(a) * r];
  }
  const t = ctx.target;
  const ahead = 'path_ahead' in p ? p.path_ahead : -p.path_behind;
  if (t) {
    pathOf(w, t).at(t.dist + ahead, tmpAt);
    return [tmpAt.x, tmpAt.y];
  }
  const path = w.paths[0];
  path.at(path.project(ctx.px, ctx.py) + ahead, tmpAt);
  return [tmpAt.x, tmpAt.y];
}

// ------------------------------------------------------------------ actions

interface Scheduled {
  at: number;
  a: Action;
  rt: SpecRuntime;
  ownerId: number;
  hostId: number;
  targetId: number;
  ctx: Ctx;
}

export function runActions(w: World, list: Action[] | null | undefined, ctx: Ctx): void {
  if (!list) return;
  for (const a of list) {
    const delay = a.delay ?? 0;
    if (delay > 0 || a.repeat) {
      const times = a.repeat ? a.repeat.times : 1;
      const every = a.repeat ? a.repeat.every : 0;
      const stripped = { ...a, delay: undefined, repeat: undefined } as Action;
      for (let i = 0; i < times; i++) {
        const at = w.tick + Math.round((delay + i * every) * TICKS);
        if (at <= w.tick) { exec(w, stripped, ctx); continue; }
        if (w.scheduled.length >= RULES.maxScheduled) break;
        w.scheduled.push({
          at, a: stripped, rt: ctx.rt, ownerId: ctx.owner?.id ?? 0, hostId: ctx.host?.id ?? 0,
          targetId: ctx.target?.id ?? 0, ctx: { ...ctx },
        } satisfies Scheduled);
      }
    } else {
      exec(w, a, ctx);
    }
  }
}

export function processScheduled(w: World): void {
  if (!w.scheduled.length) return;
  const due: Scheduled[] = [];
  const keep: Scheduled[] = [];
  for (const s of w.scheduled as Scheduled[]) (s.at <= w.tick ? due : keep).push(s);
  w.scheduled = keep;
  for (const s of due) {
    const owner = s.ownerId ? w.towerById.get(s.ownerId) ?? null : null;
    if (s.ownerId && !owner) continue; // tower sold
    const target = s.targetId ? w.enemyById.get(s.targetId) ?? null : null;
    const host = s.hostId ? w.towerById.get(s.hostId) ?? null : null;
    const ctx: Ctx = { ...s.ctx, owner, host, target };
    if (target && target.alive) {
      ctx.px = target.x;
      ctx.py = target.y;
    }
    exec(w, s.a, ctx);
  }
}

function spawnAllowed(w: World, ctx: Ctx): boolean {
  if (ctx.depth >= RULES.maxSpawnDepth) return false;
  const t = ctx.owner;
  if (t && t.liveSpawns >= RULES.maxSpawnsPerTower) return false;
  const rr = ctx.rule;
  if (rr && (ctx.event === 'on_hit' || ctx.event === 'on_ally_hit' || ctx.event === 'on_crit' || ctx.event === 'on_attack' || ctx.event === 'on_kill')) {
    const min = Math.ceil((0.1 / Math.max(0.1, ctx.procCoef)) * TICKS);
    if (w.tick - rr.lastSpawnTick < min && rr.lastSpawnTick !== w.tick) return false;
    rr.lastSpawnTick = w.tick;
  }
  return true;
}

function emitVfx(w: World, def: VfxDef | null, ctx: Ctx, x: number, y: number, x2: number, y2: number, size: number, tint: string | null, text: string | null): void {
  if (!w.fxOn || !def) return;
  w.fx.push({
    k: 'vfx', def, x, y, x2, y2, ang: ctx.aim, colors: ctx.rt.colors, dcolor: DAMAGE_COLORS[ctx.dtype], size, tint, text,
  });
}

function setVar(w: World, ctx: Ctx, id: string, value: number): void {
  const rt = ctx.rt;
  const old = rt.vars.get(id) ?? 0;
  const nv = clamp(value, -1e9, rt.varMax.get(id) ?? 1e9);
  rt.vars.set(id, nv);
  const rules = rt.byEvent.get('on_var_reached');
  if (!rules || ctx.depth > 3) return;
  for (const rr of rules) {
    const wv = rr.rule.when as { var: string; value: number };
    if (wv.var !== id || !(old < wv.value && nv >= wv.value)) continue;
    const c2: Ctx = { ...ctx, target: null, depth: ctx.depth + 1, rule: rr, event: 'on_var_reached', consumed: 0 };
    if (checkConditions(w, rr, c2)) runActions(w, rr.rule.do, c2);
  }
}

function aimAngle(w: World, aim: string, ctx: Ctx, fx: number, fy: number): { ang: number; target: Enemy | null } {
  switch (aim) {
    case 'away':
      return { ang: ctx.aim + Math.PI, target: null };
    case 'random':
      return { ang: w.rng.next() * TAU, target: null };
    case 'nearest_other': {
      let best: Enemy | null = null;
      let bd = 16;
      for (const e of w.hash.query(fx, fy, 4, 0.5)) {
        if (e === ctx.target || !effectTargetable(w, e)) continue;
        const d = dist2(e.x, e.y, fx, fy);
        if (d < bd) { bd = d; best = e; }
      }
      return best ? { ang: Math.atan2(best.y - fy, best.x - fx), target: best } : { ang: w.rng.next() * TAU, target: null };
    }
    case 'path_back':
    case 'path_forward': {
      const path = ctx.target ? pathOf(w, ctx.target) : w.paths[0];
      const d = ctx.target ? ctx.target.dist : path.project(fx, fy);
      path.at(d, tmpAt);
      return { ang: tmpAt.ang + (aim === 'path_back' ? Math.PI : 0), target: null };
    }
    default: {
      let t = ctx.target && ctx.target.alive ? ctx.target : null;
      if (!t) {
        const pool = inRange(w, ctx);
        t = pool.length ? pool[0] : null;
      }
      return t ? { ang: Math.atan2(t.y - fy, t.x - fx), target: t } : { ang: ctx.aim, target: null };
    }
  }
}

function exec(w: World, a: Action, ctx: Ctx): void {
  switch (a.action) {
    case 'damage': {
      const type = a.type ?? ctx.dtype;
      for (const e of select(w, a.to, ctx)) {
        dealDamage(w, e, evalValue(a.amount, ctx, e), type, { tower: ctx.owner, isHit: false, depth: ctx.depth });
      }
      break;
    }
    case 'explode': {
      const [x, y] = resolvePoint(w, a.at, ctx);
      const type = a.type ?? ctx.dtype;
      const amt = evalValue(a.amount, ctx, ctx.target);
      for (const e of inRange(w, ctx, a.radius, x, y)) dealDamage(w, e, amt, type, { tower: ctx.owner, isHit: false, depth: ctx.depth });
      if (w.fxOn) {
        w.fx.push({ k: 'boom', x, y, r: a.radius, vfx: resolveVfx(ctx.rt, a.vfx ?? 'ring'), colors: ctx.rt.colors, dcolor: DAMAGE_COLORS[type] });
      }
      break;
    }
    case 'execute':
      for (const e of select(w, a.to, ctx)) {
        if (e.traitSet.has('boss')) continue;
        if ((e.hp / e.maxHp) * 100 < a.below_pct) {
          if (w.fxOn) w.fx.push({ k: 'text', x: e.x, y: e.y - e.size, text: 'EXECUTE', color: '#ff5c5c' });
          killEnemy(w, e, ctx.owner);
        }
      }
      break;
    case 'apply_status': {
      const def = statusDef(ctx.rt, a.status);
      if (!def) break;
      for (const e of select(w, a.to, ctx)) applyStatus(w, e, def, a.stacks ?? 1, a.duration, ctx);
      break;
    }
    case 'remove_status':
      for (const e of select(w, a.to, ctx)) removeStatus(w, e, statusKeyFor(ctx.rt, a.status));
      break;
    case 'consume_status': {
      let total = 0;
      for (const e of select(w, a.to, ctx)) total += removeStatus(w, e, statusKeyFor(ctx.rt, a.status));
      ctx.consumed = total;
      break;
    }
    case 'spread_statuses': {
      const src = ctx.target;
      if (!src || !src.statuses.length) break;
      const pool = inRange(w, ctx, a.radius, src.x, src.y)
        .filter((e) => e !== src)
        .sort((p, q) => dist2(p.x, p.y, src.x, src.y) - dist2(q.x, q.y, src.x, src.y))
        .slice(0, a.max_targets ?? 3);
      for (const e of pool) {
        for (const s of src.statuses) {
          const c2: Ctx = { ...ctx, dmgBase: s.dotPerStack > 0 ? ctx.dmgBase : ctx.dmgBase };
          applyStatus(w, e, s.def, s.stacks, Math.min(s.remaining, s.def.hardCC ? 1 : 12), c2);
        }
        if (w.fxOn) {
          w.fx.push({ k: 'beam', x1: src.x, y1: src.y, x2: e.x, y2: e.y, look: { style: 'dotted', width: [0.05, 0.05], color: 'base', duration: 0.3 }, colors: ctx.rt.colors, dcolor: DAMAGE_COLORS[ctx.dtype], dur: 0.3 });
        }
      }
      break;
    }
    case 'knockback':
      for (const e of select(w, a.to, ctx)) {
        const d = clamp(evalValue(a.distance, ctx, e), 0, 3) * e.tenacity;
        moveAlongPath(w, e, -d);
      }
      break;
    case 'pull': {
      const [x, y] = resolvePoint(w, a.toward, ctx);
      for (const e of select(w, a.to, ctx)) {
        const s = clamp(evalValue(a.strength, ctx, e), 0, 3) * e.tenacity;
        const pd = pathOf(w, e).project(x, y);
        moveAlongPath(w, e, clamp(pd - e.dist, -s, s));
      }
      break;
    }
    case 'teleport_along_path':
      for (const e of select(w, a.to, ctx)) {
        const d = clamp(evalValue(a.distance, ctx, e), -6, 6) * (e.traitSet.has('boss') ? e.tenacity : 1);
        const x0 = e.x, y0 = e.y;
        moveAlongPath(w, e, d);
        if (w.fxOn) w.fx.push({ k: 'blink', x1: x0, y1: y0, x2: e.x, y2: e.y });
      }
      break;
    case 'rewind_position':
      for (const e of select(w, a.to, ctx)) {
        if (w.tick - e.lastRewindTick < 2 * TICKS) continue;
        e.lastRewindTick = w.tick;
        const steps = Math.min(e.hist.length - 1, Math.round(a.seconds * 10));
        const old = e.hist[(e.histIdx - steps + e.hist.length * 4) % e.hist.length];
        if (old < e.dist) {
          const x0 = e.x, y0 = e.y;
          moveAlongPath(w, e, (old - e.dist) * e.tenacity);
          if (w.fxOn) w.fx.push({ k: 'blink', x1: x0, y1: y0, x2: e.x, y2: e.y });
        }
      }
      break;
    case 'swap_positions': {
      const t = ctx.target;
      if (!t || !t.alive) break;
      const pool = inRange(w, ctx).filter((e) => e !== t && e.air === t.air && e.pathIdx === t.pathIdx && !e.traitSet.has('boss'));
      if (!pool.length || t.traitSet.has('boss')) break;
      pool.sort((p, q) => q.dist - p.dist);
      const o = a.with === 'first_in_range' ? pool[0] : a.with === 'last_in_range' ? pool[pool.length - 1] : w.rng.pick(pool);
      const d = t.dist;
      t.dist = o.dist;
      o.dist = d;
      updatePos(w, t);
      updatePos(w, o);
      if (w.fxOn) w.fx.push({ k: 'blink', x1: t.x, y1: t.y, x2: o.x, y2: o.y });
      break;
    }
    case 'shrink':
      for (const e of select(w, a.to, ctx)) {
        if (e.shrunk || e.traitSet.has('boss')) continue;
        e.shrunk = true;
        e.maxHp *= a.hp_mult;
        e.hp = Math.min(e.hp * a.hp_mult, e.maxHp);
        e.speed *= a.speed_mult;
        e.size *= 0.85;
      }
      break;
    case 'fire_projectile': {
      const tpl = ctx.rt.projectiles.get(a.projectile);
      if (!tpl || !spawnAllowed(w, ctx)) break;
      const [fx, fy] = a.from ? resolvePoint(w, a.from, ctx) : ctx.host ? [ctx.host.x, ctx.host.y] : [ctx.px, ctx.py];
      const n = a.count ?? 1;
      const { ang, target } = aimAngle(w, a.aim ?? 'target', ctx, fx, fy);
      const spread = ((a.spread ?? (n > 1 ? 30 : 0)) * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const off = n > 1 ? -spread / 2 + (spread * i) / (spread >= TAU - 0.01 ? n : n - 1) : 0;
        const aimMode = a.aim ?? 'target';
        spawnProjectile(w, tpl, ctx, fx, fy, ang + off, aimMode === 'random' && n > 1 ? null : target, aimMode);
      }
      break;
    }
    case 'create_zone': {
      const tpl = ctx.rt.zones.get(a.zone);
      if (!tpl || !spawnAllowed(w, ctx)) break;
      const [x, y] = resolvePoint(w, a.at, ctx);
      spawnZone(w, tpl, ctx, x, y);
      break;
    }
    case 'summon_drone': {
      if (!spawnAllowed(w, ctx)) break;
      const dmg = evalValue(a.damage, ctx);
      for (let i = 0; i < a.count; i++) spawnDrone(w, ctx, a.lifetime, dmg);
      break;
    }
    case 'repeat_attack': {
      const host = ctx.host;
      if (!host || ctx.depth > 0 || !spawnAllowed(w, ctx)) break;
      towerAttack(w, host, ctx.target && ctx.target.alive ? ctx.target : null, a.mult, true);
      break;
    }
    case 'modify_tower': {
      const until = w.tick + Math.round(a.duration * TICKS);
      const src = `${ctx.rt.key}:${ctx.rule?.idx ?? -1}:${a.stat}`;
      for (const t of selectTowers(w, a.to, ctx)) {
        const m = t.mods.find((x) => x.src === src);
        if (m) { m.until = until; m.mult = a.mult; } else if (t.mods.length < 12) t.mods.push({ stat: a.stat, mult: a.mult, until, src });
      }
      break;
    }
    case 'set_var':
      setVar(w, ctx, a.var, evalValue(a.value, ctx));
      break;
    case 'add_var':
      setVar(w, ctx, a.var, (ctx.rt.vars.get(a.var) ?? 0) + evalValue(a.amount, ctx));
      break;
    case 'grant_gold': {
      const t = ctx.owner;
      const cap = RULES.towerGoldCap(Math.max(1, w.waveN));
      const amt = t ? Math.min(a.amount, cap - t.goldWave) : 0;
      if (amt > 0 && t) {
        t.goldWave += amt;
        w.addGold(amt, ctx.target?.x ?? t.x, ctx.target?.y ?? t.y);
      }
      break;
    }
    case 'restore_life': {
      const t = ctx.owner;
      if (!t || t.livesWave >= 1 || w.livesRestoredWave >= 3 || w.lives >= w.livesMax) break;
      t.livesWave++;
      w.livesRestoredWave++;
      w.lives += 1;
      if (w.fxOn) w.fx.push({ k: 'text', x: t.x, y: t.y - 0.6, text: '+1 life', color: '#85e37d', big: true });
      break;
    }
    case 'reveal':
      for (const e of select(w, a.to, ctx)) e.revealedUntil = Math.max(e.revealedUntil, w.tick + Math.round(a.duration * TICKS));
      break;
    case 'break_shield':
      for (const e of select(w, a.to, ctx)) e.shield = Math.max(0, e.shield - (e.maxShield * a.pct) / 100);
      break;
    case 'vfx': {
      const def = resolveVfx(ctx.rt, a.effect);
      const [x, y] = resolvePoint(w, a.at, ctx);
      const [x2, y2] = a.to ? resolvePoint(w, a.to, ctx) : [x, y];
      const tint = a.color ? resolveColor(a.color, ctx.rt.colors, DAMAGE_COLORS[ctx.dtype], ctx.rt.colors.base) : null;
      emitVfx(w, def, ctx, x, y, x2, y2, a.size ?? 1, tint, a.text ?? null);
      break;
    }
    case 'sound':
      if (w.fxOn) w.fx.push({ k: 'sound', preset: a.preset, pitch: a.pitch ?? 1, vol: 0.6 });
      break;
  }
}

export { removeStatusInst };
