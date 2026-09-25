// Enemies are geometry. A run climbs through dimensions:
//   Flatland (2D)    : polygons with 3..14 sides. More sides = tougher. The
//                      plain ones have no effects; 11-14 sides have one.
//   Solidspace (3D)  : polyhedra, counted by faces. Platonic solids are plain;
//                      complex solids have powers whose strength scales with
//                      their face count.
//   Hyperspace (4D)  : polytopes, counted by cells. All have powers scaled by
//                      cell count, and all can "phase" through the 4th axis.
// Each dimension ends in its limit: the Circle, the Sphere, the Glome.
// Stranger shapes live alongside the regular ones: star polygons, the digon,
// star and compound solids, a polyhedron with a hole, a projective "hemi"
// shape that lives in two places at once, a chiral snub, and uniform 4D
// oddities. The mid-act bosses vary by map (see BOSS_POOLS).
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

// Stranger polygons.
const FLAT_ODD: EnemyDef[] = [
  E({ id: 'digon', name: 'Digon', dim: 2, n: 2, shape: 'lens', color: '#dff6ff', hp: 14, speed: 2.1, bounty: 2, size: 0.17, cost: 14 / 40, intro: 0,
    blurb: 'Two sides that meet at both ends: a sliver of a shape. Tiny, fragile and very fast.' }),
  E({ id: 'pentagram', name: 'Pentagram', dim: 2, n: 5, star: 2, color: '#ff9ecf', hp: 110, speed: 0.95, bounty: 6, size: 0.24, cost: 110 / 40, intro: 0,
    abilities: [{ kind: 'dash', every: 4.5, amount: 3.2, duration: 0.6 }],
    blurb: 'The star {5/2}: five sides that cross each other. Every 4.5 s it dashes at 3x speed.' }),
  E({ id: 'hexagram', name: 'Hexagram', dim: 2, n: 6, star: 2, color: '#fff3a8', hp: 170, speed: 0.85, armor: 1, bounty: 8, size: 0.26, cost: 170 / 40 + 1, intro: 0,
    abilities: [{ kind: 'split', enemy: 'p3', count: 2 }],
    blurb: 'Not one polygon but two: a compound of two Triangles, which go their own ways when it breaks.' }),
  E({ id: 'apeiro_link', name: 'Apeirogon Link', dim: 2, n: 0, shape: 'zigzag', color: '#9fd0ff', hp: 110, speed: 0.44, armor: 2, bounty: 5, size: 0.24, cost: 0, intro: 0,
    blurb: 'One link of the Apeirogon\'s endless chain.' }),
];

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

