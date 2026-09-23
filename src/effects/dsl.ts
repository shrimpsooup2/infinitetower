// Schema of the effect language. Single source of truth for validation, the
// JSON Schema sent to Ollama, and the cheat sheet in the prompt.

import { S, type Schema, toJsonSchema, DiscS, ObjS, OptS } from './schema.ts';
import {
  DAMAGE_TYPES, TRAITS, PROJECTILE_MOTIONS, PROJ_SHAPES, ICON_SHAPES, ATTACK_MOTIONS, TRAILS, SOUND_PRESETS,
  BODY_DECOR, STATUS_OVERLAYS, ZONE_STYLES, PARTICLE_SHAPES, PARTICLE_DIRECTIONS, EMIT_FROM, BEAM_STYLES, SHAPE_KINDS,
  type FusionSpec, type Value,
} from './types.ts';

export const LIMITS = {
  rules: 6,
  actionsPerList: 5,
  conditions: 3,
  statuses: 2,
  projectiles: 2,
  zones: 2,
  vars: 3,
  vfx: 6,
  layersPerVfx: 4,
  valueDepth: 3,
};

const flag = () => S.lit(true as const);

// ---------------------------------------------------------------- values

export const ValueS: Schema<Value> = S.any<Value>('Value', [
  S.num(-100000, 100000),
  S.obj({ dmg: S.num(0, 60) }),
  S.obj({ var: S.id() }),
  S.obj({ stacks: S.id() }),
  S.obj({ consumed: flag() }),
  S.obj({ stored: flag() }),
  S.obj({ target_hp_pct: flag() }),
  S.obj({ target_missing_hp_pct: flag() }),
  S.obj({ enemies_in_range: flag() }),
  S.obj({ distance: flag() }),
  S.obj({ tier: flag() }),
  S.obj({ wave: flag() }),
  S.obj({ random: S.arr(S.num(-1000, 1000), 2, 2) }),
  S.obj({ add: S.arr(S.lazy<Value>('Value', () => ValueS), 2, 4) }),
  S.obj({ mul: S.arr(S.lazy<Value>('Value', () => ValueS), 2, 4) }),
  S.obj({ min: S.arr(S.lazy<Value>('Value', () => ValueS), 2, 4) }),
  S.obj({ max: S.arr(S.lazy<Value>('Value', () => ValueS), 2, 4) }),
]);

// ---------------------------------------------------------------- selectors

const Around = S.enm(['target', 'point', 'self'] as const);
const N = (max = 8) => S.int(1, max);

export const EnemySelectorS = S.any('EnemySelector', [
  S.enm(['target', 'all_in_range'] as const),
  S.disc('EnemySelectorObj', 'select', {
    all_in_radius: S.obj({ radius: S.num(0.3, 4), around: S.opt(Around) }),
    random_in_range: S.obj({ n: N() }),
    strongest_in_range: S.obj({ n: N() }),
    weakest_in_range: S.obj({ n: N() }),
    first_in_range: S.obj({ n: N() }),
    last_in_range: S.obj({ n: N() }),
    nearest: S.obj({ n: N(), around: S.opt(Around), exclude_target: S.opt(S.bool()) }),
    chain: S.obj({ n: N(), range: S.num(0.5, 4) }),
    with_status: S.obj({ status: S.id(), within: S.opt(S.enm(['range', 'map'] as const)) }),
  }),
]);

export const TowerSelectorS = S.any('TowerSelector', [
  S.enm(['self'] as const),
  S.disc('TowerSelectorObj', 'select', { towers_in_radius: S.obj({ radius: S.num(0.5, 5) }) }),
]);

export const PointS = S.any('Point', [
  S.enm(['target', 'point', 'self', 'random_in_range'] as const),
  S.obj({ path_ahead: S.num(0, 8) }),
  S.obj({ path_behind: S.num(0, 8) }),
]);

const Aim = S.enm(['target', 'away', 'random', 'nearest_other', 'path_back', 'path_forward'] as const);

export const ColorRefS = S.any('Color', [S.enm(['base', 'secondary', 'tertiary', 'damage'] as const), S.color()]);

