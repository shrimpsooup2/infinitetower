// HTTP server: serves the game (TypeScript is type-stripped on the fly, so
// there is no build step) and the forge API. Zero dependencies.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { SqliteStore, type FusionStore, type StoreStats } from './db.ts';
import { FirestoreStore, parseServiceAccount } from './firestore.ts';
import { Forge, toDTO } from './forge/pipeline.ts';
import { Balancer } from './forge/balancer.ts';
import { MockLLM, OllamaLLM, type LLM } from './forge/llm.ts';
import { TOTAL_FUSIONS } from '../effects/keys.ts';

export interface AppConfig {
  root: string;
  dbPath: string;
  /** Firebase service account JSON (raw or base64). When set, fusions live in Firestore instead of SQLite. */
  firebaseServiceAccount: string | null;
  llm: 'ollama' | 'mock' | 'none';
  ollamaHost: string;
  ollamaKey: string | null;
  ollamaModel: string;
  ollamaFormat: 'schema' | 'json' | 'none';
  ollamaThink: string | null;
  concurrency: number;
  maxRepairs: number;
  balanceWorkers: number;
  rateLimitPerHour: number;
  /** New generations allowed per UTC day across all players (protects the API bill). */
  dailyCap: number;
  /** Origins allowed to call the API from a browser (e.g. the GitHub Pages site); '*' for any. */
  corsOrigins: string[];
  /** Behind a hosting proxy: take the client IP from the last X-Forwarded-For hop. */
  trustProxy: boolean;
}

export function configFromEnv(root: string): AppConfig {
  const env = process.env;
  const host = env.OLLAMA_HOST || 'https://ollama.com';
  const key = env.OLLAMA_API_KEY || null;
  const provider = (env.LLM_PROVIDER as AppConfig['llm']) || (key || !/ollama\.com/.test(host) ? 'ollama' : 'none');
  return {
    root,
    dbPath: env.DB_PATH || join(root, 'data', 'infinitetower.db'),
    firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT || null,
    llm: provider,
    ollamaHost: host,
    ollamaKey: key,
    ollamaModel: env.OLLAMA_MODEL || 'gpt-oss:120b',
    ollamaFormat: (env.OLLAMA_FORMAT as AppConfig['ollamaFormat']) || 'json',
    ollamaThink: env.OLLAMA_THINK || null,
    concurrency: Number(env.FORGE_CONCURRENCY || 2),
    maxRepairs: Number(env.FORGE_MAX_REPAIRS || 3),
    balanceWorkers: Number(env.BALANCE_WORKERS || 1),
    rateLimitPerHour: Number(env.FORGE_RATE_LIMIT || 60),
    dailyCap: Number(env.FORGE_DAILY_CAP || 500),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY || ''),
  };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export interface App {
  server: Server;
  store: FusionStore;
  forge: Forge;
  close(): Promise<void>;
}

export function openStore(cfg: AppConfig): FusionStore {
  if (cfg.firebaseServiceAccount) return new FirestoreStore(parseServiceAccount(cfg.firebaseServiceAccount));
  return new SqliteStore(cfg.dbPath);
}

