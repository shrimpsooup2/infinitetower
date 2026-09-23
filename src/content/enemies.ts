// Enemies are geometry. A run climbs through dimensions:
//   Flatland (2D)    : polygons with 3..14 sides. More sides = tougher. The
//                      plain ones have no effects; 11-14 sides have one.
//   Solidspace (3D)  : polyhedra, counted by faces. Platonic solids are plain;
//                      complex solids have powers whose strength scales with
//                      their face count.
//   Hyperspace (4D)  : polytopes, counted by cells. All have powers scaled by
//                      cell count, and all can "phase" through the 4th axis.
// Each dimension ends in its limit: the Circle, the Sphere, the Glome.
// Variety (flying, swarm, swift, elite, stealth) comes from per-group
// modifiers applied to any shape, not from separate enemy types.

import type { EnemyDef, EnemyAbility } from '../sim/types.ts';

type Def = Omit<EnemyDef, 'armor' | 'shield' | 'lives' | 'size' | 'traits' | 'tenacity' | 'abilities' | 'cost' | 'shape' | 'blurb'> &
  Partial<EnemyDef>;

function E(d: Def): EnemyDef {
  return {
    armor: 0, shield: 0, lives: 1, size: 0.28, traits: [], tenacity: 1, abilities: [], cost: 1, shape: 'poly',
    blurb: '', ...d,
  } as EnemyDef;
}

// ------------------------------------------------------------------ 2D
// A colour for every side count, starting from diep's own palette.
const C2 = ['#fc7677', '#ffe869', '#768dfc', '#8efffb', '#b4ff8e', '#ffa94d', '#f177dd', '#bf7ff5', '#8ef0c4', '#ffd166', '#6fd6ff', '#ff8e8e'];
const NAMES2 = ['Triangle', 'Square', 'Pentagon', 'Hexagon', 'Heptagon', 'Octagon', 'Nonagon', 'Decagon', 'Hendecagon', 'Dodecagon', 'Tridecagon', 'Tetradecagon'];
const HP2 = [20, 40, 75, 120, 175, 240, 320, 410, 380, 520, 480, 560];
const SPEED2 = [1.5, 1.0, 0.9, 0.85, 0.8, 0.76, 0.72, 0.68, 0.75, 0.62, 0.7, 0.85];
const ARMOR2 = [0, 0, 1, 2, 3, 4, 5, 6, 0, 3, 0, 0];

const abilities2: Record<number, { a: EnemyAbility[]; blurb: string; traits?: EnemyDef['traits']; shield?: number }> = {
  11: { a: [], shield: 11 * 25, traits: ['shielded'], blurb: 'Eleven edges of regenerating shield (strength = 25 per side). Shock breaks shields twice as fast.' },
  12: { a: [{ kind: 'split', enemy: 'p6', count: 2 }], blurb: 'Twelve sides = six + six: splits into two Hexagons when destroyed.' },
  13: { a: [{ kind: 'heal', every: 3, radius: 1.9, amount: 0.13 }], traits: ['elite'], blurb: 'Every 3 s heals nearby shapes for 13% of their HP (1% per side). Kill it first.' },
  14: { a: [{ kind: 'blink', every: 4, amount: 1.4 }, { kind: 'phase', count: 2 }], blurb: 'Blinks 1.4 tiles ahead every 4 s (0.1 per side) and ignores the first 2 hits from each tower.' },
};

const FLAT: EnemyDef[] = NAMES2.map((name, i) => {
  const n = i + 3;
  const sp = abilities2[n];
  return E({
    id: `p${n}`, name, dim: 2, n, color: C2[i], hp: HP2[i], speed: SPEED2[i], armor: ARMOR2[i],
    bounty: Math.round(2 + n * 0.9), size: 0.18 + n * 0.012, cost: HP2[i] / 40, intro: 0,
    abilities: sp?.a ?? [], traits: [...(sp?.traits ?? []), ...(ARMOR2[i] >= 4 ? ['armored' as const] : [])], shield: sp?.shield ?? 0,
    blurb: sp?.blurb ?? (n === 3 ? 'Three sides, all speed.' : `${n} sides. No tricks: just ${ARMOR2[i] ? `${ARMOR2[i]} armor and ` : ''}more to break.`),
  });
});

