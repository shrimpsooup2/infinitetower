// The effect language ("fusion spec"). Every power and every fusion is one of
// these. The LLM writes them; the engine interprets them. Nothing here is code.
//
// Two halves:
//   * behaviour: triggers -> conditions -> actions, plus custom statuses,
//     projectiles and zones built from the same actions;
//   * visuals: a small VFX language (particle emitters, beams, animated shapes,
//     orbiters, text, shake) composed into named effects and hooked onto the
//     tower, its attacks, statuses, zones and rules.

export type DamageType = 'kinetic' | 'fire' | 'frost' | 'shock' | 'toxic' | 'arcane';
export const DAMAGE_TYPES: readonly DamageType[] = ['kinetic', 'fire', 'frost', 'shock', 'toxic', 'arcane'];

export type Trait = 'boss' | 'flying' | 'armored' | 'shielded' | 'fast' | 'stealth' | 'elite';
export const TRAITS: readonly Trait[] = ['boss', 'flying', 'armored', 'shielded', 'fast', 'stealth', 'elite'];

export const BUILTIN_STATUSES = [
  'burn', 'poison', 'chill', 'freeze', 'stun', 'root', 'shock', 'mark', 'weaken', 'fear', 'bleed', 'curse',
] as const;
export type BuiltinStatus = (typeof BUILTIN_STATUSES)[number];

// ---------------------------------------------------------------- values

export type Value =
  | number
  | { dmg: number }
  | { var: string }
  | { stacks: string }
  | { consumed: true }
  | { stored: true }
  | { target_hp_pct: true }
  | { target_missing_hp_pct: true }
  | { enemies_in_range: true }
  | { distance: true }
  | { tier: true }
  | { wave: true }
  | { random: [number, number] }
  | { add: Value[] }
  | { mul: Value[] }
  | { min: Value[] }
  | { max: Value[] };

// ---------------------------------------------------------------- selectors

export type Anchor = 'target' | 'point' | 'self';

export type EnemySelector =
  | 'target'
  | 'all_in_range'
  | { select: 'all_in_radius'; radius: number; around?: Anchor }
  | { select: 'random_in_range'; n: number }
  | { select: 'strongest_in_range'; n: number }
  | { select: 'weakest_in_range'; n: number }
  | { select: 'first_in_range'; n: number }
  | { select: 'last_in_range'; n: number }
  | { select: 'nearest'; n: number; around?: Anchor; exclude_target?: boolean }
  | { select: 'chain'; n: number; range: number }
  | { select: 'with_status'; status: string; within?: 'range' | 'map' };

export type TowerSelector = 'self' | { select: 'towers_in_radius'; radius: number };

export type PointRef = 'target' | 'point' | 'self' | 'random_in_range' | { path_ahead: number } | { path_behind: number };

export type Aim = 'target' | 'away' | 'random' | 'nearest_other' | 'path_back' | 'path_forward';

// ---------------------------------------------------------------- triggers

export type Trigger =
  | { event: 'on_attack' }
  | { event: 'on_hit' }
  | { event: 'on_kill' }
  | { event: 'on_crit' }
  | { event: 'every_nth_attack'; n: number }
  | { event: 'every'; seconds: number }
  | { event: 'on_beat'; n: number }
  | { event: 'on_idle'; seconds: number }
  | { event: 'on_enemy_enters_range' }
  | { event: 'on_enemy_leaves_range' }
  | { event: 'on_status_applied'; status: string }
  | { event: 'on_status_expired'; status: string }
  | { event: 'on_enemy_dies_in_range' }
  | { event: 'on_projectile_end'; projectile: string }
  | { event: 'on_var_reached'; var: string; value: number }
  | { event: 'on_wave_start' }
  | { event: 'on_wave_end' }
  | { event: 'on_ally_hit' };

export type TriggerEvent = Trigger['event'];

// ---------------------------------------------------------------- conditions