// ---------------------------------------------------------------- visuals

const R2 = (lo: number, hi: number) => S.arr(S.num(lo, hi), 2, 2);

const particleFields = {
  count: S.opt(S.int(1, 60)),
  rate: S.opt(S.num(0, 120)),
  shape: S.opt(S.enm(PARTICLE_SHAPES)),
  color: S.opt(ColorRefS),
  color_end: S.opt(ColorRefS),
  size: S.opt(R2(0.01, 1.5)),
  alpha: S.opt(R2(0, 1)),
  speed: S.opt(R2(0, 20)),
  life: S.opt(R2(0.05, 4)),
  spread: S.opt(S.num(0, 360)),
  direction: S.opt(S.enm(PARTICLE_DIRECTIONS)),
  gravity: S.opt(S.num(-20, 20)),
  drag: S.opt(S.num(0, 10)),
  spin: S.opt(S.num(-20, 20)),
  wobble: S.opt(S.num(0, 5)),
  emit_from: S.opt(S.enm(EMIT_FROM)),
  radius: S.opt(S.num(0, 3)),
  outline: S.opt(S.bool()),
  glow: S.opt(S.bool()),
};

const beamFields = {
  style: S.opt(S.enm(BEAM_STYLES)),
  width: S.opt(R2(0.01, 1.5)),
  color: S.opt(ColorRefS),
  core: S.opt(ColorRefS),
  glow: S.opt(S.bool()),
  amplitude: S.opt(S.num(0, 1)),
  frequency: S.opt(S.num(0.2, 20)),
  scroll: S.opt(S.num(-30, 30)),
  flicker: S.opt(S.num(0, 1)),
  pulse: S.opt(S.num(0, 1)),
  duration: S.opt(S.num(0.05, 3)),
};

export const VfxLayerS = S.disc('VfxLayer', 'kind', {
  particles: S.obj(particleFields),
  beam: S.obj(beamFields),
  shape: S.obj({
    shape: S.opt(S.enm(SHAPE_KINDS)),
    sides: S.opt(S.int(3, 12)),
    radius: S.opt(R2(0, 6)),
    thickness: S.opt(S.num(0.01, 0.6)),
    fill: S.opt(S.bool()),
    color: S.opt(ColorRefS),
    alpha: S.opt(R2(0, 1)),
    rotate: S.opt(S.num(-20, 20)),
    duration: S.opt(S.num(0.05, 4)),
    count: S.opt(S.int(1, 5)),
    dashed: S.opt(S.bool()),
    glow: S.opt(S.bool()),
  }),
  orbiters: S.obj({
    count: S.int(1, 16),
    radius: S.num(0.1, 3),
    size: S.opt(S.num(0.02, 0.6)),
    shape: S.opt(S.enm(PARTICLE_SHAPES)),
    color: S.opt(ColorRefS),
    speed: S.opt(S.num(-20, 20)),
    wobble: S.opt(S.num(0, 2)),
    glow: S.opt(S.bool()),
  }),
  text: S.obj({ text: S.str(16), color: S.opt(ColorRefS), size: S.opt(S.num(0.2, 2)), duration: S.opt(S.num(0.2, 3)) }),
  shake: S.obj({ strength: S.num(0, 1), duration: S.opt(S.num(0.05, 1)) }),
});

export const VfxDefS = S.obj({ id: S.id(), layers: S.arr(VfxLayerS, 1, LIMITS.layersPerVfx) });

export const ProjectileLookS = S.obj({
  shape: S.opt(S.enm(PROJ_SHAPES)),
  size: S.opt(S.num(0.4, 3)),
  color: S.opt(ColorRefS),
  spin: S.opt(S.bool()),
  glow: S.opt(S.bool()),
  trail: S.opt(S.enm(TRAILS)),
  trail_color: S.opt(ColorRefS),
  emitter: S.opt(S.id()),
});

export const VisualS = S.obj({
  body: S.opt(S.enm(BODY_DECOR)),
  accent: S.opt(ColorRefS),
  aura: S.opt(S.id()),
  muzzle: S.opt(S.id()),
  impact: S.opt(S.id()),
  kill: S.opt(S.id()),
  projectile: S.opt(ProjectileLookS),
  beam: S.opt(S.obj(beamFields)),
  spray: S.opt(S.obj(particleFields)),
});