export function createApp(cfg: AppConfig, store: FusionStore = openStore(cfg)): App {
  let llm: LLM | null = null;
  if (cfg.llm === 'mock') llm = new MockLLM();
  else if (cfg.llm === 'ollama') {
    llm = new OllamaLLM({
      host: cfg.ollamaHost, apiKey: cfg.ollamaKey, model: cfg.ollamaModel, format: cfg.ollamaFormat, think: cfg.ollamaThink, timeoutMs: 240_000,
    });
  }
  const balancer = new Balancer(cfg.balanceWorkers);
  const forge = new Forge(store, llm, balancer, { concurrency: cfg.concurrency, maxRepairs: cfg.maxRepairs, noveltyLimit: 0.85 });
  const stripCache = new Map<string, { mtime: number; body: Buffer }>();
  const rate = new Map<string, number[]>();
  const retryTimer = setInterval(() => {
    forge.retryOneProvisional().catch((e: Error) => console.error('[forge] retry failed:', e.message));
  }, 10 * 60_000);
  retryTimer.unref();

  const root = resolve(cfg.root);

  async function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<void> {
    let rel = decodeURIComponent(urlPath);
    if (rel === '/' || rel === '') rel = '/index.html';
    const allowed = rel === '/index.html' || rel.startsWith('/src/') || rel.startsWith('/assets/');
    if (!allowed || rel.startsWith('/src/server/')) return send(res, 404, 'Not found');
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep)) return send(res, 403, 'Forbidden');
    const ext = extname(file);
    const type = TYPES[ext];
    if (!type) return send(res, 404, 'Not found');
    let st;
    try {
      st = await stat(file);
    } catch {
      return send(res, 404, 'Not found');
    }
    let body: Buffer;
    if (ext === '.ts') {
      const hit = stripCache.get(file);
      if (hit && hit.mtime === st.mtimeMs) body = hit.body;
      else {
        const src = await readFile(file, 'utf8');
        body = Buffer.from(stripTypeScriptTypes(src, { mode: 'strip' }));
        stripCache.set(file, { mtime: st.mtimeMs, body });
      }
    } else {
      body = await readFile(file);
    }
    res.writeHead(200, {
      'content-type': type,
      'cache-control': ext === '.html' ? 'no-cache' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function ip(req: IncomingMessage): string {
    // Only a trusted proxy's own hop (the last one) can't be forged by the client.
    const fwd = req.headers['x-forwarded-for'];
    const hop = cfg.trustProxy && typeof fwd === 'string' ? fwd.split(',').pop()?.trim() : '';
    return hop || req.socket.remoteAddress || '?';
  }

  let day = '';
  let dayCount = 0;
  /** Count one new generation against today's global cap; false when it is used up. */
  function dailyOk(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      dayCount = 0;
    }
    if (dayCount >= cfg.dailyCap) return false;
    dayCount++;
    return true;
  }

  function cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (!origin) return;
    if (cfg.corsOrigins.includes('*') || cfg.corsOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
  }

  function allow(req: IncomingMessage): boolean {
    const now = Date.now();
    const k = ip(req);
    const list = (rate.get(k) ?? []).filter((t) => now - t < 3600_000);
    if (list.length >= cfg.rateLimitPerHour) return false;
    list.push(now);
    rate.set(k, list);
    return true;
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 4096) throw new Error('body too large');
      chunks.push(c as Buffer);
    }
    const txt = Buffer.concat(chunks).toString('utf8');
    return txt ? (JSON.parse(txt) as Record<string, unknown>) : {};
  }

  // The title screen asks for stats on every visit; keep hosted databases' read quotas for real work.
  let statsCache: { at: number; value: StoreStats } | null = null;
  async function stats(): Promise<StoreStats> {
    if (!statsCache || Date.now() - statsCache.at > 30_000) statsCache = { at: Date.now(), value: await store.stats() };
    return statsCache.value;
  }

  function bump(key: string): void {
    store.bumpForged(key).catch((e: Error) => console.error('[store] bump failed:', e.message));
  }

  async function forgeStatus(key: string, token: string | null) {
    const job = forge.jobs.get(key);
    const row = await store.get(key);
    if (job && job.stage !== 'done' && job.stage !== 'failed') {
      return { status: job.stage, position: forge.queuePosition(job), attempt: job.attempt, fusion: row ? toDTO(row) : null };
    }
    if (row) return { status: row.status, fusion: toDTO(row, forge.isWorldFirst(key, token) && row.status === 'ready') };
    if (job?.error) return { status: 'failed', error: job.error };
    return { status: forge.enabled ? 'unknown' : 'unavailable' };
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    if (path === '/api/health') {
      return json(res, 200, { ok: true, forge: forge.enabled, model: llm?.name ?? null });
    }
    if (path === '/api/stats' && req.method === 'GET') {
      const s = await stats();
      return json(res, 200, { ...s, total: TOTAL_FUSIONS, forge: forge.enabled, model: llm?.name ?? null });
    }
    if (path === '/api/forge' && req.method === 'POST') {
      let b: Record<string, unknown>;
      try {
        b = await body(req);
      } catch {
        return json(res, 400, { error: 'bad request' });
      }
      const key = String(b.key ?? '');
      if (!forge.resolve(key)) return json(res, 400, { error: 'invalid fusion key' });
      const existing = await store.get(key);
      if (existing && existing.status === 'ready') {
        bump(key);
        return json(res, 200, { status: 'ready', fusion: toDTO(existing) });
      }
      if (!forge.jobs.has(key) && forge.enabled) {
        if (!allow(req)) return json(res, 429, { status: 'rate_limited', fusion: existing ? toDTO(existing) : null });
        if (!dailyOk()) return json(res, 429, { status: 'daily_cap', fusion: existing ? toDTO(existing) : null });
      }
      const r = await forge.request(key, true);
      if (!r.job) {
        return json(res, 200, { status: forge.enabled ? (r.row?.status ?? 'unknown') : 'unavailable', fusion: r.row ? toDTO(r.row) : null });
      }
      bump(key);
      return json(res, 202, { ...(await forgeStatus(key, r.token)), token: r.token });
    }
    if (path === '/api/forge' && req.method === 'GET') {
      const key = url.searchParams.get('key') ?? '';
      if (!forge.resolve(key)) return json(res, 400, { error: 'invalid fusion key' });
      return json(res, 200, await forgeStatus(key, url.searchParams.get('token')));
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      cors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' });
        res.end();
        return;
      }
    }
    const p = url.pathname.startsWith('/api/') ? api(req, res, url) : serveStatic(req, res, url.pathname);
    p.catch((e: Error) => {
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      console.error('[server]', e);
    });
  });

  return {
    server, store, forge,
    async close() {
      clearInterval(retryTimer);
      await new Promise<void>((r) => server.close(() => r()));
      await balancer.close();
      await store.close();
    },
  };
}

function send(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
