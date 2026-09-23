// Projectiles, zones and drones: creation and per-tick update.

import type { World } from './world.ts';
import type { Drone, Enemy, ProjLook, ProjTplRT, Projectile, SpecRuntime, Tower, Zone, ZoneTplRT } from './types.ts';
import type { Motion } from '../effects/types.ts';
import { type Ctx, evalValue, makeCtx, runActions, dispatch, towerEvent } from '../effects/runtime.ts';
import { applyStatus, dealDamage, pathOf } from './combat.ts';
import { BUILTIN_STATUS_DEFS } from './statuses.ts';
import { DAMAGE_COLORS } from '../content/colors.ts';
import { clamp, dist2, segDist2, TAU, turnToward } from './math.ts';
import { RULES } from '../content/rules.ts';

const tmp = { x: 0, y: 0, ang: 0 };

export function canHit(w: World, e: Enemy, hitsAir: boolean, hitsGround: boolean): boolean {
  if (!e.alive || e.burrowed) return false;
  if (e.air ? !hitsAir : !hitsGround) return false;
  if (e.traitSet.has('stealth') && e.revealedUntil <= w.tick) return false;
  return true;
}

function nearestPath(w: World, x: number, y: number): { idx: number; d: number } {
  let best = 0;
  let bestDist = Infinity;
  let bestD = 0;
  w.paths.forEach((p, i) => {
    const d = p.project(x, y);
    p.at(d, tmp);
    const dd = dist2(tmp.x, tmp.y, x, y);
    if (dd < bestDist) {
      bestDist = dd;
      best = i;
      bestD = d;
    }
  });
  return { idx: best, d: bestD };
}

export interface ProjInit {
  tower: Tower | null;
  rt: SpecRuntime | null;
  x: number;
  y: number;
  ang: number;
  target: Enemy | null;
  motion: Motion;
  speed: number;
  radius: number;
  life: number;
  damage: number;
  dtype: Projectile['dtype'];
  pierce: number;
  bounce: number;
  splash: number;
  hitsAir: boolean;
  hitsGround: boolean;
  depth: number;
  isBase: boolean;
  procCoef: number;
  crit: boolean;
  tpl: ProjTplRT | null;
  look: ProjLook;
  applyStatus: string | null;
  dmgBase: number;
  potency: number;
  aimMode?: string;
  hostId?: number;
}

