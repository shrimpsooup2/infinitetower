// Damage pipeline, statuses and path movement.

import type { World } from './world.ts';
import type { DamageType, Enemy, StatusDefRT, StatusInst, Tower } from './types.ts';
import type { Ctx } from '../effects/runtime.ts';
import { evalValue, dispatch, runActions, statusCtx } from '../effects/runtime.ts';
import { isCC } from './statuses.ts';
import { RULES } from '../content/rules.ts';

export interface DamageSrc {
  tower: Tower | null;
  isHit: boolean;
  depth: number;
}

const tmpPos = { x: 0, y: 0, ang: 0 };

export function pathOf(w: World, e: Enemy) {
  return e.air ? w.air[e.pathIdx] : w.paths[e.pathIdx];
}

export function updatePos(w: World, e: Enemy): void {
  const p = pathOf(w, e);
  p.at(e.dist, tmpPos);
  const nx = -Math.sin(tmpPos.ang);
  const ny = Math.cos(tmpPos.ang);
  e.x = tmpPos.x + nx * e.lateral;
  e.y = tmpPos.y + ny * e.lateral;
  e.heading = tmpPos.ang;
}

/** Move an enemy along its path by `delta` tiles (negative = back toward spawn). */
export function moveAlongPath(w: World, e: Enemy, delta: number): void {
  if (!e.alive) return;
  const p = pathOf(w, e);
  e.dist = Math.max(0, Math.min(p.length - 0.05, e.dist + delta));
  updatePos(w, e);
}

export function findStatus(e: Enemy, key: string): StatusInst | undefined {
  for (const s of e.statuses) if (s.def.key === key) return s;
  return undefined;
}

export function stacksOf(e: Enemy, key: string): number {
  return findStatus(e, key)?.stacks ?? 0;
}

export function killEnemy(w: World, e: Enemy, tower: Tower | null): void {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  e.killer = tower ? tower.id : 0;
  w.deathQueue.push(e);
}

export function dealDamage(w: World, e: Enemy, amount: number, type: DamageType, src: DamageSrc): number {
  if (!e.alive || !(amount > 0)) return 0;
  const t = src.tower;
  // Phantom: ignores the first N hits from each tower.
  if (src.isHit && t && e.phaseHits) {
    const n = e.phaseHits.get(t.id) ?? 0;
    const limit = e.def.abilities.find((a) => a.kind === 'phase')?.count ?? 3;
    if (n < limit) {
      e.phaseHits.set(t.id, n + 1);
      if (w.fxOn && n === 0) w.fx.push({ k: 'text', x: e.x, y: e.y - e.size, text: 'phase', color: '#e6e6ff' });
      return 0;
    }
  }
  // A hole in it (the toroid): some direct hits fly straight through.
  if (src.isHit && e.def.abilities.length) {
    const ev = e.def.abilities.find((x) => x.kind === 'evade');
    if (ev && w.rng.next() < (ev.amount ?? 0.3)) {
      if (w.fxOn) w.fx.push({ k: 'text', x: e.x, y: e.y - e.size, text: 'miss', color: '#e6e6ff' });
      return 0;
    }
  }
  if (e.immune === type) {
    if (w.fxOn && w.tick % 20 === 0) w.fx.push({ k: 'text', x: e.x, y: e.y - e.size, text: 'IMMUNE', color: '#dddddd' });
    return 0;
  }
  let a = amount;
  if (type !== 'arcane') a *= 1 - (e.resist[type] ?? 0);
  a *= e.dmgTakenMult;
  if (src.isHit) {
    const sh = findStatus(e, 'shock');
    if (sh) {
      a *= 1.5;
      removeStatusInst(w, e, sh, false);
    }
  }
  if (type === 'kinetic') {
    const armor = Math.max(0, e.armor + e.armorDelta);
    if (armor > 0) a = Math.max(a * 0.25, a - armor);
  }
  let dealt = 0;
  if (e.shield > 0) {
    const sMult = type === 'shock' ? 2 : 1;
    const absorbed = Math.min(e.shield, a * sMult);
    e.shield -= absorbed;
    a -= absorbed / sMult;
    dealt += absorbed / sMult;
  }
  if (a > 0) {
    for (const s of e.statuses) {
      if (s.def.storesDamage > 0) {
        const st = a * s.def.storesDamage;
        s.stored += st;
        a -= st;
      }
    }
    const real = Math.min(a, e.hp);
    e.hp -= a;
    dealt += real;
  }
  e.lastHitTick = w.tick;
  if (src.isHit) e.hitFlash = 5;
  if (e.mimicTally) e.mimicTally[type] = (e.mimicTally[type] ?? 0) + dealt;
  if (t) {
    t.dmgTotal += dealt;
    t.dmgWave += dealt;
    e.hitBy.add(t.id);
  }
  w.stats.damage += dealt;
  if (e.hp <= 0.0001) killEnemy(w, e, t);
  return dealt;
}

