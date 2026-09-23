// The effect language: every authored spec validates, garbage never crashes
// the validator, and the text/keys helpers behave.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../src/effects/validate.ts';
import { specJsonSchema, cheatSheet } from '../src/effects/dsl.ts';
import { BUILTIN_VFX_IDS, BUILTIN_VFX_LIST } from '../src/effects/vfxlib.ts';
import { describeSpec, nice, ord } from '../src/effects/describe.ts';
import { fusionKey, parseKey, parentKey, TOTAL_FUSIONS } from '../src/effects/keys.ts';
import { offlineFusion } from '../src/effects/combiner.ts';
import { lintFusion } from '../src/effects/lint.ts';
import { extractJson } from '../src/server/forge/llm.ts';
import { PAIR_EXAMPLES, TRIPLE_EXAMPLE } from '../src/server/forge/examples.ts';
import { POWERS, POWER_BY_ID } from '../src/content/powers.ts';
import { TOWERS, TOWER_BY_ID } from '../src/content/towers.ts';
import { Rng } from '../src/sim/rng.ts';

test('every power spec validates cleanly', () => {
  assert.equal(POWERS.length, 40);
  for (const p of POWERS) {
    const r = validateSpec(p.spec);
    assert.ok(r.ok, `${p.id}: ${r.errors.join('; ')}`);
  }
});

test('prompt examples validate and lint clean', () => {
  for (const ex of [...PAIR_EXAMPLES, TRIPLE_EXAMPLE]) {
    const r = validateSpec(ex.spec);
    assert.ok(r.ok, `${ex.spec.name}: ${r.errors.join('; ')}`);
    const powers = ex.powers.map((id) => POWER_BY_ID.get(id)!);
    const lint = lintFusion(r.spec!, powers, null);
    assert.deepEqual(lint.problems, [], `${ex.spec.name}: ${lint.problems.join('; ')}`);
  }
});

test('built-in vfx recipes are valid inside a spec', () => {
  assert.ok(BUILTIN_VFX_LIST.length >= 40);
  const rules = POWER_BY_ID.get('ember')!.spec.rules;
  for (let i = 0; i < BUILTIN_VFX_LIST.length; i += 6) {
    const vfx = BUILTIN_VFX_LIST.slice(i, i + 6).map((d) => ({ ...d, id: `x_${d.id}` }));
    const r = validateSpec({ dsl: 1, concept: 'vfx check', name: 'Vfx Check', flavor: 'x', rules, vfx });
    assert.ok(r.ok, `${vfx.map((d) => d.id).join(',')}: ${r.errors.join('; ')}`);
  }
});

test('json schema and cheat sheet are generated', () => {
  const s = specJsonSchema();
  assert.equal(s.type, 'object');
  assert.ok(JSON.stringify(s).length > 10_000);
  const sheet = cheatSheet(BUILTIN_VFX_IDS);
  for (const word of ['TRIGGERS', 'ACTIONS', 'VISUALS']) assert.ok(sheet.includes(word), word);
});

test('validator survives random garbage', () => {
  const rng = new Rng(99);
  const atoms = [null, true, 0, -1, 1e9, 'x', 'on_hit', 'damage', 'target', [], {}];
  const junk = (d: number): unknown => {
    const k = rng.int(0, 3);
    if (d > 4 || k === 0) return atoms[rng.int(0, atoms.length - 1)];
    if (k === 1) return Array.from({ length: rng.int(0, 4) }, () => junk(d + 1));
    const keys = ['rules', 'when', 'do', 'action', 'event', 'amount', 'to', 'vfx', 'layers', 'visual', 'statuses', 'name', 'dmg'];
    return Object.fromEntries(Array.from({ length: rng.int(0, 5) }, () => [keys[rng.int(0, keys.length - 1)], junk(d + 1)]));
  };
  for (let i = 0; i < 2000; i++) {
    const r = validateSpec(junk(0));
    assert.equal(typeof r.ok, 'boolean');
  }
});

test('offline fusions validate for random ordered combos', () => {
  const rng = new Rng(7);
  for (let i = 0; i < 300; i++) {
    const tower = TOWERS[rng.int(0, TOWERS.length - 1)];
    const n = rng.int(2, 3);
    const ids: string[] = [];
    while (ids.length < n) {
      const p = POWERS[rng.int(0, POWERS.length - 1)].id;
      if (!ids.includes(p)) ids.push(p);
    }
    const key = fusionKey(tower.id, ids);
    const spec = offlineFusion(tower, ids.map((p) => POWER_BY_ID.get(p)!), key);
    const r = validateSpec(spec);
    assert.ok(r.ok, `${key}: ${r.errors.join('; ')}`);
  }
});

test('fusion keys keep order and know their parent', () => {
  const k = fusionKey('frost', ['ember', 'storm', 'echo']);
  assert.equal(k, 'v1:frost:ember>storm>echo');
  assert.deepEqual(parseKey(k), { tower: 'frost', powers: ['ember', 'storm', 'echo'] });
  assert.equal(parentKey(k), 'v1:frost:ember>storm');
  assert.notEqual(fusionKey('bolt', ['a', 'b']), fusionKey('bolt', ['b', 'a']));
  assert.equal(TOTAL_FUSIONS, 656_000);
  assert.ok(TOWER_BY_ID.size === 10);
});

test('rules text reads like English', () => {
  assert.equal(nice('b_moon_shard'), 'Moon shard');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ord), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  const tower = TOWER_BY_ID.get('bolt')!;
  const spec = offlineFusion(tower, [POWER_BY_ID.get('orbit')!, POWER_BY_ID.get('boomerang')!], 'v1:bolt:orbit>boomerang');
  const text = describeSpec(spec, { potency: 1, dmgBase: 10 }).join('\n');
  assert.ok(text.length > 0);
  assert.doesNotMatch(text, /\b[abc]_[a-z]/, text);
  assert.doesNotMatch(text, /\b\d*[02-9]1th|\b\d*[02-9]?2th|\b\d*[02-9]?3th/, text);
});

test('extractJson digs JSON out of model replies', () => {
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here it is: {"a": {"b": "}"}} hope that helps'), { a: { b: '}' } });
  assert.deepEqual(extractJson('{"a": [1, 2,],}'), { a: [1, 2] });
  assert.throws(() => extractJson('no json here'));
});