export function makeProjectile(w: World, o: ProjInit): Projectile | null {
  const p: Projectile = {
    id: w.nextId++, tower: o.tower?.id ?? 0, alive: true, x: o.x, y: o.y, px: o.x, py: o.y,
    vx: Math.cos(o.ang) * o.speed, vy: Math.sin(o.ang) * o.speed, speed: o.speed, motion: o.motion, age: 0, life: o.life,
    radius: o.radius, targetId: o.target?.id ?? 0, damage: o.damage, dtype: o.dtype, pierce: o.pierce, bounce: o.bounce,
    splash: o.splash, hitsAir: o.hitsAir, hitsGround: o.hitsGround, hit: [], depth: o.depth, isBase: o.isBase,
    procCoef: o.procCoef, crit: o.crit, tpl: o.tpl, rt: o.rt, ox: o.x, oy: o.y, ang: o.ang, t: 0, returning: false,
    tx: o.x, ty: o.y, height: 0, pathIdx: 0, pathDist: 0, applyStatus: o.applyStatus, dmgBase: o.dmgBase,
    potency: o.potency, hostId: o.hostId ?? o.tower?.id ?? 0, look: o.look,
  };
  const host = o.hostId ? w.towerById.get(o.hostId) ?? o.tower : o.tower;
  switch (o.motion) {
    case 'lob': {
      let tx = o.x + Math.cos(o.ang) * 1.5;
      let ty = o.y + Math.sin(o.ang) * 1.5;
      if (o.target) {
        const flight = clamp(Math.sqrt(dist2(o.target.x, o.target.y, o.x, o.y)) / Math.max(1, o.speed), 0.45, 1.4);
        p.life = o.isBase ? o.life : flight;
        const e = o.target;
        pathOf(w, e).at(e.dist + e.speed * e.moveMult * p.life * (e.hardCC ? 0 : 1), tmp);
        tx = tmp.x;
        ty = tmp.y;
      } else if (o.aimMode === 'random') {
        const r = 0.8 + w.rng.next();
        tx = o.x + Math.cos(o.ang) * r;
        ty = o.y + Math.sin(o.ang) * r;
        p.life = 0.55;
      }
      p.tx = tx;
      p.ty = ty;
      break;
    }
    case 'sky_drop': {
      let tx = o.x, ty = o.y;
      if (o.target) {
        tx = o.target.x;
        ty = o.target.y;
      } else if (host) {
        const pool = w.hash.query(host.x, host.y, host.stats.range, 0.5).filter((e) => canHit(w, e, o.hitsAir, true));
        if (pool.length) {
          const e = w.rng.pick(pool);
          tx = e.x;
          ty = e.y;
        } else {
          const a = w.rng.next() * TAU;
          const r = host.stats.range * Math.sqrt(w.rng.next());
          tx = host.x + Math.cos(a) * r;
          ty = host.y + Math.sin(a) * r;
        }
      }
      p.x = p.px = p.tx = tx;
      p.y = p.py = p.ty = ty;
      p.life = 0.55;
      break;
    }
    case 'mine':
    case 'path_crawl': {
      const np = nearestPath(w, o.x, o.y);
      p.pathIdx = np.idx;
      p.pathDist = np.d;
      w.paths[np.idx].at(np.d, tmp);
      p.x = p.px = tmp.x;
      p.y = p.py = tmp.y;
      p.hitsAir = false;
      break;
    }
    case 'orbit':
      p.t = o.ang;
      p.hostId = host?.id ?? 0;
      break;
    case 'boomerang':
      p.hostId = host?.id ?? 0;
      break;
    case 'hitscan': {
      const len = host ? host.stats.range : 5;
      const x2 = o.x + Math.cos(o.ang) * len;
      const y2 = o.y + Math.sin(o.ang) * len;
      const hits: Enemy[] = [];
      for (const e of w.hash.query((o.x + x2) / 2, (o.y + y2) / 2, len / 2 + 0.2, 0.8)) {
        if (!canHit(w, e, o.hitsAir, o.hitsGround)) continue;
        const r = e.size + 0.12;
        if (segDist2(e.x, e.y, o.x, o.y, x2, y2) <= r * r) hits.push(e);
      }
      hits.sort((a, b) => dist2(a.x, a.y, o.x, o.y) - dist2(b.x, b.y, o.x, o.y));
      if (w.fxOn) {
        const beam = o.look.beam ?? { style: 'solid' as const, width: [0.1, 0.06] as [number, number], color: 'base', core: '#ffffff', glow: true, duration: 0.18 };
        w.fx.push({ k: 'beam', x1: o.x, y1: o.y, x2, y2, look: beam, colors: o.rt?.colors ?? w.defaultColors, dcolor: DAMAGE_COLORS[o.dtype], dur: beam.duration ?? 0.18 });
      }
      const n = Math.min(hits.length, 1 + o.pierce + 4);
      for (let i = 0; i < n; i++) projHit(w, p, hits[i]);
      p.x = x2;
      p.y = y2;
      endProjectile(w, p);
      return null;
    }
  }
  if (!o.isBase && o.tower) o.tower.liveSpawns++;
  w.projectiles.push(p);
  return p;
}

