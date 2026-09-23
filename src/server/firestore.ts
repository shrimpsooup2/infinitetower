// Firestore store: keeps fusions in Firebase's free Firestore database, so the
// forge can run on free hosts whose disk is wiped on every restart. Talks to
// the Firestore REST API directly and signs in with a service account (a JWT
// signed with node:crypto), so there are still no dependencies.
//
// Layout:  fusions/{key}   one document per fusion (spec kept as a JSON string)
//          meta/counter    { next } for discovery numbers (atomic increments)
//          gen_log/{auto}  every model attempt, for prompt tuning

import { createSign } from 'node:crypto';
import type { FusionRow, FusionStore, NewFusion, StoreStats } from './db.ts';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FirestoreOptions {
  database?: string;
  /** Override the API origin (tests). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

type Value =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: Value[] } }
  | { mapValue: { fields?: Record<string, Value> } };

interface Doc {
  name: string;
  fields?: Record<string, Value>;
}

export function encode(v: unknown): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encode(x)])) } };
  }
  throw new Error(`cannot store ${typeof v}`);
}

export function decode(v: Value): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x)]));
  throw new Error('unknown Firestore value');
}

function toFields(r: FusionRow, updatedAt: number): Record<string, Value> {
  const f: Record<string, unknown> = {
    key: r.key, tower: r.tower, base: r.powers[0], powers: r.powers, parentKey: r.parentKey, status: r.status,
    name: r.name, nameLower: r.name.toLowerCase(), concept: r.concept, flavor: r.flavor, spec: JSON.stringify(r.spec),
    potency: r.potency, ratio: r.ratio, balance: r.balance === null || r.balance === undefined ? null : JSON.stringify(r.balance),
    signature: r.signature, dslVersion: r.dslVersion, promptVersion: r.promptVersion, model: r.model, attempts: r.attempts,
    discoveryNo: r.discoveryNo, discoveredAt: r.discoveredAt, forgedCount: r.forgedCount, createdAt: r.createdAt, updatedAt,
  };
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, encode(v)]));
}

function fromDoc(d: Doc): FusionRow & { updatedAt: number } {
  const o = decode({ mapValue: { fields: d.fields ?? {} } }) as Record<string, unknown>;
  const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    key: String(o.key), tower: String(o.tower), powers: (o.powers as string[]) ?? [], parentKey: (o.parentKey as string | null) ?? null,
    status: o.status === 'ready' ? 'ready' : 'provisional', name: String(o.name), concept: String(o.concept ?? ''),
    flavor: String(o.flavor ?? ''), spec: JSON.parse(String(o.spec)), potency: Number(o.potency), ratio: num(o.ratio),
    balance: typeof o.balance === 'string' ? JSON.parse(o.balance) : null, signature: (o.signature as string[]) ?? [],
    dslVersion: Number(o.dslVersion ?? 1), promptVersion: Number(o.promptVersion ?? 0), model: String(o.model ?? ''),
    attempts: Number(o.attempts ?? 0), discoveryNo: num(o.discoveryNo), discoveredAt: num(o.discoveredAt),
    forgedCount: Number(o.forgedCount ?? 0), createdAt: Number(o.createdAt ?? 0), updatedAt: Number(o.updatedAt ?? 0),
  };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Accepts the service account JSON as-is or base64-encoded (easier to paste into some hosts). */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw.trim(), 'base64').toString('utf8');
  const sa = JSON.parse(text) as ServiceAccount;
  if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key');
  return sa;
}

export class FirestoreStore implements FusionStore {
  private sa: ServiceAccount;
  private http: typeof fetch;
  private docsPath: string;
  private base: string;
  private token: { value: string; until: number } | null = null;

  constructor(sa: ServiceAccount, o: FirestoreOptions = {}) {
    this.sa = sa;
    this.http = o.fetch ?? fetch;
    this.docsPath = `projects/${sa.project_id}/databases/${o.database ?? '(default)'}/documents`;
    this.base = `${(o.baseUrl ?? 'https://firestore.googleapis.com').replace(/\/+$/, '')}/v1/${this.docsPath}`;
  }

