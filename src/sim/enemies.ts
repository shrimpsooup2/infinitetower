// Enemy spawning, abilities and movement.

import type { World } from './world.ts';
import type { DamageType, Enemy, EnemyDef, SpawnMod } from './types.ts';
import { MOD_HP } from '../content/waves.ts';
import { ENEMY_BY_ID } from '../content/enemies.ts';
import { dealDamage, refreshDerived, tickStatuses, updatePos, pathOf } from './combat.ts';
import { BUILTIN_VFX } from '../effects/vfxlib.ts';
import { dist2 } from './math.ts';
import { RULES } from '../content/rules.ts';

const TICKS = RULES.tickRate;

export interface SpawnOpts {
  dist?: number;
  lateral?: number;
  hpFrac?: number;
  resist?: Partial<Record<DamageType, number>>;
  revived?: boolean;
  mods?: SpawnMod[];
}

export function spawnEnemy(w: World, defId: string, pathIdx: number, waveN: number, o: SpawnOpts = {}): Enemy | null {
  const def: EnemyDef | undefined = ENEMY_BY_ID.get(defId);
  if (!def) return null;
  const wave = w.getWave(Math.max(1, waveN));
  const mods = o.mods ?? [];
  const flying = def.traits.includes('flying') || mods.includes('flying');
  const paths = flying ? w.air : w.paths;
  let pi = pathIdx;
  if (pi < 0) pi = w.alternate++ % paths.length;
  pi = Math.min(paths.length - 1, Math.max(0, pi));
  const mut = wave.mutators;
  const modHp = mods.reduce((a, m) => a * MOD_HP[m], 1);
  let hp = def.hp * wave.hpMult * w.diff.hp * modHp;
  if (mut.includes('swarm')) hp *= 0.7;
  const armor = def.armor + (mut.includes('armored') ? 3 : 0);
  let shield = def.shield * wave.hpMult * w.diff.hp * (mods.includes('elite') ? 2 : 1);
  if (mut.includes('shielded')) shield += hp * 0.3;
  const speed = def.speed * (mut.includes('swift') ? 1.2 : 1) * (mods.includes('swift') ? 1.5 : 1) * (mods.includes('swarm') ? 1.12 : 1);
  const size = def.size * (mods.includes('swarm') ? 0.6 : 1) * (mods.includes('elite') ? 1.35 : 1);
  const bountyMult = mods.includes('swarm') ? 0.35 : mods.includes('elite') ? 3 : 1;
  const e: Enemy = {
    id: w.nextId++, def, alive: true, removed: false, pathIdx: pi, air: flying, dist: o.dist ?? 0,
    lateral: o.lateral ?? w.rng.range(-0.16, 0.16) * (flying ? 1.8 : 1), x: 0, y: 0, px: 0, py: 0, heading: 0,
    rot: w.rng.next() * Math.PI * 2, hp: hp * (o.hpFrac ?? 1), maxHp: hp, shield, maxShield: shield, armor, speed,
    size, resist: { ...(o.resist ?? {}) }, immune: null, statuses: [], moveMult: 1, dmgTakenMult: 1, armorDelta: 0,
    hardCC: false, reverse: false, ccImmuneUntil: 0, revealedUntil: 0, burrowed: false, lastHitTick: -9999,
    timers: def.abilities.map((a) => (a.every ?? 1) * w.rng.range(0.35, 1)), phaseHits: null, mimicTally: null,
    hist: new Float32Array(30), histIdx: 0, histTimer: 0, lastRewindTick: -9999, shrunk: false, special: o.revived ? 1 : 0,
    bounty: Math.max(1, Math.round(def.bounty * bountyMult)), lives: mods.includes('elite') ? def.lives * 2 : def.lives, killer: 0, hitFlash: 0, hitBy: new Set(), spawnTick: w.tick, tenacity: def.tenacity,
    hasteMult: 1, visScale: 1, waveN, zoneSpeed: 1, zoneDmg: 1, hpHist: new Float32Array(6), flying, traitSet: new Set(def.traits),
    mods,
  };
  if (flying) e.traitSet.add('flying');
  if (mods.includes('stealth')) e.traitSet.add('stealth');
  if (mods.includes('swift')) e.traitSet.add('fast');
  if (mods.includes('elite')) e.traitSet.add('elite');
  if (shield > 0) e.traitSet.add('shielded');
  for (const a of def.abilities) {
    if (a.kind === 'phase') e.phaseHits = new Map();
    if (a.kind === 'mimic') e.mimicTally = {};
    if (a.kind === 'carapace') e.immune = wave.carapace;
  }
  e.hist.fill(e.dist);
  e.hpHist.fill(e.hp);
  updatePos(w, e);
  e.px = e.x;
  e.py = e.y;
  w.enemies.push(e);
  w.enemyById.set(e.id, e);
  w.waveAlive(waveN, 1);
  return e;
}

