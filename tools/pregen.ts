// Pre-forge fusions into the database (e.g. before launch, so early players
// meet some existing fusions). Uses the same config as the server (.env).
//
//   node tools/pregen.ts 25                      25 random pairs
//   node tools/pregen.ts v1:arc:frost>echo ...    specific keys

import { createApp, configFromEnv } from '../src/server/app.ts';
import { fusionKey } from '../src/effects/keys.ts';
import { TOWERS } from '../src/content/towers.ts';
import { POWERS } from '../src/content/powers.ts';

const args = process.argv.slice(2);
const cfg = configFromEnv(process.cwd());
if (cfg.llm === 'none') {
  console.error('No LLM configured: set OLLAMA_API_KEY (or LLM_PROVIDER=mock) first.');
  process.exit(1);
}
const app = createApp(cfg);
let keys = args.filter((a) => a.startsWith('v1:'));
if (!keys.length) {
  const n = Math.max(1, Number(args[0]) || 10);
  const seen = new Set<string>();
  for (let guard = 0; seen.size < n && guard < n * 50; guard++) {
    const t = TOWERS[Math.floor(Math.random() * TOWERS.length)];
    const a = POWERS[Math.floor(Math.random() * POWERS.length)];
    const b = POWERS[Math.floor(Math.random() * POWERS.length)];
    const k = fusionKey(t.id, [a.id, b.id]);
    if (a !== b && !app.store.get(k)) seen.add(k);
  }
  keys = [...seen];
}
console.log(`Forging ${keys.length} fusion(s) with ${cfg.llm}${cfg.llm === 'ollama' ? ` (${cfg.ollamaModel})` : ''}...`);
const t0 = Date.now();
const results = await Promise.all(keys.map(async (k) => {
  const r = app.forge.request(k, false);
  if (!r.job) return r.row;
  try {
    return await r.job.promise;
  } catch (e) {
    console.error(`${k}: ${(e as Error).message}`);
    return null;
  }
}));
for (const [i, row] of results.entries()) {
  const tag = row ? (row.status === 'ready' ? `#${row.discoveryNo}` : row.status) : 'failed';
  console.log(`${keys[i].padEnd(34)} ${tag.padEnd(12)} ${row?.name ?? ''}`);
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
await app.close();
