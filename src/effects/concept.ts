// Numbers in a fusion's concept are live. The Forge wraps each number it
// quotes in braces: {1.2} for a plain number, {25%} for a fraction shown as a
// percentage (0.25, or a multiplier such as speed 0.75 = "25% slower"), and
// {dmg 0.5} for a damage amount written {"dmg": 0.5}. Every token must match a
// number in the spec, so the text can never promise what the fusion does not
// do. The game shows each token at the tower's real value: its level, its
// damage and the balancer's potency, and marks the ones that grow with level.

import type { FusionSpec } from './types.ts';
import { formatPath, getAt, parsePath, specAtLevel } from './level.ts';

const TOKEN = /\{\s*(dmg\s+)?(-?\d+(?:\.\d+)?)\s*(%)?\s*\}/g;

type As = 'num' | 'pct' | 'pct_less' | 'pct_more';

export interface ConceptRef {
  /** Path of the number in the spec. */
  path: string;
  dmg: boolean;
  as: As;
  /** The token was written with a % sign. */
  sign: boolean;
}

export interface ConceptPart {
  text: string;
  /** Set on numbers: how much they grow per level (0 = fixed). */
  per?: number;
  /** Damage numbers grow with the tower's damage rather than a step. */
  grows?: boolean;
}

export interface ConceptView {
  level?: number;
  potency?: number;
  /** Tower damage per hit (for {dmg x}). */
  dmgBase?: number;
}

type Seg = string | number;
const SKIP = new Set(['visual', 'vfx', 'sound', 'look', 'beam', 'scaling', 'dsl', 'tint', 'scale']);