function abilities(w: World, e: Enemy, dt: number): void {
  const def = e.def;
  def.abilities.forEach((a, i) => {
    switch (a.kind) {
      case 'heal': {
        e.timers[i] -= dt;
        if (e.timers[i] > 0) break;
        e.timers[i] = a.every ?? 3;
        const r = a.radius ?? 1.8;
        for (const o of w.hash.query(e.x, e.y, r, 0.3)) {
          if (!o.alive || dist2(o.x, o.y, e.x, e.y) > r * r) continue;
          o.hp = Math.min(o.maxHp, o.hp + o.maxHp * (a.amount ?? 0.08));
        }
        if (w.fxOn) w.vfxAt(BUILTIN_VFX.get('heal')!, e.x, e.y, 1.2);
        break;
      }
      case 'blink': {
        e.timers[i] -= dt;
        if (e.timers[i] > 0) break;
        e.timers[i] = a.every ?? 4;
        const x0 = e.x, y0 = e.y;
        const p = pathOf(w, e);
        e.dist = Math.min(p.length - 0.1, e.dist + (a.amount ?? 2));
        updatePos(w, e);
        if (w.fxOn) w.fx.push({ k: 'blink', x1: x0, y1: y0, x2: e.x, y2: e.y });
        break;
      }
      case 'burrow': {
        e.timers[i] += dt;
        const every = a.every ?? 6;
        e.burrowed = e.timers[i] % every > every - (a.duration ?? 2);
        break;
      }
      case 'spawn': {
        e.timers[i] -= dt;
        if (e.timers[i] > 0) break;
        e.timers[i] = a.every ?? 1.6;
        spawnEnemy(w, a.enemy ?? 'mini', e.pathIdx, e.waveN, { dist: Math.max(0, e.dist - 0.3) });
        break;
      }
      case 'revive': {
        e.timers[i] -= dt;
        if (e.timers[i] > 0) break;
        e.timers[i] = a.every ?? 6;
        const r = a.radius ?? 2.5;
        let n = 0;
        for (const d of w.recentDeaths) {
          if (n >= (a.count ?? 3)) break;
          if (d.used || d.revived || w.tick - d.tick > 4 * TICKS) continue;
          if (dist2(d.x, d.y, e.x, e.y) > r * r) continue;
          d.used = true;
          n++;
          spawnEnemy(w, d.def, d.pathIdx, e.waveN, { dist: d.dist, hpFrac: 0.5, revived: true });
        }
        if (n > 0 && w.fxOn) w.vfxAt(BUILTIN_VFX.get('ghost_rise')!, e.x, e.y, 1.5);
        break;
      }
      case 'stomp': {
        e.timers[i] -= dt;
        if (e.timers[i] > 0) break;
        e.timers[i] = a.every ?? 7;
        const r = a.radius ?? 2.2;
        for (const t of w.towers) {
          if (dist2(t.x, t.y, e.x, e.y) <= r * r) t.disabledUntil = Math.max(t.disabledUntil, w.tick + Math.round((a.duration ?? 2.5) * TICKS));
        }
        if (w.fxOn) w.fx.push({ k: 'stomp', x: e.x, y: e.y, r });
        break;
      }
      case 'rewind_hp': {
        e.timers[i] += dt;
        if (e.timers[i] >= 1) {
          e.timers[i] -= 1;
          e.hpHist.copyWithin(1, 0);
          e.hpHist[0] = e.hp;
        }
        if (!(e.special & 2) && e.hp < e.maxHp * (a.amount ?? 0.5)) {
          e.special |= 2;
          const back = e.hpHist[Math.min(5, Math.round(a.duration ?? 5))];
          if (back > e.hp) {
            e.hp = Math.min(e.maxHp, back);
            if (w.fxOn) {
              w.fx.push({ k: 'text', x: e.x, y: e.y - e.size - 0.3, text: 'REWIND', color: '#ffe869', big: true });
              w.vfxAt(BUILTIN_VFX.get('spiral')!, e.x, e.y, 2);
            }
          }
        }
        break;
      }
      case 'phases': {
        const f = e.hp / e.maxHp;
        if (!(e.special & 4) && f <= 0.66) {
          e.special |= 4;
          e.shield = 0;
          e.maxShield = 0;
          const n = a.count ?? 2;
          for (let k = 0; k < n; k++) {
            spawnEnemy(w, a.enemy ?? 'p6', e.pathIdx, e.waveN, { dist: Math.max(0, e.dist + (k - (n - 1) / 2) * 0.6), mods: e.air ? ['flying'] : [] });
          }
          if (w.fxOn) w.vfxAt(BUILTIN_VFX.get('shockwave')!, e.x, e.y, 1.5);
        }
        if (!(e.special & 8) && f <= 0.33) {
          e.special |= 8;
          e.speed *= 2;
          if (w.fxOn) w.fx.push({ k: 'text', x: e.x, y: e.y - e.size - 0.3, text: 'ENRAGED', color: '#f14e54', big: true });
        }
        break;
      }
      case 'mimic': {
        e.timers[i] += dt;
        if (e.timers[i] < 2 || !e.mimicTally) break;
        e.timers[i] = 0;
        let best: DamageType | null = null;
        let bv = 0;
        for (const [k, v] of Object.entries(e.mimicTally)) {
          if ((v ?? 0) > bv) {
            bv = v ?? 0;
            best = k as DamageType;
          }
        }
        if (best) e.resist[best] = Math.min(0.6, (e.resist[best] ?? 0) + 0.2);
        e.mimicTally = {};
        break;
      }
      default:
        break;
    }
  });
}