export type Condition =
  | { check: 'chance'; p: number }
  | { check: 'cooldown'; seconds: number }
  | { check: 'target_hp_below'; pct: number }
  | { check: 'target_hp_above'; pct: number }
  | { check: 'target_has_status'; status: string; min_stacks?: number }
  | { check: 'target_lacks_status'; status: string }
  | { check: 'target_is'; trait: Trait }
  | { check: 'target_is_not'; trait: Trait }
  | { check: 'var_at_least'; var: string; value: number }
  | { check: 'var_below'; var: string; value: number }
  | { check: 'enemies_in_range_at_least'; n: number }
  | { check: 'target_distance'; min?: number; max?: number }
  | { check: 'first_hit_on_target' }
  | { check: 'every_nth'; n: number };

// ---------------------------------------------------------------- visuals
// Everything is drawn by the engine in the flat diep.io style by default
// (filled shapes with a darker outline); `glow` switches a layer to soft,
// additive light for lasers, magic and fire.

/** "base" | "secondary" | "tertiary" (colour of that socketed power) | "damage" (damage-type colour) | "#rrggbb". */
export type ColorRef = string;
export type Range2 = [number, number];

export const PARTICLE_SHAPES = [
  'circle', 'soft', 'square', 'triangle', 'star', 'spark', 'ring', 'shard', 'line', 'smoke', 'bubble', 'petal', 'flake', 'drop',
] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];
export const PARTICLE_DIRECTIONS = ['aim', 'back', 'radial', 'inward', 'up', 'down', 'random', 'sideways'] as const;
export const EMIT_FROM = ['point', 'ring', 'area', 'line'] as const;
export const BEAM_STYLES = ['solid', 'dashed', 'dotted', 'wave', 'helix', 'zigzag', 'lightning', 'chain', 'twin'] as const;
export const SHAPE_KINDS = ['circle', 'ring', 'polygon', 'star', 'cross', 'crescent', 'spiral', 'rays', 'glyph'] as const;

export interface ParticleLayer {
  kind: 'particles';
  count?: number; // burst size (one-shot effects)
  rate?: number; // particles per second (continuous effects: auras, statuses, zones, trails, sprays)
  shape?: ParticleShape;
  color?: ColorRef;
  color_end?: ColorRef;
  size?: Range2; // start, end (tiles)
  alpha?: Range2; // start, end
  speed?: Range2; // min, max (tiles/s)
  life?: Range2; // min, max (s)
  spread?: number; // degrees around the direction
  direction?: (typeof PARTICLE_DIRECTIONS)[number];
  gravity?: number; // tiles/s^2, negative = rises
  drag?: number;
  spin?: number; // rad/s
  wobble?: number;
  emit_from?: (typeof EMIT_FROM)[number];
  radius?: number; // for ring/area/line emitters (tiles)
  outline?: boolean;
  glow?: boolean;
}

export interface BeamLayer {
  kind: 'beam';
  style?: (typeof BEAM_STYLES)[number];
  width?: Range2; // at start, at end (taper)
  color?: ColorRef;
  core?: ColorRef; // bright inner line
  glow?: boolean;
  amplitude?: number; // wave/helix/zigzag/lightning size (tiles)
  frequency?: number;
  scroll?: number; // texture scroll speed
  flicker?: number; // 0..1
  pulse?: number; // 0..1 width pulsing
  duration?: number; // for one-shot beams (s)
}

export interface ShapeLayer {
  kind: 'shape';
  shape?: (typeof SHAPE_KINDS)[number];
  sides?: number;
  radius?: Range2; // start, end (tiles)
  thickness?: number; // outline thickness (tiles); ignored when fill
  fill?: boolean;
  color?: ColorRef;
  alpha?: Range2;
  rotate?: number; // rad/s
  duration?: number;
  count?: number; // staggered concentric copies
  dashed?: boolean;
  glow?: boolean;
}

export interface OrbitersLayer {
  kind: 'orbiters';
  count: number;
  radius: number;
  size?: number;
  shape?: ParticleShape;
  color?: ColorRef;
  speed?: number; // rad/s
  wobble?: number;
  glow?: boolean;
}

export interface TextLayer {
  kind: 'text';
  text: string;
  color?: ColorRef;
  size?: number;
  duration?: number;
}

export interface ShakeLayer {
  kind: 'shake';
  strength: number;
  duration?: number;
}

