// Offline, order-aware fusion combiner. No LLM, no server: this is what the
// game uses when the forge is unreachable, and the fallback when generation
// fails. The base power is kept whole; the secondary is merged at 60%
// strength and the tertiary at 30%, plus one "twist" rule picked by the key.

import type { FusionSpec, Rule, StatBlock, Value } from './types.ts';
import type { PowerDef, TowerDef } from '../sim/types.ts';
import { LIMITS } from './dsl.ts';
import { validateSpec } from './validate.ts';
import { hashString } from '../sim/math.ts';

const REF_KINDS: Record<string, 'status' | 'projectile' | 'zone' | 'var' | 'vfx'> = {
  status: 'status', stacks: 'status', projectile: 'projectile', zone: 'zone', var: 'var',
  effect: 'vfx', vfx: 'vfx', emitter: 'vfx', impact: 'vfx', aura: 'vfx', muzzle: 'vfx', kill: 'vfx',
};

type Json = unknown;

function renameRefs(node: Json, maps: Record<string, Map<string, string>>): Json {
  if (Array.isArray(node)) return node.map((x) => renameRefs(x, maps));
  if (typeof node !== 'object' || node === null) return node;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(node as Record<string, Json>)) {
    const kind = REF_KINDS[k];
    if (kind && typeof v === 'string' && maps[kind].has(v)) out[k] = maps[kind].get(v)!;
    else out[k] = renameRefs(v, maps);
  }
  return out;
}

/** Give every custom id in a spec a prefix so two specs can be merged. */
function prefixSpec(spec: FusionSpec, prefix: string): FusionSpec {
  const maps = {
    status: new Map((spec.statuses ?? []).map((s) => [s.id, prefix + s.id] as [string, string])),
    projectile: new Map((spec.projectiles ?? []).map((s) => [s.id, prefix + s.id] as [string, string])),
    zone: new Map((spec.zones ?? []).map((s) => [s.id, prefix + s.id] as [string, string])),
    var: new Map((spec.vars ?? []).map((s) => [s.id, prefix + s.id] as [string, string])),
    vfx: new Map((spec.vfx ?? []).map((s) => [s.id, prefix + s.id] as [string, string])),
  };
  const out = renameRefs(spec, maps) as FusionSpec;
  const fix = <T extends { id: string }>(arr: T[] | undefined, m: Map<string, string>) =>
    arr?.map((x) => ({ ...x, id: m.get(x.id) ?? x.id }));
  out.statuses = fix(spec.statuses, maps.status);
  out.projectiles = fix(spec.projectiles, maps.projectile);
  out.zones = fix(spec.zones, maps.zone);
  out.vars = fix(spec.vars, maps.var);
  out.vfx = fix(spec.vfx, maps.vfx);
  return out;
}

/** Scale every {dmg} coefficient and chance in a subtree. */
function scale(node: Json, f: number): Json {
  if (Array.isArray(node)) return node.map((x) => scale(x, f));
  if (typeof node !== 'object' || node === null) return node;
  const o = node as Record<string, Json>;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'dmg' && typeof v === 'number') out[k] = Math.round(v * f * 1000) / 1000;
    else if (k === 'p' && o.check === 'chance' && typeof v === 'number') out[k] = Math.min(1, Math.round(v * (0.5 + 0.5 * f) * 1000) / 1000);
    else out[k] = scale(v, f);
  }
  return out;
}

function mergeStats(base: StatBlock | undefined, add: StatBlock | undefined, f: number): StatBlock | undefined {
  if (!add) return base;
  const s: StatBlock = { ...(base ?? {}) };
  const mult = ['damage_mult', 'rate_mult', 'range_mult', 'splash_mult', 'crit_mult'] as const;
  for (const k of mult) {
    if (add[k] === undefined) continue;
    const v = 1 + (add[k]! - 1) * f;
    s[k] = Math.round((s[k] ?? 1) * v * 1000) / 1000;
  }
  const addk = ['multishot', 'pierce', 'bounce', 'chains'] as const;
  for (const k of addk) if (add[k]) s[k] = (s[k] ?? 0) + Math.max(1, Math.floor(add[k]! * f));
  if (add.crit_chance) s.crit_chance = Math.min(1, (s.crit_chance ?? 0) + add.crit_chance * f);
  return s;
}

