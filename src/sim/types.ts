// Runtime + content types for the simulation.

import type {
  Action, DamageType, FusionSpec, Trait, Motion, ProjShape, Trail, ZoneStyle, StatusOverlay, IconShape,
  Value, SoundPreset, VfxDef, BeamLayer,
} from '../effects/types.ts';

export type BeamLook = Omit<BeamLayer, 'kind'>;

export type { DamageType, Trait };

export type TargetMode = 'first' | 'last' | 'strong' | 'weak' | 'close';
export const TARGET_MODES: readonly TargetMode[] = ['first', 'last', 'strong', 'weak', 'close'];

export type ChassisKind = 'projectile' | 'lob' | 'chain' | 'hitscan' | 'cone' | 'beam' | 'aura' | 'drones';

export type Tier3 = [number, number, number];

// ---------------------------------------------------------------- content

export interface TowerDef {
  id: string;
  name: string;
  role: string;
  blurb: string;
  hotkey: string;
  chassis: ChassisKind;
  cost: number;
  upgradeCost: [number, number];
  damage: Tier3;
  rate: Tier3; // attacks per second
  range: Tier3; // tiles
  dtype: DamageType;
  hitsAir: boolean;
  hitsGround: boolean;
  projectileSpeed?: number;
  splash?: Tier3;
  chains?: Tier3;
  chainRange?: number;
  coneAngle?: number; // degrees, total
  drones?: Tier3;
  auraRate?: Tier3;
  auraRange?: Tier3;
  minRange?: number;
  flightTime?: number;
  /** Multiplier on proc chances for this chassis (fast-hitting towers proc less per hit). */
  procCoef: number;
  /** every_nth_attack counts are multiplied by this for towers with very fast attack cadence. */
  nthScale: number;
  /** Text given to the LLM describing the chassis. */
  card: string;
  /** Built-in status every hit applies (Frost: chill, Flame: burn). */
  onHitStatus?: string;
  /** Radius of the basic projectile in tiles. */
  projRadius?: number;
}

export interface EnemyAbility {
  kind:
    | 'heal' | 'blink' | 'burrow' | 'spawn' | 'split' | 'revive' | 'haste_aura' | 'phase' | 'mimic'
    | 'carapace' | 'stomp' | 'rewind_hp' | 'phases';
  every?: number;
  radius?: number;
  amount?: number;
  duration?: number;
  enemy?: string;
  count?: number;
}

export type EnemyShape = 'poly' | 'circle';

/** Per-group spawn modifiers that give any shape a gameplay twist. */
export type SpawnMod = 'swarm' | 'flying' | 'swift' | 'elite' | 'stealth';
export const SPAWN_MODS: readonly SpawnMod[] = ['swarm', 'flying', 'swift', 'elite', 'stealth'];

export interface EnemyDef {
  id: string;
  name: string;
  blurb: string;
  /** 2 = polygon, 3 = polyhedron, 4 = polytope. */
  dim: 2 | 3 | 4;
  /** Sides (2D), faces (3D) or cells (4D). 0 = the smooth limit (circle / sphere / glome). */
  n: number;
  /** 3D/4D model id for the renderer. */
  poly?: string;
  shape: EnemyShape;
  color: string;
  hp: number;
  speed: number;
  armor: number;
  shield: number;
  bounty: number;
  lives: number;
  size: number; // radius in tiles
  traits: Trait[];
  tenacity: number; // CC duration multiplier (1 = full)
  abilities: EnemyAbility[];
  /** Wave-budget cost. */
  cost: number;
  /** First wave it appears in generated waves (0 = never randomly). */
  intro: number;
}

export interface PowerDef {
  id: string;
  name: string;
  family: 'elements' | 'forms' | 'tempo' | 'fortune' | 'matter';
  color: string;
  icon: string;
  tags: string[];
  blurb: string;
  adj: string; // for offline names
  noun: string;
  spec: FusionSpec;
}

export interface MapDef {
  id: string;
  name: string;
  blurb: string;
  cols: number;
  rows: number;
  /** Ground paths in tile coordinates (centers at .5). Waypoints must be axis-aligned for ground paths. */
  paths: [number, number][][];
  air: [number, number][][];
  blocked: [number, number][];
  seed: number;
  difficulty: number; // 1..5 stars
  /** Map-level enemy HP multiplier (short paths get weaker enemies). */
  hpScale: number;
  /** Ground path index per spawn: 'alternate' splits groups between paths. */
  pathMode: 'first' | 'alternate' | 'per_group';
  /** Campaign act (1 Flatland, 2 Solidspace, 3 Hyperspace) and run length. */
  act: 1 | 2 | 3;
  waves: number;
  /** Look of the map (see client/render/scenery.ts); purely visual. Defaults to 'plain'. */
  theme?: string;
}

