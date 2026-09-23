// A small stand-in for the Firestore REST API and Google's token endpoint,
// covering exactly what FirestoreStore uses: get / patch / create documents,
// commit with increment transforms and preconditions, equality queries with
// ordering and limits, count aggregations, and service-account JWT sign-in
// (the signature is really verified).

import { createServer, type IncomingMessage } from 'node:http';
import { createVerify, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { decode, type ServiceAccount } from '../../src/server/firestore.ts';

type Fields = Record<string, any>;

export interface FakeFirestore {
  url: string;
  serviceAccount: ServiceAccount;
  docs: Map<string, Fields>;
  tokenRequests: number;
  close(): Promise<void>;
}

const PROJECT = 'demo-tower';
const PREFIX = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const NAME_PREFIX = `projects/${PROJECT}/databases/(default)/documents/`;

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function matches(fields: Fields, where: any): boolean {
  if (!where) return true;
  if (where.compositeFilter) return where.compositeFilter.filters.every((f: any) => matches(fields, f));
  if (where.fieldFilter) {
    const v = fields[where.fieldFilter.field.fieldPath];
    if (where.fieldFilter.op !== 'EQUAL') throw new Error(`unsupported op ${where.fieldFilter.op}`);
    return v !== undefined && isDeepStrictEqual(decode(v), decode(where.fieldFilter.value));
  }
  if (where.unaryFilter) {
    if (where.unaryFilter.op !== 'IS_NULL') throw new Error(`unsupported op ${where.unaryFilter.op}`);
    const v = fields[where.unaryFilter.field.fieldPath];
    return v !== undefined && 'nullValue' in v;
  }
  throw new Error('unsupported filter');
}

export async function startFakeFirestore(): Promise<FakeFirestore> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const docs = new Map<string, Fields>();
  const state = { tokenRequests: 0 };
  let url = '';
  const email = 'forge@demo-tower.iam.gserviceaccount.com';

  const query = (sq: any) => {
    const col = sq.from[0].collectionId;
    let rows = [...docs.entries()].filter(([p, f]) => p.startsWith(`${col}/`) && !p.slice(col.length + 1).includes('/') && matches(f, sq.where));
    for (const o of [...(sq.orderBy ?? [])].reverse()) {
      const k = o.field.fieldPath;
      rows = rows.filter(([, f]) => f[k] !== undefined);
      rows.sort(([, a], [, b]) => {
        const x = decode(a[k]) as any, y = decode(b[k]) as any;
        const c = x === y ? 0 : x === null ? -1 : y === null ? 1 : x < y ? -1 : 1;
        return o.direction === 'DESCENDING' ? -c : c;
      });
    }
    return rows.slice(0, sq.limit ?? rows.length);
  };

  const server = createServer(async (req, res) => {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const path = (req.url ?? '').split('?')[0];
      const text = await body(req);
      if (path === '/token') {
        state.tokenRequests++;
        const jwt = new URLSearchParams(text).get('assertion') ?? '';
        const [h, c, sig] = jwt.split('.');
        const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
        const ok = JSON.parse(Buffer.from(h, 'base64url').toString()).alg === 'RS256'
          && createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))
          && claims.iss === email && claims.aud === `${url}/token` && /datastore/.test(claims.scope) && claims.exp > claims.iat;
        return ok ? send(200, { access_token: 'fake-access', expires_in: 3600, token_type: 'Bearer' }) : send(401, { error: 'invalid_grant' });
      }
      if (req.headers.authorization !== 'Bearer fake-access') return send(401, { error: { status: 'UNAUTHENTICATED' } });
      if (!path.startsWith(PREFIX)) return send(404, { error: { status: 'NOT_FOUND' } });
      const rest = path.slice(PREFIX.length);
      const json = text ? JSON.parse(text) : {};
      if (rest === ':commit') {
        const writeResults = [];
        for (const w of json.writes) {
          const p = String(w.update.name).slice(NAME_PREFIX.length);
          const cur = docs.get(p);
          if (w.currentDocument?.exists === true && !cur) return send(404, { error: { status: 'NOT_FOUND' } });
          let fields: Fields = { ...(cur ?? {}) };
          if (w.updateMask) for (const k of w.updateMask.fieldPaths) fields[k] = w.update.fields[k];
          else fields = { ...w.update.fields };
          const transformResults = [];
          for (const t of w.updateTransforms ?? []) {
            const now = fields[t.fieldPath] ? Number(decode(fields[t.fieldPath])) : 0;
            fields[t.fieldPath] = { integerValue: String(now + Number(t.increment.integerValue)) };
            transformResults.push(fields[t.fieldPath]);
          }
          docs.set(p, fields);
          writeResults.push({ updateTime: new Date().toISOString(), transformResults });
        }
        return send(200, { writeResults, commitTime: new Date().toISOString() });
      }
      if (rest === ':runQuery') {
        const rows = query(json.structuredQuery);
        const readTime = new Date().toISOString();
        return send(200, rows.length ? rows.map(([p, fields]) => ({ document: { name: NAME_PREFIX + p, fields }, readTime })) : [{ readTime }]);
      }
      if (rest === ':runAggregationQuery') {
        const n = query({ ...json.structuredAggregationQuery.structuredQuery, limit: undefined }).length;
        return send(200, [{ result: { aggregateFields: { n: { integerValue: String(n) } } }, readTime: new Date().toISOString() }]);
      }
      const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts.length === 2 && req.method === 'GET') {
        const f = docs.get(parts.join('/'));
        return f ? send(200, { name: NAME_PREFIX + parts.join('/'), fields: f }) : send(404, { error: { status: 'NOT_FOUND' } });
      }
      if (parts.length === 2 && req.method === 'PATCH') {
        docs.set(parts.join('/'), json.fields ?? {});
        return send(200, { name: NAME_PREFIX + parts.join('/'), fields: json.fields ?? {} });
      }
      if (parts.length === 1 && req.method === 'POST') {
        const p = `${parts[0]}/${randomUUID()}`;
        docs.set(p, json.fields ?? {});
        return send(200, { name: NAME_PREFIX + p, fields: json.fields ?? {} });
      }
      return send(400, { error: { status: 'INVALID_ARGUMENT', message: `unsupported ${req.method} ${rest}` } });
    } catch (e) {
      return send(500, { error: { message: (e as Error).message } });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    docs,
    get tokenRequests() { return state.tokenRequests; },
    serviceAccount: { project_id: PROJECT, client_email: email, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: `${url}/token` },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
