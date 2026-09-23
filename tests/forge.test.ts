// The forge end to end with the deterministic mock LLM: numbering, lineage,
// world firsts, the provisional fallback, and the HTTP API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/server/db.ts';
import { Forge } from '../src/server/forge/pipeline.ts';
import { Balancer } from '../src/server/forge/balancer.ts';
import { MockLLM, type LLM } from '../src/server/forge/llm.ts';
import { createApp, configFromEnv } from '../src/server/app.ts';
import { fusionKey } from '../src/effects/keys.ts';

const OPTS = { concurrency: 2, maxRepairs: 2, noveltyLimit: 0.85 };

test('pairs and triples are forged, numbered and shared', async () => {
  const store = new Store(':memory:');
  const forge = new Forge(store, new MockLLM(), new Balancer(0), OPTS);
  const pair = fusionKey('arc', ['frost', 'echo']);
  const r1 = forge.request(pair);
  assert.ok(r1.job && r1.token);
  const row = await r1.job.promise;
  assert.equal(row.status, 'ready');
  assert.equal(row.discoveryNo, 1);
  assert.ok(row.discoveredAt);
  assert.ok(forge.isWorldFirst(pair, r1.token));

  // A second player gets the stored fusion straight away, and no world first.
  const r2 = forge.request(pair);
  assert.equal(r2.job, null);
  assert.equal(r2.row?.discoveryNo, 1);
  assert.ok(!forge.isWorldFirst(pair, r2.token));

  // A triple forges its missing parent pair first.
  const triple = fusionKey('bolt', ['ember', 'storm', 'void']);
  const r3 = forge.request(triple);
  const t = await r3.job!.promise;
  const parent = store.get(fusionKey('bolt', ['ember', 'storm']));
  assert.equal(parent?.status, 'ready');
  assert.equal(t.status, 'ready');
  assert.deepEqual([parent!.discoveryNo, t.discoveryNo].sort(), [2, 3]);
  assert.ok(t.discoveryNo! > parent!.discoveryNo!);
  assert.ok(t.potency > 0);
});

test('a broken model falls back to a provisional fusion without a number', async () => {
  const broken: LLM = { name: 'broken', chat: async () => 'I would love to help, but here is no JSON.' };
  const store = new Store(':memory:');
  const forge = new Forge(store, broken, new Balancer(0), OPTS);
  const key = fusionKey('cannon', ['tide', 'gravity']);
  const row = await forge.request(key).job!.promise;
  assert.equal(row.status, 'provisional');
  assert.equal(row.discoveryNo, null);
  assert.ok(row.spec.rules.length > 0, 'the offline combination is still playable');
});

test('the HTTP API forges on request', async () => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.DB_PATH = ':memory:';
  process.env.BALANCE_WORKERS = '0';
  const app = createApp(configFromEnv(process.cwd()));
  await new Promise<void>((res) => app.server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.forge, true);

    const bad = await fetch(`${base}/api/forge`, { method: 'POST', body: JSON.stringify({ key: 'v1:bolt:nope>nah' }) });
    assert.equal(bad.status, 400);

    const key = fusionKey('prism', ['radiance', 'echo']);
    const post = await fetch(`${base}/api/forge`, { method: 'POST', body: JSON.stringify({ key }) });
    assert.equal(post.status, 202);
    const { token } = await post.json();
    let status = '';
    let body: { status: string; fusion?: { discoveryNo: number; worldFirst?: boolean; name: string } } = { status: '' };
    for (let i = 0; i < 200 && status !== 'ready'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      body = await (await fetch(`${base}/api/forge?key=${encodeURIComponent(key)}&token=${token}`)).json();
      status = body.status;
    }
    assert.equal(status, 'ready');
    assert.equal(body.fusion?.discoveryNo, 1);
    assert.equal(body.fusion?.worldFirst, true);

    const again = await (await fetch(`${base}/api/forge`, { method: 'POST', body: JSON.stringify({ key }) })).json();
    assert.equal(again.status, 'ready');
    assert.equal(again.fusion.worldFirst, undefined);

    const stats = await (await fetch(`${base}/api/stats`)).json();
    assert.equal(stats.total, 656_000);
    assert.ok(stats.discovered >= 1);

    // Server code is never served as a static file.
    assert.equal((await fetch(`${base}/src/server/db.ts`)).status, 404);
  } finally {
    await app.close();
  }
});
