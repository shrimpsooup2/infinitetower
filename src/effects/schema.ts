// A tiny schema library. One schema definition gives us:
//   1. validation + normalization of untrusted JSON (LLM output, DB rows),
//   2. a JSON Schema for Ollama's structured-output `format`,
//   3. a compact type sketch + docs for the LLM cheat sheet.
// Out-of-range numbers are clamped with a warning rather than rejected: small
// numeric slips from the LLM are not worth a repair round-trip.

export interface Issue {
  path: string;
  msg: string;
  level: 'error' | 'warn';
}

export abstract class Schema<T = unknown> {
  doc = '';
  abstract parse(v: unknown, path: string, issues: Issue[]): T | undefined;
  abstract json(defs: JsonDefs): Record<string, unknown>;
  abstract sketch(): string;
  describe(doc: string): this {
    this.doc = doc;
    return this;
  }
}

export type JsonDefs = Map<string, Record<string, unknown>>;

function err(issues: Issue[], path: string, msg: string): undefined {
  issues.push({ path, msg, level: 'error' });
  return undefined;
}

function warn(issues: Issue[], path: string, msg: string): void {
  issues.push({ path, msg, level: 'warn' });
}

class NumS extends Schema<number> {
  readonly min: number;
  readonly max: number;
  readonly int: boolean;
  constructor(min: number, max: number, int: boolean) {
    super();
    this.min = min;
    this.max = max;
    this.int = int;
  }
  parse(v: unknown, path: string, issues: Issue[]): number | undefined {
    let n = v;
    if (typeof n === 'string' && n.trim() !== '' && !Number.isNaN(Number(n))) n = Number(n);
    if (typeof n !== 'number' || !Number.isFinite(n)) return err(issues, path, `expected a number, got ${JSON.stringify(v)}`);
    let out = this.int ? Math.round(n) : n;
    if (out < this.min || out > this.max) {
      const c = Math.min(this.max, Math.max(this.min, out));
      warn(issues, path, `${out} clamped to ${c} (allowed ${this.min}..${this.max})`);
      out = c;
    }
    return out;
  }
  json(): Record<string, unknown> {
    return { type: this.int ? 'integer' : 'number', minimum: this.min, maximum: this.max };
  }
  sketch(): string {
    return `${this.int ? 'int' : 'number'} ${this.min}..${this.max}`;
  }
}

class StrS extends Schema<string> {
  readonly maxLen: number;
  readonly pattern: RegExp | null;
  constructor(maxLen: number, pattern: RegExp | null) {
    super();
    this.maxLen = maxLen;
    this.pattern = pattern;
  }
  parse(v: unknown, path: string, issues: Issue[]): string | undefined {
    if (typeof v !== 'string') return err(issues, path, `expected a string`);
    // Strip control characters; LLM text is rendered as plain text only.
    let s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (s.length === 0) return err(issues, path, 'must not be empty');
    if (s.length > this.maxLen) {
      warn(issues, path, `truncated to ${this.maxLen} chars`);
      s = s.slice(0, this.maxLen).trim();
    }
    if (this.pattern && !this.pattern.test(s)) return err(issues, path, `"${s}" does not match ${this.pattern}`);
    return s;
  }
  json(): Record<string, unknown> {
    const o: Record<string, unknown> = { type: 'string', maxLength: this.maxLen };
    if (this.pattern) o.pattern = this.pattern.source;
    return o;
  }
  sketch(): string {
    return this.pattern ? 'id' : 'text';
  }
}

class EnumS<T extends string> extends Schema<T> {
  readonly values: readonly T[];
  constructor(values: readonly T[]) {
    super();
    this.values = values;
  }
  parse(v: unknown, path: string, issues: Issue[]): T | undefined {
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
      const hit = this.values.find((x) => x === s);
      if (hit) return hit;
    }
    return err(issues, path, `expected one of ${this.values.join('|')}, got ${JSON.stringify(v)}`);
  }
  json(): Record<string, unknown> {
    return { type: 'string', enum: [...this.values] };
  }
  sketch(): string {
    return this.values.join('|');
  }
}

class LitS<T extends string | number | boolean> extends Schema<T> {
  readonly value: T;
  constructor(value: T) {
    super();
    this.value = value;
  }
  parse(v: unknown, path: string, issues: Issue[]): T | undefined {
    if (v === this.value) return this.value;
    return err(issues, path, `expected ${JSON.stringify(this.value)}`);
  }
  json(): Record<string, unknown> {
    return { const: this.value };
  }
  sketch(): string {
    return JSON.stringify(this.value);
  }
}