// ---------------------------------------------------------------- triggers

export const TRIGGER_DOCS: Record<string, string> = {
  on_attack: 'the tower attacks (fires / pulses / stings). target = its target',
  on_hit: "one of the tower's attacks hits an enemy. target = that enemy, point = impact",
  on_kill: 'an enemy dies to this tower (any damage). target = the dead enemy (use point/all_in_radius)',
  on_crit: 'a hit is a critical hit. target = that enemy',
  every_nth_attack: 'every n-th attack. target = the attack target',
  every: 'every `seconds` while enemies are in range. NO target: use selectors like strongest_in_range',
  on_beat: 'every n-th beat of the global 0.5 s rhythm shared by all towers. NO target',
  on_idle: 'once, after `seconds` without attacking. NO target',
  on_enemy_enters_range: 'an enemy enters range. target = that enemy',
  on_enemy_leaves_range: 'an enemy leaves range alive. target = that enemy',
  on_status_applied: 'this tower applies `status` to an enemy. target = that enemy',
  on_status_expired: 'a `status` applied by this tower wears off. target = that enemy',
  on_enemy_dies_in_range: 'any enemy dies inside range (not only kills by this tower). target = dead enemy',
  on_projectile_end: 'one of your custom projectiles ends. point = where it ended. NO target',
  on_var_reached: 'a var rises to >= value. NO target',
  on_wave_start: 'a wave starts. NO target',
  on_wave_end: 'a wave is cleared. NO target',
  on_ally_hit: 'another tower within range hits an enemy. target = that enemy',
};

export const TriggerS = S.disc('Trigger', 'event', {
  on_attack: S.obj({}),
  on_hit: S.obj({}),
  on_kill: S.obj({}),
  on_crit: S.obj({}),
  every_nth_attack: S.obj({ n: S.int(2, 20) }),
  every: S.obj({ seconds: S.num(0.5, 30) }),
  on_beat: S.obj({ n: S.int(1, 16) }),
  on_idle: S.obj({ seconds: S.num(0.5, 10) }),
  on_enemy_enters_range: S.obj({}),
  on_enemy_leaves_range: S.obj({}),
  on_status_applied: S.obj({ status: S.id() }),
  on_status_expired: S.obj({ status: S.id() }),
  on_enemy_dies_in_range: S.obj({}),
  on_projectile_end: S.obj({ projectile: S.id() }),
  on_var_reached: S.obj({ var: S.id(), value: S.num(-100000, 100000) }),
  on_wave_start: S.obj({}),
  on_wave_end: S.obj({}),
  on_ally_hit: S.obj({}),
});

/** Triggers that provide no target enemy. */
export const TARGETLESS_TRIGGERS = new Set(['every', 'on_beat', 'on_idle', 'on_var_reached', 'on_wave_start', 'on_wave_end', 'on_projectile_end']);

// ---------------------------------------------------------------- conditions

export const CONDITION_DOCS: Record<string, string> = {
  chance: 'random roll, p in 0..1 (scaled down for towers that hit very often)',
  cooldown: 'this rule can pass at most once per `seconds`',
  target_hp_below: 'target HP% below pct',
  target_hp_above: 'target HP% above pct',
  target_has_status: 'target has status (optionally at least min_stacks)',
  target_lacks_status: 'target does not have status',
  target_is: 'target has trait',
  target_is_not: 'target lacks trait',
  var_at_least: 'tower var >= value',
  var_below: 'tower var < value',
  enemies_in_range_at_least: 'at least n enemies in range',
  target_distance: 'target distance from tower (tiles) within [min, max]',
  first_hit_on_target: "this is the tower's first hit on this enemy",
  every_nth: 'passes every n-th time it is checked',
};