/** Spawn a projectile from a template (fire_projectile action). */
export function spawnProjectile(w: World, tpl: ProjTplRT, ctx: Ctx, x: number, y: number, ang: number, target: Enemy | null, aimMode: string): void {
  makeProjectile(w, {
    tower: ctx.owner, rt: ctx.rt, x, y, ang, target, motion: tpl.motion, speed: tpl.speed, radius: tpl.size * tpl.look.size,
    life: tpl.lifetime, damage: Math.max(0, evalValue(tpl.amount, ctx, target)), dtype: tpl.type ?? ctx.dtype,
    pierce: tpl.pierce, bounce: tpl.bounce, splash: tpl.splash, hitsAir: tpl.hitsAir, hitsGround: true,
    depth: ctx.depth + 1, isBase: false, procCoef: 1, crit: false, tpl, look: tpl.look, applyStatus: null,
    dmgBase: ctx.dmgBase, potency: ctx.potency, aimMode, hostId: ctx.host?.id,
  });
}

function projCtx(w: World, p: Projectile, target: Enemy | null): Ctx | null {
  if (!p.rt) return null;
  const owner = w.towerById.get(p.tower) ?? null;
  const host = w.towerById.get(p.hostId) ?? owner;
  const ctx = makeCtx(w, p.rt, owner, { target, px: p.x, py: p.y, depth: p.depth, host: host ?? undefined, aim: Math.atan2(p.vy, p.vx) }, null, 'projectile');
  ctx.potency = p.potency;
  ctx.dmgBase = p.dmgBase;
  return ctx;
}

function projHit(w: World, p: Projectile, e: Enemy, mult = 1): void {
  p.hit.push(e.id);
  const t = w.towerById.get(p.tower) ?? null;
  dealDamage(w, e, p.damage * mult, p.dtype, { tower: t, isHit: true, depth: p.depth });
  if (p.applyStatus && t) {
    const def = BUILTIN_STATUS_DEFS[p.applyStatus];
    if (def) applyStatus(w, e, def, 1, undefined, t.rt ? makeCtx(w, t.rt, t, { depth: p.depth }, null, 'chassis') : chassisCtx(w, t));
  }
  if (w.fxOn && p.look.impact) {
    w.fx.push({ k: 'hit', x: e.x, y: e.y, vfx: p.look.impact, colors: p.rt?.colors ?? w.defaultColors, dcolor: DAMAGE_COLORS[p.dtype], size: 1 });
  } else if (w.fxOn && p.isBase) {
    w.fx.push({ k: 'hit', x: p.x, y: p.y, vfx: null, colors: p.rt?.colors ?? w.defaultColors, dcolor: p.look.color, size: p.radius });
  }
  if (t) {
    const init = { target: e, px: e.x, py: e.y, depth: p.depth, procCoef: p.procCoef, aim: Math.atan2(p.vy, p.vx) };
    towerEvent(w, t, 'on_hit', init);
    if (p.crit) towerEvent(w, t, 'on_crit', init);
  }
  if (p.tpl?.onHit) {
    const ctx = projCtx(w, p, e);
    if (ctx) runActions(w, p.tpl.onHit, ctx);
  }
}

function explode(w: World, p: Projectile, x: number, y: number): void {
  const r = Math.max(0.2, p.splash);
  for (const e of w.hash.query(x, y, r, 0.8)) {
    if (!canHit(w, e, p.hitsAir, p.hitsGround)) continue;
    const rr = r + e.size * 0.6;
    if (dist2(e.x, e.y, x, y) <= rr * rr) projHit(w, p, e);
  }
  if (w.fxOn) {
    w.fx.push({ k: 'boom', x, y, r, vfx: p.look.impact, colors: p.rt?.colors ?? w.defaultColors, dcolor: p.look.color });
  }
}

export function endProjectile(w: World, p: Projectile): void {
  if (!p.alive) return;
  p.alive = false;
  const owner = w.towerById.get(p.tower) ?? null;
  if (!p.isBase && owner) owner.liveSpawns = Math.max(0, owner.liveSpawns - 1);
  if (p.tpl?.onEnd) {
    const ctx = projCtx(w, p, null);
    if (ctx) runActions(w, p.tpl.onEnd, ctx);
  }
  if (p.tpl && owner?.rt?.byEvent.has('on_projectile_end')) {
    dispatch(w, owner, 'on_projectile_end', { target: null, px: p.x, py: p.y, depth: p.depth, projectileId: p.tpl.id });
  }
}