interface Twist {
  name: string;
  flavor: string;
  rule: Rule;
}

const d = (x: number): Value => ({ dmg: x });

export const TWISTS: Twist[] = [
  { name: 'Resonant', flavor: 'Every sixth strike rings out.', rule: { when: { event: 'every_nth_attack', n: 6 }, do: [{ action: 'explode', at: 'target', radius: 1.2, amount: d(0.6), vfx: 'ring' }] } },
  { name: 'Haunted', flavor: 'The fallen keep fighting for a moment.', rule: { when: { event: 'on_kill' }, if: [{ check: 'chance', p: 0.5 }], do: [{ action: 'repeat_attack', mult: 0.5 }] } },
  { name: 'Charged', flavor: 'The air around it crackles.', rule: { when: { event: 'every', seconds: 3 }, do: [{ action: 'apply_status', to: { select: 'random_in_range', n: 2 }, status: 'shock' }, { action: 'vfx', effect: 'sparks', at: 'random_in_range' }] } },
  { name: 'Undertow', flavor: 'Something pulls back.', rule: { when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.1 }], do: [{ action: 'knockback', to: 'target', distance: 0.3 }] } },
  { name: 'Fervent', flavor: 'Victory is fuel.', rule: { when: { event: 'on_kill' }, do: [{ action: 'modify_tower', to: 'self', stat: 'rate', mult: 1.2, duration: 2 }] } },
  { name: 'Brittle', flavor: 'Cold things break.', rule: { when: { event: 'on_hit' }, if: [{ check: 'target_has_status', status: 'chill' }], do: [{ action: 'damage', to: 'target', amount: d(0.3) }] } },
  { name: 'Kindled', flavor: 'Fire eats armour.', rule: { when: { event: 'on_hit' }, if: [{ check: 'target_has_status', status: 'burn' }], do: [{ action: 'apply_status', to: 'target', status: 'weaken' }] } },
  { name: 'Lodestar', flavor: 'All roads lead here.', rule: { when: { event: 'every', seconds: 4 }, do: [{ action: 'pull', to: { select: 'strongest_in_range', n: 3 }, toward: 'self', strength: 0.4 }] } },
  { name: 'Ominous', flavor: 'It sees you coming.', rule: { when: { event: 'on_enemy_enters_range' }, if: [{ check: 'chance', p: 0.3 }], do: [{ action: 'apply_status', to: 'target', status: 'mark' }] } },
  { name: 'Syncopated', flavor: 'Off the beat, on the kill.', rule: { when: { event: 'on_beat', n: 8 }, do: [{ action: 'repeat_attack', mult: 0.8 }] } },
  { name: 'Shrapnel', flavor: 'Crits come apart.', rule: { when: { event: 'on_crit' }, do: [{ action: 'explode', at: 'target', radius: 0.8, amount: d(0.5), vfx: 'burst' }] } },
  { name: 'Scattering', flavor: 'Now and then it just lets go.', rule: { when: { event: 'every_nth_attack', n: 5 }, do: [{ action: 'fire_projectile', projectile: 'bullet', aim: 'random', count: 3, spread: 360 }] } },
  { name: 'Hungry', flavor: 'It finishes what it starts.', rule: { when: { event: 'on_hit' }, if: [{ check: 'target_hp_below', pct: 25 }], do: [{ action: 'damage', to: 'target', amount: d(0.4) }] } },
  { name: 'Dawning', flavor: 'First light hurts most.', rule: { when: { event: 'on_hit' }, if: [{ check: 'first_hit_on_target' }], do: [{ action: 'damage', to: 'target', amount: d(0.8) }, { action: 'vfx', effect: 'flash', at: 'target' }] } },
  { name: 'Wardbreaking', flavor: 'Shields are a suggestion.', rule: { when: { event: 'on_hit' }, if: [{ check: 'target_is', trait: 'shielded' }], do: [{ action: 'break_shield', to: 'target', pct: 15 }] } },
  { name: 'Grim', flavor: 'The end is catching.', rule: { when: { event: 'on_enemy_dies_in_range' }, if: [{ check: 'chance', p: 0.3 }], do: [{ action: 'apply_status', to: { select: 'nearest', n: 1, around: 'point' }, status: 'fear', duration: 0.6 }] } },
];

