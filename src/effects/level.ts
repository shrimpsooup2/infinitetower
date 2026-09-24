// Tower levels and the numbers that grow with them.
//
// A tower gains levels separately from its tier. Every level adds base damage
// (see LEVELS in content/towers.ts), so every {"dmg": x} value grows with it.
// Other numbers in a spec (a stun's length, a proc chance, a blast radius)
// grow only when the spec marks them. The Forge writes {"lvl": base, "per":
// step} in place of such a number; validation lifts each mark out into
// `spec.scaling` (a path and a step per level) and leaves the base number in
// place. Unmarked numbers stay fixed. Specs written before levels existed
// (hand-made powers, offline fusions, older fusions) have no `scaling` at all,
// and `autoScaling` picks a few natural numbers for them.

import type { FusionSpec, LevelScale } from './types.ts';
import { SpecS } from './dsl.ts';
import type { Issue } from './schema.ts';

/** How many numbers one spec may scale, and how fast: at most this share of the base per level. */
export const SCALING = { maxEntries: 6, maxStep: 0.15 };

type Seg = string | number;

export function parsePath(path: string): Seg[] | null {
  const out: Seg[] = [];
  for (const piece of path.split('.')) {
    const m = /^([a-z_][a-z0-9_]*)((?:\[\d+\])*)$/i.exec(piece);
    if (!m) return null;
    out.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out;
}

export function formatPath(segs: readonly Seg[]): string {
  let s = '';
  for (const x of segs) s += typeof x === 'number' ? `[${x}]` : (s ? '.' : '') + x;
  return s;
}

export function getAt(root: unknown, segs: readonly Seg[]): unknown {
  let o: unknown = root;
  for (const x of segs) {
    if (o === null || typeof o !== 'object') return undefined;
    o = (o as Record<string | number, unknown>)[x];
  }
  return o;
}

function setAt(root: unknown, segs: readonly Seg[], v: unknown): void {
  const parent = getAt(root, segs.slice(0, -1));
  if (parent && typeof parent === 'object') (parent as Record<string | number, unknown>)[segs[segs.length - 1]] = v;
}

const isMark = (v: unknown): v is { lvl: unknown; per?: unknown } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'lvl' in v && Object.keys(v).every((k) => k === 'lvl' || k === 'per');

/** Replace every {"lvl": base, "per": step} with its base number and list the marks by path. */
export function extractLevelMarks(raw: unknown): { raw: unknown; marks: LevelScale[] } {
  const marks: LevelScale[] = [];
  const walk = (v: unknown, segs: Seg[]): unknown => {
    if (isMark(v)) {
      const base = Number(v.lvl), per = Number(v.per ?? 0);
      if (Number.isFinite(base) && Number.isFinite(per) && per !== 0) marks.push({ path: formatPath(segs), per });
      return Number.isFinite(base) ? base : v.lvl;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...segs, i]));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, [...segs, k]);
      return o;
    }
    return v;
  };
  return { raw: walk(raw, []), marks };
}

/** The inverse, for showing a spec to the model: marks written back in place. */
export function inlineLevelMarks(spec: FusionSpec): unknown {
  const { scaling, ...rest } = spec;
  const out = structuredClone(rest) as unknown;
  for (const s of scaling ?? []) {
    const segs = parsePath(s.path);
    const base = segs ? getAt(out, segs) : undefined;
    if (segs && typeof base === 'number') setAt(out, segs, { lvl: base, per: s.per });
  }
  return out;
}

const ROOTS = new Set(['stats', 'rules', 'statuses', 'projectiles', 'zones']);
const COSMETIC_KEYS = new Set(['look', 'beam', 'vfx', 'visual', 'sound', 'tint', 'scale']);

