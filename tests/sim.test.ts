// The simulation: deterministic, save/restore safe, every tower and power
// runs, and the content (waves, packs, geometry) is well formed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.ts';
import { MAPS, TUTORIAL_MAP } from '../src/content/maps.ts';
import { TOWERS } from '../src/content/towers.ts';
import { POWERS } from '../src/content/powers.ts';
import { ENEMY_BY_ID, BOSS_WAVES, dimensionOf } from '../src/content/enemies.ts';
import { generateWave } from '../src/content/waves.ts';
import { PACKS } from '../src/content/packs.ts';
import { POWER_MIN_RARITY } from '../src/content/rarity.ts';
import { getModel } from '../src/client/render/geometry.ts';

const meadow = MAPS[0];

function digest(w: World): string {
  const e = w.enemies.map((x) => `${x.def.id}:${x.dist.toFixed(4)}:${x.hp.toFixed(3)}`).join('|');
  return `${w.tick}/${w.gold}/${w.lives}/${w.waveN}/${w.stats.kills}/${Math.round(w.stats.damage)}/${e}`;
}

function scripted(seed: number): World {
  const w = new World({ map: meadow, difficulty: 'normal', seed, startGold: 5000 });
  const a = w.place('bolt', 5, 4);
  const b = w.place('cannon', 7, 6);
  if (typeof a === 'string' || typeof b === 'string') throw new Error('placement failed');
  w.upgrade(a.id);
  w.socket(a.id, w.giveCard('storm', 1).uid);
  w.socket(a.id, w.giveCard('frost', 0).uid);
  w.socket(b.id, w.giveCard('ember', 2).uid);
  w.callWave();
  return w;
}

test('same seed and commands give the same game', () => {
  const a = scripted(123), b = scripted(123);
  for (let i = 0; i < 60 * 40; i++) {
    a.step();
    b.step();
  }
  assert.equal(digest(a), digest(b));
  assert.ok(a.stats.kills > 0, 'towers should kill something');
});

test('a snapshot restores into an identical game', () => {
  const a = scripted(5);
  let guard = 0;
  while (!(a.waveN >= 1 && a.quiescent()) && guard++ < 60 * 120) a.step();
  assert.ok(a.quiescent(), 'wave 1 should end');
  const save = a.snapshot();
  const b = new World({ map: meadow, difficulty: 'normal', seed: save.seed });
  b.restore(save);
  assert.equal(b.towers.length, a.towers.length);
  assert.deepEqual(b.towers.map((t) => t.sockets), a.towers.map((t) => t.sockets));
  a.callWave();
  b.callWave();
  for (let i = 0; i < 60 * 20; i++) {
    a.step();
    b.step();
  }
  assert.equal(digest(b), digest(a));
});

test('losing your last life on the final wave is a defeat, not a victory', () => {
  const w = new World({ map: meadow, difficulty: 'normal', seed: 3, waves: [{ n: 1, groups: [{ enemy: 'p3', count: 1, interval: 1, delay: 0, path: 0 }], hpMult: 1, boss: null, reward: 0, carapace: null, mutators: [] }] });
  w.lives = 1;
  w.callWave();
  for (let i = 0; i < 60 * 120 && w.phase === 'running'; i++) w.step();
  assert.equal(w.lives, 0);
  assert.equal(w.phase, 'defeat');
});

test('every tower with every single power runs without errors', () => {
  for (const t of TOWERS) {
    const w = new World({ map: meadow, difficulty: 'normal', seed: 9, startGold: 1e6 });
    const tw = w.place(t.id, 5, 4);
    if (typeof tw === 'string') throw new Error(tw);
    w.upgrade(tw.id);
    w.upgrade(tw.id);
    for (let i = 0; i < 6; i++) w.callWave();
    for (const p of POWERS) {
      while (tw.sockets.length) w.unsocket(tw.id);
      const err = w.socket(tw.id, w.giveCard(p.id, 3).uid);
      assert.equal(err, null, `${t.id}+${p.id}: ${err}`);
      for (let i = 0; i < 90; i++) w.step();
    }
  }
});

test('waves are well formed across the campaign', () => {
  for (const m of [...MAPS, TUTORIAL_MAP]) {
    for (let n = 1; n <= m.waves; n++) {
      const wv = generateWave(m, n);
      assert.ok(wv.groups.length > 0, `${m.id} wave ${n} is empty`);
      for (const g of wv.groups) assert.ok(ENEMY_BY_ID.has(g.enemy), `${m.id} wave ${n}: unknown enemy ${g.enemy}`);
      if (BOSS_WAVES[n]) assert.ok(wv.groups.some((g) => g.enemy === BOSS_WAVES[n]), `${m.id} wave ${n} lacks its boss`);
      // Nothing from a higher dimension shows up early.
      const dim = dimensionOf(n);
      for (const g of wv.groups) assert.ok(ENEMY_BY_ID.get(g.enemy)!.dim <= dim, `${m.id} wave ${n}: ${g.enemy} is from the future`);
    }
  }
});

test('hp budget keeps climbing', () => {
  const m = MAPS[8];
  const hp = (n: number) => generateWave(m, n).groups.reduce((a, g) => a + ENEMY_BY_ID.get(g.enemy)!.hp * g.count, 0) * generateWave(m, n).hpMult;
  assert.ok(hp(40) > hp(20) * 3, 'act 2 should be much harder than act 1');
  assert.ok(hp(60) > hp(40) * 2, 'act 3 should be harder again');
});

test('packs respect rarity floors and exclusive powers', () => {
  const w = new World({ map: meadow, difficulty: 'normal', seed: 77, packs: false });
  for (const def of PACKS) {
    for (let i = 0; i < 40; i++) {
      const pk = w.grantPack(def.id);
      const cards = w.openPack(pk.uid);
      assert.ok(Array.isArray(cards), String(cards));
      assert.equal(cards.length, def.floors.length);
      const rar = cards.map((c) => c.rarity).sort((a, b) => a - b);
      const floors = [...def.floors].sort((a, b) => a - b);
      rar.forEach((r, j) => assert.ok(r >= floors[j], `${def.id}: rarity ${r} below floor ${floors[j]}`));
      for (const c of cards) assert.ok(c.rarity >= (POWER_MIN_RARITY[c.power] ?? 0), `${c.power} rolled at rarity ${c.rarity}`);
    }
  }
});

test('polytope geometry has the textbook counts', () => {
  const counts: Record<string, [number, number, number]> = {
    tetrahedron: [4, 6, 4], cube: [8, 12, 6], octahedron: [6, 12, 8], dodecahedron: [20, 30, 12], icosahedron: [12, 30, 20],
    truncated_icosahedron: [60, 90, 32], rhombicosidodecahedron: [60, 120, 62], cuboctahedron: [12, 24, 14],
    tesseract: [16, 32, 0], cell16: [8, 24, 0], cell24: [24, 96, 0], cell600: [120, 720, 0], cell5: [5, 10, 0],
  };
  for (const [id, [v, e, f]] of Object.entries(counts)) {
    const m = getModel(id)!;
    assert.ok(m, id);
    assert.equal(m.verts.length, v, `${id} vertices`);
    assert.equal(m.edges.length, e, `${id} edges`);
    assert.equal(m.faces.length, f, `${id} faces`);
    if (m.dim === 3) assert.equal(v - e + f, 2, `${id} Euler characteristic`);
  }
});
