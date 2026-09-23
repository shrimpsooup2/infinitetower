// Both storage backends (SQLite and Firestore) behave the same, and the forge
// runs end to end on Firestore. Firestore is exercised against a local fake
// of its REST API and token endpoint (tests/support/fake-firestore.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore, type FusionStore, type NewFusion } from '../src/server/db.ts';
import { FirestoreStore, parseServiceAccount, encode, decode } from '../src/server/firestore.ts';
import { Forge } from '../src/server/forge/pipeline.ts';
import { Balancer } from '../src/server/forge/balancer.ts';
import { MockLLM } from '../src/server/forge/llm.ts';
import { fusionKey } from '../src/effects/keys.ts';
import { POWER_BY_ID } from '../src/content/powers.ts';
import { startFakeFirestore, type FakeFirestore } from './support/fake-firestore.ts';

function fusion(key: string, over: Partial<NewFusion> = {}): NewFusion {
  const parts = key.split(':')[2].split('>');
  const spec = POWER_BY_ID.get(parts[0])!.spec;
  return {
    key, tower: key.split(':')[1], powers: parts, parentKey: null, status: 'ready', name: `Fusion ${key}`, concept: 'c', flavor: 'f',
    spec, potency: 1.25, ratio: 1.6, balance: { status: 'ok' }, signature: ['on_hit', 'damage'], dslVersion: 1, promptVersion: 5,
    model: 'test', attempts: 1, ...over,
  };
}

async function contract(store: FusionStore): Promise<void> {
  const a = fusionKey('arc', ['frost', 'echo']);
  const b = fusionKey('arc', ['frost', 'storm']);
  const p = fusionKey('arc', ['venom', 'tide']);
  const t = fusionKey('arc', ['frost', 'echo', 'void']);

  assert.equal(await store.get(a), null);
  const prov = await store.save(fusion(p, { status: 'provisional', name: 'Offline Thing' }));
  assert.equal(prov.discoveryNo, null, 'provisional fusions get no number');

  const ra = await store.save(fusion(a, { name: 'Glacial Carillon' }));
  const rb = await store.save(fusion(b, { name: 'Storm Glass' }));
  assert.deepEqual([ra.discoveryNo, rb.discoveryNo], [1, 2]);
  assert.ok(ra.discoveredAt);

  // Round trip keeps everything, and re-saving keeps the number and date.
  const got = await store.get(a);
  assert.deepEqual(got?.spec, POWER_BY_ID.get('frost')!.spec);
  assert.deepEqual(got?.powers, ['frost', 'echo']);
  assert.equal(got?.potency, 1.25);
  assert.deepEqual(got?.balance, { status: 'ok' });
  const again = await store.save(fusion(a, { name: 'Glacial Carillon', potency: 2 }));
  assert.equal(again.discoveryNo, 1);
  assert.equal(again.discoveredAt, ra.discoveredAt);
  assert.equal((await store.get(a))?.potency, 2);

  // Promotion: a provisional fusion gets the next number once forged.
  const promoted = await store.save(fusion(p, { name: 'Tidal Miasma' }));
  assert.equal(promoted.discoveryNo, 3);

  await store.bumpForged(a);
  await store.bumpForged(a);
  await store.bumpForged('v1:arc:nope>nope');
  assert.equal((await store.get(a))?.forgedCount, 2);

  await store.save(fusion(t, { parentKey: a, name: 'Void Carillon' }));
  const same = await store.sameTowerBase('arc', 'frost', a);
  assert.deepEqual(same.map((r) => r.key), [b], 'same tower+base: ready pairs only, not itself or triples');
  assert.deepEqual((await store.siblings(a, 'x')).map((r) => r.key), [t]);
  assert.equal((await store.siblings(a, t)).length, 0);

  assert.equal(await store.nameTaken('glacial carillon', 'other'), true, 'names are unique ignoring case');
  assert.equal(await store.nameTaken('Glacial Carillon', a), false);
  assert.equal(await store.nameTaken('Unused Name', 'x'), false);

  const q = fusionKey('rail', ['ember', 'haste']);
  await store.save(fusion(q, { status: 'provisional' }));
  assert.equal((await store.oldestProvisional())?.key, q);

  const s = await store.stats();
  assert.equal(s.discovered, 4);
  assert.equal(s.provisional, 1);
  assert.deepEqual(s.recent.map((r) => r.no), [4, 3, 2, 1]);

  await store.log(a, 1, 'test', 5, 12, '{"x":1}', ['a problem']);
  await store.close();
}

test('SQLite store: numbering, round trips and queries', async () => {
  await contract(new SqliteStore(':memory:'));
});

test('Firestore store: numbering, round trips and queries', async () => {
  const fake = await startFakeFirestore();
  try {
    await contract(new FirestoreStore(fake.serviceAccount, { baseUrl: fake.url }));
    assert.equal(fake.tokenRequests, 1, 'the access token is cached');
    assert.equal(decode(fake.docs.get('meta/counter')!.next), 4);
    assert.ok([...fake.docs.keys()].some((k) => k.startsWith('gen_log/')));
  } finally {
    await fake.close();
  }
});

test('the forge runs end to end on Firestore', async () => {
  const fake: FakeFirestore = await startFakeFirestore();
  try {
    const store = new FirestoreStore(fake.serviceAccount, { baseUrl: fake.url });
    const forge = new Forge(store, new MockLLM(), new Balancer(0), { concurrency: 2, maxRepairs: 2, noveltyLimit: 0.85 });
    const triple = fusionKey('bolt', ['ember', 'storm', 'void']);
    const r = await forge.request(triple);
    assert.ok(r.job && r.token);
    const row = await r.job.promise;
    assert.equal(row.status, 'ready');
    const parent = await store.get(fusionKey('bolt', ['ember', 'storm']));
    assert.equal(parent?.status, 'ready');
    assert.deepEqual([parent!.discoveryNo, row.discoveryNo], [1, 2]);
    assert.ok(forge.isWorldFirst(triple, r.token));
    assert.equal((await forge.request(triple)).row?.discoveryNo, 2, 'stored fusions come straight back');
  } finally {
    await fake.close();
  }
});

test('a bad service account is refused at sign-in', async () => {
  const fake = await startFakeFirestore();
  try {
    const other = await startFakeFirestore();
    await other.close();
    // Right endpoint, wrong private key.
    const store = new FirestoreStore({ ...fake.serviceAccount, private_key: other.serviceAccount.private_key }, { baseUrl: fake.url });
    await assert.rejects(store.get('v1:bolt:ember>storm'), /sign-in failed/);
  } finally {
    await fake.close();
  }
});

test('service accounts can be pasted raw or base64-encoded', () => {
  const sa = { project_id: 'p', client_email: 'e@x', private_key: 'k', token_uri: 'https://t' };
  assert.deepEqual(parseServiceAccount(JSON.stringify(sa)), sa);
  assert.deepEqual(parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString('base64')), sa);
  assert.throws(() => parseServiceAccount('{"project_id":"p"}'), /missing/);
  assert.deepEqual(decode(encode({ a: [1, 2.5, 'x', null, true], b: { c: -3 } })), { a: [1, 2.5, 'x', null, true], b: { c: -3 } });
});
