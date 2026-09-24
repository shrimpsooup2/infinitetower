// The campaign: 3 acts x 5 maps. Maps grow from 20 x 12 to 30 x 17 and their
// look (theme) gets richer as the campaign goes on.
//   Act I   Flatland   : 20-wave runs, 2D shapes only (learn the game).
//   Act II  Solidspace : 40-wave runs, 2D then 3D.
//   Act III Hyperspace : 60-wave runs, 2D, 3D, then 4D.
// Ground paths are axis-aligned waypoint lists in tile coordinates
// (off-grid points = spawn / exit). Beating a map unlocks the next.

import type { MapDef } from '../sim/types.ts';

export const ACTS = [
  { act: 1, name: 'Flatland', waves: 20 },
  { act: 2, name: 'Solidspace', waves: 40 },
  { act: 3, name: 'Hyperspace', waves: 60 },
] as const;

export const MAPS: MapDef[] = [
  // ---------------------------------------------------------------- Act I: Flatland (20 waves)
  {
    id: 'meadow', name: 'Meadow', blurb: 'A gentle serpentine.', act: 1, waves: 20, theme: 'plain', bosses: { 10: 'icosagon' },
    cols: 20, rows: 12, seed: 101, difficulty: 1, hpScale: 0.75, pathMode: 'first',
    paths: [[[-1, 3], [5, 3], [5, 8], [10, 8], [10, 3], [15, 3], [15, 8], [20, 8]]],
    air: [[[-1, 1], [20, 10]]],
    blocked: [[2, 6], [8, 1], [13, 10], [18, 5], [8, 5], [13, 5], [3, 10]],
  },
  {
    id: 'switchback', name: 'Switchback', blurb: 'A long zig-zag.', act: 1, waves: 20, theme: 'plain', bosses: { 10: 'apeirogon' },
    cols: 22, rows: 13, seed: 202, difficulty: 2, hpScale: 0.95, pathMode: 'first',
    paths: [[[-1, 2], [18, 2], [18, 5], [3, 5], [3, 8], [18, 8], [18, 11], [22, 11]]],
    air: [[[-1, 0], [22, 12]]],
    blocked: [[1, 11], [10, 12], [12, 0], [20, 4], [0, 6], [10, 10], [20, 7]],
  },
  {
    id: 'crossroads', name: 'Crossroads', blurb: 'Two spawns merge into one road.', act: 1, waves: 20, theme: 'paper', bosses: { 10: 'icosagon' },
    cols: 24, rows: 13, seed: 303, difficulty: 2, hpScale: 0.85, pathMode: 'per_group',
    paths: [
      [[-1, 4], [8, 4], [8, 9], [16, 9], [16, 6], [24, 6]],
      [[12, -1], [12, 9], [16, 9], [16, 6], [24, 6]],
    ],
    air: [[[-1, 1], [24, 11]], [[12, -1], [24, 6]]],
    blocked: [[4, 8], [5, 11], [20, 10], [21, 2], [14, 2], [2, 1]],
  },
  {
    id: 'loopback', name: 'Loopback', blurb: 'The road crosses itself.', act: 1, waves: 20, theme: 'paper', bosses: { 10: 'great_heptagram' },
    cols: 24, rows: 14, seed: 314, difficulty: 3, hpScale: 0.95, pathMode: 'first',
    paths: [[[-1, 2], [17, 2], [17, 11], [6, 11], [6, 6], [21, 6], [21, 14]]],
    air: [[[-1, 12], [24, 1]]],
    blocked: [[3, 8], [11, 8], [12, 8], [20, 3], [2, 4], [13, 13], [23, 9]],
  },
  {
    id: 'orchard', name: 'Orchard', blurb: 'Two lanes join among the trees.', act: 1, waves: 20, theme: 'garden', bosses: { 10: 'apeirogon' },
    cols: 26, rows: 14, seed: 325, difficulty: 3, hpScale: 0.95, pathMode: 'per_group',
    paths: [
      [[-1, 2], [7, 2], [7, 6], [14, 6], [14, 10], [20, 10], [20, 4], [26, 4]],
      [[-1, 11], [10, 11], [10, 6], [14, 6], [14, 10], [20, 10], [20, 4], [26, 4]],
    ],
    air: [[[-1, 1], [26, 12]]],
    blocked: [[3, 5], [4, 6], [17, 2], [18, 2], [23, 8], [12, 2], [2, 8], [17, 13], [24, 11]],
  },
  // ---------------------------------------------------------------- Act II: Solidspace (40 waves)
  {
    id: 'skyway', name: 'Skyway', blurb: 'Heavy air traffic over a winding road.', act: 2, waves: 40, theme: 'blueprint', bosses: { 10: 'icosagon', 30: 'geodesic' },
    cols: 26, rows: 15, seed: 404, difficulty: 3, hpScale: 1.0, pathMode: 'first',
    paths: [[[-1, 12], [5, 12], [5, 3], [12, 3], [12, 12], [20, 12], [20, 3], [26, 3]]],
    air: [[[-1, 1], [26, 13]], [[-1, 7], [26, 7]]],
    blocked: [[8, 7], [9, 7], [16, 7], [17, 7], [2, 5], [23, 10], [23, 6]],
  },
  {
    id: 'fork', name: 'Fork', blurb: 'The road splits and rejoins.', act: 2, waves: 40, theme: 'blueprint', bosses: { 10: 'apeirogon', 30: 'gsd' },
    cols: 26, rows: 15, seed: 505, difficulty: 3, hpScale: 0.9, pathMode: 'alternate',
    paths: [
      [[-1, 7], [5, 7], [5, 2], [20, 2], [20, 7], [26, 7]],
      [[-1, 7], [5, 7], [5, 12], [20, 12], [20, 7], [26, 7]],
    ],
    air: [[[-1, 7], [26, 7]]],
    blocked: [[12, 7], [13, 7], [2, 3], [2, 11], [23, 3], [23, 11], [12, 4], [12, 10]],
  },
  {
    id: 'dunes', name: 'Dunes', blurb: 'A long road through the sand.', act: 2, waves: 40, theme: 'desert', bosses: { 10: 'great_heptagram', 30: 'compound5' },
    cols: 28, rows: 15, seed: 515, difficulty: 3, hpScale: 0.9, pathMode: 'first',
    paths: [[[-1, 2], [6, 2], [6, 12], [12, 12], [12, 2], [18, 2], [18, 12], [24, 12], [24, 5], [28, 5]]],
    air: [[[-1, 14], [28, 0]]],
    blocked: [[3, 7], [9, 7], [15, 7], [21, 7], [9, 0], [21, 14], [26, 10], [26, 1], [1, 11]],
  },
  {
    id: 'spiral', name: 'Spiral', blurb: 'The road winds in to a base at the heart.', act: 2, waves: 40, theme: 'crystal', bosses: { 10: 'icosagon', 30: 'gsd' },
    cols: 28, rows: 16, seed: 606, difficulty: 4, hpScale: 1.0, pathMode: 'first',
    paths: [[[-1, 2], [24, 2], [24, 13], [4, 13], [4, 5], [20, 5], [20, 10], [9, 10], [9, 8], [14, 8]]],
    air: [[[-1, 2], [14, 8]], [[28, 15], [14, 8]]],
    blocked: [[0, 14], [27, 0], [14, 6], [26, 8], [1, 8], [14, 15], [16, 12]],
  },
  {
    id: 'geode', name: 'Geode', blurb: 'Two roads meet inside the crystal.', act: 2, waves: 40, theme: 'crystal', bosses: { 10: 'apeirogon', 30: 'compound5' },
    cols: 28, rows: 16, seed: 626, difficulty: 4, hpScale: 1.0, pathMode: 'per_group',
    paths: [
      [[4, -1], [4, 6], [12, 6], [12, 8], [20, 8], [20, 4], [28, 4]],
      [[4, 16], [4, 10], [12, 10], [12, 8], [20, 8], [20, 4], [28, 4]],
    ],
    air: [[[-1, 8], [28, 4]], [[14, -1], [14, 16]]],
    blocked: [[8, 8], [9, 8], [16, 5], [16, 11], [24, 9], [24, 12], [1, 2], [1, 13], [8, 2], [8, 14]],
  },
  // ---------------------------------------------------------------- Act III: Hyperspace (60 waves)
  {
    id: 'twinrivers', name: 'Twin Rivers', blurb: 'Two roads, two exits.', act: 3, waves: 60, theme: 'neon', bosses: { 10: 'great_heptagram', 30: 'geodesic', 50: 'hexacosi' },
    cols: 28, rows: 16, seed: 707, difficulty: 4, hpScale: 0.85, pathMode: 'per_group',
    paths: [
      [[-1, 2], [9, 2], [9, 6], [18, 6], [18, 2], [28, 2]],
      [[-1, 13], [9, 13], [9, 9], [18, 9], [18, 13], [28, 13]],
    ],
    air: [[[-1, 7], [28, 8]], [[-1, 0], [28, 15]]],
    blocked: [[13, 3], [13, 12], [4, 7], [4, 8], [23, 7], [23, 8], [13, 7], [14, 8]],
  },
  {
    id: 'gauntlet', name: 'Gauntlet', blurb: 'A short road through the pillars.', act: 3, waves: 60, theme: 'neon', bosses: { 10: 'icosagon', 30: 'compound5', 50: 'cell120' },
    cols: 26, rows: 15, seed: 808, difficulty: 5, hpScale: 0.85, pathMode: 'first',
    paths: [[[-1, 7], [8, 7], [8, 4], [17, 4], [17, 11], [26, 11]]],
    air: [[[-1, 7], [26, 11]]],
    blocked: [
      [6, 5], [7, 5], [6, 9], [7, 9], [10, 6], [11, 6], [12, 6], [14, 2], [15, 2], [19, 6], [19, 7], [19, 8], [20, 13],
      [21, 13], [22, 9], [10, 2], [3, 3], [3, 11], [13, 12], [14, 12], [23, 5], [1, 1], [11, 10], [24, 13], [2, 9],
    ],
  },
  {
    id: 'nebula', name: 'Nebula', blurb: 'An S through the clouds, with two sky lanes.', act: 3, waves: 60, theme: 'void', bosses: { 10: 'apeirogon', 30: 'gsd', 50: 'grand_antiprism' },
    cols: 30, rows: 17, seed: 818, difficulty: 5, hpScale: 1.0, pathMode: 'first',
    paths: [[[-1, 3], [10, 3], [10, 13], [20, 13], [20, 3], [26, 3], [26, 9], [30, 9]]],
    air: [[[-1, 15], [30, 1]], [[-1, 8], [30, 8]]],
    blocked: [[5, 7], [5, 8], [15, 6], [15, 7], [15, 8], [23, 9], [23, 10], [28, 5], [2, 12], [13, 1], [17, 16], [27, 14]],
  },
  {
    id: 'horizon', name: 'Event Horizon', blurb: 'A long comb of a road.', act: 3, waves: 60, theme: 'void', bosses: { 10: 'great_heptagram', 30: 'compound5', 50: 'cell120' },
    cols: 30, rows: 17, seed: 828, difficulty: 5, hpScale: 0.9, pathMode: 'first',
    paths: [[[-1, 2], [26, 2], [26, 6], [4, 6], [4, 10], [26, 10], [26, 14], [30, 14]]],
    air: [[[-1, 0], [30, 16]], [[15, -1], [15, 17]]],
    blocked: [[10, 4], [18, 4], [10, 8], [18, 8], [10, 12], [18, 12], [1, 8], [28, 8], [2, 16], [14, 16], [24, 16]],
  },
  {
    id: 'tesseract', name: 'Tesseract', blurb: 'A road that folds back through itself.', act: 3, waves: 60, theme: 'hyper', bosses: { 10: 'apeirogon', 30: 'gsd', 50: 'grand_antiprism' },
    cols: 30, rows: 17, seed: 909, difficulty: 5, hpScale: 1.1, pathMode: 'first',
    paths: [[[-1, 7], [5, 7], [5, 2], [24, 2], [24, 14], [5, 14], [5, 10], [17, 10], [17, 5], [11, 5], [11, 12], [30, 12]]],
    air: [[[-1, 1], [30, 15]], [[-1, 15], [30, 1]]],
    blocked: [[14, 7], [15, 7], [1, 3], [1, 13], [27, 6], [27, 4], [20, 7], [8, 7], [20, 16], [14, 0]],
  },
];

export const MAP_BY_ID = new Map(MAPS.map((m) => [m.id, m]));

/** The guided tutorial: a short, forgiving map that is not part of the campaign. */
export const TUTORIAL_MAP: MapDef = {
  id: 'tutorial', name: 'Tutorial', blurb: '', act: 1, waves: 6,
  cols: 24, rows: 14, seed: 42, difficulty: 1, hpScale: 0.55, pathMode: 'first',
  paths: [[[-1, 7], [7, 7], [7, 3], [16, 3], [16, 10], [24, 10]]],
  air: [[[-1, 2], [24, 12]]],
  blocked: [[3, 3], [11, 7], [12, 7], [20, 5], [4, 11]],
};