class BoolS extends Schema<boolean> {
  parse(v: unknown, path: string, issues: Issue[]): boolean | undefined {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return err(issues, path, 'expected true/false');
  }
  json(): Record<string, unknown> {
    return { type: 'boolean' };
  }
  sketch(): string {
    return 'bool';
  }
}

class ArrS<T> extends Schema<T[]> {
  readonly item: Schema<T>;
  readonly min: number;
  readonly max: number;
  constructor(item: Schema<T>, min: number, max: number) {
    super();
    this.item = item;
    this.min = min;
    this.max = max;
  }
  parse(v: unknown, path: string, issues: Issue[]): T[] | undefined {
    if (v === undefined || v === null) v = [];
    if (!Array.isArray(v)) {
      // A lone object where a list was expected is a common LLM slip.
      if (typeof v === 'object') v = [v];
      else return err(issues, path, 'expected a list');
    }
    let arr = v as unknown[];
    if (arr.length > this.max) {
      warn(issues, path, `only the first ${this.max} items kept`);
      arr = arr.slice(0, this.max);
    }
    if (arr.length < this.min) return err(issues, path, `needs at least ${this.min} item(s)`);
    const out: T[] = [];
    let ok = true;
    arr.forEach((x, i) => {
      const r = this.item.parse(x, `${path}[${i}]`, issues);
      if (r === undefined) ok = false;
      else out.push(r);
    });
    return ok ? out : undefined;
  }
  json(defs: JsonDefs): Record<string, unknown> {
    return { type: 'array', items: this.item.json(defs), minItems: this.min, maxItems: this.max };
  }
  sketch(): string {
    return `[${this.item.sketch()}]`;
  }
}

class OptS<T> extends Schema<T | undefined> {
  readonly inner: Schema<T>;
  constructor(inner: Schema<T>) {
    super();
    this.inner = inner;
    this.doc = inner.doc;
  }
  parse(v: unknown, path: string, issues: Issue[]): T | undefined {
    if (v === undefined || v === null) return undefined;
    return this.inner.parse(v, path, issues);
  }
  json(defs: JsonDefs): Record<string, unknown> {
    return this.inner.json(defs);
  }
  sketch(): string {
    return this.inner.sketch();
  }
}

export type Shape = Record<string, Schema<unknown>>;

class ObjS<T> extends Schema<T> {
  readonly shape: Shape;
  constructor(shape: Shape) {
    super();
    this.shape = shape;
  }
  parse(v: unknown, path: string, issues: Issue[]): T | undefined {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return err(issues, path, 'expected an object');
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let ok = true;
    for (const [k, s] of Object.entries(this.shape)) {
      const has = src[k] !== undefined && src[k] !== null;
      if (!has && !(s instanceof OptS)) {
        err(issues, `${path}.${k}`, 'is required');
        ok = false;
        continue;
      }
      const before = issues.length;
      const r = s.parse(src[k], `${path}.${k}`, issues);
      if (r === undefined) {
        if (has && issues.slice(before).some((i) => i.level === 'error')) ok = false;
      } else out[k] = r;
    }
    for (const k of Object.keys(src)) {
      if (!(k in this.shape)) warn(issues, `${path}.${k}`, 'unknown field ignored');
    }
    return ok ? (out as T) : undefined;
  }
  json(defs: JsonDefs): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, s] of Object.entries(this.shape)) {
      props[k] = s.json(defs);
      if (!(s instanceof OptS)) required.push(k);
    }
    return { type: 'object', properties: props, required, additionalProperties: false };
  }
  sketch(): string {
    const parts = Object.entries(this.shape).map(([k, s]) => `${k}${s instanceof OptS ? '?' : ''}: ${s.sketch()}`);
    return `{ ${parts.join(', ')} }`;
  }
}