export type VfxLayer = ParticleLayer | BeamLayer | ShapeLayer | OrbitersLayer | TextLayer | ShakeLayer;

export interface VfxDef {
  id: string;
  layers: VfxLayer[];
}

export const PROJ_SHAPES = ['circle', 'square', 'triangle', 'star', 'ring', 'shard', 'crescent', 'needle', 'orb', 'blade'] as const;
export type ProjShape = (typeof PROJ_SHAPES)[number];
export const TRAILS = ['none', 'line', 'ribbon', 'dots', 'ghost'] as const;
export type Trail = (typeof TRAILS)[number];

export interface ProjectileLook {
  shape?: ProjShape;
  size?: number; // multiplier
  color?: ColorRef;
  spin?: boolean;
  glow?: boolean;
  trail?: Trail;
  trail_color?: ColorRef;
  emitter?: string; // vfx id emitted continuously along the flight
}

export const BODY_DECOR = ['plain', 'spikes', 'gear', 'petals', 'shell', 'crystal', 'eye', 'core', 'halo_ring', 'fins'] as const;
export const ICON_SHAPES = ['dot', 'ring', 'cross', 'diamond', 'star', 'triangle', 'bell', 'skull', 'spiral', 'eye', 'flame', 'drop'] as const;
export type IconShape = (typeof ICON_SHAPES)[number];
export const STATUS_OVERLAYS = ['none', 'shell', 'flames', 'bubbles', 'sparks', 'orbit', 'cracks', 'glow', 'shadow', 'drip', 'chains'] as const;
export type StatusOverlay = (typeof STATUS_OVERLAYS)[number];
export const ZONE_STYLES = ['fill', 'dashed', 'ripples', 'spiral', 'hazard', 'glyph', 'grid', 'vortex', 'none'] as const;
export type ZoneStyle = (typeof ZONE_STYLES)[number];

export const SOUND_PRESETS = ['pew', 'zap', 'boom', 'chime', 'thud', 'hiss', 'warble', 'pluck', 'laser', 'whoosh'] as const;
export type SoundPreset = (typeof SOUND_PRESETS)[number];

export interface Visual {
  body?: (typeof BODY_DECOR)[number];
  accent?: ColorRef;
  aura?: string; // vfx ref shown continuously around the tower
  muzzle?: string; // vfx ref on every attack, at the barrel, aimed
  impact?: string; // vfx ref on every hit
  kill?: string; // vfx ref when this tower kills
  projectile?: ProjectileLook; // look of the basic projectile (projectile/lob towers)
  beam?: Omit<BeamLayer, 'kind'>; // look of the basic beam / line / lightning (beam, hitscan, chain towers)
  spray?: Omit<ParticleLayer, 'kind'>; // look of the basic spray (cone towers)
}

export interface Sound {
  preset: SoundPreset;
  pitch?: number;
}

// ---------------------------------------------------------------- actions

export interface ActionTiming {
  delay?: number;
  repeat?: { times: number; every: number };
}

export type ActionBody =
  | { action: 'damage'; to: EnemySelector; amount: Value; type?: DamageType }
  | { action: 'explode'; at: PointRef; radius: number; amount: Value; type?: DamageType; vfx?: string }
  | { action: 'execute'; to: EnemySelector; below_pct: number }
  | { action: 'apply_status'; to: EnemySelector; status: string; stacks?: number; duration?: number }
  | { action: 'remove_status'; to: EnemySelector; status: string }
  | { action: 'consume_status'; to: EnemySelector; status: string }
  | { action: 'spread_statuses'; radius: number; max_targets?: number }
  | { action: 'knockback'; to: EnemySelector; distance: Value }
  | { action: 'pull'; to: EnemySelector; toward: PointRef; strength: Value }
  | { action: 'teleport_along_path'; to: EnemySelector; distance: Value }
  | { action: 'rewind_position'; to: EnemySelector; seconds: number }
  | { action: 'swap_positions'; with: 'first_in_range' | 'last_in_range' | 'random_in_range' }
  | { action: 'shrink'; to: EnemySelector; hp_mult: number; speed_mult: number }
  | { action: 'fire_projectile'; projectile: string; from?: PointRef; aim?: Aim; count?: number; spread?: number }
  | { action: 'create_zone'; zone: string; at: PointRef }
  | { action: 'summon_drone'; count: number; lifetime: number; damage: Value }
  | { action: 'repeat_attack'; mult: number }
  | { action: 'modify_tower'; to: TowerSelector; stat: 'damage' | 'rate' | 'range'; mult: number; duration: number }
  | { action: 'set_var'; var: string; value: Value }
  | { action: 'add_var'; var: string; amount: Value }
  | { action: 'grant_gold'; amount: number }
  | { action: 'restore_life'; amount: number }
  | { action: 'reveal'; to: EnemySelector; duration: number }
  | { action: 'break_shield'; to: EnemySelector; pct: number }
  | { action: 'vfx'; effect: string; at: PointRef; to?: PointRef; size?: number; color?: ColorRef; text?: string }
  | { action: 'sound'; preset: SoundPreset; pitch?: number };

