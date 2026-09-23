// Spec -> plain-English rules text. Tooltips never trust LLM prose for
// numbers: they are generated from the spec itself, with potency applied.

import type {
  Action, Condition, EnemySelector, FusionSpec, PointRef, StatBlock, TowerSelector, Trigger, Value,
} from './types.ts';

export interface DescribeOpts {
  potency?: number;
  /** Tower damage per hit, to show absolute numbers next to percentages. */
  dmgBase?: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pctStr = (n: number) => `${Math.round(n * 100)}%`;

function statusName(spec: FusionSpec, id: string): string {
  const s = spec.statuses?.find((x) => x.id === id);
  return s ? s.name : id.charAt(0).toUpperCase() + id.slice(1);
}

export function describeValue(v: Value, o: DescribeOpts, spec?: FusionSpec): string {
  if (typeof v === 'number') return String(r1(v));
  const x = v as Record<string, unknown>;
  if ('dmg' in x) {
    const k = (x.dmg as number) * (o.potency ?? 1);
    return o.dmgBase ? `${pctStr(k)} dmg (${Math.round(k * o.dmgBase)})` : `${pctStr(k)} dmg`;
  }
  if ('var' in x) return `[${x.var}]`;
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
    case 'all_in_radius': return `enemies within ${r1(s.radius)} tiles of ${s.around === 'self' ? 'the tower' : s.around === 'point' ? 'the point' : 'the target'}`;
    case 'random_in_range': return s.n === 1 ? 'a random enemy in range' : `${s.n} random enemies in range`;
    case 'strongest_in_range': return s.n === 1 ? 'the strongest enemy in range' : `the ${s.n} strongest enemies in range`;
    case 'weakest_in_range': return s.n === 1 ? 'the weakest enemy in range' : `the ${s.n} weakest enemies in range`;
    case 'first_in_range': return s.n === 1 ? 'the leading enemy' : `the ${s.n} leading enemies`;
    case 'last_in_range': return s.n === 1 ? 'the rearmost enemy' : `the ${s.n} rearmost enemies`;
    case 'nearest': return `the ${s.n > 1 ? s.n + ' ' : ''}nearest ${s.n > 1 ? 'enemies' : 'enemy'}${s.exclude_target ? ' (not the target)' : ''}`;
    case 'chain': return `${s.n} more ${s.n > 1 ? 'enemies' : 'enemy'} in a chain`;
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
    case 'every_nth_attack': return `Every ${t.n}th attack`;
    case 'every': return `Every ${r1(t.seconds)} s (while enemies are in range)`;
    case 'on_beat': return t.n === 1 ? 'On every beat' : `Every ${t.n}th beat (${r1(t.n * 0.5)} s)`;
    case 'on_idle': return `After ${r1(t.seconds)} s idle`;
    case 'on_enemy_enters_range': return 'When an enemy enters range';
    case 'on_enemy_leaves_range': return 'When an enemy escapes range';
    case 'on_status_applied': return `When it applies ${statusName(spec, t.status)}`;
    case 'on_status_expired': return `When its ${statusName(spec, t.status)} wears off`;
    case 'on_enemy_dies_in_range': return 'When any enemy dies in range';
    case 'on_projectile_end': return `When a ${t.projectile} lands`;
    case 'on_var_reached': return `When [${t.var}] reaches ${r1(t.value)}`;
    case 'on_wave_start': return 'At wave start';
    case 'on_wave_end': return 'When a wave is cleared';
    case 'on_ally_hit': return 'When a nearby tower hits';
  }
}

function cond(c: Condition, spec: FusionSpec): string {
  switch (c.check) {
    case 'chance': return `${Math.round(c.p * 100)}% chance`;
    case 'cooldown': return `${r1(c.seconds)} s cooldown`;
    case 'target_hp_below': return `target below ${c.pct}% HP`;
    case 'target_hp_above': return `target above ${c.pct}% HP`;
    case 'target_has_status': return `target has ${c.min_stacks && c.min_stacks > 1 ? c.min_stacks + '+ ' : ''}${statusName(spec, c.status)}`;
    case 'target_lacks_status': return `target lacks ${statusName(spec, c.status)}`;
    case 'target_is': return `target is ${c.trait}`;
    case 'target_is_not': return `target is not ${c.trait}`;
    case 'var_at_least': return `[${c.var}] ≥ ${r1(c.value)}`;
    case 'var_below': return `[${c.var}] < ${r1(c.value)}`;
    case 'enemies_in_range_at_least': return `${c.n}+ enemies in range`;
    case 'target_distance': return `target ${c.min ?? 0}–${c.max ?? '∞'} tiles away`;
    case 'first_hit_on_target': return 'first hit on that enemy';
    case 'every_nth': return `every ${c.n}th time`;
  }
}