export const ConditionS = S.disc('Condition', 'check', {
  chance: S.obj({ p: S.num(0.01, 1) }),
  cooldown: S.obj({ seconds: S.num(0.1, 30) }),
  target_hp_below: S.obj({ pct: S.num(1, 99) }),
  target_hp_above: S.obj({ pct: S.num(1, 99) }),
  target_has_status: S.obj({ status: S.id(), min_stacks: S.opt(S.int(1, 10)) }),
  target_lacks_status: S.obj({ status: S.id() }),
  target_is: S.obj({ trait: S.enm(TRAITS) }),
  target_is_not: S.obj({ trait: S.enm(TRAITS) }),
  var_at_least: S.obj({ var: S.id(), value: S.num(-100000, 100000) }),
  var_below: S.obj({ var: S.id(), value: S.num(-100000, 100000) }),
  enemies_in_range_at_least: S.obj({ n: S.int(1, 30) }),
  target_distance: S.obj({ min: S.opt(S.num(0, 12)), max: S.opt(S.num(0, 12)) }),
  first_hit_on_target: S.obj({}),
  every_nth: S.obj({ n: S.int(2, 20) }),
});

// ---------------------------------------------------------------- actions

export const ACTION_DOCS: Record<string, string> = {
  damage: 'deal damage (amount MUST use {dmg}); type defaults to the tower damage type',
  explode: 'area damage at a point (amount MUST use {dmg}); optional vfx drawn at the blast (scaled to radius)',
  execute: 'instantly kill non-boss enemies below below_pct HP',
  apply_status: 'apply a built-in or custom status',
  remove_status: 'remove a status',
  consume_status: 'remove a status and store its stack count in {consumed} for the following actions in this list',
  spread_statuses: "copy the target's statuses to up to max_targets enemies within radius of it",
  knockback: 'push enemies back along the path by distance tiles (max 3)',
  pull: 'drag enemies along the path toward a point by strength tiles (max 3)',
  teleport_along_path: 'move enemies along the path (negative = back toward spawn), max 6',
  rewind_position: 'send enemies back to where they were `seconds` ago (once per enemy per 2 s)',
  swap_positions: 'swap the target with another enemy in range',
  shrink: 'permanently shrink non-boss enemies once: HP and speed multiplied',
  fire_projectile: "fire a custom projectile (or 'bullet', a basic homing shot for 50% damage) from a point, aimed per `aim`",
  create_zone: 'create a custom zone at a point',
  summon_drone: 'summon temporary drones that chase and sting enemies (damage MUST use {dmg})',
  repeat_attack: "repeat the tower's basic attack at mult damage",
  modify_tower: 'temporarily multiply a tower stat (damage|rate|range)',
  set_var: 'set a tower var',
  add_var: 'add to a tower var (clamped to its max)',
  grant_gold: 'give gold (capped per wave)',
  restore_life: 'restore lives (max 1 per wave per tower)',
  reveal: 'make stealthy enemies targetable for duration',
  break_shield: 'remove pct% of enemy shields',
  vfx: 'play a visual effect (built-in or custom vfx id) at a point; `to` = second point for beams; size scales it; color tints it; text feeds text layers',
  sound: 'play a sound',
};

const timing = { delay: S.opt(S.num(0, 5)), repeat: S.opt(S.obj({ times: S.int(2, 6), every: S.num(0.1, 3) })) };
const act = (shape: Record<string, Schema<unknown>>) => S.obj({ ...shape, ...timing });
const Dmg = () => S.opt(S.enm(DAMAGE_TYPES));

