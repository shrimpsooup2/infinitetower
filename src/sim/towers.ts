// Tower stats, targeting and the 8 chassis attack behaviours.

import type { World } from './world.ts';
import type { Drone, Enemy, Tower, TowerStats } from './types.ts';
import { dispatch, dispatchNth, dispatchConduits, fireRule, makeCtx, resolveVfx, towerEvent } from '../effects/runtime.ts';
import { applyStatus, dealDamage, pathOf } from './combat.ts';
import { makeProjectile, spawnBaseDrone, chassisCtx, canHit } from './entities.ts';
import { BUILTIN_STATUS_DEFS } from './statuses.ts';
import { ATTACK_EVENT_MIN } from '../content/towers.ts';
import { DAMAGE_COLORS } from '../content/colors.ts';
import { angleDiff, dist2, segDist2, turnToward } from './math.ts';
import { RULES } from '../content/rules.ts';

const TICKS = RULES.tickRate;
const tmp = { x: 0, y: 0, ang: 0 };

export function baseStats(t: Tower): TowerStats {
  const d = t.def;
  const i = t.tier - 1;
  return {
    damage: d.damage[i],
    rate: d.rate[i],
    range: d.range[i],
    splash: d.splash?.[i] ?? 0,
    multishot: 0,
    pierce: 0,
    bounce: 0,
    chains: d.chains?.[i] ?? 0,
    critChance: 0,
    critMult: 2,
    drones: d.drones?.[i] ?? 0,
    auraRate: d.auraRate?.[i] ?? 0,
    auraRange: d.auraRange?.[i] ?? 0,
  };
}

function applySpecStats(s: TowerStats, t: Tower, strength: number): void {
  const st = t.rt?.spec.stats;
  if (!st) return;
  const pot = Math.min(1.5, t.rt!.potency) * strength;
  if (st.damage_mult !== undefined) s.damage *= Math.max(0.2, 1 + (st.damage_mult - 1) * pot);
  if (st.rate_mult !== undefined) s.rate *= Math.max(0.2, 1 + (st.rate_mult - 1) * pot);
  if (st.range_mult !== undefined) s.range *= 1 + (st.range_mult - 1) * strength;
  if (strength < 1) {
    if (st.crit_chance) s.critChance += st.crit_chance * strength;
    if (st.crit_mult) s.critMult = Math.max(s.critMult, st.crit_mult);
    return;
  }
  if (st.splash_mult !== undefined) s.splash *= st.splash_mult;
  s.multishot += st.multishot ?? 0;
  s.pierce += st.pierce ?? 0;
  s.bounce += st.bounce ?? 0;
  s.chains += st.chains ?? 0;
  s.critChance += (st.crit_chance ?? 0) * Math.min(1.25, pot);
  if (st.crit_mult) s.critMult = Math.max(s.critMult, st.crit_mult);
}

export function computeAllStats(w: World): void {
  const beacons = w.towers.filter((b) => b.def.chassis === 'aura');
  for (const t of w.towers) {
    const s = baseStats(t);
    t.conduits = [];
    t.aura = 0;
    if (t.def.chassis !== 'aura') {
      applySpecStats(s, t, 1);
      let best: Tower | null = null;
      for (const b of beacons) {
        if (w.tick < b.disabledUntil) continue;
        const r = b.stats.range || b.def.range[b.tier - 1];
        if (dist2(b.x, b.y, t.x, t.y) > r * r) continue;
        if (!best || b.def.auraRate![b.tier - 1] > best.def.auraRate![best.tier - 1]) best = b;
        if (b.rt && t.conduits.length < 3) t.conduits.push(b);
      }
      if (best) {
        const bi = best.tier - 1;
        s.rate *= 1 + best.def.auraRate![bi];
        s.range *= 1 + best.def.auraRange![bi];
        t.aura = best.def.auraRate![bi];
        if (best.rt) applySpecStats(s, best, 0.5);
      }
      // Pierce / bounce mean something different per chassis.
      const extra = s.pierce + s.bounce;
      switch (t.def.chassis) {
        case 'chain':
          s.chains += Math.floor(s.pierce / 2) + s.bounce;
          break;
        case 'lob':
          s.splash *= 1 + 0.1 * extra;
          break;
        case 'projectile':
          break;
        default:
          s.damage *= 1 + 0.08 * extra;
      }
    }
    if (t.mods.length) {
      t.mods = t.mods.filter((m) => m.until > w.tick);
      for (const m of t.mods) {
        if (m.stat === 'damage') s.damage *= m.mult;
        else if (m.stat === 'rate') s.rate *= m.mult;
        else s.range *= Math.min(1.6, m.mult);
      }
    }
    s.critChance = Math.min(0.9, s.critChance);
    s.range = Math.min(12, s.range);
    t.stats = s;
  }
}