function act(a: Action, spec: FusionSpec, o: DescribeOpts): string | null {
  const v = (x: Value) => describeValue(x, o, spec);
  let s: string | null;
  switch (a.action) {
    case 'damage': s = `deal ${v(a.amount)}${a.type ? ' ' + a.type : ''} to ${sel(a.to, spec)}`; break;
    case 'explode': s = `explode at ${pt(a.at)} (${r1(a.radius)} tiles) for ${v(a.amount)}${a.type ? ' ' + a.type : ''}`; break;
    case 'execute': s = `execute ${sel(a.to, spec)} below ${a.below_pct}% HP (not bosses)`; break;
    case 'apply_status': s = `apply ${a.stacks && a.stacks > 1 ? a.stacks + ' ' : ''}${statusName(spec, a.status)}${a.duration ? ` (${r1(a.duration)} s)` : ''} to ${sel(a.to, spec)}`; break;
    case 'remove_status': s = `remove ${statusName(spec, a.status)} from ${sel(a.to, spec)}`; break;
    case 'consume_status': s = `consume ${statusName(spec, a.status)} from ${sel(a.to, spec)}`; break;
    case 'spread_statuses': s = `spread its statuses to ${a.max_targets ?? 3} enemies within ${r1(a.radius)} tiles`; break;
    case 'knockback': s = `knock ${sel(a.to, spec)} back ${v(a.distance)} tiles`; break;
    case 'pull': s = `pull ${sel(a.to, spec)} ${v(a.strength)} tiles toward ${pt(a.toward)}`; break;
    case 'teleport_along_path': s = `teleport ${sel(a.to, spec)} ${v(a.distance)} tiles along the path`; break;
    case 'rewind_position': s = `rewind ${sel(a.to, spec)} to where it was ${r1(a.seconds)} s ago`; break;
    case 'swap_positions': s = `swap the target with the ${a.with.replace('_in_range', '').replace('_', ' ')} enemy in range`; break;
    case 'shrink': s = `shrink ${sel(a.to, spec)} (HP ×${r1(a.hp_mult)}, speed ×${r1(a.speed_mult)})`; break;
    case 'fire_projectile': {
      const p = spec.projectiles?.find((x) => x.id === a.projectile);
      const what = p ? `${p.id} (${p.motion.replace('_', ' ')}, ${v(p.amount)}${p.splash ? `, ${r1(p.splash)}-tile blast` : ''}${p.pierce ? `, pierces ${p.pierce}` : ''})` : 'a homing bullet (50% dmg)';
      s = `fire ${(a.count ?? 1) > 1 ? a.count + '× ' : ''}${what}${a.from && a.from !== 'self' ? ` from ${pt(a.from)}` : ''}${a.aim && a.aim !== 'target' ? ` aimed ${a.aim.replace('_', ' ')}` : ''}`;
      break;
    }
    case 'create_zone': {
      const z = spec.zones?.find((x) => x.id === a.zone);
      s = `create ${z ? `a ${r1(z.radius)}-tile ${z.shape.replace('_', ' ')} zone for ${r1(z.duration)} s${z.speed_mult && z.speed_mult !== 1 ? ` (speed ×${r1(z.speed_mult)})` : ''}` : a.zone} at ${pt(a.at)}`;
      break;
    }
    case 'summon_drone': s = `summon ${a.count} drone${a.count > 1 ? 's' : ''} for ${r1(a.lifetime)} s (${v(a.damage)} per sting)`; break;
    case 'repeat_attack': s = `repeat its attack at ${pctStr(a.mult)} power`; break;
    case 'modify_tower': s = `${tsel(a.to)} get ${a.stat} ×${r1(a.mult)} for ${r1(a.duration)} s`; break;
    case 'set_var': s = `set [${a.var}] to ${v(a.value)}`; break;
    case 'add_var': s = `add ${v(a.amount)} to [${a.var}]`; break;
    case 'grant_gold': s = `gain ${a.amount} gold`; break;
    case 'restore_life': s = 'restore 1 life'; break;
    case 'reveal': s = `reveal ${sel(a.to, spec)} for ${r1(a.duration)} s`; break;
    case 'break_shield': s = `break ${a.pct}% of ${sel(a.to, spec)}'s shield`; break;
    case 'vfx':
    case 'sound':
      s = null;
      break;
    default:
      s = null;
  }
  if (!s) return null;
  if (a.delay) s = `after ${r1(a.delay)} s, ${s}`;
  if (a.repeat) s += ` (${a.repeat.times}× every ${r1(a.repeat.every)} s)`;
  return s;
}