export function updateEnemies(w: World, dt: number): void {
  for (const e of w.enemies) e.hasteMult = 1;
  for (const e of w.enemies) {
    if (!e.alive || e.hardCC) continue;
    for (const a of e.def.abilities) {
      if (a.kind !== 'haste_aura') continue;
      const r = a.radius ?? 2;
      for (const o of w.hash.query(e.x, e.y, r, 0.3)) {
        if (o !== e && o.alive && dist2(o.x, o.y, e.x, e.y) <= r * r) o.hasteMult = Math.max(o.hasteMult, 1 + (a.amount ?? 0.3));
      }
    }
  }
  const regen = w.getWave(Math.max(1, w.waveN)).mutators.includes('regen');
  for (const e of w.enemies) {
    if (!e.alive) continue;
    e.px = e.x;
    e.py = e.y;
    if (e.hitFlash > 0) e.hitFlash--;
    e.rot += dt * (e.id % 2 ? 0.5 : -0.5) * (e.traitSet.has('boss') ? 0.3 : 1);
    tickStatuses(w, e, dt);
    if (!e.alive) continue;
    refreshDerived(w, e);
    if (e.maxShield > 0 && e.shield < e.maxShield && w.tick - e.lastHitTick > 3 * TICKS) {
      e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.3 * dt);
    }
    if (regen) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.01 * dt);
    if (!e.hardCC) abilities(w, e, dt);
    if (!e.alive) continue;
    let moved = 0;
    if (!e.hardCC) {
      const v = e.speed * e.moveMult * e.hasteMult;
      moved = e.reverse ? -v * 0.6 * dt : v * dt;
      e.dist = Math.max(0, e.dist + moved);
    }
    if (moved !== 0) {
      for (const s of e.statuses) {
        if (s.perTile > 0) {
          const t = w.towerById.get(s.source) ?? null;
          dealDamage(w, e, s.perTile * s.stacks * Math.abs(moved), 'kinetic', { tower: t, isHit: false, depth: 1 });
        }
      }
      if (!e.alive) continue;
    }
    e.histTimer += dt;
    if (e.histTimer >= 0.1) {
      e.histTimer -= 0.1;
      e.hist[e.histIdx] = e.dist;
      e.histIdx = (e.histIdx + 1) % e.hist.length;
    }
    updatePos(w, e);
    if (e.dist >= pathOf(w, e).length - 0.05) w.leak(e);
  }
}