export type Action = ActionTiming & ActionBody;
export type ActionName = ActionBody['action'];

// ---------------------------------------------------------------- templates

export interface StatusTpl {
  id: string;
  name: string;
  stacking?: 'refresh' | 'add';
  max_stacks?: number;
  duration: number;
  speed_mult?: number;
  damage_taken_mult?: number;
  armor_delta?: number;
  hard_cc?: boolean;
  reverse?: boolean;
  stores_damage?: number;
  damage_per_tile?: Value;
  dot?: { amount: Value; type?: DamageType };
  tick?: { every: number; do: Action[] };
  on_apply?: Action[];
  on_expire?: Action[];
  on_death?: Action[];
  tint?: ColorRef;
  icon?: IconShape;
  overlay?: StatusOverlay;
  scale?: number;
  vfx?: string; // continuous effect on the carrier
}

export const PROJECTILE_MOTIONS = [
  'straight', 'homing', 'lob', 'boomerang', 'orbit', 'spiral', 'sine', 'sky_drop', 'path_crawl', 'mine', 'hitscan',
] as const;
export type Motion = (typeof PROJECTILE_MOTIONS)[number];

export interface ProjectileTpl {
  id: string;
  motion: Motion;
  speed?: number;
  size?: number;
  lifetime?: number;
  pierce?: number;
  bounce?: number;
  splash?: number;
  amount: Value;
  type?: DamageType;
  hits_air?: boolean;
  on_hit?: Action[];
  on_end?: Action[];
  look?: ProjectileLook;
  beam?: Omit<BeamLayer, 'kind'>; // look for hitscan projectiles
  impact?: string;
}

export interface ZoneTpl {
  id: string;
  shape: 'circle' | 'ring' | 'path_segment';
  radius: number;
  duration: number;
  follows?: 'none' | 'target' | 'self';
  speed_mult?: number;
  damage_taken_mult?: number;
  tick?: { every: number; do: Action[] };
  on_enter?: Action[];
  on_exit?: Action[];
  style?: ZoneStyle;
  color?: ColorRef;
  vfx?: string; // continuous effect inside the zone
}

export interface VarDef {
  id: string;
  max?: number;
  reset?: 'never' | 'wave_start' | 'idle';
}

export interface Rule {
  when: Trigger;
  if?: Condition[];
  do: Action[];
}

export interface StatBlock {
  damage_mult?: number;
  rate_mult?: number;
  range_mult?: number;
  splash_mult?: number;
  multishot?: number;
  pierce?: number;
  bounce?: number;
  chains?: number;
  crit_chance?: number;
  crit_mult?: number;
}

export const ATTACK_MOTIONS = ['straight', 'homing', 'boomerang', 'spiral', 'sine'] as const;
export type AttackMotion = (typeof ATTACK_MOTIONS)[number];

export interface FusionSpec {
  dsl: 1;
  concept: string;
  name: string;
  flavor: string;
  stats?: StatBlock;
  attack?: { motion?: AttackMotion };
  vars?: VarDef[];
  statuses?: StatusTpl[];
  projectiles?: ProjectileTpl[];
  zones?: ZoneTpl[];
  vfx?: VfxDef[];
  rules: Rule[];
  visual?: Visual;
  sound?: Sound;
}