/** Apply a status. `ctx` is the applier's context (used for DoT amounts and triggers). */
export function applyStatus(
  w: World, e: Enemy, def: StatusDefRT, stacks: number, duration: number | undefined, ctx: Ctx | null,
): void {
  if (!e.alive) return;
  const cc = isCC(def);
  if (cc && w.tick < e.ccImmuneUntil) return;
  let n = Math.max(1, Math.round(stacks));
  let dur = duration ?? def.duration;
  if (cc) dur = Math.min(dur * Math.sqrt(ctx?.potency ?? 1), 4) * e.tenacity;
  if (def.key !== 'curse') {
    const curse = findStatus(e, 'curse');
    if (curse) {
      n *= 2;
      dur *= 2;
      removeStatusInst(w, e, curse, false);
    }
  }
  if (dur <= 0.05) return;
  const dotAmt = def.dot && ctx ? Math.max(0, evalValue(def.dot.amount, ctx, e)) : 0;
  const perTile = def.damagePerTile && ctx ? Math.max(0, evalValue(def.damagePerTile, ctx, e)) : 0;
  const source = ctx?.owner?.id ?? 0;
  let inst = findStatus(e, def.key);
  if (inst) {
    if (def.stacking === 'add') inst.stacks = Math.min(def.maxStacks, inst.stacks + n);
    inst.remaining = Math.max(inst.remaining, dur);
    inst.dotPerStack = Math.max(inst.dotPerStack, dotAmt);
    inst.perTile = Math.max(inst.perTile, perTile);
    inst.source = source || inst.source;
  } else {
    inst = {
      def, stacks: Math.min(def.maxStacks, def.stacking === 'add' ? n : 1), remaining: dur, source, tickTimer: 0, stored: 0,
      dotPerStack: dotAmt, perTile, potency: ctx?.potency ?? 1, dmgBase: ctx?.dmgBase ?? 10,
    };
    e.statuses.push(inst);
    if (def.onApply && def.owner) runActions(w, def.onApply, statusCtx(w, def, inst, e, 'status_apply'));
  }
  if (cc) refreshDerived(w, e);
  const owner = ctx?.owner;
  if (owner && owner.rt && ctx && ctx.depth < 3) {
    dispatch(w, owner, 'on_status_applied', { target: e, px: e.x, py: e.y, depth: ctx.depth + 1, statusKey: def.key });
  }
}

export function removeStatusInst(w: World, e: Enemy, inst: StatusInst, expired: boolean): void {
  const i = e.statuses.indexOf(inst);
  if (i < 0) return;
  e.statuses.splice(i, 1);
  const d = inst.def;
  if (isCC(d)) e.ccImmuneUntil = w.tick + Math.round(RULES.ccImmunity * RULES.tickRate);
  if (expired && d.onExpire && d.owner && e.alive) {
    runActions(w, d.onExpire, statusCtx(w, d, inst, e, 'status_expire'));
  }
  if (expired) {
    const owner = w.towerById.get(inst.source);
    if (owner && owner.rt) dispatch(w, owner, 'on_status_expired', { target: e, px: e.x, py: e.y, depth: 1, statusKey: d.key });
  }
}

export function removeStatus(w: World, e: Enemy, key: string): number {
  const inst = findStatus(e, key);
  if (!inst) return 0;
  removeStatusInst(w, e, inst, false);
  return inst.stacks;
}

/** Recompute speed / damage-taken / armor modifiers from statuses. */
export function refreshDerived(w: World, e: Enemy): void {
  let speed = 1;
  let dmg = 1;
  let armor = 0;
  let hard = false;
  let rev = false;
  let scale = e.shrunk ? 0.8 : 1;
  for (const s of e.statuses) {
    const d = s.def;
    const k = d.stacking === 'add' ? s.stacks : 1;
    // Potency (from the balance solver) scales how strong slows and amps are.
    const pf = Math.min(1.3, Math.sqrt(s.potency));
    if (d.speedMult < 1) speed *= Math.pow(1 - (1 - d.speedMult) * pf, k);
    else if (d.speedMult > 1) speed *= Math.pow(d.speedMult, k);
    if (d.dmgTakenMult !== 1) dmg *= 1 + (d.dmgTakenMult - 1) * pf * k;
    armor += d.armorDelta * k;
    if (d.hardCC) hard = true;
    if (d.reverse) rev = true;
    if (d.scale !== 1) scale *= d.scale;
  }
  speed *= e.zoneSpeed;
  dmg *= e.zoneDmg;
  const cap = e.traitSet.has('boss') ? RULES.bossSlowCap : RULES.slowCap;
  e.moveMult = Math.max(cap, Math.min(2, speed));
  e.dmgTakenMult = Math.max(0.25, Math.min(4, dmg));
  e.armorDelta = armor;
  e.hardCC = hard;
  e.reverse = rev && !hard;
  e.visScale = scale;
}

/** Tick statuses on an enemy: durations, DoTs, custom ticks, expiry. */
export function tickStatuses(w: World, e: Enemy, dt: number): void {
  for (let i = e.statuses.length - 1; i >= 0 && e.alive; i--) {
    const s = e.statuses[i];
    if (!s) continue;
    const d = s.def;
    s.remaining -= dt;
    if (d.dot && s.dotPerStack > 0) {
      s.tickTimer += dt;
      if (s.tickTimer >= 0.25) {
        const amt = s.dotPerStack * s.tickTimer * (d.stacking === 'add' ? s.stacks : 1);
        s.tickTimer = 0;
        const t = w.towerById.get(s.source) ?? null;
        dealDamage(w, e, amt, d.dot.type ?? 'kinetic', { tower: t, isHit: false, depth: 1 });
      }
    } else if (d.tick && d.owner) {
      s.tickTimer += dt;
      if (s.tickTimer >= d.tick.every) {
        s.tickTimer -= d.tick.every;
        runActions(w, d.tick.do, statusCtx(w, d, s, e, 'status_tick'));
      }
    }
    if (s.remaining <= 0 && e.alive) removeStatusInst(w, e, s, true);
  }
}
