// Six hand-made maps on a 24 x 14 grid. Ground paths are axis-aligned
// waypoint lists in tile coordinates (off-grid points = spawn / exit).

import type { MapDef } from '../sim/types.ts';

export const MAPS: MapDef[] = [
  {
    id: 'meadow', name: 'Meadow', blurb: 'A gentle serpentine. Learn the ropes here.',
    cols: 24, rows: 14, seed: 101, difficulty: 1, hpScale: 0.9, pathMode: 'first',
    paths: [[[-1, 3], [6, 3], [6, 10], [12, 10], [12, 3], [18, 3], [18, 10], [24, 10]]],
    air: [[[-1, 1], [24, 12]]],
    blocked: [[2, 7], [3, 11], [9, 1], [15, 12], [21, 5], [21, 6], [9, 6], [15, 6]],
  },
  {
    id: 'switchback', name: 'Switchback', blurb: 'A long zig-zag. Lots of coverage, lots of enemies.',
    cols: 24, rows: 14, seed: 202, difficulty: 2, hpScale: 1.15, pathMode: 'first',
    paths: [[[-1, 2], [20, 2], [20, 5], [3, 5], [3, 8], [20, 8], [20, 11], [24, 11]]],
    air: [[[-1, 0], [24, 13]]],
    blocked: [[1, 11], [10, 12], [12, 0], [22, 3], [0, 6], [11, 10]],
  },
  {
    id: 'crossroads', name: 'Crossroads', blurb: 'Two spawns merge into one road. Cover both.',
    cols: 24, rows: 14, seed: 303, difficulty: 3, hpScale: 1.0, pathMode: 'per_group',
    paths: [
      [[-1, 4], [8, 4], [8, 9], [16, 9], [16, 6], [24, 6]],
      [[12, -1], [12, 9], [16, 9], [16, 6], [24, 6]],
    ],
    air: [[[-1, 1], [24, 12]], [[12, -1], [24, 6]]],
    blocked: [[4, 8], [5, 12], [20, 10], [21, 2], [14, 2], [2, 1]],
  },
  {
    id: 'skyway', name: 'Skyway', blurb: 'Heavy air traffic crosses a winding road.',
    cols: 24, rows: 14, seed: 404, difficulty: 3, hpScale: 1.0, pathMode: 'first',
    paths: [[[-1, 11], [5, 11], [5, 3], [12, 3], [12, 11], [19, 11], [19, 3], [24, 3]]],
    air: [[[-1, 1], [24, 12]], [[-1, 7], [24, 7]]],
    blocked: [[8, 7], [9, 7], [15, 7], [16, 7], [2, 5], [22, 9]],
  },
  {
    id: 'fork', name: 'Fork', blurb: 'The road splits in two and rejoins. Enemies take both.',
    cols: 24, rows: 14, seed: 505, difficulty: 4, hpScale: 1.0, pathMode: 'alternate',
    paths: [
      [[-1, 7], [5, 7], [5, 2], [18, 2], [18, 7], [24, 7]],
      [[-1, 7], [5, 7], [5, 12], [18, 12], [18, 7], [24, 7]],
    ],
    air: [[[-1, 7], [24, 7]]],
    blocked: [[11, 7], [12, 7], [2, 3], [2, 11], [21, 3], [21, 11]],
  },
  {
    id: 'gauntlet', name: 'Gauntlet', blurb: 'A short road through the rocks. Every tile counts.',
    cols: 24, rows: 14, seed: 606, difficulty: 5, hpScale: 0.85, pathMode: 'first',
    paths: [[[-1, 7], [7, 7], [7, 4], [16, 4], [16, 10], [24, 10]]],
    air: [[[-1, 7], [24, 10]]],
    blocked: [
      [5, 5], [6, 5], [5, 9], [6, 9], [9, 6], [10, 6], [11, 6], [13, 2], [14, 2], [18, 6], [18, 7], [18, 8],
      [19, 12], [20, 12], [21, 8], [9, 2], [3, 3], [3, 11], [12, 11], [13, 11], [22, 5], [1, 1], [10, 10],
    ],
  },
];

export const MAP_BY_ID = new Map(MAPS.map((m) => [m.id, m]));