// Stranger solids.
const SOLID_ODD: EnemyDef[] = [
  E({ id: 'stella', name: 'Stella Octangula', dim: 3, n: 8, poly: 'stella_octangula', color: '#ff7ae6', hp: 1300, speed: 0.9, bounty: 18, size: 0.34, cost: 38, intro: 0,
    abilities: [{ kind: 'split', enemy: 'tetra', count: 2 }],
    blurb: 'Two Tetrahedra run through each other: a compound, not a solid. Breaks into both.' }),
  E({ id: 'toroid', name: 'Toroid', dim: 3, n: 16, poly: 'toroid', color: '#ffb347', hp: 1500, speed: 0.85, bounty: 20, size: 0.36, cost: 40, intro: 0,
    abilities: [{ kind: 'evade', amount: 0.33 }],
    blurb: 'A polyhedron with a hole through it. One direct hit in three flies straight through; DoTs, zones and blasts still land.' }),
  E({ id: 'sm_stellated', name: 'Small Stellated Dodecahedron', dim: 3, n: 12, poly: 'small_stellated_dodecahedron', color: '#c3a6ff', hp: 2300, speed: 0.7, armor: 6, bounty: 26, size: 0.38, cost: 62, intro: 0,
    traits: ['armored'], abilities: [{ kind: 'spikes', every: 7, radius: 2.6, count: 1, duration: 1.6 }],
    blurb: 'A Kepler-Poinsot star: twelve pentagrams. Every 7 s it throws a spike that jams the nearest tower for 1.6 s.' }),
  E({ id: 'hemicube', name: 'Hemicube', dim: 3, n: 3, poly: 'cube', color: '#a0f0ff', hp: 1400, speed: 0.8, bounty: 22, size: 0.34, cost: 42, intro: 0,
    abilities: [{ kind: 'antipode', every: 3.2, amount: 2.4 }],
    blurb: 'Half a cube, glued to its own opposite: it lives in two places at once. Every 3.2 s it swaps to its ghost, 2.4 tiles ahead or part of the way back.' }),
  E({ id: 'snub_cube', name: 'Snub Cube', dim: 3, n: 38, poly: 'snub_cube', color: '#c3ff5c', hp: 3400, speed: 0.7, bounty: 34, size: 0.4, cost: 90, intro: 0,
    abilities: [{ kind: 'cycle_immunity', every: 5 }],
    blurb: 'Chiral and restless: immune to one damage type at a time, switching every 5 s. Mix your damage.' }),
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

// Stranger polytopes.
const HYPER_ODD: EnemyDef[] = [
  E({ id: 'rect5', name: 'Rectified 5-Cell', dim: 4, n: 10, poly: 'rect5', color: '#ff9d5c', hp: 11000, speed: 1.05, bounty: 46, size: 0.36, cost: 260, intro: 0,
    abilities: [shift(10), { kind: 'dash', every: 5, amount: 2.6, duration: 0.7 }],
    blurb: 'The 5-cell with its corners cut to the midpoints: five tetrahedra and five octahedra. Phases, and dashes every 5 s.' }),
  E({ id: 'star_duo', name: 'Great Duoprism', dim: 4, n: 10, poly: 'star_duo', color: '#ff5ad8', hp: 17000, speed: 0.8, bounty: 62, size: 0.4, cost: 400, intro: 0,
    abilities: [shift(10), { kind: 'spikes', every: 7, radius: 2.8, count: 2, duration: 1.8 }],
    blurb: 'Two pentagrams multiplied through each other, {5/2}x{5/2}. Phases, and jams the 2 nearest towers every 7 s.' }),
];

// ------------------------------------------------------------------ bosses (limits of each dimension)
const BOSSES: EnemyDef[] = [
  E({ id: 'icosagon', name: 'The Icosagon', dim: 2, n: 20, color: '#ffd166', hp: 3200, speed: 0.42, armor: 4, bounty: 150, lives: 10, size: 0.75, cost: 0, intro: 0,
    tenacity: 0.35, traits: ['boss'], abilities: [{ kind: 'stomp', every: 7, radius: 2.2, duration: 2.5 }],
    blurb: 'Twenty sides. Every 7 s it slams the ground, disabling towers within 2 tiles.' }),
  E({ id: 'circle', name: 'The Circle', dim: 2, n: 0, shape: 'circle', color: '#ffffff', hp: 5800, shield: 1500, speed: 0.45, bounty: 250, lives: 20, size: 0.85, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'], abilities: [{ kind: 'phases', enemy: 'p12', count: 3 }],
    blurb: 'Infinite sides: the limit of Flatland. Sheds Dodecagons at 66% HP and rolls twice as fast below 33%.' }),
  E({ id: 'geodesic', name: 'The Geodesic', dim: 3, n: 80, poly: 'geodesic', color: '#8efffb', hp: 17600, shield: 3200, speed: 0.42, bounty: 350, lives: 15, size: 0.85, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'], abilities: [{ kind: 'rewind_hp', amount: 0.5, duration: 5 }, { kind: 'haste_aura', radius: 2.6, amount: 0.25 }],
    blurb: 'Eighty faces. Once below 50% it rewinds its HP 5 s, and it hastes everything around it.' }),
  E({ id: 'sphere', name: 'The Sphere', dim: 3, n: 0, poly: 'sphere', color: '#ffffff', hp: 25000, shield: 5600, speed: 0.45, bounty: 500, lives: 20, size: 0.95, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'], abilities: [{ kind: 'phases', enemy: 'icosahedron', count: 4 }, { kind: 'stomp', every: 9, radius: 2.4, duration: 2 }],
    blurb: 'Infinite faces: the limit of Solidspace. Stomps, sheds Icosahedra at 66% and races below 33%.' }),
  E({ id: 'hexacosi', name: 'The 600-Cell', dim: 4, n: 600, poly: 'cell600', color: '#bf7ff5', hp: 10700, shield: 1650, armor: 12, speed: 0.4, bounty: 700, lives: 20, size: 0.95, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded', 'armored'], abilities: [{ kind: 'spawn', every: 3, enemy: 'cell5' }, { kind: 'stomp', every: 8, radius: 2.4, duration: 2.2 }, shift(30)],
    blurb: 'Six hundred tetrahedral cells. Births 5-Cells as it walks and stomps towers offline.' }),
  E({ id: 'glome', name: 'The Glome', dim: 4, n: 0, poly: 'glome', color: '#ffffff', hp: 100000, shield: 16700, speed: 0.4, bounty: 1500, lives: 40, size: 1.05, cost: 0, intro: 0,
    tenacity: 0.25, traits: ['boss', 'shielded'],
    abilities: [{ kind: 'phases', enemy: 'tesseract', count: 4 }, { kind: 'rewind_hp', amount: 0.4, duration: 5 }, { kind: 'stomp', every: 8, radius: 2.6, duration: 2.5 }, shift(40)],
    blurb: 'The hypersphere, the limit of everything. Every trick at once.' }),
];

// The mid-act bosses: stranger, tougher alternatives that vary by map.
const STRANGE_BOSSES: EnemyDef[] = [
  E({ id: 'apeirogon', name: 'The Apeirogon', dim: 2, n: 0, shape: 'zigzag', color: '#9fd0ff', hp: 2200, armor: 3, speed: 0.44, bounty: 170, lives: 10, size: 0.8, cost: 0, intro: 0,
    tenacity: 0.35, traits: ['boss', 'armored'],
    abilities: [{ kind: 'spawn', every: 1.1, enemy: 'apeiro_link', count: 12 }, { kind: 'haste_aura', radius: 3.5, amount: 0.15 }],
    blurb: 'A polygon with infinitely many sides, straightened into a zigzag that never ends. Its head drags a chain of 12 links, each a shape of its own, and hastes them by 15%.' }),
  E({ id: 'great_heptagram', name: 'The Great Heptagram', dim: 2, n: 7, star: 3, color: '#ff5c8a', hp: 2900, shield: 500, speed: 0.44, bounty: 170, lives: 10, size: 0.78, cost: 0, intro: 0,
    tenacity: 0.35, traits: ['boss', 'shielded'],
    abilities: [{ kind: 'dash', every: 7, amount: 2.5, duration: 0.8 }, { kind: 'shed', enemy: 'pentagram', count: 4 }],
    blurb: 'Seven sides folded three times over, {7/3}. Dashes every 7 s and sheds a Pentagram at every fifth of its HP.' }),
  E({ id: 'gsd', name: 'The Great Stellated Dodecahedron', dim: 3, n: 12, poly: 'great_stellated_dodecahedron', color: '#ffcf40', hp: 20500, shield: 2600, armor: 8, speed: 0.42, bounty: 360, lives: 15, size: 0.85, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'armored', 'shielded'],
    abilities: [{ kind: 'spikes', every: 5, radius: 3.4, count: 3, duration: 2.5 }, { kind: 'shed', enemy: 'sm_stellated', count: 3 }],
    blurb: 'The last and spikiest Kepler-Poinsot star. Every 5 s it spears the 3 nearest towers, jamming them for 2.5 s, and it sheds Small Stellated Dodecahedra as it breaks.' }),
  E({ id: 'compound5', name: 'The Compound of Five Tetrahedra', dim: 3, n: 20, poly: 'compound5', color: '#8efffb', hp: 30000, shield: 6000, speed: 0.44, bounty: 360, lives: 15, size: 0.85, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'],
    abilities: [{ kind: 'cycle_immunity', every: 6 }, { kind: 'shed', enemy: 'tetra', count: 4 }, { kind: 'split', enemy: 'tetra', count: 5 }],
    blurb: 'Five tetrahedra sharing one body, twisted by 44.48°. Immune to a different damage type every 6 s, sheds a Tetrahedron at 80, 60, 40 and 20% HP, and breaks into five more.' }),
  E({ id: 'cell120', name: 'The 120-Cell', dim: 4, n: 120, poly: 'cell120', color: '#8ef0c4', hp: 27600, shield: 6800, armor: 10, speed: 0.38, bounty: 720, lives: 20, size: 0.95, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded', 'armored'],
    abilities: [{ kind: 'spawn', every: 3.5, enemy: 'dodecahedron' }, { kind: 'heal', every: 4, radius: 3, amount: 0.1 }, shift(30)],
    blurb: 'The 600-Cell\'s dual: 120 dodecahedral cells, 600 vertices. Births Dodecahedra, heals everything within 3 tiles by 10% every 4 s, and phases.' }),
  E({ id: 'grand_antiprism', name: 'The Grand Antiprism', dim: 4, n: 320, poly: 'grand_antiprism', color: '#b0a0ff', hp: 39700, shield: 9000, speed: 0.42, bounty: 720, lives: 20, size: 0.95, cost: 0, intro: 0,
    tenacity: 0.3, traits: ['boss', 'shielded'],
    abilities: [{ kind: 'evade', amount: 0.3 }, { kind: 'antipode', every: 4, amount: 3 }, { kind: 'shed', enemy: 'rect5', count: 4 }, shift(25)],
    blurb: 'The strangest uniform polytope, built by no mirror at all: two interlocked rings of antiprisms. 30% of direct hits pass through it, it flickers between two places, and it sheds Rectified 5-Cells.' }),
];

