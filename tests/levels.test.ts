// Tower levels, numbers that grow with level, and concepts with live numbers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.ts';
import { MAPS } from '../src/content/maps.ts';
import { LEVELS } from '../src/content/towers.ts';
import { POWERS } from '../src/content/powers.ts';
import { validateSpec } from '../src/effects/validate.ts';
import { autoScaling, getAt, inlineLevelMarks, parsePath, specAtLevel } from '../src/effects/level.ts';
import { renderConcept, conceptText } from '../src/effects/concept.ts';
import { describeSpec } from '../src/effects/describe.ts';
import { PAIR_EXAMPLES, TRIPLE_EXAMPLE } from '../src/server/forge/examples.ts';
import type { FusionSpec } from '../src/effects/types.ts';

const iceBells = PAIR_EXAMPLES[0].spec;

function world(): World {
  return new World({ map: MAPS[0], difficulty: 'normal', seed: 1, startGold: 1e6 });
}

test('level marks are lifted out of the spec, checked and kept by path', () => {
  const raw = structuredClone(inlineLevelMarks(iceBells)) as Record<string, unknown>;
  const v = validateSpec(raw);
  assert.ok(v.ok, v.errors.join('\n'));
  const byPath = (l: { path: string }[] | undefined) => [...(l ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(byPath(v.spec!.scaling), byPath(iceBells.scaling));
  assert.equal(v.spec!.statuses![0].duration, 2.5, 'the base number stays in place');

  // Damage marks are dropped (damage already grows), steps that are too fast are slowed.
  const bad = structuredClone(inlineLevelMarks(iceBells)) as FusionSpec;
  (bad.rules[2].do[0] as { amount: unknown }).amount = { dmg: { lvl: 0.5, per: 0.1 } };
  (bad.statuses![0] as { duration: unknown }).duration = { lvl: 2.5, per: 2 };
  const w = validateSpec(bad);
  assert.ok(w.ok, w.errors.join('\n'));
  assert.ok(!w.spec!.scaling!.some((s) => s.path.endsWith('.dmg')));
  assert.equal(w.spec!.scaling!.find((s) => s.path === 'statuses[0].duration')!.per, 0.375);
  assert.ok(w.warnings.some((x) => x.includes('too fast')));
});

test('a spec at a level moves only its marked numbers, rounded and clamped', () => {
  const at5 = specAtLevel(iceBells, 5);
  assert.equal(at5.statuses![0].duration, 2.5 + 0.2 * 4);
  assert.ok(Math.abs(at5.statuses![0].speed_mult! - (0.5 - 0.02 * 4)) < 1e-9);
  assert.equal(specAtLevel({ ...iceBells, scaling: [{ path: 'statuses[0].speed_mult', per: -0.1 }] }, 9).statuses![0].speed_mult, 0.3, 'clamped to the slow cap');
  assert.deepEqual(at5.rules, iceBells.rules, 'unmarked numbers stay fixed');
  const flood = PAIR_EXAMPLES[3].spec;
  const count = (s: FusionSpec) => (s.rules[1].do[1] as { count: number }).count;
  assert.equal(count(specAtLevel(flood, 4)), 6, 'integer fields are rounded');
  assert.equal(specAtLevel(iceBells, 1), iceBells);
});

test('every example has valid level marks and concept numbers, and survives max level', () => {
  for (const ex of [...PAIR_EXAMPLES, TRIPLE_EXAMPLE]) {
    const v = validateSpec(inlineLevelMarks(ex.spec));
    assert.ok(v.ok, `${ex.spec.name}: ${v.errors.join('; ')}`);
    const byPath = (l: { path: string }[] | undefined) => [...(l ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(byPath(v.spec!.scaling), byPath(ex.spec.scaling), `${ex.spec.name}: every mark kept as written`);
    assert.equal(v.warnings.filter((x) => x.startsWith('scaling')).length, 0, `${ex.spec.name}: ${v.warnings.join('; ')}`);
    // (Its concept quotes level-1 numbers, so check the rest of the levelled spec.)
    const top = validateSpec({ ...specAtLevel(ex.spec, LEVELS.max), concept: 'Top level.' });
    assert.ok(top.ok, `${ex.spec.name} at max level: ${top.errors.join('; ')}`);
  }
});

test('hand-made powers get natural numbers to grow, and stay valid at every level', () => {
  let scaled = 0;
  for (const p of POWERS) {
    const sc = autoScaling(p.spec);
    if (sc.length) scaled++;
    for (const s of sc) assert.equal(typeof getAt(p.spec, parsePath(s.path)!), 'number', `${p.id}: ${s.path}`);
    const top = specAtLevel({ ...p.spec, scaling: sc }, LEVELS.max);
    assert.ok(validateSpec(top).ok, `${p.id} at max level`);
  }
  assert.ok(scaled >= 10, `only ${scaled} powers have growing numbers`);
});

test('levels add damage and cost more with more and rarer cards', () => {
  const w = world();
  const a = w.place('bolt', 7, 4) as import('../src/sim/types.ts').Tower;
  const b = w.place('bolt', 7, 6) as import('../src/sim/types.ts').Tower;
  const bare = w.levelCost(a)!;
  w.socket(a.id, w.giveCard('frost', 0).uid);
  const common = w.levelCost(a)!;
  w.socket(b.id, w.giveCard('frost', 3).uid);
  assert.ok(common > bare, 'a socketed card makes levels pricier');
  assert.ok(w.levelCost(b)! > common, 'a rarer card makes them pricier still');

  const dmg1 = a.stats.damage;
  const invested = a.invested;
  assert.equal(w.levelUp(a.id), null);
  assert.ok(w.levelCost(a)! > common, 'each level costs more than the last');
  assert.equal(a.level, 2);
  assert.ok(Math.abs(a.stats.damage - dmg1 * (1 + LEVELS.damage)) < 1e-9);
  assert.equal(a.invested, invested + common, 'level gold counts toward the sell value');
  while (a.level < LEVELS.max) assert.equal(w.levelUp(a.id), null);
  assert.equal(w.levelCost(a), null);
  assert.equal(w.levelUp(a.id), 'Already max level');
});

test('levels make the next socket and tier pricier, rare cards most', () => {
  const w = world();
  const a = w.place('bolt', 7, 4) as import('../src/sim/types.ts').Tower;
  const up1 = w.upgradeCost(a)!, c1 = w.socketCost(a, 0)!, l1 = w.socketCost(a, 3)!;
  for (let i = 0; i < 4; i++) w.levelUp(a.id);
  assert.ok(w.upgradeCost(a)! > up1);
  const c5 = w.socketCost(a, 0)!, l5 = w.socketCost(a, 3)!;
  assert.ok(c5 > c1 && l5 > l1);
  assert.ok(l5 / l1 > c5 / c1, 'rarer cards climb faster with level');
});

test('a level-up regrows the fusion and survives save and load', () => {
  const w = world();
  const t = w.place('arc', 7, 4) as import('../src/sim/types.ts').Tower;
  w.upgrade(t.id);
  w.socket(t.id, w.giveCard('frost', 0).uid);
  w.socket(t.id, w.giveCard('echo', 0).uid);
  w.applySpec(t.id, t.specKey, iceBells, 1, 'ready');
  const fusions = w.stats.fusions;
  for (let i = 0; i < 3; i++) w.levelUp(t.id);
  assert.equal(t.rt!.spec.statuses![0].duration, 2.5 + 0.2 * 3);
  assert.equal(w.stats.fusions, fusions, 'levelling is not a new fusion');
  const save = w.snapshot();
  const w2 = new World({ map: MAPS[0], difficulty: 'normal', seed: save.seed });
  w2.restore(save);
  assert.equal(w2.towers[0].level, 4);
  assert.equal(w2.towers[0].stats.damage, t.stats.damage);
});

test('concept numbers bind to the spec and show live values', () => {
  const unbound = validateSpec({ ...iceBells, concept: 'Rings bells for {7.5}s.' });
  assert.ok(!unbound.ok && unbound.errors.some((e) => e.includes('{7.5}')));

  assert.equal(conceptText(iceBells), "Hits chill. At 3 Chill, enemies become Ice Bells (50% slower, 2.5s); a bell's death rings all bells twice for 50% damage.");
  const parts = renderConcept(iceBells, { level: 5, dmgBase: 20, potency: 1 });
  const nums = parts.filter((p) => p.per !== undefined || p.grows);
  assert.deepEqual(nums.map((p) => p.text), ['3', '58%', '3.3', '10']);
  assert.equal(nums[0].per, 0, 'unmarked numbers are fixed');
  assert.ok(nums[1].per! > 0 && nums[2].per! > 0, 'marked numbers grow');
  assert.ok(nums[3].grows, 'damage grows with the tower');

  const judgment = PAIR_EXAMPLES[2].spec;
  assert.equal(conceptText(judgment, { level: 3, dmgBase: 40 }), 'Shots brand enemies to take 24% more damage. Branded enemies under 27% HP are executed in a burst of light for 20.');
});

test('rules text labels the numbers that grow with level', () => {
  const lines = describeSpec(specAtLevel(iceBells, 3), { potency: 1 });
  const status = lines.find((l) => l.startsWith('Ice Bell'))!;
  assert.match(status, /2\.9 s \(\+0\.2 s\/lvl\)/);
  assert.match(status, /54% slower \(\+2%\/lvl\)/);
  assert.ok(!lines.some((l) => l.includes('Also grows')), 'every mark shown inline');
  const plain = describeSpec(POWERS[0].spec);
  assert.ok(!plain.join(' ').includes('/lvl'), 'a spec without marks shows no labels');
});