// ------------------------------------------------------------------ 3D
const SOLID: EnemyDef[] = [
  E({ id: 'tetra', name: 'Tetrahedron', dim: 3, n: 4, poly: 'tetrahedron', color: '#fc7677', hp: 700, speed: 1.05, bounty: 12, size: 0.3, cost: 17, intro: 0,
    blurb: 'The simplest solid. Four faces, no tricks.' }),
  E({ id: 'cube', name: 'Cube', dim: 3, n: 6, poly: 'cube', color: '#ffe869', hp: 1050, speed: 0.85, armor: 8, bounty: 16, size: 0.32, cost: 26, intro: 0, traits: ['armored'],
    blurb: 'Six faces of plain, sturdy armor.' }),
  E({ id: 'octahedron', name: 'Octahedron', dim: 3, n: 8, poly: 'octahedron', color: '#768dfc', hp: 1300, speed: 0.95, bounty: 18, size: 0.33, cost: 32, intro: 0,
    blurb: 'Eight faces. Fast for a solid.' }),
  E({ id: 'dodecahedron', name: 'Dodecahedron', dim: 3, n: 12, poly: 'dodecahedron', color: '#b4ff8e', hp: 2000, speed: 0.72, armor: 10, bounty: 24, size: 0.36, cost: 50, intro: 0, traits: ['armored'],
    blurb: 'Twelve pentagonal faces and heavy armor.' }),
  E({ id: 'icosahedron', name: 'Icosahedron', dim: 3, n: 20, poly: 'icosahedron', color: '#8efffb', hp: 2700, speed: 0.78, bounty: 30, size: 0.38, cost: 67, intro: 0,
    blurb: 'Twenty faces, the roundest Platonic solid.' }),
  // Complex solids: powers scale with face count.
  E({ id: 'prism3', name: 'Triangular Prism', dim: 3, n: 5, poly: 'prism3', color: '#f177dd', hp: 800, speed: 1.2, bounty: 14, size: 0.3, cost: 22, intro: 0,
    traits: ['flying'], blurb: 'Glides over the map on its 5 faces. Only anti-air towers can reach it.' }),
  E({ id: 'trunc_tetra', name: 'Truncated Tetrahedron', dim: 3, n: 8, poly: 'truncated_tetrahedron', color: '#ffa94d', hp: 1500, speed: 0.8, bounty: 20, size: 0.36, cost: 42, intro: 0,
    abilities: [{ kind: 'split', enemy: 'tetra', count: 4 }], blurb: 'Shatters into 4 Tetrahedra when destroyed (one per two faces).' }),
  E({ id: 'cuboct', name: 'Cuboctahedron', dim: 3, n: 14, poly: 'cuboctahedron', color: '#8ef0c4', hp: 1600, shield: 14 * 70, speed: 0.8, bounty: 26, size: 0.36, cost: 55, intro: 0,
    traits: ['shielded'], blurb: 'A 14-faced shield generator: 70 shield per face, regenerating.' }),
  E({ id: 'rhombic', name: 'Rhombic Dodecahedron', dim: 3, n: 12, poly: 'rhombic_dodecahedron', color: '#bf7ff5', hp: 1800, speed: 0.75, bounty: 26, size: 0.36, cost: 55, intro: 0,
    abilities: [{ kind: 'heal', every: 3, radius: 2.2, amount: 0.12 }], traits: ['elite'], blurb: 'Heals nearby shapes for 12% every 3 s (1% per face).' }),
  E({ id: 'trunc_octa', name: 'Truncated Octahedron', dim: 3, n: 14, poly: 'truncated_octahedron', color: '#6fd6ff', hp: 1700, speed: 0.85, bounty: 26, size: 0.36, cost: 52, intro: 0,
    abilities: [{ kind: 'blink', every: 4, amount: 2.1 }, { kind: 'haste_aura', radius: 1.8, amount: 0.14 }],
    blurb: 'Blinks 2.1 tiles every 4 s and hastes neighbours by 14% (0.15 tiles and 1% per face).' }),
  E({ id: 'trunc_icosa', name: 'Truncated Icosahedron', dim: 3, n: 32, poly: 'truncated_icosahedron', color: '#ffffff', hp: 3600, speed: 0.6, bounty: 45, lives: 2, size: 0.44, cost: 110, intro: 0,
    abilities: [{ kind: 'spawn', every: 40 / 32, enemy: 'tetra' }], traits: ['elite'], tenacity: 0.6,
    blurb: 'A 32-faced carrier: drops a Tetrahedron every 1.25 s (faster with more faces).' }),
  E({ id: 'rhombicosi', name: 'Rhombicosidodecahedron', dim: 3, n: 62, poly: 'rhombicosidodecahedron', color: '#ffd166', hp: 5200, speed: 0.55, armor: 6, bounty: 60, lives: 3, size: 0.48, cost: 150, intro: 0,
    abilities: [{ kind: 'revive', every: 6, radius: 2.6, count: 3 }, { kind: 'mimic' }], traits: ['elite', 'armored'], tenacity: 0.5,
    blurb: 'Sixty-two faces of trouble: raises 3 fallen shapes every 6 s and adapts its resistances.' }),
];

