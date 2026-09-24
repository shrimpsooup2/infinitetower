// Every map is well formed: straight road segments inside the grid, obstacles
// off the road, a known theme, and a first wave that actually plays.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, TUTORIAL_MAP, ACTS } from '../src/content/maps.ts';
import { THEMES } from '../src/client/render/scenery.ts';
import { World } from '../src/sim/world.ts';

const ALL = [...MAPS, TUTORIAL_MAP];

test('map ids are unique and every act has five maps', () => {
  assert.equal(new Set(ALL.map((m) => m.id)).size, ALL.length);
  for (const a of ACTS) assert.equal(MAPS.filter((m) => m.act === a.act).length, 5, `act ${a.act}`);
});

test('roads, obstacles and themes are well formed', () => {
  for (const m of ALL) {
    assert.ok(THEMES[m.theme ?? 'plain'], `${m.id}: unknown theme ${m.theme}`);
    assert.ok(m.cols >= 16 && m.cols <= 32 && m.rows >= 10 && m.rows <= 18, `${m.id}: odd size ${m.cols}x${m.rows}`);
    const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < m.cols && r < m.rows;
    const near = (c: number, r: number) => c >= -1 && r >= -1 && c <= m.cols && r <= m.rows;
    const road = new Set<string>();
    for (const p of m.paths) {
      assert.ok(p.length >= 2, `${m.id}: short path`);
      p.forEach(([c, r], i) => {
        const end = i === 0 || i === p.length - 1;
        assert.ok(end ? near(c, r) : inside(c, r), `${m.id}: waypoint ${c},${r} out of bounds`);
      });
      for (let i = 1; i < p.length; i++) {
        const [c0, r0] = p[i - 1], [c1, r1] = p[i];
        assert.ok(c0 === c1 || r0 === r1, `${m.id}: diagonal road segment ${c0},${r0} -> ${c1},${r1}`);
        const n = Math.abs(c1 - c0) + Math.abs(r1 - r0);
        for (let k = 0; k <= n; k++) road.add(`${c0 + Math.sign(c1 - c0) * k},${r0 + Math.sign(r1 - r0) * k}`);
      }
    }
    const seen = new Set<string>();
    for (const [c, r] of m.blocked) {
      assert.ok(inside(c, r), `${m.id}: obstacle ${c},${r} out of bounds`);
      assert.ok(!road.has(`${c},${r}`), `${m.id}: obstacle ${c},${r} sits on the road`);
      assert.ok(!seen.has(`${c},${r}`), `${m.id}: duplicate obstacle ${c},${r}`);
      seen.add(`${c},${r}`);
    }
    for (const a of m.air) assert.ok(a.length >= 2, `${m.id}: short air lane`);
  }
});

test('every map plays its first wave', () => {
  for (const m of ALL) {
    const w = new World({ map: m, difficulty: 'normal', seed: 3 });
    w.callWave();
    for (let i = 0; i < 60 * 30; i++) w.step();
    assert.ok(w.stats.leaks > 0 || w.enemies.length > 0 || w.stats.kills > 0, `${m.id}: nothing happened`);
    assert.ok(w.paths.every((p) => p.length > 5), `${m.id}: suspiciously short road`);
  }
});
