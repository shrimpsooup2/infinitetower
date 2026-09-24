// The simulation: deterministic, save/restore safe, every tower and power
// runs, and the content (waves, packs, geometry) is well formed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.ts';
import { MAPS, TUTORIAL_MAP } from '../src/content/maps.ts';
import { TOWERS } from '../src/content/towers.ts';
import { POWERS, POWER_BY_ID } from '../src/content/powers.ts';
import { ENEMY_BY_ID, bossFor, dimensionOf } from '../src/content/enemies.ts';
import { generateWave } from '../src/content/waves.ts';
import { PACKS, SCRAP_VALUE } from '../src/content/packs.ts';
import { POWER_MIN_RARITY } from '../src/content/rarity.ts';
import { getModel } from '../src/client/render/geometry.ts';

const meadow = MAPS[0];

function digest(w: World): string {
  const e = w.enemies.map((x) => `${x.def.id}:${x.dist.toFixed(4)}:${x.hp.toFixed(3)}`).join('|');
  return `${w.tick}/${w.gold}/${w.lives}/${w.waveN}/${w.stats.kills}/${Math.round(w.stats.damage)}/${e}`;
}

function scripted(seed: number): World {
  const w = new World({ map: meadow, difficulty: 'normal', seed, startGold: 5000 });
  const a = w.place('bolt', 7, 4);
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

test('a settled game saved to JSON plays on exactly: aim, reloads, rule timers, drones and mines', () => {
  // Two roads (spawns alternate between them), a hive's drones, spore mines that outlive the wave.
  const map = MAPS.find((m) => m.paths.length > 1)!;
  const settle = (w: World) => {
    for (let i = 0; !w.quiescent() && w.phase === 'running' && i < 60 * 300; i++) w.step();
    for (let i = 0; !w.settled() && i < 600; i++) w.step();
  };
  const a = new World({ map, difficulty: 'hard', seed: 17, startGold: 1e6, packs: false });
  const spots: [number, number][] = [];
  for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) if (a.canBuild(c, r)) spots.push([c, r]);
  const kit: [string, string[]][] = [['bolt', ['spore']], ['hive', ['storm', 'orbit']], ['prism', ['metronome']], ['cannon', ['ember', 'echo', 'venom']], ['mortar', []]];
  kit.forEach(([id, powers], i) => {
    const [c, r] = spots[Math.floor(((i + 0.5) * spots.length) / kit.length)];
    const t = a.place(id, c, r);
    if (typeof t === 'string') throw new Error(t);
    a.upgrade(t.id);
    a.upgrade(t.id);
    for (const p of powers) a.socket(t.id, a.giveCard(p, 2).uid);
  });
  for (let n = 0; n < 3; n++) { a.callWave(); settle(a); }
  const b = new World({ map, difficulty: 'hard', seed: a.seed });
  b.restore(JSON.parse(JSON.stringify(a.snapshot())));
  for (let n = 0; n < 3; n++) {
    a.callWave();
    b.callWave();
    settle(a);
    settle(b);
    assert.equal(digest(b), digest(a), `wave ${a.waveN}`);
    assert.deepEqual(b.towers.map((t) => Math.round(t.dmgTotal)), a.towers.map((t) => Math.round(t.dmgTotal)), `wave ${a.waveN}`);
  }
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
    const tw = w.place(t.id, 7, 4);
    if (typeof tw === 'string') throw new Error(tw);
    w.upgrade(tw.id);
    w.upgrade(tw.id);
    for (let i = 0; i < 6; i++) w.callWave();
    let cur = tw;
    for (const p of POWERS) {
      // Cards never come out of a socket, so each power gets a fresh tower.
      if (cur.sockets.length) {
        w.sell(cur.id);
        cur = w.place(t.id, 7, 4) as typeof tw;
        w.upgrade(cur.id);
        w.upgrade(cur.id);
      }
      const err = w.socket(cur.id, w.giveCard(p.id, 3).uid);
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
      const boss = bossFor(m, n);
      if (boss) assert.ok(wv.groups.some((g) => g.enemy === boss), `${m.id} wave ${n} lacks its boss`);
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

test('packs respect rarity floors, exclusive powers and families, and you keep what the pack allows', () => {
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
      if (def.perk === 'family') assert.ok(pk.family && cards.every((c) => POWER_BY_ID.get(c.power)!.family === pk.family), `${def.id}: every card from ${pk.family}`);
      const hand = w.cards.length;
      const keep = def.keep ?? 1;
      for (let k = 0; k < keep; k++) {
        assert.ok(w.offer, `${def.id}: still offering after ${k} kept`);
        assert.equal(typeof w.pickCard(w.offer!.cards[i % w.offer!.cards.length].uid), 'object');
      }
      assert.equal(w.cards.length, hand + keep, `exactly ${keep} kept`);
      assert.equal(w.offer, null);
    }
  }
});

test('an open pack must be picked from first, and survives a save', () => {
  const w = new World({ map: meadow, difficulty: 'normal', seed: 5, packs: false });
  const a = w.grantPack('shape'), b = w.grantPack('shape');
  const offered = w.openPack(a.uid) as { uid: number }[];
  assert.equal(typeof w.openPack(b.uid), 'string', 'second pack waits');
  assert.equal(typeof w.pickCard(12345), 'string', 'only offered cards can be kept');
  const w2 = new World({ map: meadow, difficulty: 'normal', seed: 5, packs: false });
  w2.restore(w.snapshot());
  assert.deepEqual(w2.offer?.cards.map((c) => c.uid), offered.map((c) => c.uid), 'no re-rolling by reloading');
  assert.equal(typeof w2.pickCard(offered[1].uid), 'object');
  assert.equal(w2.cards.length, 1);
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

test('pack perks: salvage pays for the rest, twin keeps two, gambler rerolls once, shop gates by wave', () => {
  const w = new World({ map: meadow, difficulty: 'normal', seed: 21, packs: false });
  // (A function, so TypeScript doesn't keep w.offer narrowed after a null check.)
  const open = () => w.offer!;
  const gold = w.gold;
  const s = w.openPack(w.grantPack('salvage').uid) as import('../src/sim/types.ts').Card[];
  w.pickCard(s[0].uid);
  assert.equal(w.gold, gold + s.slice(1).reduce((a, c) => a + SCRAP_VALUE[c.rarity], 0), 'unkept cards are scrapped for gold');

  const t = w.openPack(w.grantPack('twin').uid) as import('../src/sim/types.ts').Card[];
  assert.equal(t.length, 5);
  w.pickCard(t[0].uid);
  assert.equal(open().cards.length, 4, 'a Twin Pack stays open for a second card');
  w.pickCard(open().cards[0].uid);
  assert.equal(w.offer, null);

  const g = w.openPack(w.grantPack('gambler').uid) as import('../src/sim/types.ts').Card[];
  const again = w.rerollPack();
  assert.ok(Array.isArray(again) && again.every((c) => !g.some((x) => x.uid === c.uid)), 'a reroll deals new cards');
  assert.equal(typeof w.rerollPack(), 'string', 'only one reroll');
  w.pickCard(open().cards[0].uid);
  assert.equal(typeof w.rerollPack(), 'string');

  w.gold = 1e6;
  assert.match(w.packBlocker('crown')!, /wave 15/);
  w.waveN = 15;
  assert.equal(w.packBlocker('crown'), null);
  const fam = w.buyPack('family');
  assert.ok(typeof fam === 'object' && fam.family === w.shopFamily(), 'a bought Family Pack has the family the Shop shows');
});

test('socketed cards stay in: there is no taking them out, and selling scraps them', () => {
  const w = new World({ map: meadow, difficulty: 'normal', seed: 4, startGold: 5000, packs: false });
  const t = w.place('bolt', 7, 4) as import('../src/sim/types.ts').Tower;
  w.socket(t.id, w.giveCard('frost', 2).uid);
  assert.equal((w as unknown as Record<string, unknown>).unsocket, undefined, 'no unsocket command');
  const hand = w.cards.length;
  const gold = w.gold, value = w.sellValue(t);
  assert.ok(value >= SCRAP_VALUE[2], 'the sell price includes the card\'s scrap value');
  w.sell(t.id);
  assert.equal(w.cards.length, hand, 'selling does not return the card');
  assert.equal(w.gold, gold + value);
});
