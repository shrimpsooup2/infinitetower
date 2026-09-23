// Public deployment: the static build for GitHub Pages, and the backend's
// cross-origin access, spend caps and proxy-aware rate limiting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp, configFromEnv, type AppConfig } from '../src/server/app.ts';
import { fusionKey } from '../src/effects/keys.ts';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

test('the static build is plain JS, points at the API and ships no server code', () => {
  const out = mkdtempSync(join(tmpdir(), 'it-build-'));
  try {
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/build.ts', out], {
      env: { ...process.env, API_BASE: 'https://forge.example.com/' },
      stdio: 'pipe',
    });
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    assert.match(html, /window\.IT_API_BASE = "https:\/\/forge\.example\.com";/);
    assert.match(html, /src="\.\/src\/client\/main\.js"/);
    assert.ok(existsSync(join(out, '.nojekyll')));
    assert.ok(existsSync(join(out, 'src/client/style.css')));
    const files = walk(out);
    assert.ok(files.every((f) => !f.endsWith('.ts')), 'no .ts files');
    assert.ok(files.every((f) => !f.includes(`${join('src', 'server')}`)), 'no server code');
    for (const f of files.filter((x) => x.endsWith('.js'))) {
      const src = readFileSync(f, 'utf8');
      assert.doesNotMatch(src, /from\s*['"][^'"]+\.ts['"]/, `${f} still imports .ts`);
      assert.doesNotMatch(src, /\binterface\s+\w+\s*\{/, `${f} still has types`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

async function serve(over: Partial<AppConfig>) {
  const app = createApp({ ...configFromEnv(process.cwd()), llm: 'mock', dbPath: ':memory:', balanceWorkers: 0, ...over });
  await new Promise<void>((res) => app.server.listen(0, '127.0.0.1', res));
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}

test('only the configured site may call the API from a browser', async () => {
  const { app, base } = await serve({ corsOrigins: ['https://someone.github.io'] });
  try {
    const pre = await fetch(`${base}/api/forge`, { method: 'OPTIONS', headers: { origin: 'https://someone.github.io', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://someone.github.io');
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /content-type/);
    const other = await fetch(`${base}/api/health`, { headers: { origin: 'https://elsewhere.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  } finally {
    await app.close();
  }
});

test('the daily cap stops new generations but not stored fusions', async () => {
  const { app, base } = await serve({ dailyCap: 1 });
  try {
    const post = (key: string) => fetch(`${base}/api/forge`, { method: 'POST', body: JSON.stringify({ key }) });
    const first = await post(fusionKey('bolt', ['ember', 'frost']));
    assert.equal(first.status, 202);
    const second = await post(fusionKey('bolt', ['storm', 'venom']));
    assert.equal(second.status, 429);
    assert.equal((await second.json()).status, 'daily_cap');
  } finally {
    await app.close();
  }
});

test('spoofed forwarding headers do not dodge the per-player limit', async () => {
  const { app, base } = await serve({ rateLimitPerHour: 1, trustProxy: true });
  try {
    const post = (key: string, fwd: string) =>
      fetch(`${base}/api/forge`, { method: 'POST', body: JSON.stringify({ key }), headers: { 'x-forwarded-for': fwd } });
    // A client can prepend anything; the proxy's own (last) hop is what counts.
    assert.equal((await post(fusionKey('cannon', ['tide', 'void']), '1.1.1.1, 9.9.9.9')).status, 202);
    assert.equal((await post(fusionKey('cannon', ['void', 'tide']), '2.2.2.2, 9.9.9.9')).status, 429);
    assert.equal((await post(fusionKey('cannon', ['echo', 'tide']), '3.3.3.3, 8.8.8.8')).status, 202);
  } finally {
    await app.close();
  }
});