function acts(list: Action[] | undefined, spec: FusionSpec, o: DescribeOpts): string {
  const parts = (list ?? []).map((a) => act(a, spec, o)).filter((x): x is string => !!x);
  if (!parts.length) return 'a visual flourish';
  const s = parts.join(', then ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stats(st: StatBlock): string[] {
  const out: string[] = [];
  const m = (k: keyof StatBlock, label: string) => {
    const x = st[k];
    if (x === undefined || x === 1) return;
    out.push(`${x > 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}% ${label}`);
  };
  m('damage_mult', 'damage');
  m('rate_mult', 'attack speed');
  m('range_mult', 'range');
  m('splash_mult', 'blast radius');
  if (st.multishot) out.push(`+${st.multishot} multishot`);
  if (st.pierce) out.push(`+${st.pierce} pierce`);
  if (st.bounce) out.push(`+${st.bounce} bounce`);
  if (st.chains) out.push(`+${st.chains} chain jumps`);
  if (st.crit_chance) out.push(`${Math.round(st.crit_chance * 100)}% crit chance`);
  if (st.crit_mult) out.push(`crits deal ${pctStr(st.crit_mult)}`);
  return out;
}

/** Bullet lines describing everything a spec does. */
export function describeSpec(spec: FusionSpec, o: DescribeOpts = {}): string[] {
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
    if (s.speed_mult && s.speed_mult !== 1) bits.push(`${s.speed_mult < 1 ? '−' : '+'}${Math.round(Math.abs(1 - s.speed_mult) * 100)}% speed`);
    if (s.damage_taken_mult && s.damage_taken_mult !== 1) bits.push(`${s.damage_taken_mult > 1 ? '+' : '−'}${Math.round(Math.abs(s.damage_taken_mult - 1) * 100)}% damage taken`);
    if (s.armor_delta) bits.push(`${s.armor_delta > 0 ? '+' : ''}${s.armor_delta} armor`);
    if (s.hard_cc) bits.push('cannot move');
    if (s.reverse) bits.push('walks backwards');
    if (s.stores_damage) bits.push(`stores ${pctStr(s.stores_damage)} of damage taken`);
    if (s.dot) bits.push(`${describeValue(s.dot.amount, o, spec)}/s`);
    if (s.stacking === 'add') bits.push(`stacks to ${s.max_stacks ?? 1}`);
    lines.push(`${s.name}: ${bits.length ? bits.join(', ') + ', ' : ''}${r1(s.duration)} s.` +
      (s.tick ? ` Every ${r1(s.tick.every)} s: ${acts(s.tick.do, spec, o)}.` : '') +
      (s.on_expire ? ` When it ends: ${acts(s.on_expire, spec, o)}.` : '') +
      (s.on_death ? ` If the enemy dies with it: ${acts(s.on_death, spec, o)}.` : ''));
  }
  for (const z of spec.zones ?? []) {
    const bits: string[] = [];
    if (z.tick) bits.push(`every ${r1(z.tick.every)} s: ${acts(z.tick.do, spec, o)}`);
    if (z.on_enter) bits.push(`on enter: ${acts(z.on_enter, spec, o)}`);
    if (z.damage_taken_mult && z.damage_taken_mult !== 1) bits.push(`damage taken ×${r1(z.damage_taken_mult)}`);
    if (bits.length) lines.push(`Zone ${z.id}: ${bits.join('; ')}.`);
  }
  for (const p of spec.projectiles ?? []) {
    const bits: string[] = [];
    if (p.on_hit) bits.push(`on hit: ${acts(p.on_hit, spec, o)}`);
    if (p.on_end) bits.push(`when it ends: ${acts(p.on_end, spec, o)}`);
    if (bits.length) lines.push(`${p.id}: ${bits.join('; ')}.`);
  }
  return lines;
}
