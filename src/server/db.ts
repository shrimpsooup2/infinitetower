// SQLite store (node:sqlite, no native dependencies). Fusions are stored once
// and shared forever. No player identity is stored: a discovery is credited
// only with its number and date.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FusionSpec } from '../effects/types.ts';

export interface FusionRow {
  key: string;
  tower: string;
  powers: string[];
  parentKey: string | null;
  status: 'ready' | 'provisional';
  name: string;
  concept: string;
  flavor: string;
  spec: FusionSpec;
  potency: number;
  ratio: number | null;
  balance: unknown;
  signature: string[];
  dslVersion: number;
  promptVersion: number;
  model: string;
  attempts: number;
  discoveryNo: number | null;
  discoveredAt: number | null;
  forgedCount: number;
  createdAt: number;
}

interface RawRow {
  key: string;
  tower: string;
  powers: string;
  parent_key: string | null;
  status: string;
  name: string;
  concept: string;
  flavor: string;
  spec: string;
  potency: number;
  ratio: number | null;
  balance: string | null;
  signature: string;
  dsl_version: number;
  prompt_version: number;
  model: string;
  attempts: number;
  discovery_no: number | null;
  discovered_at: number | null;
  forged_count: number;
  created_at: number;
}

function fromRaw(r: RawRow): FusionRow {
  return {
    key: r.key, tower: r.tower, powers: JSON.parse(r.powers), parentKey: r.parent_key, status: r.status as FusionRow['status'],
    name: r.name, concept: r.concept, flavor: r.flavor, spec: JSON.parse(r.spec), potency: r.potency, ratio: r.ratio,
    balance: r.balance ? JSON.parse(r.balance) : null, signature: JSON.parse(r.signature), dslVersion: r.dsl_version,
    promptVersion: r.prompt_version, model: r.model, attempts: r.attempts, discoveryNo: r.discovery_no,
    discoveredAt: r.discovered_at, forgedCount: r.forged_count, createdAt: r.created_at,
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS fusions (
        key TEXT PRIMARY KEY,
        tower TEXT NOT NULL,
        base TEXT NOT NULL,
        powers TEXT NOT NULL,
        parent_key TEXT,
        status TEXT NOT NULL,
        name TEXT NOT NULL,
        concept TEXT NOT NULL,
        flavor TEXT NOT NULL,
        spec TEXT NOT NULL,
        potency REAL NOT NULL,
        ratio REAL,
        balance TEXT,
        signature TEXT NOT NULL,
        dsl_version INTEGER NOT NULL,
        prompt_version INTEGER NOT NULL,
        model TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        discovery_no INTEGER UNIQUE,
        discovered_at INTEGER,
        forged_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fusions_tower_base ON fusions(tower, base);
      CREATE INDEX IF NOT EXISTS fusions_parent ON fusions(parent_key);
      CREATE INDEX IF NOT EXISTS fusions_status ON fusions(status);
      CREATE TABLE IF NOT EXISTS gen_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        model TEXT NOT NULL,
        prompt_version INTEGER NOT NULL,
        ms INTEGER NOT NULL,
        output TEXT,
        problems TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  get(key: string): FusionRow | null {
    const r = this.db.prepare('SELECT * FROM fusions WHERE key = ?').get(key) as RawRow | undefined;
    return r ? fromRaw(r) : null;
  }

  /** Insert or replace a fusion. A ready fusion gets the next discovery number the first time. */
  save(row: Omit<FusionRow, 'discoveryNo' | 'discoveredAt' | 'forgedCount' | 'createdAt'>): FusionRow {
    const now = Date.now();
    const existing = this.get(row.key);
    let discoveryNo = existing?.discoveryNo ?? null;
    let discoveredAt = existing?.discoveredAt ?? null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (row.status === 'ready' && discoveryNo === null) {
        const m = this.db.prepare('SELECT COALESCE(MAX(discovery_no), 0) + 1 AS n FROM fusions').get() as { n: number };
        discoveryNo = m.n;
        discoveredAt = now;
      }
      this.db.prepare(`
        INSERT INTO fusions (key, tower, base, powers, parent_key, status, name, concept, flavor, spec, potency, ratio, balance,
          signature, dsl_version, prompt_version, model, attempts, discovery_no, discovered_at, forged_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET status = excluded.status, name = excluded.name, concept = excluded.concept,
          flavor = excluded.flavor, spec = excluded.spec, potency = excluded.potency, ratio = excluded.ratio,
          balance = excluded.balance, signature = excluded.signature, dsl_version = excluded.dsl_version,
          prompt_version = excluded.prompt_version, model = excluded.model, attempts = excluded.attempts,
          discovery_no = excluded.discovery_no, discovered_at = excluded.discovered_at, updated_at = excluded.updated_at
      `).run(
        row.key, row.tower, row.powers[0], JSON.stringify(row.powers), row.parentKey, row.status, row.name, row.concept, row.flavor,
        JSON.stringify(row.spec), row.potency, row.ratio, row.balance ? JSON.stringify(row.balance) : null,
        JSON.stringify(row.signature), row.dslVersion, row.promptVersion, row.model, row.attempts, discoveryNo, discoveredAt,
        existing?.forgedCount ?? 0, existing?.createdAt ?? now, now,
      );
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return this.get(row.key)!;
  }

  bumpForged(key: string): void {
    this.db.prepare('UPDATE fusions SET forged_count = forged_count + 1 WHERE key = ?').run(key);
  }

  /** Fusions sharing a tower and base power (for the "avoid" list and novelty checks). */
  sameTowerBase(tower: string, base: string, exceptKey: string, limit = 40): FusionRow[] {
    return (this.db.prepare(
      "SELECT * FROM fusions WHERE tower = ? AND base = ? AND key != ? AND status = 'ready' AND parent_key IS NULL ORDER BY discovery_no DESC LIMIT ?",
    ).all(tower, base, exceptKey, limit) as unknown as RawRow[]).map(fromRaw);
  }

  siblings(parentKey: string, exceptKey: string): FusionRow[] {
    return (this.db.prepare("SELECT * FROM fusions WHERE parent_key = ? AND key != ? AND status = 'ready' LIMIT 40")
      .all(parentKey, exceptKey) as unknown as RawRow[]).map(fromRaw);
  }

  nameTaken(name: string, exceptKey: string): boolean {
    const r = this.db.prepare("SELECT 1 FROM fusions WHERE lower(name) = lower(?) AND key != ? AND status = 'ready' LIMIT 1").get(name, exceptKey);
    return !!r;
  }

  oldestProvisional(): FusionRow | null {
    const r = this.db.prepare("SELECT * FROM fusions WHERE status = 'provisional' ORDER BY updated_at ASC LIMIT 1").get() as RawRow | undefined;
    return r ? fromRaw(r) : null;
  }

  stats(): { discovered: number; provisional: number; recent: { no: number; tower: string; powers: string[]; at: number }[] } {
    const c = this.db.prepare("SELECT COUNT(*) AS n FROM fusions WHERE status = 'ready'").get() as { n: number };
    const p = this.db.prepare("SELECT COUNT(*) AS n FROM fusions WHERE status = 'provisional'").get() as { n: number };
    const recent = (this.db.prepare(
      "SELECT discovery_no, tower, powers, discovered_at FROM fusions WHERE status = 'ready' ORDER BY discovery_no DESC LIMIT 12",
    ).all() as unknown as { discovery_no: number; tower: string; powers: string; discovered_at: number }[])
      .map((r) => ({ no: r.discovery_no, tower: r.tower, powers: JSON.parse(r.powers) as string[], at: r.discovered_at }));
    return { discovered: c.n, provisional: p.n, recent };
  }

  log(key: string, attempt: number, model: string, promptVersion: number, ms: number, output: string | null, problems: string[]): void {
    this.db.prepare('INSERT INTO gen_log (key, attempt, model, prompt_version, ms, output, problems, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(key, attempt, model, promptVersion, ms, output ? output.slice(0, 20000) : null, JSON.stringify(problems), Date.now());
  }

  close(): void {
    this.db.close();
  }
}