/** Every gameplay number in a spec, with its path. */
function leaves(spec: FusionSpec): { segs: Seg[]; v: number; dmg: boolean }[] {
  const out: { segs: Seg[]; v: number; dmg: boolean }[] = [];
  const walk = (o: unknown, segs: Seg[]) => {
    if (typeof o === 'number') {
      out.push({ segs, v: o, dmg: segs[segs.length - 1] === 'dmg' });
      return;
    }
    if (Array.isArray(o)) o.forEach((x, i) => walk(x, [...segs, i]));
    else if (o && typeof o === 'object') {
      const rec = o as Record<string, unknown>;
      if (rec.action === 'vfx' || rec.action === 'sound') return;
      for (const [k, x] of Object.entries(rec)) if (!SKIP.has(k)) walk(x, [...segs, k]);
    }
  };
  walk(spec, []);
  return out;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Find the number a token refers to. */
function bindToken(spec: FusionSpec, all: ReturnType<typeof leaves>, dmg: boolean, n: number, pct: boolean): ConceptRef | null {
  const scaled = new Set((spec.scaling ?? []).map((s) => s.path));
  const pick = (cands: { segs: Seg[] }[], as: As): ConceptRef | null => {
    if (!cands.length) return null;
    const paths = cands.map((c) => formatPath(c.segs));
    return { path: paths.find((p) => scaled.has(p)) ?? paths[0], dmg, as, sign: pct };
  };
  if (dmg) return pick(all.filter((l) => l.dmg && near(l.v, n, 0.005)), 'num');
  const plain = all.filter((l) => !l.dmg);
  if (!pct) return pick(plain.filter((l) => near(l.v, n, Math.max(0.001, Math.abs(n) * 1e-4))), 'num');
  // Multipliers (speed_mult 0.5, damage_taken_mult 1.2) are quoted as the change they make ("50% slower",
  // "20% more"); fractions (a 0.25 chance) as themselves.
  const mult = (l: { segs: Seg[] }) => /_mult$/.test(String(l.segs[l.segs.length - 1]));
  return pick(plain.filter((l) => !mult(l) && near(l.v * 100, n, 0.51)), 'pct')
    ?? pick(plain.filter((l) => mult(l) && l.v < 1 && near((1 - l.v) * 100, n, 0.51)), 'pct_less')
    ?? pick(plain.filter((l) => mult(l) && l.v > 1 && near((l.v - 1) * 100, n, 0.51)), 'pct_more')
    ?? pick(plain.filter((l) => near(l.v * 100, n, 0.51)), 'pct')
    ?? pick(plain.filter((l) => near(l.v, n, 0.5)), 'num'); // already a percentage (pct, below_pct...)
}

const cache = new WeakMap<FusionSpec, (ConceptRef | null)[]>();

/** Bind every token of the concept; unbound tokens are reported as problems for the model. */
export function bindConcept(spec: FusionSpec): { refs: (ConceptRef | null)[]; errors: string[] } {
  const all = leaves(spec);
  const refs: (ConceptRef | null)[] = [];
  const errors: string[] = [];
  for (const m of spec.concept.matchAll(TOKEN)) {
    const ref = bindToken(spec, all, !!m[1], Number(m[2]), !!m[3]);
    refs.push(ref);
    if (!ref) {
      errors.push(m[1]
        ? `concept: "${m[0]}" matches no {"dmg": ${m[2]}} in the spec; quote damage exactly as written in the JSON`
        : `concept: "${m[0]}" matches no number in the spec; wrap only numbers that appear in your JSON (write other numbers without braces)`);
    }
  }
  cache.set(spec, refs);
  return { refs, errors };
}

/** Does a path hold a crowd-control duration, a displacement, a slow or an amp? (Potency scales these.) */
function potencyShape(spec: FusionSpec, segs: Seg[]): 'cc' | 'move' | 'slow' | 'amp' | null {
  const key = String(segs[segs.length - 1]);
  const owner = getAt(spec, segs.slice(0, -1)) as Record<string, unknown> | undefined;
  if (!owner) return null;
  const hardStatus = (id: unknown) =>
    id === 'freeze' || id === 'stun' || id === 'root' || id === 'fear' ||
    !!spec.statuses?.some((s) => s.id === id && (s.hard_cc || s.reverse));
  if (key === 'duration' && (owner.action === 'apply_status' ? hardStatus(owner.status) : segs[0] === 'statuses' && (owner.hard_cc || owner.reverse))) return 'cc';
  const back = owner.action === 'teleport_along_path' && typeof owner.distance === 'number' && owner.distance < 0;
  if ((key === 'distance' && (owner.action === 'knockback' || back)) || (key === 'strength' && owner.action === 'pull')) return 'move';
  if (key === 'speed_mult' && typeof owner[key] === 'number' && (owner[key] as number) < 1) return 'slow';
  if (key === 'damage_taken_mult') return 'amp';
  return null;
}

function fmt(n: number): string {
  const a = Math.abs(n);
  const r = a >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(r);
}

/** The concept as text parts, with each token at the tower's real value. */
export function renderConcept(spec: FusionSpec, view: ConceptView = {}): ConceptPart[] {
  const refs = cache.get(spec) ?? bindConcept(spec).refs;
  const level = view.level ?? 1;
  const pot = view.potency ?? 1;
  const pf = Math.min(1.3, Math.sqrt(pot));
  const leveled = specAtLevel(spec, level);
  const steps = new Map((spec.scaling ?? []).map((s) => [s.path, s.per]));
  const parts: ConceptPart[] = [];
  let last = 0, i = 0;
  for (const m of spec.concept.matchAll(TOKEN)) {
    const ref = refs[i++];
    if (m.index! > last) parts.push({ text: spec.concept.slice(last, m.index) });
    last = m.index! + m[0].length;
    const segs = ref ? parsePath(ref.path) : null;
    if (!ref || !segs) {
      parts.push({ text: `${m[2]}${m[3] ?? ''}` });
      continue;
    }
    let v = getAt(leveled, segs);
    if (typeof v !== 'number') v = Number(m[2]);
    if (ref.dmg) {
      const k = (v as number) * pot;
      parts.push({ text: view.dmgBase ? String(Math.round(k * view.dmgBase)) : `${Math.round(k * 100)}% damage`, grows: true });
      continue;
    }
    let x = v as number;
    let per = steps.get(ref.path) ?? 0;
    switch (potencyShape(spec, segs)) {
      case 'cc': x = Math.min(x * Math.sqrt(pot), 4); per *= Math.sqrt(pot); break;
      case 'move': x *= pf; per *= pf; break;
      case 'slow': x = 1 - (1 - x) * pf; per *= pf; break;
      case 'amp': x = 1 + (x - 1) * pf; per *= pf; break;
      default: break;
    }
    if (ref.as === 'num') parts.push({ text: `${fmt(x)}${ref.sign ? '%' : ''}`, per });
    else if (ref.as === 'pct') parts.push({ text: `${Math.round(x * 100)}%`, per: per * 100 });
    else if (ref.as === 'pct_less') parts.push({ text: `${Math.round((1 - x) * 100)}%`, per: -per * 100 });
    else parts.push({ text: `${Math.round((x - 1) * 100)}%`, per: per * 100 });
  }
  if (last < spec.concept.length) parts.push({ text: spec.concept.slice(last) });
  return parts;
}

/** The concept as plain text (for search, logs and prompts). */
export function conceptText(spec: FusionSpec, view: ConceptView = {}): string {
  return renderConcept(spec, view).map((p) => p.text).join('');
}

/** A concept's text with its tokens as bare numbers (when there is no spec to bind them to). */
export function stripTokens(concept: string): string {
  return concept.replace(TOKEN, (_m, dmg: string | undefined, n: string, pct: string | undefined) => (dmg ? `${Math.round(Number(n) * 100)}% damage` : `${n}${pct ?? ''}`));
}

/** Words in a concept, counting each token as one word. */
export function conceptWords(concept: string): number {
  return concept.replace(TOKEN, 'N').trim().split(/[\s-]+/).filter(Boolean).length;
}
