// Entry point: `npm start` (reads .env if present).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv, createApp } from './app.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cfg = configFromEnv(root);
const app = createApp(cfg);
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

app.server.listen(port, host, () => {
  const forge = cfg.llm === 'none'
    ? 'OFF (set OLLAMA_API_KEY to enable AI fusions; the game falls back to offline fusions)'
    : cfg.llm === 'mock' ? 'MOCK (test provider)' : `${cfg.ollamaModel} @ ${cfg.ollamaHost}`;
  console.log(`Infinite Tower running at http://localhost:${port}`);
  console.log(`  forge: ${forge}`);
  console.log(`  database: ${cfg.firebaseServiceAccount ? 'Firestore (Firebase)' : cfg.dbPath}`);
  if (cfg.corsOrigins.length) console.log(`  API open to: ${cfg.corsOrigins.join(', ')}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