export function isTargetable(w: World, e: Enemy, t: Tower): boolean {
  return canHit(w, e, t.def.hitsAir, t.def.hitsGround);
}

export function findTarget(w: World, t: Tower, exclude?: Set<number>): Enemy | null {
  const range = t.stats.range;
  const minR = t.def.minRange ?? 0;
  let best: Enemy | null = null;
  let bestScore = -Infinity;
  for (const e of w.hash.query(t.x, t.y, range, 1)) {
    if (exclude?.has(e.id) || !isTargetable(w, e, t)) continue;
    const d2 = dist2(e.x, e.y, t.x, t.y);
    const r = range + e.size * 0.5;
    if (d2 > r * r || (minR > 0 && d2 < minR * minR)) continue;
    let score: number;
    switch (t.targetMode) {
      case 'last': score = -(e.dist); break;
      case 'strong': score = e.hp + e.shield; break;
      case 'weak': score = -(e.hp + e.shield); break;
      case 'close': score = -d2; break;
      default: score = e.dist - pathOf(w, e).length; // closest to exit
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

// ------------------------------------------------------------------ hits

/** A hit from the tower's own chassis attack (or a base drone). */
export function chassisHit(w: World, t: Tower, e: Enemy, dmg: number, depth: number, aim: number): void {
  let crit = false;
  if (t.stats.critChance > 0 && w.rng.next() < t.stats.critChance) {
    crit = true;
    dmg *= t.stats.critMult;
  }
  dealDamage(w, e, dmg, t.def.dtype, { tower: t, isHit: true, depth });
  if (t.def.onHitStatus) {
    const def = BUILTIN_STATUS_DEFS[t.def.onHitStatus];
    applyStatus(w, e, def, 1, undefined, t.rt ? makeCtx(w, t.rt, t, { depth }, null, 'chassis') : chassisCtx(w, t));
  }
  if (w.fxOn) {
    const vfx = resolveVfx(t.rt, t.rt?.spec.visual?.impact);
    if (vfx || w.tick % 2 === 0) {
      w.fx.push({ k: 'hit', x: e.x, y: e.y, vfx, colors: t.rt?.colors ?? w.defaultColors, dcolor: t.look.color, size: 1 });
    }
    if (crit) w.fx.push({ k: 'text', x: e.x, y: e.y - e.size - 0.1, text: 'CRIT', color: '#ff5c5c' });
  }
  const init = { target: e, px: e.x, py: e.y, depth, procCoef: t.def.procCoef, aim };
  towerEvent(w, t, 'on_hit', init);
  if (crit) towerEvent(w, t, 'on_crit', init);
}

function emitAttack(w: World, t: Tower, target: Enemy, aim: number): void {
  const min = ATTACK_EVENT_MIN[t.def.chassis] ?? 0;
  if (min > 0 && (w.tick - t.lastAttackEventTick) / TICKS < min) return;
  t.lastAttackEventTick = w.tick;
  const init = { target, px: target.x, py: target.y, aim, depth: 0 };
  if (t.rt) {
    dispatch(w, t, 'on_attack', init);
    dispatchNth(w, t, init);
  }
  if (t.conduits.length) {
    dispatchConduits(w, t, 'on_attack', init);
    dispatchConduits(w, t, 'every_nth_attack', init);
  }
}

function muzzle(w: World, t: Tower, aim: number): void {
  t.recoil = 1;
  if (!w.fxOn) return;
  const spec = t.rt?.spec;
  w.fx.push({ k: 'shot', tower: t.id, x: t.x, y: t.y, ang: aim, sound: spec?.sound?.preset ?? DEFAULT_SOUND[t.def.chassis], pitch: spec?.sound?.pitch ?? 1 });
  const mv = resolveVfx(t.rt, spec?.visual?.muzzle);
  if (mv) {
    const r = 0.55;
    w.fx.push({
      k: 'vfx', def: mv, x: t.x + Math.cos(aim) * r, y: t.y + Math.sin(aim) * r, x2: t.x + Math.cos(aim) * (r + 1), y2: t.y + Math.sin(aim) * (r + 1),
      ang: aim, colors: t.rt!.colors, dcolor: DAMAGE_COLORS[t.def.dtype], size: 0.7, tint: null, text: null,
    });
  }
}

const DEFAULT_SOUND: Record<string, 'pew' | 'boom' | 'zap' | 'laser' | 'hiss' | 'thud'> = {
  projectile: 'pew', lob: 'thud', chain: 'zap', hitscan: 'laser', cone: 'hiss', beam: 'laser', aura: 'pew', drones: 'pew',
};

function fireBaseProjectile(w: World, t: Tower, target: Enemy, ang: number, mult: number): void {
  const d = t.def;
  const lob = d.chassis === 'lob';
  const motion = lob ? 'lob' : t.rt?.spec.attack?.motion ?? (d.id === 'cannon' ? 'straight' : 'homing');
  const speed = d.projectileSpeed ?? 8;
  const dd = Math.sqrt(dist2(target.x, target.y, t.x, t.y));
  let life = motion === 'straight' && t.stats.splash > 0 ? Math.max(0.1, dd / speed) : (t.stats.range / speed) * 1.6 + 0.3;
  if (motion === 'boomerang') life = (t.stats.range / speed) * 2.2;
  if (lob) life = d.flightTime ?? 1;
  let crit = false;
  let dmg = t.stats.damage * mult;
  if (!lob && t.stats.critChance > 0 && w.rng.next() < t.stats.critChance) {
    crit = true;
    dmg *= t.stats.critMult;
  }
  const r = 0.55;
  makeProjectile(w, {
    tower: t, rt: t.rt, x: t.x + Math.cos(ang) * r, y: t.y + Math.sin(ang) * r, ang, target, motion, speed,
    radius: (d.projRadius ?? 0.1) * t.look.size, life, damage: dmg, dtype: d.dtype, pierce: t.stats.pierce,
    bounce: t.stats.bounce, splash: t.stats.splash, hitsAir: d.hitsAir, hitsGround: d.hitsGround, depth: 0, isBase: true,
    procCoef: d.procCoef, crit, tpl: null, look: t.look, applyStatus: d.onHitStatus ?? null, dmgBase: t.stats.damage,
    potency: t.rt?.potency ?? 1,
  });
}

function chainAttack(w: World, t: Tower, first: Enemy, mult: number, aim: number): void {
  const n = Math.max(1, Math.round(t.stats.chains));
  const range = t.def.chainRange ?? 1.9;
  const seen = new Set<number>([first.id]);
  const chain: Enemy[] = [first];
  let cur = first;
  for (let i = 1; i < n; i++) {
    let best: Enemy | null = null;
    let bd = range * range;
    for (const e of w.hash.query(cur.x, cur.y, range, 0.5)) {
      if (seen.has(e.id) || !isTargetable(w, e, t)) continue;
      const d = dist2(e.x, e.y, cur.x, cur.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) break;
    seen.add(best.id);
    chain.push(best);
    cur = best;
  }
  if (w.fxOn) {
    const pts = [t.x, t.y];
    for (const e of chain) pts.push(e.x, e.y);
    const look = { style: 'lightning' as const, width: [0.1, 0.05] as [number, number], color: 'base', core: '#ffffff', glow: true, amplitude: 0.22, duration: 0.16, ...(t.rt?.spec.visual?.beam ?? {}) };
    w.fx.push({ k: 'beam', x1: t.x, y1: t.y, x2: cur.x, y2: cur.y, pts, look, colors: t.rt?.colors ?? w.defaultColors, dcolor: t.look.color, dur: look.duration ?? 0.16 });
  }
  chain.forEach((e, i) => chassisHit(w, t, e, t.stats.damage * mult * Math.pow(0.85, i), 0, aim));
}

function lineAttack(w: World, t: Tower, ang: number, mult: number): void {
  const len = t.stats.range;
  const x1 = t.x + Math.cos(ang) * 0.5, y1 = t.y + Math.sin(ang) * 0.5;
  const x2 = t.x + Math.cos(ang) * len, y2 = t.y + Math.sin(ang) * len;
  const hits: Enemy[] = [];
  for (const e of w.hash.query((x1 + x2) / 2, (y1 + y2) / 2, len / 2 + 0.2, 0.8)) {
    if (!isTargetable(w, e, t)) continue;
    const r = e.size + 0.12;
    if (segDist2(e.x, e.y, x1, y1, x2, y2) <= r * r) hits.push(e);
  }
  hits.sort((a, b) => dist2(a.x, a.y, t.x, t.y) - dist2(b.x, b.y, t.x, t.y));
  if (w.fxOn) {
    const look = { style: 'solid' as const, width: [0.14, 0.06] as [number, number], color: 'base', core: '#ffffff', glow: true, duration: 0.2, ...(t.rt?.spec.visual?.beam ?? {}) };
    w.fx.push({ k: 'beam', x1, y1, x2, y2, look, colors: t.rt?.colors ?? w.defaultColors, dcolor: t.look.color, dur: look.duration ?? 0.2 });
  }
  for (const e of hits) chassisHit(w, t, e, t.stats.damage * mult, 0, ang);
}

function coneTick(w: World, t: Tower, mult: number): void {
  const half = (((t.def.coneAngle ?? 55) + t.stats.multishot * 15) * Math.PI) / 360;
  const r = t.stats.range;
  for (const e of w.hash.query(t.x, t.y, r, 0.6)) {
    if (!isTargetable(w, e, t)) continue;
    const rr = r + e.size * 0.5;
    if (dist2(e.x, e.y, t.x, t.y) > rr * rr) continue;
    if (Math.abs(angleDiff(t.angle, Math.atan2(e.y - t.y, e.x - t.x))) > half + 0.15) continue;
    chassisHit(w, t, e, t.stats.damage * mult, 0, t.angle);
  }
}

function beamTick(w: World, t: Tower, mult: number): void {
  t.beamTargets.forEach((id, i) => {
    const e = w.enemyById.get(id);
    if (!e || !e.alive) return;
    chassisHit(w, t, e, t.stats.damage * mult * (i === 0 ? t.beamRamp : 1), 0, t.angle);
  });
}

/** Perform one attack. `isRepeat` attacks (from repeat_attack) don't fire on_attack triggers. */
export function towerAttack(w: World, t: Tower, target: Enemy | null, mult: number, isRepeat: boolean): boolean {
  if (!target || !target.alive || !isTargetable(w, target, t)) target = findTarget(w, t);
  if (!target) return false;
  const aim = Math.atan2(target.y - t.y, target.x - t.x);
  switch (t.def.chassis) {
    case 'projectile':
    case 'lob': {
      t.angle = aim;
      const n = 1 + t.stats.multishot;
      if (t.def.chassis === 'lob') {
        fireBaseProjectile(w, t, target, aim, mult);
        const others = w.hash.query(t.x, t.y, t.stats.range, 1).filter((e) => e !== target && isTargetable(w, e, t));
        for (let i = 1; i < n && others.length; i++) {
          const o = others.splice(w.rng.int(0, others.length - 1), 1)[0];
          fireBaseProjectile(w, t, o, Math.atan2(o.y - t.y, o.x - t.x), mult);
        }
      } else {
        const step = 0.16;
        for (let i = 0; i < n; i++) fireBaseProjectile(w, t, target, aim + (i - (n - 1) / 2) * step, mult);
      }
      if (t.def.id === 'frost' || t.tier >= 2) t.barrel = (t.barrel + 1) % 3;
      break;
    }
    case 'chain': {
      t.angle = aim;
      chainAttack(w, t, target, mult, aim);
      if (t.stats.multishot > 0) {
        const ex = new Set<number>([target.id]);
        for (let i = 0; i < t.stats.multishot; i++) {
          const o = findTarget(w, t, ex);
          if (!o) break;
          ex.add(o.id);
          chainAttack(w, t, o, mult * 0.7, aim);
        }
      }
      break;
    }
    case 'hitscan': {
      t.angle = aim;
      lineAttack(w, t, aim, mult);
      for (let i = 1; i <= t.stats.multishot; i++) lineAttack(w, t, aim + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.14, mult * 0.7);
      break;
    }
    case 'cone':
      coneTick(w, t, mult * 2.5);
      break;
    case 'beam':
      if (!t.beamTargets.length) t.beamTargets = [target.id];
      beamTick(w, t, mult * 2.5);
      break;
    case 'drones':
      for (const id of t.drones) {
        const d = w.drones.find((x) => x.id === id);
        const e = d?.targetId ? w.enemyById.get(d.targetId) : undefined;
        if (d && e && e.alive) chassisHit(w, t, e, t.stats.damage * mult, 0, d.angle);
      }
      break;
    case 'aura':
      return false;
  }
  if (!isRepeat) {
    t.attackCount++;
    t.lastAttackTick = w.tick;
    if (t.rt) for (const rr of t.rt.byEvent.get('on_idle') ?? []) rr.idleFired = false;
    if (t.def.chassis !== 'cone' && t.def.chassis !== 'beam') muzzle(w, t, aim);
    emitAttack(w, t, target, aim);
  } else if (w.fxOn && t.def.chassis !== 'cone' && t.def.chassis !== 'beam') {
    muzzle(w, t, aim);
  }
  return true;
}

// ------------------------------------------------------------------ per-tick update

function baseSting(w: World, t: Tower, d: Drone, e: Enemy): void {
  chassisHit(w, t, e, t.stats.damage, 0, d.angle);
  t.lastAttackTick = w.tick;
  t.attackCount++;
  emitAttack(w, t, e, d.angle);
}

export { baseSting };

function anyInRange(w: World, t: Tower): boolean {
  const r = t.stats.range;
  for (const e of w.hash.query(t.x, t.y, r, 0.5)) {
    if (!e.alive || e.burrowed) continue;
    if (dist2(e.x, e.y, t.x, t.y) <= r * r) return true;
  }
  return false;
}

export function updateTowers(w: World, dt: number): void {
  // Beacons reveal stealth inside their aura.
  for (const b of w.towers) {
    if (b.def.chassis !== 'aura' || w.tick < b.disabledUntil) continue;
    for (const e of w.hash.query(b.x, b.y, b.stats.range, 0.3)) {
      if (dist2(e.x, e.y, b.x, b.y) <= b.stats.range * b.stats.range) e.revealedUntil = Math.max(e.revealedUntil, w.tick + 2);
    }
  }
  w.allyHitListeners = w.towers.filter((t) => t.rt?.byEvent.has('on_ally_hit'));

  for (const t of w.towers) {
    t.eventsThisTick = 0;
    t.recoil = Math.max(0, t.recoil - dt * 6);
    const disabled = w.tick < t.disabledUntil;
    const rt = t.rt;
    if (rt) {
      const idle = (w.tick - t.lastAttackTick) / TICKS;
      const everyRules = rt.byEvent.get('every');
      if (everyRules) {
        const near = anyInRange(w, t);
        for (const rr of everyRules) {
          if (!near) continue;
          rr.timer += dt;
          const sec = (rr.rule.when as { seconds: number }).seconds;
          if (rr.timer >= sec) {
            rr.timer -= sec;
            if (!disabled) fireRule(w, t, rr, { depth: 0 });
          }
        }
      }
      for (const rr of rt.byEvent.get('on_idle') ?? []) {
        if (!rr.idleFired && idle >= (rr.rule.when as { seconds: number }).seconds) {
          rr.idleFired = true;
          fireRule(w, t, rr, { depth: 0 });
        }
      }
      if (idle >= 1.5) {
        for (const [id, mode] of rt.varReset) if (mode === 'idle' && rt.vars.get(id)) rt.vars.set(id, 0);
      }
      if (rt.needsRangeTracking) {
        const now = new Set<number>();
        const r = t.stats.range;
        for (const e of w.hash.query(t.x, t.y, r, 0.5)) {
          if (!isTargetable(w, e, t) || dist2(e.x, e.y, t.x, t.y) > r * r) continue;
          now.add(e.id);
          if (!t.inRange?.has(e.id)) dispatch(w, t, 'on_enemy_enters_range', { target: e, depth: 0 });
        }
        if (t.inRange) {
          for (const id of t.inRange) {
            const e = w.enemyById.get(id);
            if (!now.has(id) && e && e.alive) dispatch(w, t, 'on_enemy_leaves_range', { target: e, depth: 0 });
          }
        }
        t.inRange = now;
      }
    }
    if (disabled) {
      t.beamTargets = [];
      t.coneOn = false;
      continue;
    }
    switch (t.def.chassis) {
      case 'aura':
        break;
      case 'drones': {
        t.drones = t.drones.filter((id) => w.drones.some((d) => d.id === id && d.alive));
        if (t.drones.length < t.stats.drones) {
          t.droneTimer -= dt;
          if (t.droneTimer <= 0) {
            spawnBaseDrone(w, t);
            t.droneTimer = 1.5;
          }
        } else {
          while (t.drones.length > t.stats.drones) {
            const id = t.drones.pop()!;
            const d = w.drones.find((x) => x.id === id);
            if (d) d.alive = false;
          }
        }
        break;
      }
      case 'beam': {
        let main = t.beamTargets.length ? w.enemyById.get(t.beamTargets[0]) : undefined;
        const r = t.stats.range + 0.3;
        if (!main || !isTargetable(w, main, t) || dist2(main.x, main.y, t.x, t.y) > r * r) {
          const nt = findTarget(w, t);
          if (!nt) {
            t.beamTargets = [];
            t.beamRamp = Math.max(1, t.beamRamp - dt * 2);
            break;
          }
          if (nt.id !== main?.id) t.beamRamp = 1;
          main = nt;
        }
        const ids = [main.id];
        if (t.stats.multishot > 0) {
          const ex = new Set(ids);
          for (let i = 0; i < t.stats.multishot; i++) {
            const o = findTarget(w, t, ex);
            if (!o) break;
            ex.add(o.id);
            ids.push(o.id);
          }
        }
        t.beamTargets = ids;
        t.angle = turnToward(t.angle, Math.atan2(main.y - t.y, main.x - t.x), 10 * dt);
        t.beamTimer -= dt;
        if (t.beamTimer <= 0) {
          t.beamTimer += 1 / Math.max(0.5, t.stats.rate);
          t.beamRamp = Math.min(3, t.beamRamp + 0.6 / Math.max(0.5, t.stats.rate));
          beamTick(w, t, 1);
          t.attackCount++;
          t.lastAttackTick = w.tick;
          if (t.rt) for (const rr of t.rt.byEvent.get('on_idle') ?? []) rr.idleFired = false;
          emitAttack(w, t, main, t.angle);
          if (w.fxOn && w.tick % 12 === 0) w.fx.push({ k: 'shot', tower: t.id, x: t.x, y: t.y, ang: t.angle, sound: t.rt?.spec.sound?.preset ?? 'laser', pitch: (t.rt?.spec.sound?.pitch ?? 1) * 0.8 });
        }
        break;
      }
      case 'cone': {
        const target = findTarget(w, t);
        if (!target) {
          t.coneOn = false;
          break;
        }
        t.coneOn = true;
        t.angle = turnToward(t.angle, Math.atan2(target.y - t.y, target.x - t.x), 7 * dt);
        t.beamTimer -= dt;
        if (t.beamTimer <= 0) {
          t.beamTimer += 1 / Math.max(0.5, t.stats.rate);
          coneTick(w, t, 1);
          t.attackCount++;
          t.lastAttackTick = w.tick;
          if (t.rt) for (const rr of t.rt.byEvent.get('on_idle') ?? []) rr.idleFired = false;
          emitAttack(w, t, target, t.angle);
          if (w.fxOn && w.tick % 15 === 0) w.fx.push({ k: 'shot', tower: t.id, x: t.x, y: t.y, ang: t.angle, sound: t.rt?.spec.sound?.preset ?? 'hiss', pitch: t.rt?.spec.sound?.pitch ?? 1 });
        }
        break;
      }
      default: {
        t.cooldown -= dt;
        const target = findTarget(w, t);
        if (target) {
          const want = Math.atan2(target.y - t.y, target.x - t.x);
          t.angle = turnToward(t.angle, want, 12 * dt);
          if (t.cooldown <= 0) {
            towerAttack(w, t, target, 1, false);
            t.cooldown = 1 / Math.max(0.1, t.stats.rate);
          }
        } else if (t.cooldown < 0) {
          t.cooldown = 0;
        }
      }
    }
  }
}

export { tmp };