export const ENEMIES: EnemyDef[] = [...FLAT, ...FLAT_ODD, ...SOLID, ...SOLID_ODD, ...HYPER, ...HYPER_ODD, ...BOSSES, ...STRANGE_BOSSES];
export const ENEMY_BY_ID = new Map(ENEMIES.map((e) => [e.id, e]));

/**
 * Bosses by wave. The limits of each dimension (the Circle, the Sphere, the
 * Glome) end every act; the midpoints vary by map, so the campaign meets them all.
 */
export const BOSS_POOLS: Record<number, string[]> = {
  10: ['icosagon', 'apeirogon', 'great_heptagram'],
  20: ['circle'],
  30: ['geodesic', 'gsd', 'compound5'],
  40: ['sphere'],
  50: ['hexacosi', 'cell120', 'grand_antiprism'],
  60: ['glome'],
};
/** Endless mode brings a 4D boss every 10 waves. */
export const ENDLESS_BOSSES = ['hexacosi', 'cell120', 'grand_antiprism', 'glome'];

/** The boss of wave `n` on a map: the map's own pick, else one from the pool by its seed; or null. */
export function bossFor(map: { seed: number; bosses?: Partial<Record<number, string>> }, n: number): string | null {
  if (n > 60) return n % 10 === 0 ? ENDLESS_BOSSES[(n / 10 + map.seed) % ENDLESS_BOSSES.length] : null;
  const pool = BOSS_POOLS[n];
  if (!pool) return null;
  const own = map.bosses?.[n];
  return own && pool.includes(own) ? own : pool[(map.seed + n / 10) % pool.length];
}