/** Discriminated union over `key` (e.g. "action", "event", "check"). */
class DiscS<T> extends Schema<T> {
  readonly key: string;
  readonly variants: Map<string, ObjS<unknown>>;
  readonly name: string;
  constructor(name: string, key: string, variants: Record<string, ObjS<unknown>>) {
    super();
    this.name = name;
    this.key = key;
    this.variants = new Map(Object.entries(variants));
  }
  parse(v: unknown, path: string, issues: Issue[]): T | undefined {
    if (typeof v !== 'object' || v === null) return err(issues, path, `expected a ${this.name} object`);
    const tag = (v as Record<string, unknown>)[this.key];
    const variant = typeof tag === 'string' ? this.variants.get(tag.trim().toLowerCase()) : undefined;
    if (!variant) {
      return err(issues, `${path}.${this.key}`, `unknown ${this.name} ${JSON.stringify(tag)}; valid: ${[...this.variants.keys()].join(', ')}`);
    }
    const rest = { ...(v as Record<string, unknown>) };
    delete rest[this.key];
    const r = variant.parse(rest, path, issues) as Record<string, unknown> | undefined;
    if (r === undefined) return undefined;
    return { [this.key]: (tag as string).trim().toLowerCase(), ...r } as T;
  }
  json(defs: JsonDefs): Record<string, unknown> {
    if (!defs.has(this.name)) {
      defs.set(this.name, {}); // reserve to break cycles
      const anyOf = [...this.variants.entries()].map(([tag, obj]) => {
        const j = obj.json(defs) as { properties: Record<string, unknown>; required: string[] };
        return {
          type: 'object',
          properties: { [this.key]: { const: tag }, ...j.properties },
          required: [this.key, ...j.required],
          additionalProperties: false,
        };
      });
      defs.set(this.name, { anyOf });
    }
    return { $ref: `#/$defs/${this.name}` };
  }
  sketch(): string {
    return this.name;
  }
}

/** First alternative that parses without errors wins. */
class AnyS<T> extends Schema<T> {
  readonly alts: Schema<unknown>[];
  readonly name: string;
  constructor(name: string, alts: Schema<unknown>[]) {
    super();
    this.name = name;
    this.alts = alts;
  }
  parse(v: unknown, path: string, issues: Issue[]): T | undefined {
    for (const a of this.alts) {
      const local: Issue[] = [];
      const r = a.parse(v, path, local);
      if (r !== undefined && !local.some((i) => i.level === 'error')) {
        issues.push(...local);
        return r as T;
      }
    }
    return err(issues, path, `not a valid ${this.name}: ${JSON.stringify(v)?.slice(0, 80)}`);
  }
  json(defs: JsonDefs): Record<string, unknown> {
    if (!defs.has(this.name)) {
      defs.set(this.name, {});
      defs.set(this.name, { anyOf: this.alts.map((a) => a.json(defs)) });
    }
    return { $ref: `#/$defs/${this.name}` };
  }
  sketch(): string {
    return this.name;
  }
}

class LazyS<T> extends Schema<T> {
  readonly get: () => Schema<T>;
  readonly name: string;
  constructor(name: string, get: () => Schema<T>) {
    super();
    this.name = name;
    this.get = get;
  }
  parse(v: unknown, path: string, issues: Issue[]): T | undefined {
    return this.get().parse(v, path, issues);
  }
  json(defs: JsonDefs): Record<string, unknown> {
    return this.get().json(defs);
  }
  sketch(): string {
    return this.name;
  }
}

export const S = {
  num: (min: number, max: number) => new NumS(min, max, false),
  int: (min: number, max: number) => new NumS(min, max, true),
  str: (maxLen: number) => new StrS(maxLen, null),
  id: () => new StrS(24, /^[a-z][a-z0-9_]{0,23}$/),
  color: () => new StrS(7, /^#[0-9a-fA-F]{6}$/),
  enm: <T extends string>(values: readonly T[]) => new EnumS<T>(values),
  lit: <T extends string | number | boolean>(v: T) => new LitS<T>(v),
  bool: () => new BoolS(),
  arr: <T>(item: Schema<T>, min: number, max: number) => new ArrS<T>(item, min, max),
  opt: <T>(inner: Schema<T>) => new OptS<T>(inner),
  obj: <T = Record<string, unknown>>(shape: Shape) => new ObjS<T>(shape),
  disc: <T = Record<string, unknown>>(name: string, key: string, variants: Record<string, ObjS<unknown>>) =>
    new DiscS<T>(name, key, variants),
  any: <T = unknown>(name: string, alts: Schema<unknown>[]) => new AnyS<T>(name, alts),
  lazy: <T>(name: string, get: () => Schema<T>) => new LazyS<T>(name, get),
};

export function toJsonSchema(root: Schema<unknown>): Record<string, unknown> {
  const defs: JsonDefs = new Map();
  const body = root.json(defs);
  return { ...body, $defs: Object.fromEntries(defs) };
}

export { DiscS, ObjS, OptS };
