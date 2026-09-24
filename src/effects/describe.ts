// Spec -> plain-English rules text. Tooltips never trust LLM prose for
// numbers: they are generated from the spec itself, with potency applied.
// Numbers that grow with the tower's level are labelled with their step
// ("2 s (+0.2 s/lvl)"); every other number is fixed.

import type {
  Action, Condition, EnemySelector, FusionSpec, PointRef, StatBlock, TowerSelector, Trigger, Value,
} from './types.ts';
import { getAt, parsePath } from './level.ts';

export interface DescribeOpts {
  potency?: number;
  /** Tower damage per hit, to show absolute numbers next to percentages. */
  dmgBase?: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pctStr = (n: number) => `${Math.round(n * 100)}%`;

// The level steps of the spec being described, found by object identity.
interface Steps {
  at: Map<object, Map<string, number>>;
  used: Set<string>;
  paths: Map<object, Map<string, string>>;
}
let steps: Steps | null = null;

function buildSteps(spec: FusionSpec): Steps {
  const st: Steps = { at: new Map(), used: new Set(), paths: new Map() };
  for (const sc of spec.scaling ?? []) {
    const segs = parsePath(sc.path);
    const owner = segs ? getAt(spec, segs.slice(0, -1)) : null;
    if (!segs || !owner || typeof owner !== 'object') continue;
    const key = String(segs[segs.length - 1]);
    if (!st.at.has(owner)) { st.at.set(owner, new Map()); st.paths.set(owner, new Map()); }
    st.at.get(owner)!.set(key, sc.per);
    st.paths.get(owner)!.set(key, sc.path);
  }
  return st;
}

/** " (+0.2 s/lvl)" if obj[key] grows with level, else "". `k` converts to the unit shown. */
function lv(obj: object | undefined, key: string, k = 1, unit = ''): string {
  const per = obj ? steps?.at.get(obj)?.get(key) : undefined;
  if (per === undefined || !steps) return '';
  steps.used.add(steps.paths.get(obj!)!.get(key)!);
  const d = per * k;
  return ` (${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100) / 100}${unit}/lvl)`;
}

/** Internal ids (`b_moon_shard`) as player-facing words (`Moon shard`). */
export function nice(id: string): string {
  const s = id.replace(/^[abc]_/, '').replace(/_+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : id;
}

/** 1st, 2nd, 3rd, 4th, 11th, 22nd... */
export function ord(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

// The balancer's potency also scales slows, amps, displacement and hard
// crowd control (by its square root), as the engine does; show those numbers
// as they play.
const pfOf = (o: DescribeOpts) => Math.min(1.3, Math.sqrt(o.potency ?? 1));
const slowAt = (m: number, o: DescribeOpts) => (m < 1 ? 1 - (1 - m) * pfOf(o) : m);
const ampAt = (m: number, o: DescribeOpts) => 1 + (m - 1) * pfOf(o);

function hardStatus(spec: FusionSpec, id: string): boolean {
  return id === 'freeze' || id === 'stun' || id === 'root' || id === 'fear' || !!spec.statuses?.some((s) => s.id === id && (s.hard_cc || s.reverse));
}

/** A crowd-control duration as it plays: longer with potency, capped at 4 s. */
const ccAt = (d: number, o: DescribeOpts) => Math.min(d * Math.sqrt(o.potency ?? 1), 4);

function statusName(spec: FusionSpec, id: string): string {
  const s = spec.statuses?.find((x) => x.id === id);
  return s ? s.name : nice(id);
}

export function describeValue(v: Value, o: DescribeOpts, spec?: FusionSpec): string {
  if (typeof v === 'number') return String(r1(v));
  const x = v as Record<string, unknown>;
  if ('dmg' in x) {
    const k = (x.dmg as number) * (o.potency ?? 1);
    return o.dmgBase ? `${pctStr(k)} dmg (${Math.round(k * o.dmgBase)})` : `${pctStr(k)} dmg`;
  }
  if ('var' in x) return `[${nice(x.var as string)}]`;
  if ('stacks' in x) return `${spec ? statusName(spec, x.stacks as string) : x.stacks} stacks`;
  if ('consumed' in x) return 'stacks consumed';
  if ('stored' in x) return 'stored damage';
  if ('target_hp_pct' in x) return "target's HP%";
  if ('target_missing_hp_pct' in x) return "target's missing HP%";
  if ('enemies_in_range' in x) return 'enemies in range';
  if ('distance' in x) return 'distance';
  if ('tier' in x) return 'tier';
  if ('wave' in x) return 'wave number';
  if ('random' in x) {
    const [a, b] = x.random as [number, number];
    return `random ${r1(a)}–${r1(b)}`;
  }
  const ops: Record<string, string> = { add: ' + ', mul: ' × ', min: ', ', max: ', ' };
  for (const op of Object.keys(ops)) {
    const arr = x[op] as Value[] | undefined;
    if (!arr) continue;
    const inner = arr.map((y) => describeValue(y, o, spec)).join(ops[op]);
    return op === 'min' || op === 'max' ? `${op}(${inner})` : `(${inner})`;
  }
  return '?';
}

function sel(s: EnemySelector, spec: FusionSpec): string {
  if (s === 'target') return 'the target';
  if (s === 'all_in_range') return 'all enemies in range';
  switch (s.select) {
    case 'all_in_radius': return `enemies within ${r1(s.radius)} tiles${lv(s, 'radius', 1, ' tiles')} of ${s.around === 'self' ? 'the tower' : s.around === 'point' ? 'the point' : 'the target'}`;
    case 'random_in_range': return s.n === 1 && !lv(s, 'n') ? 'a random enemy in range' : `${s.n}${lv(s, 'n')} random enemies in range`;
    case 'strongest_in_range': return s.n === 1 && !lv(s, 'n') ? 'the strongest enemy in range' : `the ${s.n}${lv(s, 'n')} strongest enemies in range`;
    case 'weakest_in_range': return s.n === 1 ? 'the weakest enemy in range' : `the ${s.n} weakest enemies in range`;
    case 'first_in_range': return s.n === 1 ? 'the leading enemy' : `the ${s.n} leading enemies`;
    case 'last_in_range': return s.n === 1 ? 'the rearmost enemy' : `the ${s.n} rearmost enemies`;
    case 'nearest': return `the ${s.n > 1 ? s.n + ' ' : ''}nearest ${s.n > 1 ? 'enemies' : 'enemy'}${s.exclude_target ? ' (not the target)' : ''}`;
    case 'chain': return `${s.n}${lv(s, 'n')} more ${s.n > 1 ? 'enemies' : 'enemy'} in a chain`;
    case 'with_status': return `every enemy with ${statusName(spec, s.status)}${s.within === 'map' ? ' anywhere' : ' in range'}`;
  }
  return 'enemies';
}

function tsel(s: TowerSelector): string {
  return s === 'self' ? 'this tower' : `towers within ${r1(s.radius)} tiles`;
}

function pt(p: PointRef): string {
  if (p === 'target') return 'the target';
  if (p === 'point') return 'the impact point';
  if (p === 'self') return 'the tower';
  if (p === 'random_in_range') return 'a random spot in range';
  return 'path_ahead' in p ? `${r1(p.path_ahead)} tiles ahead on the path` : `${r1(p.path_behind)} tiles back on the path`;
}

function trig(t: Trigger, spec: FusionSpec): string {
  switch (t.event) {
    case 'on_attack': return 'On attack';
    case 'on_hit': return 'On hit';
    case 'on_kill': return 'On kill';
    case 'on_crit': return 'On critical hit';
    case 'every_nth_attack': return `Every ${ord(t.n)} attack${lv(t, 'n')}`;
    case 'every': return `Every ${r1(t.seconds)} s${lv(t, 'seconds', 1, ' s')} (while enemies are in range)`;
    case 'on_beat': return t.n === 1 ? 'On every beat' : `Every ${ord(t.n)} beat (${r1(t.n * 0.5)} s)`;
    case 'on_idle': return `After ${r1(t.seconds)} s idle`;
    case 'on_enemy_enters_range': return 'When an enemy enters range';
    case 'on_enemy_leaves_range': return 'When an enemy escapes range';
    case 'on_status_applied': return `When it applies ${statusName(spec, t.status)}`;
    case 'on_status_expired': return `When its ${statusName(spec, t.status)} wears off`;
    case 'on_enemy_dies_in_range': return 'When any enemy dies in range';
    case 'on_projectile_end': return `When a ${nice(t.projectile).toLowerCase()} lands`;
    case 'on_var_reached': return `When [${nice(t.var)}] reaches ${r1(t.value)}`;
    case 'on_wave_start': return 'At wave start';
    case 'on_wave_end': return 'When a wave is cleared';
    case 'on_ally_hit': return 'When a nearby tower hits';
  }
}

function cond(c: Condition, spec: FusionSpec): string {
  switch (c.check) {
    case 'chance': return `${Math.round(c.p * 100)}% chance${lv(c, 'p', 100, '%')}`;
    case 'cooldown': return `${r1(c.seconds)} s cooldown${lv(c, 'seconds', 1, ' s')}`;
    case 'target_hp_below': return `target below ${c.pct}% HP${lv(c, 'pct', 1, '%')}`;
    case 'target_hp_above': return `target above ${c.pct}% HP${lv(c, 'pct', 1, '%')}`;
    case 'target_has_status': return `target has ${c.min_stacks && c.min_stacks > 1 ? c.min_stacks + '+ ' : ''}${statusName(spec, c.status)}`;
    case 'target_lacks_status': return `target lacks ${statusName(spec, c.status)}`;
    case 'target_is': return `target is ${c.trait}`;
    case 'target_is_not': return `target is not ${c.trait}`;
    case 'var_at_least': return `[${nice(c.var)}] ≥ ${r1(c.value)}`;
    case 'var_below': return `[${nice(c.var)}] < ${r1(c.value)}`;
    case 'enemies_in_range_at_least': return `${c.n}+ enemies in range`;
    case 'target_distance': return `target ${c.min ?? 0}–${c.max ?? '∞'} tiles away`;
    case 'first_hit_on_target': return 'first hit on that enemy';
    case 'every_nth': return `every ${ord(c.n)} time`;
  }
}

function act(a: Action, spec: FusionSpec, o: DescribeOpts): string | null {
  const v = (x: Value) => describeValue(x, o, spec);
  // Displacement grows with potency like the engine's.
  const mv = (x: Value) => (typeof x === 'number' ? String(r1(x * pfOf(o))) : v(x));
  let s: string | null;
  switch (a.action) {
    case 'damage': s = `deal ${v(a.amount)}${a.type ? ' ' + a.type : ''} to ${sel(a.to, spec)}`; break;
    case 'explode': s = `explode at ${pt(a.at)} (${r1(a.radius)} tiles${lv(a, 'radius', 1, ' tiles')}) for ${v(a.amount)}${a.type ? ' ' + a.type : ''}`; break;
    case 'execute': s = `execute ${sel(a.to, spec)} below ${a.below_pct}% HP${lv(a, 'below_pct', 1, '%')} (not bosses)`; break;
    case 'apply_status': {
      const cc = hardStatus(spec, a.status);
      const d = a.duration ? (cc ? ccAt(a.duration, o) : a.duration) : 0;
      s = `apply ${a.stacks && a.stacks > 1 ? `${a.stacks}${lv(a, 'stacks')} ` : ''}${statusName(spec, a.status)}${d ? ` (${r1(d)} s${lv(a, 'duration', cc ? Math.sqrt(o.potency ?? 1) : 1, ' s')})` : ''} to ${sel(a.to, spec)}`;
      break;
    }
    case 'remove_status': s = `remove ${statusName(spec, a.status)} from ${sel(a.to, spec)}`; break;
    case 'consume_status': s = `consume ${statusName(spec, a.status)} from ${sel(a.to, spec)}`; break;
    case 'spread_statuses': s = `spread its statuses to ${a.max_targets ?? 3}${lv(a, 'max_targets')} enemies within ${r1(a.radius)} tiles${lv(a, 'radius', 1, ' tiles')}`; break;
    case 'knockback': s = `knock ${sel(a.to, spec)} back ${mv(a.distance)} tiles${lv(a, 'distance', pfOf(o), ' tiles')}`; break;
    case 'pull': s = `pull ${sel(a.to, spec)} ${mv(a.strength)} tiles${lv(a, 'strength', pfOf(o), ' tiles')} toward ${pt(a.toward)}`; break;
    case 'teleport_along_path': {
      const back = typeof a.distance === 'number' && a.distance < 0;
      s = `teleport ${sel(a.to, spec)} ${back ? mv(a.distance) : v(a.distance)} tiles${lv(a, 'distance', back ? pfOf(o) : 1, ' tiles')} along the path`;
      break;
    }
    case 'rewind_position': s = `rewind ${sel(a.to, spec)} to where it was ${r1(a.seconds)} s${lv(a, 'seconds', 1, ' s')} ago`; break;
    case 'swap_positions': s = `swap the target with the ${a.with.replace('_in_range', '').replace('_', ' ')} enemy in range`; break;
    case 'shrink': s = `shrink ${sel(a.to, spec)} (HP ×${r1(a.hp_mult)}${lv(a, 'hp_mult')}, speed ×${r1(a.speed_mult)}${lv(a, 'speed_mult')})`; break;
    case 'fire_projectile': {
      const p = spec.projectiles?.find((x) => x.id === a.projectile);
      const what = p ? `${nice(p.id).toLowerCase()} (${p.motion.replace('_', ' ')}, ${v(p.amount)}${p.splash ? `, ${r1(p.splash)}-tile blast${lv(p, 'splash', 1, ' tiles')}` : ''}${p.pierce ? `, pierces ${p.pierce}${lv(p, 'pierce')}` : ''})` : 'a homing bullet (50% dmg)';
      const n = a.count ?? 1;
      s = `fire ${n > 1 || lv(a, 'count') ? `${n}${lv(a, 'count')}× ` : ''}${what}${a.from && a.from !== 'self' ? ` from ${pt(a.from)}` : ''}${a.aim && a.aim !== 'target' ? ` aimed ${a.aim.replace('_', ' ')}` : ''}`;
      break;
    }
    case 'create_zone': {
      const z = spec.zones?.find((x) => x.id === a.zone);
      s = `create ${z ? `a ${r1(z.radius)}-tile${lv(z, 'radius', 1, ' tiles')} ${z.shape.replace('_', ' ')} zone for ${r1(z.duration)} s${lv(z, 'duration', 1, ' s')}${z.speed_mult && z.speed_mult !== 1 ? ` (${slower(slowAt(z.speed_mult, o))}${lv(z, 'speed_mult', z.speed_mult < 1 ? -100 * pfOf(o) : 100, '%')})` : ''}` : nice(a.zone).toLowerCase()} at ${pt(a.at)}`;
      break;
    }
    case 'summon_drone': s = `summon ${a.count}${lv(a, 'count')} drone${a.count > 1 ? 's' : ''} for ${r1(a.lifetime)} s${lv(a, 'lifetime', 1, ' s')} (${v(a.damage)} per sting)`; break;
    case 'repeat_attack': s = `repeat its attack at ${pctStr(a.mult)} power${lv(a, 'mult', 100, '%')}`; break;
    case 'modify_tower': s = `${tsel(a.to)} ${a.to === 'self' ? 'gets' : 'get'} ${a.stat} ×${r1(a.mult)}${lv(a, 'mult')} for ${r1(a.duration)} s${lv(a, 'duration', 1, ' s')}`; break;
    case 'set_var': s = `set [${nice(a.var)}] to ${v(a.value)}`; break;
    case 'add_var': s = `add ${v(a.amount)} to [${nice(a.var)}]`; break;
    case 'grant_gold': s = `gain ${a.amount}${lv(a, 'amount')} gold`; break;
    case 'restore_life': s = 'restore 1 life'; break;
    case 'reveal': s = `reveal ${sel(a.to, spec)} for ${r1(a.duration)} s${lv(a, 'duration', 1, ' s')}`; break;
    case 'break_shield': s = `break ${a.pct}%${lv(a, 'pct', 1, '%')} of ${sel(a.to, spec)}'s shield`; break;
    case 'vfx':
    case 'sound':
      s = null;
      break;
    default:
      s = null;
  }
  if (!s) return null;
  if (a.delay) s = `after ${r1(a.delay)} s${lv(a, 'delay', 1, ' s')}, ${s}`;
  if (a.repeat) s += ` (${a.repeat.times}×${lv(a.repeat, 'times')} every ${r1(a.repeat.every)} s${lv(a.repeat, 'every', 1, ' s')})`;
  return s;
}

function acts(list: Action[] | undefined, spec: FusionSpec, o: DescribeOpts): string {
  const parts = (list ?? []).map((a) => act(a, spec, o)).filter((x): x is string => !!x);
  if (!parts.length) return 'a visual flourish';
  const s = parts.join(', then ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slower(mult: number): string {
  return mult < 1 ? `${Math.round((1 - mult) * 100)}% slower` : `${Math.round((mult - 1) * 100)}% faster`;
}

function stats(st: StatBlock): string[] {
  const out: string[] = [];
  const m = (k: keyof StatBlock, label: string) => {
    const x = st[k];
    if (x === undefined || x === 1) return;
    out.push(`${x > 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}% ${label}${lv(st, k, 100, '%')}`);
  };
  m('damage_mult', 'damage');
  m('rate_mult', 'attack speed');
  m('range_mult', 'range');
  m('splash_mult', 'blast radius');
  if (st.multishot) out.push(`+${st.multishot} multishot${lv(st, 'multishot')}`);
  if (st.pierce) out.push(`+${st.pierce} pierce${lv(st, 'pierce')}`);
  if (st.bounce) out.push(`+${st.bounce} bounce${lv(st, 'bounce')}`);
  if (st.chains) out.push(`+${st.chains} chain jumps${lv(st, 'chains')}`);
  if (st.crit_chance) out.push(`${Math.round(st.crit_chance * 100)}% crit chance${lv(st, 'crit_chance', 100, '%')}`);
  if (st.crit_mult) out.push(`crits deal ${pctStr(st.crit_mult)}${lv(st, 'crit_mult', 100, '%')}`);
  return out;
}

/** Bullet lines describing everything a spec does. */
export function describeSpec(spec: FusionSpec, o: DescribeOpts = {}): string[] {
  const outer = steps;
  steps = buildSteps(spec);
  try {
    return describeLines(spec, o);
  } finally {
    steps = outer;
  }
}

function describeLines(spec: FusionSpec, o: DescribeOpts): string[] {
  const lines: string[] = [];
  if (spec.stats) {
    const s = stats(spec.stats);
    if (s.length) lines.push(s.join(', ') + '.');
  }
  if (spec.attack?.motion) lines.push(`Basic shots fly ${spec.attack.motion}.`);
  for (const r of spec.rules) {
    const c = (r.if ?? []).map((x) => cond(x, spec));
    lines.push(`${trig(r.when, spec)}${c.length ? ` (${c.join(', ')})` : ''}: ${acts(r.do, spec, o)}.`);
  }
  for (const s of spec.statuses ?? []) {
    const bits: string[] = [];
    if (s.speed_mult && s.speed_mult !== 1) bits.push(`${slower(slowAt(s.speed_mult, o))}${lv(s, 'speed_mult', s.speed_mult < 1 ? -100 * pfOf(o) : 100, '%')}`);
    if (s.damage_taken_mult && s.damage_taken_mult !== 1) {
      const m = ampAt(s.damage_taken_mult, o);
      bits.push(`${m > 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}% damage taken${lv(s, 'damage_taken_mult', 100 * pfOf(o), '%')}`);
    }
    if (s.armor_delta) bits.push(`${s.armor_delta > 0 ? '+' : ''}${s.armor_delta} armor${lv(s, 'armor_delta')}`);
    if (s.hard_cc) bits.push('cannot move');
    if (s.reverse) bits.push('walks backwards');
    if (s.stores_damage) bits.push(`stores ${pctStr(s.stores_damage)} of damage taken${lv(s, 'stores_damage', 100, '%')}`);
    if (s.dot) bits.push(`${describeValue(s.dot.amount, o, spec)}/s`);
    if (s.stacking === 'add') bits.push(`stacks to ${s.max_stacks ?? 1}${lv(s, 'max_stacks')}`);
    const cc = !!(s.hard_cc || s.reverse);
    lines.push(`${s.name}: ${bits.length ? bits.join(', ') + ', ' : ''}${r1(cc ? ccAt(s.duration, o) : s.duration)} s${lv(s, 'duration', cc ? Math.sqrt(o.potency ?? 1) : 1, ' s')}.` +
      (s.tick ? ` Every ${r1(s.tick.every)} s${lv(s.tick, 'every', 1, ' s')}: ${acts(s.tick.do, spec, o)}.` : '') +
      (s.on_expire ? ` When it ends: ${acts(s.on_expire, spec, o)}.` : '') +
      (s.on_death ? ` If the enemy dies with it: ${acts(s.on_death, spec, o)}.` : ''));
  }
  for (const z of spec.zones ?? []) {
    const bits: string[] = [];
    if (z.tick) bits.push(`every ${r1(z.tick.every)} s${lv(z.tick, 'every', 1, ' s')}: ${acts(z.tick.do, spec, o)}`);
    if (z.on_enter) bits.push(`on enter: ${acts(z.on_enter, spec, o)}`);
    if (z.damage_taken_mult && z.damage_taken_mult !== 1) bits.push(`damage taken ×${r1(ampAt(z.damage_taken_mult, o))}${lv(z, 'damage_taken_mult', pfOf(o))}`);
    if (bits.length) lines.push(`${nice(z.id)} zone: ${bits.join('; ')}.`);
  }
  for (const p of spec.projectiles ?? []) {
    const bits: string[] = [];
    if (p.on_hit) bits.push(`on hit: ${acts(p.on_hit, spec, o)}`);
    if (p.on_end) bits.push(`when it ends: ${acts(p.on_end, spec, o)}`);
    if (bits.length) lines.push(`${nice(p.id)}: ${bits.join('; ')}.`);
  }
  // Anything that grows but was not shown above (numbers inside formulas, templates not described).
  const rest = (spec.scaling ?? []).filter((sc) => !steps?.used.has(sc.path));
  if (rest.length) {
    lines.push(`Also grows per level: ${rest.map((sc) => {
      const segs = parsePath(sc.path) ?? [];
      const owner = getAt(spec, segs.slice(0, -2));
      const label = nice(String([...segs].reverse().find((x) => typeof x === 'string') ?? 'value'));
      const where = owner && typeof owner === 'object' && 'id' in owner ? `${nice(String((owner as { id: string }).id))} ` : '';
      return `${where}${label.toLowerCase()} ${sc.per >= 0 ? '+' : '−'}${Math.round(Math.abs(sc.per) * 100) / 100}`;
    }).join(', ')}.`);
  }
  return lines;
}