/** Which dimension a wave belongs to. */
export function dimensionOf(wave: number): 2 | 3 | 4 {
  return wave <= 20 ? 2 : wave <= 40 ? 3 : 4;
}

export const DIMENSION_NAMES: Record<number, string> = { 2: 'Flatland', 3: 'Solidspace', 4: 'Hyperspace' };

/** Order in which shapes are introduced, with the wave they first appear. */
export const INTRO: [string, number][] = [
  ['p3', 1], ['p4', 1], ['digon', 2], ['p5', 3], ['p6', 4], ['pentagram', 5], ['p7', 6], ['p8', 7], ['hexagram', 8], ['p9', 9], ['p10', 11],
  ['p11', 12], ['p12', 14], ['p13', 16], ['p14', 18],
  ['tetra', 21], ['cube', 22], ['stella', 23], ['octahedron', 24], ['prism3', 25], ['toroid', 26], ['dodecahedron', 27], ['sm_stellated', 28],
  ['trunc_tetra', 29], ['icosahedron', 31], ['cuboct', 32], ['hemicube', 33], ['rhombic', 34], ['trunc_octa', 35], ['snub_cube', 36],
  ['trunc_icosa', 37], ['rhombicosi', 39],
  ['cell5', 41], ['duo33', 43], ['rect5', 44], ['tesseract', 45], ['duo55', 48], ['cell16', 51], ['star_duo', 53], ['cell24', 55],
];
for (const [id, w] of INTRO) ENEMY_BY_ID.get(id)!.intro = w;