export const ActionS = S.disc('Action', 'action', {
  damage: act({ to: EnemySelectorS, amount: ValueS, type: Dmg() }),
  explode: act({ at: PointS, radius: S.num(0.3, 3), amount: ValueS, type: Dmg(), vfx: S.opt(S.id()) }),
  execute: act({ to: EnemySelectorS, below_pct: S.num(1, 30) }),
  apply_status: act({ to: EnemySelectorS, status: S.id(), stacks: S.opt(S.int(1, 5)), duration: S.opt(S.num(0.2, 12)) }),
  remove_status: act({ to: EnemySelectorS, status: S.id() }),
  consume_status: act({ to: EnemySelectorS, status: S.id() }),
  spread_statuses: act({ radius: S.num(0.5, 3), max_targets: S.opt(S.int(1, 8)) }),
  knockback: act({ to: EnemySelectorS, distance: ValueS }),
  pull: act({ to: EnemySelectorS, toward: PointS, strength: ValueS }),
  teleport_along_path: act({ to: EnemySelectorS, distance: ValueS }),
  rewind_position: act({ to: EnemySelectorS, seconds: S.num(0.5, 3) }),
  swap_positions: act({ with: S.enm(['first_in_range', 'last_in_range', 'random_in_range'] as const) }),
  shrink: act({ to: EnemySelectorS, hp_mult: S.num(0.3, 1), speed_mult: S.num(0.5, 1.5) }),
  fire_projectile: act({
    projectile: S.id(),
    from: S.opt(PointS),
    aim: S.opt(Aim),
    count: S.opt(S.int(1, 8)),
    spread: S.opt(S.num(0, 360)),
  }),
  create_zone: act({ zone: S.id(), at: PointS }),
  summon_drone: act({ count: S.int(1, 4), lifetime: S.num(1, 15), damage: ValueS }),
  repeat_attack: act({ mult: S.num(0.1, 1.5) }),
  modify_tower: act({
    to: TowerSelectorS,
    stat: S.enm(['damage', 'rate', 'range'] as const),
    mult: S.num(0.5, 3),
    duration: S.num(0.5, 15),
  }),
  set_var: act({ var: S.id(), value: ValueS }),
  add_var: act({ var: S.id(), amount: ValueS }),
  grant_gold: act({ amount: S.int(1, 25) }),
  restore_life: act({ amount: S.int(1, 1) }),
  reveal: act({ to: EnemySelectorS, duration: S.num(0.5, 10) }),
  break_shield: act({ to: EnemySelectorS, pct: S.num(1, 100) }),
  vfx: act({
    effect: S.id(),
    at: PointS,
    to: S.opt(PointS),
    size: S.opt(S.num(0.2, 4)),
    color: S.opt(ColorRefS),
    text: S.opt(S.str(12)),
  }),
  sound: act({ preset: S.enm(SOUND_PRESETS), pitch: S.opt(S.num(0.5, 2)) }),
});

const Actions = () => S.arr(ActionS, 1, LIMITS.actionsPerList);
const OptActions = () => S.opt(Actions());

// ---------------------------------------------------------------- templates

export const StatusTplS = S.obj({
  id: S.id(),
  name: S.str(24),
  stacking: S.opt(S.enm(['refresh', 'add'] as const)),
  max_stacks: S.opt(S.int(1, 10)),
  duration: S.num(0.2, 12),
  speed_mult: S.opt(S.num(0.3, 1.5)),
  damage_taken_mult: S.opt(S.num(0.5, 2)),
  armor_delta: S.opt(S.num(-20, 20)),
  hard_cc: S.opt(S.bool()),
  reverse: S.opt(S.bool()),
  stores_damage: S.opt(S.num(0, 1)),
  damage_per_tile: S.opt(ValueS),
  dot: S.opt(S.obj({ amount: ValueS, type: Dmg() })),
  tick: S.opt(S.obj({ every: S.num(0.2, 5), do: Actions() })),
  on_apply: OptActions(),
  on_expire: OptActions(),
  on_death: OptActions(),
  tint: S.opt(ColorRefS),
  icon: S.opt(S.enm(ICON_SHAPES)),
  overlay: S.opt(S.enm(STATUS_OVERLAYS)),
  scale: S.opt(S.num(0.6, 1.6)),
  vfx: S.opt(S.id()),
});

export const ProjectileTplS = S.obj({
  id: S.id(),
  motion: S.enm(PROJECTILE_MOTIONS),
  speed: S.opt(S.num(1, 20)),
  size: S.opt(S.num(0.05, 0.5)),
  lifetime: S.opt(S.num(0.2, 15)),
  pierce: S.opt(S.int(0, 10)),
  bounce: S.opt(S.int(0, 5)),
  splash: S.opt(S.num(0, 2.5)),
  amount: ValueS,
  type: Dmg(),
  hits_air: S.opt(S.bool()),
  on_hit: OptActions(),
  on_end: OptActions(),
  look: S.opt(ProjectileLookS),
  beam: S.opt(S.obj(beamFields)),
  impact: S.opt(S.id()),
});