// ------------------------------------------------------------------ 4D
const shift = (cells: number): EnemyAbility => ({ kind: 'burrow', every: Math.max(4, 12 - cells / 4), duration: 0.8 + cells / 30 });
const HYPER: EnemyDef[] = [
  E({ id: 'cell5', name: '5-Cell', dim: 4, n: 5, poly: 'cell5', color: '#fc7677', hp: 9000, speed: 1.0, bounty: 40, size: 0.34, cost: 220, intro: 0,
    abilities: [shift(5)], blurb: 'The 4D simplex. Periodically rotates through the 4th axis, becoming untouchable (DoTs and zones still work).' }),
  E({ id: 'duo33', name: '3-3 Duoprism', dim: 4, n: 6, poly: 'duo33', color: '#f177dd', hp: 9500, speed: 1.15, bounty: 42, size: 0.34, cost: 230, intro: 0,
    abilities: [shift(6)], traits: ['flying'], blurb: 'Two triangles multiplied through each other. Flies, and phases out now and then.' }),
  E({ id: 'tesseract', name: 'Tesseract', dim: 4, n: 8, poly: 'tesseract', color: '#ffe869', hp: 13000, shield: 8 * 500, armor: 18, speed: 0.8, bounty: 55, size: 0.38, cost: 330, intro: 0,
    abilities: [shift(8)], traits: ['armored', 'shielded'], blurb: 'The hypercube: 8 cubic cells of armor and a 500-per-cell regenerating shield.' }),
  E({ id: 'duo55', name: '5-5 Duoprism', dim: 4, n: 10, poly: 'duo55', color: '#b4ff8e', hp: 15000, speed: 0.8, bounty: 60, size: 0.4, cost: 380, intro: 0,
    abilities: [shift(10), { kind: 'split', enemy: 'cell5', count: 2 }], blurb: 'Ten prism cells. Breaks into two 5-Cells when destroyed.' }),
  E({ id: 'cell16', name: '16-Cell', dim: 4, n: 16, poly: 'cell16', color: '#6fd6ff', hp: 20000, speed: 0.78, bounty: 70, size: 0.42, cost: 500, intro: 0,
    abilities: [shift(16), { kind: 'heal', every: 3, radius: 2.4, amount: 0.08 }, { kind: 'haste_aura', radius: 2.2, amount: 0.16 }], traits: ['elite'],
    blurb: 'Heals neighbours 8% every 3 s and hastes them by 16% (1% per cell).' }),
  E({ id: 'cell24', name: '24-Cell', dim: 4, n: 24, poly: 'cell24', color: '#bf7ff5', hp: 28000, speed: 0.7, armor: 10, bounty: 90, lives: 3, size: 0.46, cost: 700, intro: 0,
    abilities: [shift(24), { kind: 'stomp', every: 8, radius: 1.8, duration: 1.8 }, { kind: 'mimic' }], traits: ['elite', 'armored'], tenacity: 0.5,
    blurb: 'Stomps nearby towers offline every 8 s, adapts its resistances, and phases for 1.6 s (cells / 15).' }),
];