export interface SpawnGroup {
  enemy: string;
  count: number;
  interval: number;
  delay: number;
  path: number; // ground path index, or air lane index if the enemy flies (-1 = alternate)
  mods?: SpawnMod[];
}

export interface WaveDef {
  n: number;
  groups: SpawnGroup[];
  hpMult: number;
  boss: string | null;
  reward: number;
  carapace: DamageType | null;
  mutators: string[];
}

export interface DifficultyDef {
  id: 'casual' | 'normal' | 'hard' | 'brutal';
  name: string;
  hp: number;
  lives: number;
  gold: number;
  bounty: number;
}

// ---------------------------------------------------------------- runtime

export interface StatusDefRT {
  key: string;
  name: string;
  builtin: boolean;
  stacking: 'refresh' | 'add';
  maxStacks: number;
  duration: number;
  speedMult: number;
  dmgTakenMult: number;
  armorDelta: number;
  hardCC: boolean;
  reverse: boolean;
  storesDamage: number;
  damagePerTile: Value | null;
  dot: { amount: Value; type: DamageType | null } | null;
  tick: { every: number; do: Action[] } | null;
  onApply: Action[] | null;
  onExpire: Action[] | null;
  onDeath: Action[] | null;
  tint: string;
  icon: IconShape;
  overlay: StatusOverlay;
  scale: number;
  vfx: VfxDef | null;
  /** The spec runtime that defines this status (custom statuses only). */
  owner: SpecRuntime | null;
}

export interface StatusInst {
  def: StatusDefRT;
  stacks: number;
  remaining: number;
  source: number; // tower id
  tickTimer: number;
  stored: number;
  dotPerStack: number;
  perTile: number;
  potency: number;
  dmgBase: number;
}

export interface Enemy {
  id: number;
  def: EnemyDef;
  alive: boolean;
  removed: boolean;
  pathIdx: number;
  air: boolean;
  dist: number;
  lateral: number;
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  rot: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  armor: number;
  speed: number;
  size: number;
  resist: Partial<Record<DamageType, number>>;
  immune: DamageType | null;
  statuses: StatusInst[];
  moveMult: number;
  dmgTakenMult: number;
  armorDelta: number;
  hardCC: boolean;
  reverse: boolean;
  ccImmuneUntil: number;
  revealedUntil: number;
  burrowed: boolean;
  lastHitTick: number;
  timers: number[];
  phaseHits: Map<number, number> | null;
  mimicTally: Partial<Record<DamageType, number>> | null;
  hist: Float32Array;
  histIdx: number;
  histTimer: number;
  lastRewindTick: number;
  shrunk: boolean;
  special: number; // boss phase / one-shot flags
  bounty: number;
  lives: number;
  killer: number;
  hitFlash: number;
  hitBy: Set<number>;
  spawnTick: number;
  tenacity: number;
  hasteMult: number;
  visScale: number;
  waveN: number;
  zoneSpeed: number;
  zoneDmg: number;
  hpHist: Float32Array;
  flying: boolean;
  traitSet: Set<string>;
  mods: SpawnMod[];
}

export interface TowerStats {
  damage: number;
  rate: number;
  range: number;
  splash: number;
  multishot: number;
  pierce: number;
  bounce: number;
  chains: number;
  critChance: number;
  critMult: number;
  drones: number;
  auraRate: number;
  auraRange: number;
}

/** A power card in hand or in a socket. */
export interface Card {
  uid: number;
  power: string;
  rarity: number; // 0 common, 1 rare, 2 epic, 3 legendary
}

export interface TempMod {
  stat: 'damage' | 'rate' | 'range';
  mult: number;
  until: number;
  src: string;
}

export type SpecState = 'none' | 'single' | 'provisional' | 'forging' | 'ready' | 'offline';

export interface Tower {
  id: number;
  def: TowerDef;
  c: number;
  r: number;
  x: number;
  y: number;
  tier: 1 | 2 | 3;
  angle: number;
  targetMode: TargetMode;
  targetId: number;
  cooldown: number;
  sockets: string[];
  cards: Card[];
  specKey: string;
  specState: SpecState;
  rt: SpecRuntime | null;
  stats: TowerStats;
  invested: number;
  socketGold: number;
  placedTick: number;
  kills: number;
  dmgTotal: number;
  dmgWave: number;
  attackCount: number;
  lastAttackTick: number;
  disabledUntil: number;
  barrel: number;
  recoil: number;
  beamTargets: number[];
  beamRamp: number;
  beamTimer: number;
  coneOn: boolean;
  drones: number[];
  droneTimer: number;
  mods: TempMod[];
  inRange: Set<number> | null;
  goldWave: number;
  livesWave: number;
  conduits: Tower[];
  aura: number; // beacon buff strength applied to this tower (for display)
  liveSpawns: number;
  eventsThisTick: number;
  lastAttackEventTick: number;
  look: ProjLook;
}