function findNear(w: World, x: number, y: number, r: number, p: Projectile): Enemy | null {
  let best: Enemy | null = null;
  let bd = r * r;
  for (const e of w.hash.query(x, y, r, 0.5)) {
    if (p.hit.includes(e.id) || !canHit(w, e, p.hitsAir, p.hitsGround)) continue;
    const d = dist2(e.x, e.y, x, y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

export function updateProjectiles(w: World, dt: number): void {
  for (const p of w.projectiles) {
    if (!p.alive) continue;
    p.px = p.x;
    p.py = p.y;
    p.age += dt;
    switch (p.motion) {
      case 'straight':
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        break;
      case 'homing': {
        let t = p.targetId ? w.enemyById.get(p.targetId) : undefined;
        if (!t || !canHit(w, t, p.hitsAir, p.hitsGround)) {
          const n = findNear(w, p.x, p.y, 1.8, p);
          p.targetId = n ? n.id : 0;
          t = n ?? undefined;
        }
        if (t) {
          const a = turnToward(Math.atan2(p.vy, p.vx), Math.atan2(t.y - p.y, t.x - p.x), 14 * dt);
          p.vx = Math.cos(a) * p.speed;
          p.vy = Math.sin(a) * p.speed;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        break;
      }
      case 'boomerang': {
        if (!p.returning && p.age >= p.life * 0.5) {
          p.returning = true;
          p.hit.length = 0;
        }
        if (p.returning) {
          const h = w.towerById.get(p.hostId);
          const hx = h?.x ?? p.ox, hy = h?.y ?? p.oy;
          const a = turnToward(Math.atan2(p.vy, p.vx), Math.atan2(hy - p.y, hx - p.x), 9 * dt);
          p.vx = Math.cos(a) * p.speed;
          p.vy = Math.sin(a) * p.speed;
          if (dist2(p.x, p.y, hx, hy) < 0.09) p.age = p.life;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.t += dt * 12;
        break;
      }
      case 'orbit': {
        const h = w.towerById.get(p.hostId);
        if (!h) {
          p.age = p.life;
          break;
        }
        p.t += (p.speed / 1.2) * dt;
        p.x = h.x + Math.cos(p.t) * 1.2;
        p.y = h.y + Math.sin(p.t) * 1.2;
        p.vx = -Math.sin(p.t);
        p.vy = Math.cos(p.t);
        if (Math.floor(p.age / 0.6) !== Math.floor((p.age - dt) / 0.6)) p.hit.length = 0;
        break;
      }
      case 'spiral': {
        p.t += dt;
        const r = p.speed * p.t * 0.6;
        const a = p.ang + p.t * 3;
        p.x = p.ox + Math.cos(a) * r;
        p.y = p.oy + Math.sin(a) * r;
        p.vx = Math.cos(a + Math.PI / 2);
        p.vy = Math.sin(a + Math.PI / 2);
        break;
      }
      case 'sine': {
        p.t += dt;
        const f = p.speed * p.t;
        const l = 0.35 * Math.sin(p.t * 9);
        p.x = p.ox + Math.cos(p.ang) * f - Math.sin(p.ang) * l;
        p.y = p.oy + Math.sin(p.ang) * f + Math.cos(p.ang) * l;
        break;
      }
      case 'lob': {
        const k = Math.min(1, p.age / p.life);
        p.x = p.ox + (p.tx - p.ox) * k;
        p.y = p.oy + (p.ty - p.oy) * k;
        p.height = Math.sin(Math.PI * k) * 1.2;
        if (k >= 1) {
          explode(w, p, p.tx, p.ty);
          endProjectile(w, p);
        }
        continue;
      }
      case 'sky_drop': {
        p.height = Math.max(0, 1 - p.age / 0.5) * 3;
        if (p.age >= 0.5) {
          explode(w, p, p.tx, p.ty);
          endProjectile(w, p);
        }
        continue;
      }
      case 'path_crawl': {
        p.pathDist -= p.speed * dt;
        const path = w.paths[p.pathIdx];
        path.at(p.pathDist, tmp);
        p.x = tmp.x;
        p.y = tmp.y;
        p.vx = -Math.cos(tmp.ang);
        p.vy = -Math.sin(tmp.ang);
        if (p.pathDist <= 0) p.age = p.life;
        break;
      }
      case 'mine': {
        if (Math.floor(p.age * 6) !== Math.floor((p.age - dt) * 6)) {
          for (const e of w.hash.query(p.x, p.y, 0.8, 0.6)) {
            if (!canHit(w, e, false, true)) continue;
            const r = e.size + Math.max(0.3, p.radius);
            if (dist2(e.x, e.y, p.x, p.y) <= r * r) {
              if (p.splash > 0) explode(w, p, p.x, p.y);
              else projHit(w, p, e);
              endProjectile(w, p);
              break;
            }
          }
        }
        if (p.alive && p.age >= p.life) endProjectile(w, p);
        continue;
      }
      default:
        break;
    }
    if (p.age >= p.life) {
      if (p.splash > 0 && p.motion !== 'orbit') explode(w, p, p.x, p.y);
      endProjectile(w, p);
      continue;
    }
    if (p.x < -4 || p.y < -4 || p.x > w.cols + 4 || p.y > w.rows + 4) {
      endProjectile(w, p);
      continue;
    }
    // Collision
    for (const e of w.hash.query(p.x, p.y, p.radius + 0.9)) {
      if (p.hit.includes(e.id) || !canHit(w, e, p.hitsAir, p.hitsGround)) continue;
      const r = e.size + p.radius;
      if (dist2(e.x, e.y, p.x, p.y) > r * r) continue;
      if (p.splash > 0 && p.motion !== 'orbit' && p.motion !== 'path_crawl') {
        explode(w, p, p.x, p.y);
        endProjectile(w, p);
        break;
      }
      projHit(w, p, e);
      if (p.motion === 'orbit' || p.motion === 'boomerang' || p.motion === 'path_crawl') {
        if (p.hit.length > 40) p.hit.length = 0;
        continue;
      }
      if (--p.pierce < 0) {
        if (p.bounce > 0) {
          const n = findNear(w, p.x, p.y, 2.5, p);
          if (n) {
            p.bounce--;
            p.pierce = 0;
            p.targetId = n.id;
            p.motion = 'homing';
            const a = Math.atan2(n.y - p.y, n.x - p.x);
            p.vx = Math.cos(a) * p.speed;
            p.vy = Math.sin(a) * p.speed;
            p.age = Math.min(p.age, p.life * 0.5);
            break;
          }
        }
        endProjectile(w, p);
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ zones

export function spawnZone(w: World, tpl: ZoneTplRT, ctx: Ctx, x: number, y: number): void {
  let pathIdx = 0, pathDist = 0;
  if (tpl.shape === 'path_segment') {
    const np = nearestPath(w, x, y);
    pathIdx = np.idx;
    pathDist = np.d;
    w.paths[np.idx].at(np.d, tmp);
    x = tmp.x;
    y = tmp.y;
  }
  const z: Zone = {
    id: w.nextId++, tower: ctx.owner?.id ?? 0, alive: true, x, y, life: tpl.duration, age: 0,
    followId: tpl.follows === 'target' ? ctx.target?.id ?? 0 : tpl.follows === 'self' ? -(ctx.host?.id ?? 0) : 0,
    tickTimer: 0, tpl, rt: ctx.rt, inside: new Set(), depth: ctx.depth + 1, pathIdx, pathDist,
    potency: ctx.potency, dmgBase: ctx.dmgBase,
  };
  if (ctx.owner) ctx.owner.liveSpawns++;
  w.zones.push(z);
}

function zoneCtx(w: World, z: Zone, target: Enemy | null): Ctx {
  const owner = w.towerById.get(z.tower) ?? null;
  const ctx = makeCtx(w, z.rt, owner, { target, px: z.x, py: z.y, depth: z.depth }, null, 'zone');
  ctx.potency = z.potency;
  ctx.dmgBase = z.dmgBase;
  return ctx;
}

function inZone(w: World, z: Zone, e: Enemy): boolean {
  const d2 = dist2(e.x, e.y, z.x, z.y);
  const r = z.tpl.radius;
  if (z.tpl.shape === 'path_segment') {
    if (e.air) return false;
    const rr = r + 0.45;
    return d2 <= rr * rr;
  }
  if (z.tpl.shape === 'ring') {
    const d = Math.sqrt(d2);
    return Math.abs(d - r) <= 0.35 + e.size * 0.5;
  }
  const rr = r + e.size * 0.5;
  return d2 <= rr * rr;
}

export function updateZones(w: World, dt: number): void {
  for (const e of w.enemies) {
    e.zoneSpeed = 1;
    e.zoneDmg = 1;
  }
  for (const z of w.zones) {
    if (!z.alive) continue;
    z.age += dt;
    if (z.followId > 0) {
      const t = w.enemyById.get(z.followId);
      if (t && t.alive) {
        z.x = t.x;
        z.y = t.y;
      }
    } else if (z.followId < 0) {
      const h = w.towerById.get(-z.followId);
      if (h) {
        z.x = h.x;
        z.y = h.y;
      }
    }
    const now = new Set<number>();
    for (const e of w.hash.query(z.x, z.y, z.tpl.radius + 0.9, 0.5)) {
      if (!e.alive || e.burrowed && z.tpl.shape !== 'path_segment') continue;
      if (!inZone(w, z, e)) continue;
      now.add(e.id);
      if (z.tpl.speedMult !== 1) e.zoneSpeed = Math.min(e.zoneSpeed, z.tpl.speedMult);
      if (z.tpl.dmgTakenMult !== 1) e.zoneDmg *= z.tpl.dmgTakenMult;
      if (!z.inside.has(e.id) && z.tpl.onEnter) runActions(w, z.tpl.onEnter, zoneCtx(w, z, e));
    }
    if (z.tpl.onExit) {
      for (const id of z.inside) {
        if (!now.has(id)) {
          const e = w.enemyById.get(id);
          if (e && e.alive) runActions(w, z.tpl.onExit, zoneCtx(w, z, e));
        }
      }
    }
    z.inside = now;
    if (z.tpl.tick) {
      z.tickTimer += dt;
      if (z.tickTimer >= z.tpl.tick.every) {
        z.tickTimer -= z.tpl.tick.every;
        let n = 0;
        for (const id of now) {
          const e = w.enemyById.get(id);
          if (!e || !e.alive) continue;
          runActions(w, z.tpl.tick.do, zoneCtx(w, z, e));
          if (++n >= 25) break;
        }
      }
    }
    if (z.age >= z.life) {
      z.alive = false;
      const owner = w.towerById.get(z.tower);
      if (owner) owner.liveSpawns = Math.max(0, owner.liveSpawns - 1);
    }
  }
}

// ------------------------------------------------------------------ drones

export function spawnDrone(w: World, ctx: Ctx, lifetime: number, damage: number): void {
  const h = ctx.host ?? ctx.owner;
  if (!h) return;
  const a = w.rng.next() * TAU;
  const d: Drone = {
    id: w.nextId++, tower: ctx.owner?.id ?? h.id, alive: true, x: h.x + Math.cos(a) * 0.3, y: h.y + Math.sin(a) * 0.3,
    px: h.x, py: h.y, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, angle: a, targetId: 0, sting: 0, life: lifetime,
    damage, isBase: false, depth: ctx.depth + 1, color: ctx.rt.colors.base, phase: w.rng.next() * TAU,
  };
  if (ctx.owner) ctx.owner.liveSpawns++;
  w.drones.push(d);
}

export function spawnBaseDrone(w: World, t: Tower): void {
  const a = w.rng.next() * TAU;
  const d: Drone = {
    id: w.nextId++, tower: t.id, alive: true, x: t.x, y: t.y, px: t.x, py: t.y, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2,
    angle: a, targetId: 0, sting: 0.3, life: Infinity, damage: 0, isBase: true, depth: 0, color: t.look.color,
    phase: w.rng.next() * TAU,
  };
  t.drones.push(d.id);
  w.drones.push(d);
}

export function chassisCtx(w: World, t: Tower): Ctx {
  return makeCtx(w, w.emptyRt, t, { depth: 0 }, null, 'chassis');
}

export function updateDrones(w: World, dt: number, onBaseSting: (t: Tower, d: Drone, e: Enemy) => void): void {
  for (const d of w.drones) {
    if (!d.alive) continue;
    d.px = d.x;
    d.py = d.y;
    const t = w.towerById.get(d.tower);
    if (!t) {
      d.alive = false;
      continue;
    }
    if (!d.isBase) {
      d.life -= dt;
      if (d.life <= 0) {
        d.alive = false;
        t.liveSpawns = Math.max(0, t.liveSpawns - 1);
        continue;
      }
    }
    d.sting -= dt;
    const leash = d.isBase ? t.stats.range + 0.4 : 5;
    let target = d.targetId ? w.enemyById.get(d.targetId) : undefined;
    const valid = (e: Enemy | undefined): e is Enemy =>
      !!e && canHit(w, e, true, true) && (d.isBase ? dist2(e.x, e.y, t.x, t.y) <= leash * leash : true);
    if (!valid(target) || w.tick % 30 === d.id % 30) {
      let best: Enemy | undefined;
      let bd = Infinity;
      const cx = d.isBase ? t.x : d.x, cy = d.isBase ? t.y : d.y;
      for (const e of w.hash.query(cx, cy, leash, 0.5)) {
        if (!valid(e)) continue;
        const dd = dist2(e.x, e.y, d.x, d.y);
        if (dd < bd) {
          bd = dd;
          best = e;
        }
      }
      target = best;
      d.targetId = best?.id ?? 0;
    }
    const disabled = w.tick < t.disabledUntil;
    let gx: number, gy: number;
    if (target && !disabled) {
      gx = target.x;
      gy = target.y;
    } else {
      const a = w.time * 1.6 + d.phase;
      gx = t.x + Math.cos(a) * 0.75;
      gy = t.y + Math.sin(a) * 0.75;
    }
    const speed = d.isBase ? 4.5 : 5;
    const dx = gx - d.x, dy = gy - d.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, 7 * dt);
    d.vx += ((dx / len) * speed - d.vx) * k;
    d.vy += ((dy / len) * speed - d.vy) * k;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.angle = Math.atan2(d.vy, d.vx);
    if (target && !disabled && d.sting <= 0) {
      const r = target.size + 0.2;
      if (dist2(target.x, target.y, d.x, d.y) <= r * r) {
        if (d.isBase) {
          d.sting = 1 / Math.max(0.2, t.stats.rate);
          onBaseSting(t, d, target);
        } else {
          d.sting = 0.5;
          dealDamage(w, target, d.damage, t.def.dtype === 'arcane' && t.def.chassis === 'aura' ? 'arcane' : t.def.dtype, { tower: t, isHit: true, depth: d.depth });
          towerEvent(w, t, 'on_hit', { target, px: target.x, py: target.y, depth: d.depth, procCoef: 0.5, aim: d.angle });
        }
      }
    }
  }
}

export { RULES };
