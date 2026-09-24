// The stranger shapes: their geometry, their abilities and the boss rotation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.ts';
import { MAPS } from '../src/content/maps.ts';
import { ENEMIES, ENEMY_BY_ID, BOSS_POOLS, bossFor, INTRO } from '../src/content/enemies.ts';
import { spawnEnemy } from '../src/sim/enemies.ts';
import { dealDamage } from '../src/sim/combat.ts';
import { getModel } from '../src/client/render/geometry.ts';
import type { Enemy } from '../src/sim/types.ts';

const meadow = MAPS[0];

function world(): World {
  return new World({ map: meadow, difficulty: 'normal', seed: 11, startGold: 1e6, packs: false });
}

function lone(w: World, id: string, dist = 3): Enemy {
  const e = spawnEnemy(w, id, 0, 30, { dist, lateral: 0 })!;
  assert.ok(e, id);
  return e;
}

const step = (w: World, seconds: number) => { for (let i = 0; i < seconds * 60; i++) w.step(); };

test('the new polytopes have their textbook counts', () => {
  // [vertices, edges, faces, Euler characteristic of the drawn surface]
  const counts: Record<string, [number, number, number, number | null]> = {
    snub_cube: [24, 60, 38, 2],
    toroid: [16, 32, 16, 0], // a torus
    stella_octangula: [8, 12, 8, 4], // two tetrahedra
    compound5: [20, 30, 20, 10], // five tetrahedra
    small_stellated_dodecahedron: [32, 90, 60, 2],
    great_stellated_dodecahedron: [32, 90, 60, 2],
    rect5: [10, 30, 0, null],
    star_duo: [25, 50, 0, null],
    grand_antiprism: [100, 500, 0, null],
    cell120: [600, 1200, 0, null],
  };
  for (const [id, [v, e, f, chi]] of Object.entries(counts)) {
    const m = getModel(id)!;
    assert.equal(m.verts.length, v, `${id} vertices`);
    assert.equal(m.edges.length, e, `${id} edges`);
    assert.equal(m.faces.length, f, `${id} faces`);
    if (chi !== null) assert.equal(v - e + f, chi, `${id} Euler characteristic`);
  }
  for (const d of ENEMIES) if (d.poly && d.poly !== 'sphere' && d.poly !== 'glome') assert.ok(getModel(d.poly), `${d.id}: no model ${d.poly}`);
});

test('every enemy is introduced once, and only regular shapes are', () => {
  const ids = INTRO.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    const d = ENEMY_BY_ID.get(id)!;
    assert.ok(!d.traits.includes('boss'), `${id} is a boss`);
    assert.ok(![10, 20, 30, 40, 50, 60].includes(d.intro), `${id} is introduced on a boss wave`);
  }
  for (const d of ENEMIES) for (const a of d.abilities) if (a.enemy) assert.ok(ENEMY_BY_ID.has(a.enemy), `${d.id} spawns unknown ${a.enemy}`);
});

test('the campaign meets every boss, and the first map starts gently', () => {
  const met = new Set<string>();
  for (const m of MAPS) for (let n = 1; n <= m.waves; n++) { const b = bossFor(m, n); if (b) met.add(b); }
  for (const pool of Object.values(BOSS_POOLS)) for (const b of pool) assert.ok(met.has(b), `${b} never appears`);
  assert.equal(bossFor(meadow, 10), 'icosagon');
  assert.ok(bossFor(meadow, 70), 'endless mode has bosses');
  assert.equal(bossFor(meadow, 65), null);
});

test('evade: some direct hits pass through a toroid, but damage over time lands', () => {
  const w = world();
  const e = lone(w, 'toroid');
  let missed = 0;
  for (let i = 0; i < 300; i++) if (dealDamage(w, e, 1, 'arcane', { tower: null, isHit: true, depth: 0 }) === 0) missed++;
  assert.ok(missed > 60 && missed < 140, `missed ${missed} of 300`);
  const hp = e.hp;
  for (let i = 0; i < 50; i++) dealDamage(w, e, 1, 'arcane', { tower: null, isHit: false, depth: 0 });
  assert.ok(Math.abs(hp - e.hp - 50) < 1e-6, 'non-hit damage always lands');
});

test('antipode: the hemicube swaps ahead, then part of the way back', () => {
  const w = world();
  const e = lone(w, 'hemicube', 4);
  e.speed = 0;
  e.timers = e.timers.map(() => 0.01);
  step(w, 0.05);
  assert.ok(Math.abs(e.dist - (4 + 2.4)) < 1e-6, `jumped to ${e.dist}`);
  e.timers = e.timers.map(() => 0.01);
  step(w, 0.05);
  assert.ok(Math.abs(e.dist - (4 + 2.4 - 1.44)) < 1e-6, `swapped back to ${e.dist}`);
  assert.ok(e.ghost >= 0, 'shows where it goes next');
});

test('dash, spikes, cycling immunity, shedding and a fixed train of links', () => {
  const w = world();
  // Dash: a pentagram mid-dash outruns one that is not dashing.
  const a = lone(w, 'pentagram', 2), b = lone(w, 'pentagram', 2);
  a.timers = a.timers.map(() => 0.01);
  b.timers = b.timers.map(() => 99);
  step(w, 0.5);
  assert.ok(a.dist - b.dist > 0.5, `dash gained ${a.dist - b.dist}`);

  // Spikes jam the nearest tower.
  const t = w.place('bolt', 7, 4) as import('../src/sim/types.ts').Tower;
  const s = lone(w, 'sm_stellated', 0);
  const p = w.paths[0], out = { x: 0, y: 0, ang: 0 };
  let best = 0;
  for (let d = 0; d < p.length; d += 0.1) { p.at(d, out); if ((out.x - t.x) ** 2 + (out.y - t.y) ** 2 < 6) { best = d; break; } }
  s.dist = best;
  s.speed = 0;
  s.timers = s.timers.map(() => 99);
  step(w, 0.05); // settle at its new spot
  s.timers = s.timers.map(() => 0.01);
  step(w, 0.05);
  assert.ok(t.disabledUntil > w.tick, 'the nearest tower is jammed');

  // Immunity rotates.
  const c = lone(w, 'snub_cube');
  step(w, 0.05);
  const first = c.immune;
  assert.ok(first);
  c.timers = c.timers.map(() => 0.01);
  step(w, 0.05);
  assert.notEqual(c.immune, first);

  // Shedding: the Compound of Five Tetrahedra drops one tetrahedron per fifth of HP lost.
  const k = lone(w, 'compound5');
  k.shield = 0;
  k.hp = k.maxHp * 0.55;
  const before = w.enemies.filter((x) => x.def.id === 'tetra').length;
  step(w, 0.05);
  assert.equal(w.enemies.filter((x) => x.def.id === 'tetra').length - before, 2, 'two thresholds crossed, two tetrahedra');

  // The Apeirogon drags exactly its 12 links.
  const w2 = world();
  const head = lone(w2, 'apeirogon', 1);
  for (let i = 0; i < 60 * 30 && head.alive; i++) w2.step();
  assert.equal(head.spawned, 12);
  assert.ok(w2.enemies.filter((x) => x.def.id === 'apeiro_link').length <= 12);
});