export const ZoneTplS = S.obj({
  id: S.id(),
  shape: S.enm(['circle', 'ring', 'path_segment'] as const),
  radius: S.num(0.3, 3),
  duration: S.num(0.3, 12),
  follows: S.opt(S.enm(['none', 'target', 'self'] as const)),
  speed_mult: S.opt(S.num(0.3, 1.5)),
  damage_taken_mult: S.opt(S.num(0.5, 2)),
  tick: S.opt(S.obj({ every: S.num(0.2, 5), do: Actions() })),
  on_enter: OptActions(),
  on_exit: OptActions(),
  style: S.opt(S.enm(ZONE_STYLES)),
  color: S.opt(ColorRefS),
  vfx: S.opt(S.id()),
});

export const StatBlockS = S.obj({
  damage_mult: S.opt(S.num(0.3, 3)),
  rate_mult: S.opt(S.num(0.3, 3)),
  range_mult: S.opt(S.num(0.5, 2)),
  splash_mult: S.opt(S.num(0.5, 3)),
  multishot: S.opt(S.int(0, 6)),
  pierce: S.opt(S.int(0, 10)),
  bounce: S.opt(S.int(0, 5)),
  chains: S.opt(S.int(0, 6)),
  crit_chance: S.opt(S.num(0, 1)),
  crit_mult: S.opt(S.num(1, 10)),
});

export const RuleS = S.obj({
  when: TriggerS,
  if: S.opt(S.arr(ConditionS, 0, LIMITS.conditions)),
  do: Actions(),
});

export const SpecS = S.obj<FusionSpec>({
  dsl: S.opt(S.lit(1 as const)),
  concept: S.str(320),
  name: S.str(32),
  flavor: S.str(140),
  stats: S.opt(StatBlockS),
  attack: S.opt(S.obj({ motion: S.opt(S.enm(ATTACK_MOTIONS)) })),
  vars: S.opt(S.arr(S.obj({ id: S.id(), max: S.opt(S.num(1, 100000)), reset: S.opt(S.enm(['never', 'wave_start', 'idle'] as const)) }), 0, LIMITS.vars)),
  statuses: S.opt(S.arr(StatusTplS, 0, LIMITS.statuses)),
  projectiles: S.opt(S.arr(ProjectileTplS, 0, LIMITS.projectiles)),
  zones: S.opt(S.arr(ZoneTplS, 0, LIMITS.zones)),
  vfx: S.opt(S.arr(VfxDefS, 0, LIMITS.vfx)),
  rules: S.arr(RuleS, 1, LIMITS.rules),
  visual: S.opt(VisualS),
  sound: S.opt(S.obj({ preset: S.enm(SOUND_PRESETS), pitch: S.opt(S.num(0.5, 2)) })),
});

let cachedJson: Record<string, unknown> | null = null;
/** JSON Schema of a fusion spec, for Ollama's structured output `format`. */
export function specJsonSchema(): Record<string, unknown> {
  if (!cachedJson) cachedJson = toJsonSchema(SpecS as Schema<unknown>);
  return cachedJson;
}

// ---------------------------------------------------------------- cheat sheet

function variantLines(d: DiscS<unknown>, docs: Record<string, string>): string[] {
  const lines: string[] = [];
  for (const [tag, obj] of d.variants) {
    const params = Object.entries((obj as ObjS<unknown>).shape)
      .filter(([k]) => k !== 'delay' && k !== 'repeat')
      .map(([k, s]) => `${k}${s instanceof OptS ? '?' : ''}: ${s.sketch()}`);
    lines.push(`- ${tag}${params.length ? ` { ${params.join(', ')} }` : ''}${docs[tag] ? ' — ' + docs[tag] : ''}`);
  }
  return lines;
}