export function offlineFusion(tower: TowerDef, powers: PowerDef[], key: string): FusionSpec {
  const [p0, p1, p2] = powers;
  const base = prefixSpec(p0.spec, 'a_');
  const parts: { spec: FusionSpec; f: number }[] = [{ spec: base, f: 1 }];
  if (p1) parts.push({ spec: scale(prefixSpec(p1.spec, 'b_'), 0.6) as FusionSpec, f: 0.6 });
  if (p2) parts.push({ spec: scale(prefixSpec(p2.spec, 'c_'), 0.3) as FusionSpec, f: 0.3 });

  const twist = TWISTS[hashString(key) % TWISTS.length];
  const merged: FusionSpec = {
    dsl: 1,
    concept: `${p0.name} at the core, shaped by ${p1?.name ?? '-'}${p2 ? `, with a touch of ${p2.name}` : ''} (${twist.name.toLowerCase()} twist).`,
    name: `${p2 ? twist.name + ' ' : ''}${p0.adj} ${p1 ? p1.noun : p0.noun}`.slice(0, 32),
    flavor: twist.flavor,
    stats: undefined,
    rules: [],
  };
  for (const { spec, f } of parts) {
    merged.stats = mergeStats(merged.stats, spec.stats, f);
    merged.vars = [...(merged.vars ?? []), ...(spec.vars ?? [])];
    merged.statuses = [...(merged.statuses ?? []), ...(spec.statuses ?? [])];
    merged.projectiles = [...(merged.projectiles ?? []), ...(spec.projectiles ?? [])];
    merged.zones = [...(merged.zones ?? []), ...(spec.zones ?? [])];
    merged.vfx = [...(merged.vfx ?? []), ...(spec.vfx ?? [])];
    merged.rules.push(...spec.rules);
  }
  merged.rules.push(twist.rule);
  if (!merged.stats || Object.keys(merged.stats).length === 0) delete merged.stats;

  // Visuals: base look, secondary fills the gaps, tertiary tints the trail.
  const v0 = p0.spec.visual ?? {};
  const v1 = p1?.spec.visual ?? {};
  const v2 = p2?.spec.visual ?? {};
  merged.visual = {
    ...v2, ...v1, ...v0,
    projectile: { ...(v1.projectile ?? {}), ...(v0.projectile ?? {}), trail: v0.projectile?.trail ?? v1.projectile?.trail ?? (p2 ? 'ribbon' : 'line'), trail_color: p2 ? 'tertiary' : 'secondary' },
    aura: v0.aura ?? v1.aura ?? v2.aura,
  };
  merged.sound = p0.spec.sound ?? p1?.spec.sound;

  // Trim to engine limits, dropping from the weakest contributor first.
  const trim = <T>(arr: T[] | undefined, n: number) => (arr && arr.length > n ? arr.slice(0, n) : arr);
  merged.vars = trim(merged.vars, LIMITS.vars);
  merged.statuses = trim(merged.statuses, LIMITS.statuses);
  merged.projectiles = trim(merged.projectiles, LIMITS.projectiles);
  merged.zones = trim(merged.zones, LIMITS.zones);
  merged.vfx = trim(merged.vfx, LIMITS.vfx);
  while (merged.rules.length > LIMITS.rules) merged.rules.splice(merged.rules.length - 2, 1);

  // Drop rules until the spec validates (e.g. a trimmed template was referenced).
  for (let guard = 0; guard < 12; guard++) {
    const r = validateSpec(merged);
    if (r.ok && r.spec) return r.spec;
    if (merged.rules.length <= 1) break;
    merged.rules.splice(merged.rules.length - 1, 1);
  }
  void tower;
  return { ...p0.spec, name: merged.name, concept: merged.concept, flavor: merged.flavor };
}