/** Keep the valid scaling entries of a parsed spec; everything else becomes a warning. */
export function checkScaling(spec: FusionSpec, list: LevelScale[]): { kept: LevelScale[]; warnings: string[] } {
  const kept: LevelScale[] = [];
  const warnings: string[] = [];
  for (const s of list) {
    const segs = parsePath(s.path);
    const drop = (why: string) => warnings.push(`scaling ${s.path}: ${why}; it stays fixed`);
    if (!segs) { drop('not a valid path'); continue; }
    if (!ROOTS.has(String(segs[0])) || segs.some((x) => COSMETIC_KEYS.has(String(x)))) { drop('only gameplay numbers can grow with level'); continue; }
    if (segs[segs.length - 1] === 'dmg') { drop('{"dmg"} values already grow with the tower\'s damage'); continue; }
    const owner = getAt(spec, segs.slice(0, -1)) as Record<string, unknown> | undefined;
    if (owner && (owner.action === 'vfx' || owner.action === 'sound')) { drop('only gameplay numbers can grow with level'); continue; }
    const base = getAt(spec, segs);
    if (typeof base !== 'number') { drop('not a number in the spec'); continue; }
    if (base === 0) { drop('a zero cannot grow'); continue; }
    if (kept.some((k) => k.path === s.path)) { drop('marked twice'); continue; }
    if (kept.length >= SCALING.maxEntries) { drop(`at most ${SCALING.maxEntries} numbers may grow`); continue; }
    const size = /_mult$/.test(String(segs[segs.length - 1])) ? Math.abs(base - 1) : Math.abs(base);
    const lim = Math.max(size * SCALING.maxStep, 0.01);
    let per = s.per;
    if (Math.abs(per) > lim + 1e-9) {
      per = Math.sign(per) * lim;
      warnings.push(`scaling ${s.path}: ${s.per} per level is too fast; slowed to ${round(per)}`);
    }
    kept.push({ path: s.path, per: round(per) });
  }
  return { kept, warnings };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** The spec as it plays at a tower level: marked numbers moved by their step, then re-clamped. */
export function specAtLevel(spec: FusionSpec, level: number): FusionSpec {
  const scaling = spec.scaling;
  if (level <= 1 || !scaling?.length) return spec;
  const clone = structuredClone(spec);
  for (const s of scaling) {
    const segs = parsePath(s.path);
    const base = segs ? getAt(spec, segs) : undefined;
    if (segs && typeof base === 'number') setAt(clone, segs, base + s.per * (level - 1));
  }
  const issues: Issue[] = [];
  const parsed = SpecS.parse(clone, 'spec', issues);
  return parsed ? { ...parsed, dsl: 1, scaling } : spec;
}

/** A few natural numbers to grow, for specs that were written without marks. */
export function autoScaling(spec: FusionSpec): LevelScale[] {
  const out: LevelScale[] = [];
  const add = (path: string, base: number | undefined, per: number) => {
    if (typeof base !== 'number' || base === 0 || out.length >= 4 || out.some((o) => o.path === path)) return;
    out.push({ path, per: round(per) });
  };
  spec.rules.forEach((r, i) => {
    r.if?.forEach((c, j) => { if (c.check === 'chance') add(`rules[${i}].if[${j}].p`, c.p, Math.max(0.01, c.p * 0.08)); });
    r.do.forEach((a, j) => {
      const p = `rules[${i}].do[${j}]`;
      if (a.action === 'apply_status' && a.duration) add(`${p}.duration`, a.duration, a.duration * 0.08);
      else if (a.action === 'explode') add(`${p}.radius`, a.radius, a.radius * 0.05);
      else if (a.action === 'summon_drone') add(`${p}.lifetime`, a.lifetime, a.lifetime * 0.08);
    });
  });
  spec.statuses?.forEach((s, i) => {
    add(`statuses[${i}].duration`, s.duration, s.duration * 0.08);
    if (s.speed_mult !== undefined && s.speed_mult < 1) add(`statuses[${i}].speed_mult`, s.speed_mult, -(1 - s.speed_mult) * 0.08);
  });
  spec.zones?.forEach((z, i) => {
    add(`zones[${i}].radius`, z.radius, z.radius * 0.05);
    add(`zones[${i}].duration`, z.duration, z.duration * 0.06);
  });
  if (spec.stats?.crit_chance) add('stats.crit_chance', spec.stats.crit_chance, spec.stats.crit_chance * 0.08);
  return out;
}

/** A spec ready to level: its own marks, or natural ones if it was written without any. */
export function withScaling(spec: FusionSpec): FusionSpec {
  return spec.scaling ? spec : { ...spec, scaling: autoScaling(spec) };
}