export interface Projectile {
  id: number;
  tower: number;
  alive: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  speed: number;
  motion: Motion;
  age: number;
  life: number;
  radius: number;
  targetId: number;
  damage: number;
  dtype: DamageType;
  pierce: number;
  bounce: number;
  splash: number;
  hitsAir: boolean;
  hitsGround: boolean;
  hit: number[];
  depth: number;
  isBase: boolean;
  procCoef: number;
  crit: boolean;
  tpl: ProjTplRT | null;
  rt: SpecRuntime | null;
  // motion state
  ox: number;
  oy: number;
  ang: number;
  t: number;
  returning: boolean;
  tx: number;
  ty: number;
  height: number;
  pathIdx: number;
  pathDist: number;
  applyStatus: string | null;
  dmgBase: number;
  potency: number;
  hostId: number;
  // visuals
  look: ProjLook;
}

export interface ProjLook {
  shape: ProjShape;
  color: string;
  trail: Trail;
  trailColor: string;
  spin: boolean;
  glow: boolean;
  size: number;
  emitter: VfxDef | null;
  impact: VfxDef | null;
  beam: BeamLook | null;
}

export interface ProjTplRT {
  id: string;
  motion: Motion;
  speed: number;
  size: number;
  lifetime: number;
  pierce: number;
  bounce: number;
  splash: number;
  amount: Value;
  type: DamageType | null;
  hitsAir: boolean;
  onHit: Action[] | null;
  onEnd: Action[] | null;
  look: ProjLook;
}

export interface ZoneTplRT {
  id: string;
  shape: 'circle' | 'ring' | 'path_segment';
  radius: number;
  duration: number;
  follows: 'none' | 'target' | 'self';
  speedMult: number;
  dmgTakenMult: number;
  tick: { every: number; do: Action[] } | null;
  onEnter: Action[] | null;
  onExit: Action[] | null;
  style: ZoneStyle;
  color: string;
  vfx: VfxDef | null;
}

export interface Zone {
  id: number;
  tower: number;
  alive: boolean;
  x: number;
  y: number;
  life: number;
  age: number;
  followId: number;
  tickTimer: number;
  tpl: ZoneTplRT;
  rt: SpecRuntime;
  inside: Set<number>;
  depth: number;
  pathIdx: number;
  pathDist: number;
  potency: number;
  dmgBase: number;
}

export interface Drone {
  id: number;
  tower: number;
  alive: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  angle: number;
  targetId: number;
  sting: number;
  life: number;
  damage: number;
  isBase: boolean;
  depth: number;
  color: string;
  phase: number;
}

// ---------------------------------------------------------------- spec runtime

export interface Palette3 {
  base: string;
  secondary: string;
  tertiary: string;
}

export interface RuleRT {
  idx: number;
  event: string;
  rule: import('../effects/types.ts').Rule;
  cooldownUntil: number;
  nthCounter: number;
  attackCounter: number;
  timer: number;
  idleFired: boolean;
  statusKey: string | null;
  lastSpawnTick: number;
}

export interface SpecRuntime {
  key: string;
  spec: FusionSpec;
  potency: number;
  rules: RuleRT[];
  byEvent: Map<string, RuleRT[]>;
  statuses: Map<string, StatusDefRT>;
  projectiles: Map<string, ProjTplRT>;
  zones: Map<string, ZoneTplRT>;
  vars: Map<string, number>;
  varMax: Map<string, number>;
  varReset: Map<string, string>;
  colors: Palette3;
  vfx: Map<string, VfxDef>;
  firstHits: Set<number>;
  needsRangeTracking: boolean;
}

// ---------------------------------------------------------------- fx events (sim -> renderer)

export type FxEvent =
  | { k: 'shot'; tower: number; x: number; y: number; ang: number; sound: SoundPreset; pitch: number }
  | { k: 'hit'; x: number; y: number; vfx: VfxDef | null; colors: Palette3; dcolor: string; size: number }
  | { k: 'boom'; x: number; y: number; r: number; vfx: VfxDef | null; colors: Palette3; dcolor: string }
  | { k: 'beam'; x1: number; y1: number; x2: number; y2: number; look: BeamLook; colors: Palette3; dcolor: string; dur: number; pts?: number[] }
  | { k: 'death'; e: Enemy; vfx: VfxDef | null; colors: Palette3 }
  | { k: 'text'; x: number; y: number; text: string; color: string; big?: boolean }
  | { k: 'leak'; x: number; y: number; lives: number }
  | { k: 'sound'; preset: SoundPreset; pitch: number; vol: number }
  | { k: 'vfx'; def: VfxDef; x: number; y: number; x2: number; y2: number; ang: number; colors: Palette3; dcolor: string; size: number; tint: string | null; text: string | null }
  | { k: 'stomp'; x: number; y: number; r: number }
  | { k: 'blink'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'gold'; x: number; y: number; amount: number };