// ------------------------------------------------------------------ bosses (limits of each dimension)
const BOSSES: EnemyDef[] = [
  E({ id: 'icosagon', name: 'The Icosagon', dim: 2, n: 20, color: '#ffd166', hp: 4200, speed: 0.42, armor: 6, bounty: 150, lives: 10, size: 0.75, cost: 0, intro: 0,
    tenacity: 0.35, traits: ['boss'], abilities: [{ kind: 'stomp', every: 7, radius: 2.2, duration: 2.5 }],
    blurb: 'Twenty sides. Every 7 s it slams the ground, disabling towers within 2 tiles.' }),
  E({ id: 'circle', name: 'The Circle', dim: 2, n: 0, shape: 'circle', color: '#ffffff', hp: 11000, shield: 3000, speed: 0.45, bounty: 250, lives: 20, size: 0.85, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'], abilities: [{ kind: 'phases', enemy: 'p12', count: 3 }],
    blurb: 'Infinite sides: the limit of Flatland. Sheds Dodecagons at 66% HP and rolls twice as fast below 33%.' }),
  E({ id: 'geodesic', name: 'The Geodesic', dim: 3, n: 80, poly: 'geodesic', color: '#8efffb', hp: 45000, shield: 8000, speed: 0.42, bounty: 350, lives: 15, size: 0.85, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'], abilities: [{ kind: 'rewind_hp', amount: 0.5, duration: 5 }, { kind: 'haste_aura', radius: 2.6, amount: 0.25 }],
    blurb: 'Eighty faces. Once below 50% it rewinds its HP 5 s, and it hastes everything around it.' }),
  E({ id: 'sphere', name: 'The Sphere', dim: 3, n: 0, poly: 'sphere', color: '#ffffff', hp: 90000, shield: 20000, speed: 0.45, bounty: 500, lives: 20, size: 0.95, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'], abilities: [{ kind: 'phases', enemy: 'icosahedron', count: 4 }, { kind: 'stomp', every: 9, radius: 2.4, duration: 2 }],
    blurb: 'Infinite faces: the limit of Solidspace. Stomps, sheds Icosahedra at 66% and races below 33%.' }),
  E({ id: 'hexacosi', name: 'The 600-Cell', dim: 4, n: 600, poly: 'cell600', color: '#bf7ff5', hp: 260000, shield: 40000, armor: 12, speed: 0.4, bounty: 700, lives: 20, size: 0.95, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded', 'armored'], abilities: [{ kind: 'spawn', every: 3, enemy: 'cell5' }, { kind: 'stomp', every: 8, radius: 2.4, duration: 2.2 }, shift(30)],
    blurb: 'Six hundred tetrahedral cells. Births 5-Cells as it walks and stomps towers offline.' }),
  E({ id: 'glome', name: 'The Glome', dim: 4, n: 0, poly: 'glome', color: '#ffffff', hp: 700000, shield: 120000, speed: 0.4, bounty: 1500, lives: 40, size: 1.05, cost: 0, intro: 0,
    tenacity: 0.25, traits: ['boss', 'shielded'],
    abilities: [{ kind: 'phases', enemy: 'tesseract', count: 4 }, { kind: 'rewind_hp', amount: 0.4, duration: 5 }, { kind: 'stomp', every: 8, radius: 2.6, duration: 2.5 }, shift(40)],
    blurb: 'The hypersphere, the limit of everything. Every trick at once.' }),
];

export const ENEMIES: EnemyDef[] = [...FLAT, ...SOLID, ...HYPER, ...BOSSES];
export const ENEMY_BY_ID = new Map(ENEMIES.map((e) => [e.id, e]));

/** Boss by wave number (the last wave of each act, and the midpoints). */
export const BOSS_WAVES: Record<number, string> = { 10: 'icosagon', 20: 'circle', 30: 'geodesic', 40: 'sphere', 50: 'hexacosi', 60: 'glome' };

/** Which dimension a wave belongs to. */
export function dimensionOf(wave: number): 2 | 3 | 4 {
  return wave <= 20 ? 2 : wave <= 40 ? 3 : 4;
}

export const DIMENSION_NAMES: Record<number, string> = { 2: 'Flatland', 3: 'Solidspace', 4: 'Hyperspace' };

/** Order in which shapes are introduced, with the wave they first appear. */
export const INTRO: [string, number][] = [
  ['p3', 1], ['p4', 1], ['p5', 3], ['p6', 4], ['p7', 6], ['p8', 7], ['p9', 9], ['p10', 11], ['p11', 12], ['p12', 14], ['p13', 16], ['p14', 18],
  ['tetra', 21], ['cube', 22], ['octahedron', 24], ['prism3', 25], ['dodecahedron', 27], ['trunc_tetra', 29], ['icosahedron', 31],
  ['cuboct', 32], ['rhombic', 34], ['trunc_octa', 35], ['trunc_icosa', 37], ['rhombicosi', 39],
  ['cell5', 41], ['duo33', 43], ['tesseract', 45], ['duo55', 48], ['cell16', 51], ['cell24', 55],
];
for (const [id, w] of INTRO) ENEMY_BY_ID.get(id)!.intro = w;
