// The campaign: 3 acts x 3 maps on a 24 x 14 grid.
//   Act I   Flatland   : 20-wave runs, 2D shapes only (learn the game).
//   Act II  Solidspace : 40-wave runs, 2D then 3D.
//   Act III Hyperspace : 60-wave runs, 2D, 3D, then 4D.
// Ground paths are axis-aligned waypoint lists in tile coordinates
// (off-grid points = spawn / exit). Beating a map unlocks the next.

import type { MapDef } from '../sim/types.ts';

export const ACTS = [
  { act: 1, name: 'Flatland', blurb: 'Polygons from 3 to 14 sides. 20 waves per map.', waves: 20 },
  { act: 2, name: 'Solidspace', blurb: 'Polygons give way to polyhedra. 40 waves per map.', waves: 40 },
  { act: 3, name: 'Hyperspace', blurb: 'All the way to four dimensions. 60 waves per map.', waves: 60 },
] as const;

export const MAPS: MapDef[] = [
  // ---------------------------------------------------------------- Act I
  {
    id: 'meadow', name: 'Meadow', blurb: 'A gentle serpentine. Learn the ropes here.', act: 1, waves: 20,
    cols: 24, rows: 14, seed: 101, difficulty: 1, hpScale: 0.9, pathMode: 'first',
    paths: [[[-1, 3], [6, 3], [6, 10], [12, 10], [12, 3], [18, 3], [18, 10], [24, 10]]],
    air: [[[-1, 1], [24, 12]]],
    blocked: [[2, 7], [3, 11], [9, 1], [15, 12], [21, 5], [21, 6], [9, 6], [15, 6]],
  },
  {
    id: 'switchback', name: 'Switchback', blurb: 'A long zig-zag. Lots of coverage, lots of shapes.', act: 1, waves: 20,
    cols: 24, rows: 14, seed: 202, difficulty: 2, hpScale: 1.1, pathMode: 'first',
    paths: [[[-1, 2], [20, 2], [20, 5], [3, 5], [3, 8], [20, 8], [20, 11], [24, 11]]],
    air: [[[-1, 0], [24, 13]]],
    blocked: [[1, 11], [10, 12], [12, 0], [22, 3], [0, 6], [11, 10]],
  },
  {
    id: 'crossroads', name: 'Crossroads', blurb: 'Two spawns merge into one road. Cover both.', act: 1, waves: 20,
    cols: 24, rows: 14, seed: 303, difficulty: 2, hpScale: 0.85, pathMode: 'per_group',
    paths: [
      [[-1, 4], [8, 4], [8, 9], [16, 9], [16, 6], [24, 6]],
      [[12, -1], [12, 9], [16, 9], [16, 6], [24, 6]],
    ],
    air: [[[-1, 1], [24, 12]], [[12, -1], [24, 6]]],
    blocked: [[4, 8], [5, 12], [20, 10], [21, 2], [14, 2], [2, 1]],
  },
  // ---------------------------------------------------------------- Act II
  {
    id: 'skyway', name: 'Skyway', blurb: 'Heavy air traffic crosses a winding road.', act: 2, waves: 40,
    cols: 24, rows: 14, seed: 404, difficulty: 3, hpScale: 1.0, pathMode: 'first',
    paths: [[[-1, 11], [5, 11], [5, 3], [12, 3], [12, 11], [19, 11], [19, 3], [24, 3]]],
    air: [[[-1, 1], [24, 12]], [[-1, 7], [24, 7]]],
    blocked: [[8, 7], [9, 7], [15, 7], [16, 7], [2, 5], [22, 9]],
  },
  {
    id: 'fork', name: 'Fork', blurb: 'The road splits in two and rejoins. Shapes take both.', act: 2, waves: 40,
    cols: 24, rows: 14, seed: 505, difficulty: 3, hpScale: 0.9, pathMode: 'alternate',
    paths: [
      [[-1, 7], [5, 7], [5, 2], [18, 2], [18, 7], [24, 7]],
      [[-1, 7], [5, 7], [5, 12], [18, 12], [18, 7], [24, 7]],
    ],
    air: [[[-1, 7], [24, 7]]],
    blocked: [[11, 7], [12, 7], [2, 3], [2, 11], [21, 3], [21, 11]],
  },
  {
    id: 'spiral', name: 'Spiral', blurb: 'The road winds inward to a base at the heart of the map.', act: 2, waves: 40,
    cols: 24, rows: 14, seed: 606, difficulty: 4, hpScale: 1.15, pathMode: 'first',
    paths: [[[-1, 2], [20, 2], [20, 11], [4, 11], [4, 5], [16, 5], [16, 8], [9, 8]]],
    air: [[[-1, 2], [9, 8]], [[24, 13], [9, 8]]],
    blocked: [[0, 12], [23, 0], [12, 7], [22, 7], [1, 7], [12, 13]],
  },
  // ---------------------------------------------------------------- Act III
  {
    id: 'twinrivers', name: 'Twin Rivers', blurb: 'Two separate roads, two exits. Split your defence.', act: 3, waves: 60,
    cols: 24, rows: 14, seed: 707, difficulty: 4, hpScale: 0.85, pathMode: 'per_group',
    paths: [
      [[-1, 2], [8, 2], [8, 6], [15, 6], [15, 2], [24, 2]],
      [[-1, 11], [8, 11], [8, 8], [15, 8], [15, 11], [24, 11]],
    ],
    air: [[[-1, 7], [24, 7]], [[-1, 0], [24, 13]]],
    blocked: [[11, 3], [11, 10], [3, 6], [3, 7], [20, 6], [20, 7]],
  },
  {
    id: 'gauntlet', name: 'Gauntlet', blurb: 'A short road through the rocks. Every tile counts.', act: 3, waves: 60,
    cols: 24, rows: 14, seed: 808, difficulty: 5, hpScale: 0.85, pathMode: 'first',
    paths: [[[-1, 7], [7, 7], [7, 4], [16, 4], [16, 10], [24, 10]]],
    air: [[[-1, 7], [24, 10]]],
    blocked: [
      [5, 5], [6, 5], [5, 9], [6, 9], [9, 6], [10, 6], [11, 6], [13, 2], [14, 2], [18, 6], [18, 7], [18, 8],
      [19, 12], [20, 12], [21, 8], [9, 2], [3, 3], [3, 11], [12, 11], [13, 11], [22, 5], [1, 1], [10, 10],
    ],
  },
  {
    id: 'tesseract', name: 'Tesseract', blurb: 'A road that folds back through itself, like a hypercube.', act: 3, waves: 60,
    cols: 24, rows: 14, seed: 909, difficulty: 5, hpScale: 1.1, pathMode: 'first',
    paths: [[[-1, 6], [4, 6], [4, 1], [19, 1], [19, 12], [4, 12], [4, 8], [14, 8], [14, 4], [9, 4], [9, 10], [24, 10]]],
    air: [[[-1, 1], [24, 12]], [[-1, 12], [24, 1]]],
    blocked: [[11, 6], [12, 6], [1, 2], [1, 11], [22, 5], [22, 3], [16, 6]],
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