/** Compact reference of the whole language, embedded in the LLM prompt. */
export function cheatSheet(builtinVfx: string[]): string {
  const selObj = (EnemySelectorS as unknown as { alts: Schema<unknown>[] }).alts[1] as DiscS<unknown>;
  return [
    'UNITS: distance in tiles (tower ranges are ~2-8 tiles), time in seconds.',
    '',
    'VALUE = number | {"dmg": x} (x times the tower damage per hit; REQUIRED in every damage amount) | {"var": id} | {"stacks": statusId} (target stacks) | {"consumed": true} | {"stored": true} (damage stored by the status, only in its on_expire) | {"target_hp_pct": true} | {"target_missing_hp_pct": true} | {"enemies_in_range": true} | {"distance": true} | {"tier": true} | {"wave": true} | {"random": [a, b]} | {"add"|"mul"|"min"|"max": [VALUE, VALUE...]} (nest at most 3 deep)',
    '',
    'ENEMY SELECTOR = "target" | "all_in_range" | {"select": ...}:',
    ...variantLines(selObj, {
      all_in_radius: 'enemies within radius of target/point/self (default target)',
      random_in_range: 'n random enemies in tower range',
      strongest_in_range: 'n highest-HP enemies in range',
      weakest_in_range: 'n lowest-HP enemies in range',
      first_in_range: 'n enemies closest to the exit',
      last_in_range: 'n enemies furthest from the exit',
      nearest: 'n enemies nearest to target/point/self',
      chain: 'n enemies hopping from the target, each within range of the previous (draws lightning)',
      with_status: 'enemies that have the status (in tower range, or on the whole map)',
    }),
    'TOWER SELECTOR = "self" | {"select": "towers_in_radius", "radius": r}',
    'POINT = "target" | "point" (the impact/context point) | "self" (the tower) | "random_in_range" | {"path_ahead": d} | {"path_behind": d} (on the path, ahead of / behind the target)',
    'AIM = target | away | random | nearest_other | path_back | path_forward',
    '',
    'TRIGGERS (rule.when = {"event": name, ...params}):',
    ...variantLines(TriggerS as DiscS<unknown>, TRIGGER_DOCS),
    '',
    'CONDITIONS (rule.if = list, all must pass; {"check": name, ...}):',
    ...variantLines(ConditionS as DiscS<unknown>, CONDITION_DOCS),
    '',
    'ACTIONS (rule.do = list; {"action": name, ...params}). Every action may also have "delay": seconds and "repeat": {"times": n, "every": s}:',
    ...variantLines(ActionS as DiscS<unknown>, ACTION_DOCS),
    '',
    'BUILT-IN STATUSES: burn (fire DoT), poison (stacking toxic DoT, 10 max), chill (-12% speed per stack, 4 max), freeze (stops; hard CC), stun (stops; hard CC), root (stops; hard CC), shock (next hit +50%), mark (+15% damage taken, reveals stealth), weaken (-2 armor per stack), fear (walks backwards; hard CC), bleed (damage per tile walked), curse (next status applied to it is doubled).',
    'Hard CC grants brief immunity afterwards and is much shorter on bosses. Slows cap at -70%.',
    '',
    'CUSTOM STATUS = ' + StatusTplS.sketch(),
    '  stacking "add": dot, speed_mult and damage_taken_mult apply per stack. stores_damage: fraction of damage taken that is stored and readable as {"stored": true} in on_expire. Inside status actions, "target" = the enemy carrying it.',
    'CUSTOM PROJECTILE = ' + ProjectileTplS.sketch(),
    '  motions: straight, homing, lob (arcs to the aim point and splashes), boomerang (flies out and returns), orbit (circles the tower), spiral, sine, sky_drop (falls from the sky onto the aim point after 0.5 s), path_crawl (rolls along the path toward the spawn, hitting everything), mine (sits on the path until an enemy steps on it), hitscan (instant line). "bullet" is a built-in homing projectile (50% damage).',
    'CUSTOM ZONE = ' + ZoneTplS.sketch(),
    '  path_segment covers the path within radius (along the path) of the point. Inside zone actions, "target" = each enemy inside.',
    'VARS = [{ id, max?, reset?: never|wave_start|idle }] per-tower counters starting at 0.',
    'STATS = ' + StatBlockS.sketch() + '  (passive modifiers of the tower itself)',
    'ATTACK = { motion?: ' + ATTACK_MOTIONS.join('|') + ' } changes how the basic projectile flies (projectile towers only).',
    '',
    '=== VISUALS (as important as the mechanics: every fusion must LOOK like its concept) ===',
    'Style: flat diep.io shapes with dark outlines by default; "glow": true makes a layer soft, additive light (lasers, magic, fire).',
    'COLOR = "base" | "secondary" | "tertiary" (colour of that socketed power) | "damage" (damage-type colour) | "#rrggbb"',
    'VFX = { id, layers: [LAYER, ... up to 4] } — define up to 6 under the top-level "vfx" list and reference them by id anywhere a vfx id is expected.',
    'LAYER kinds:',
    '- particles ' + (VfxLayerS as DiscS<unknown>).variants.get('particles')!.sketch() +
      '\n    count = burst size for one-shot effects; rate = particles/second for continuous ones (auras, statuses, zones, projectile emitters, sprays). ' +
      'direction is relative to the aim (aim = forward, back, radial = outward, inward, up/down = screen, sideways). emit_from ring/area/line uses radius. ' +
      'size/alpha/speed/life are [start,end] or [min,max] pairs. gravity < 0 rises. drag slows particles.',
    '- beam ' + (VfxLayerS as DiscS<unknown>).variants.get('beam')!.sketch() +
      '\n    drawn from `at` to `to`. width = [at start, at end]. core = bright inner line. styles: solid, dashed, dotted, wave, helix (two twisting strands), zigzag, lightning (jagged, re-rolled each frame), chain (links), twin (two parallel lines).',
    '- shape ' + (VfxLayerS as DiscS<unknown>).variants.get('shape')!.sketch() +
      '\n    an animated outline/fill growing from radius[0] to radius[1] over duration (rings, shockwaves, sigils, flashes, spinning stars). count = staggered copies.',
    '- orbiters ' + (VfxLayerS as DiscS<unknown>).variants.get('orbiters')!.sketch() + '  (small shapes circling the anchor)',
    '- text { text, color?, size?, duration? }   - shake { strength 0..1, duration? } (screen shake, keep it rare)',
    'HOOKS: top-level "visual" = ' + VisualS.sketch(),
    '  body = decoration drawn on the tower; aura = vfx looping around the tower; muzzle = vfx on each attack at the barrel (aimed); impact = vfx on each hit; kill = vfx when it kills;',
    '  projectile = look of the basic projectile (projectile/lob towers); beam = look of the basic beam/line/lightning (Prism, Rail, Arc); spray = particle look of the basic spray (Flame).',
    '  custom statuses: tint, icon, overlay, scale, vfx (looping on the carrier). custom projectiles: look {shape,size,color,spin,glow,trail,trail_color,emitter}, beam (hitscan look), impact. custom zones: style, color, vfx (looping inside). explode.vfx, and the "vfx" action anywhere in rules.',
    'BUILT-IN VFX ids (usable anywhere a vfx id is expected): ' + builtinVfx.join(', '),
    'Examples:',
    '  mist sprayer: "spray": {"shape":"soft","rate":40,"color":"#dff6ff","color_end":"base","size":[0.2,0.8],"alpha":[0.5,0],"speed":[2,4],"life":[0.4,0.9],"spread":35,"drag":2.5}',
    '  heavy laser: "beam": {"style":"solid","width":[0.35,0.25],"color":"base","core":"#ffffff","glow":true,"pulse":0.4,"flicker":0.2} with "muzzle": a vfx of a glowing shape circle + inward particles',
    '  frost nova: {"id":"frost_nova","layers":[{"kind":"shape","shape":"star","sides":6,"radius":[0.2,1.6],"thickness":0.08,"color":"base","alpha":[1,0],"rotate":2,"duration":0.5},{"kind":"particles","count":24,"shape":"flake","direction":"radial","speed":[2,5],"life":[0.3,0.7],"size":[0.12,0.03],"spin":6,"color":"#ffffff","outline":true}]}',
  ].join('\n');
}