  // ------------------------------------------------------------ transport

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.until) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const aud = this.sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
      iss: this.sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud, iat: now, exp: now + 3600,
    }))}`;
    const jwt = `${unsigned}.${b64url(createSign('RSA-SHA256').update(unsigned).sign(this.sa.private_key))}`;
    const res = await this.http(aud, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
    });
    const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !j.access_token) throw new Error(`Firebase sign-in failed: ${j.error_description ?? j.error ?? res.status}`);
    this.token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
    return j.access_token;
  }

  private async call<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
    const res = await this.http(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firestore ${method} ${path.split('?')[0]}: ${res.status} ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  private docName(path: string): string {
    return `${this.docsPath}/${path}`;
  }

  /** Atomically add `by` to a numeric field (creating the document if allowed); returns the new value. */
  private async increment(path: string, field: string, by: number, mustExist: boolean): Promise<number> {
    const r = await this.call<{ writeResults?: { transformResults?: Value[] }[] }>('POST', ':commit', {
      writes: [{
        update: { name: this.docName(path), fields: {} },
        updateMask: { fieldPaths: [] },
        updateTransforms: [{ fieldPath: field, increment: { integerValue: String(by) } }],
        ...(mustExist ? { currentDocument: { exists: true } } : {}),
      }],
    });
    const v = r?.writeResults?.[0]?.transformResults?.[0];
    return v ? Number(decode(v)) : NaN;
  }

  private async query(filters: [string, unknown][], limit: number, orderBy?: [string, 'ASCENDING' | 'DESCENDING']): Promise<(FusionRow & { updatedAt: number })[]> {
    const one = ([field, value]: [string, unknown]) =>
      value === null
        ? { unaryFilter: { op: 'IS_NULL', field: { fieldPath: field } } }
        : { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encode(value) } };
    const structuredQuery: Record<string, unknown> = { from: [{ collectionId: 'fusions' }], limit };
    if (filters.length === 1) structuredQuery.where = one(filters[0]);
    else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters: filters.map(one) } };
    if (orderBy) structuredQuery.orderBy = [{ field: { fieldPath: orderBy[0] }, direction: orderBy[1] }];
    const r = await this.call<{ document?: Doc }[]>('POST', ':runQuery', { structuredQuery });
    return (r ?? []).filter((x) => x.document).map((x) => fromDoc(x.document!));
  }

  private async count(field: string, value: unknown): Promise<number> {
    const r = await this.call<{ result?: { aggregateFields?: Record<string, Value> } }[]>('POST', ':runAggregationQuery', {
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: 'fusions' }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encode(value) } } },
        aggregations: [{ alias: 'n', count: {} }],
      },
    });
    const v = r?.[0]?.result?.aggregateFields?.n;
    return v ? Number(decode(v)) : 0;
  }

  // ------------------------------------------------------------ FusionStore

  async get(key: string): Promise<FusionRow | null> {
    const d = await this.call<Doc>('GET', `/fusions/${encodeURIComponent(key)}`, undefined, true);
    return d ? fromDoc(d) : null;
  }

  async save(row: NewFusion): Promise<FusionRow> {
    const now = Date.now();
    const existing = await this.get(row.key);
    let discoveryNo = existing?.discoveryNo ?? null;
    let discoveredAt = existing?.discoveredAt ?? null;
    if (row.status === 'ready' && discoveryNo === null) {
      discoveryNo = await this.increment('meta/counter', 'next', 1, false);
      if (!Number.isFinite(discoveryNo)) throw new Error('could not allocate a discovery number');
      discoveredAt = now;
    }
    const full: FusionRow = { ...row, discoveryNo, discoveredAt, forgedCount: existing?.forgedCount ?? 0, createdAt: existing?.createdAt ?? now };
    await this.call('PATCH', `/fusions/${encodeURIComponent(row.key)}`, { fields: toFields(full, now) });
    return full;
  }

  async bumpForged(key: string): Promise<void> {
    try {
      await this.increment(`fusions/${key}`, 'forgedCount', 1, true);
    } catch {
      // The fusion may not exist (yet); the count is only a statistic.
    }
  }

  async sameTowerBase(tower: string, base: string, exceptKey: string, limit = 40): Promise<FusionRow[]> {
    const rows = await this.query([['tower', tower], ['base', base], ['status', 'ready'], ['parentKey', null]], 80);
    return rows.filter((r) => r.key !== exceptKey).sort((a, b) => (b.discoveryNo ?? 0) - (a.discoveryNo ?? 0)).slice(0, limit);
  }

  async siblings(parentKey: string, exceptKey: string): Promise<FusionRow[]> {
    return (await this.query([['parentKey', parentKey], ['status', 'ready']], 41)).filter((r) => r.key !== exceptKey).slice(0, 40);
  }

  async nameTaken(name: string, exceptKey: string): Promise<boolean> {
    return (await this.query([['nameLower', name.toLowerCase()], ['status', 'ready']], 2)).some((r) => r.key !== exceptKey);
  }

  async oldestProvisional(): Promise<FusionRow | null> {
    const rows = await this.query([['status', 'provisional']], 50);
    return rows.sort((a, b) => a.updatedAt - b.updatedAt)[0] ?? null;
  }

  async stats(): Promise<StoreStats> {
    const [discovered, provisional, latest] = await Promise.all([
      this.count('status', 'ready'),
      this.count('status', 'provisional'),
      this.query([], 12, ['discoveryNo', 'DESCENDING']),
    ]);
    const recent = latest
      .filter((r) => r.status === 'ready' && r.discoveryNo !== null)
      .map((r) => ({ no: r.discoveryNo!, tower: r.tower, powers: r.powers, at: r.discoveredAt ?? 0 }));
    return { discovered, provisional, recent };
  }

  async log(key: string, attempt: number, model: string, promptVersion: number, ms: number, output: string | null, problems: string[]): Promise<void> {
    const fields = { key, attempt, model, promptVersion, ms, output: output ? output.slice(0, 20000) : null, problems: JSON.stringify(problems), createdAt: Date.now() };
    await this.call('POST', '/gen_log', { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) });
  }

  async close(): Promise<void> {
    // Nothing to release: every call is a stateless HTTPS request.
  }
}
