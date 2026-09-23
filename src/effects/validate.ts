// Validation = schema parse (types, ranges, sizes) + semantic checks
// (references resolve, damage scales with the tower, rules that need a
// target have one). Errors are phrased so they can be fed back to the LLM.

import { SpecS, LIMITS, TARGETLESS_TRIGGERS } from './dsl.ts';
import { BUILTIN_VFX } from './vfxlib.ts';
import type { Issue } from './schema.ts';
import {
  BUILTIN_STATUSES, type Action, type EnemySelector, type FusionSpec, type Rule, type Value,
} from './types.ts';

export interface ValidationResult {
  ok: boolean;
  spec: FusionSpec | null;
  errors: string[];
  warnings: string[];
}

const BUILTIN = new Set<string>(BUILTIN_STATUSES);
const DAMAGE_ACTIONS = new Set(['damage', 'explode']);

export function valueDepth(v: Value): number {
  if (typeof v !== 'object' || v === null) return 0;
  for (const op of ['add', 'mul', 'min', 'max'] as const) {
    const arr = (v as Record<string, unknown>)[op];
    if (Array.isArray(arr)) return 1 + Math.max(...arr.map((x) => valueDepth(x as Value)));
  }
  return 0;
}

export function valueHasDmg(v: Value): boolean {
  if (typeof v !== 'object' || v === null) return false;
  if ('dmg' in v) return true;
  for (const op of ['add', 'mul', 'min', 'max'] as const) {
    const arr = (v as Record<string, unknown>)[op];
    if (Array.isArray(arr)) return arr.some((x) => valueHasDmg(x as Value));
  }
  return false;
}

function valueRefs(v: Value, vars: Set<string>, statuses: Set<string>): void {
  if (typeof v !== 'object' || v === null) return;
  const o = v as Record<string, unknown>;
  if (typeof o.var === 'string') vars.add(o.var);
  if (typeof o.stacks === 'string') statuses.add(o.stacks);
  for (const op of ['add', 'mul', 'min', 'max'] as const) {
    const arr = o[op];
    if (Array.isArray(arr)) arr.forEach((x) => valueRefs(x as Value, vars, statuses));
  }
}

function selectorStatus(s: EnemySelector): string | null {
  return typeof s === 'object' && s.select === 'with_status' ? s.status : null;
}

function usesTarget(s: unknown): boolean {
  if (s === 'target') return true;
  if (typeof s === 'object' && s !== null) {
    const o = s as Record<string, unknown>;
    if (o.select === 'chain') return true;
    if (o.around === undefined && (o.select === 'all_in_radius' || o.select === 'nearest')) return true;
    if (o.around === 'target') return true;
    if ('path_ahead' in o || 'path_behind' in o) return true;
  }
  return false;
}

interface Refs {
  statuses: Map<string, string>; // id -> path of first use
  projectiles: Map<string, string>;
  zones: Map<string, string>;
  vars: Map<string, string>;
  vfx: Map<string, string>;
}

function noteAll(set: Set<string>, into: Map<string, string>, path: string): void {
  for (const s of set) if (!into.has(s)) into.set(s, path);
}

function scanActions(actions: Action[] | undefined, path: string, refs: Refs, errors: string[], hasTarget: boolean): void {
  if (!actions) return;
  actions.forEach((a, i) => {
    const p = `${path}[${i}]`;
    const vars = new Set<string>();
    const sts = new Set<string>();
    for (const val of Object.values(a)) {
      if (typeof val === 'number' || (typeof val === 'object' && val !== null && !Array.isArray(val))) {
        valueRefs(val as Value, vars, sts);
        if (typeof val === 'object' && valueDepth(val as Value) > LIMITS.valueDepth) {
          errors.push(`${p}: value nested deeper than ${LIMITS.valueDepth}`);
        }
      }
    }
    noteAll(vars, refs.vars, p);
    noteAll(sts, refs.statuses, p);
    const rec = a as unknown as Record<string, unknown>;
    if (typeof rec.status === 'string') noteAll(new Set([rec.status]), refs.statuses, p);
    if (rec.to && typeof rec.to === 'object') {
      const s = selectorStatus(rec.to as EnemySelector);
      if (s) noteAll(new Set([s]), refs.statuses, p);
    }
    if (a.action === 'fire_projectile' && a.projectile !== 'bullet') noteAll(new Set([a.projectile]), refs.projectiles, p);
    if (a.action === 'create_zone') noteAll(new Set([a.zone]), refs.zones, p);
    if (a.action === 'set_var' || a.action === 'add_var') noteAll(new Set([a.var]), refs.vars, p);
    if (a.action === 'vfx') noteAll(new Set([a.effect]), refs.vfx, p);
    if (a.action === 'explode' && a.vfx) noteAll(new Set([a.vfx]), refs.vfx, p);
    if (DAMAGE_ACTIONS.has(a.action) && !valueHasDmg((a as { amount: Value }).amount)) {
      errors.push(`${p}: ${a.action}.amount must include {"dmg": x} so it scales with the tower`);
    }
    if (a.action === 'summon_drone' && !valueHasDmg(a.damage)) {
      errors.push(`${p}: summon_drone.damage must include {"dmg": x}`);
    }
    if (!hasTarget) {
      const needs =
        usesTarget(rec.to) || usesTarget(rec.at) || usesTarget(rec.toward) || usesTarget(rec.from) ||
        (a.action === 'spread_statuses') || (a.action === 'swap_positions') ||
        (a.action === 'fire_projectile' && (a.aim === undefined || a.aim === 'target' || a.aim === 'nearest_other'));
      if (needs) {
        errors.push(
          `${p}: this rule has no target enemy (its trigger provides none), so "${a.action}" cannot use "target"; ` +
            'use a selector such as {"select":"strongest_in_range","n":1} or a point like "self"/"random_in_range"',
        );
      }
    }
  });
}

/** Parse + semantically validate untrusted spec JSON. */
export function validateSpec(raw: unknown): ValidationResult {
  const issues: Issue[] = [];
  const parsed = SpecS.parse(raw, 'spec', issues);
  const errors = issues.filter((i) => i.level === 'error').map((i) => `${i.path}: ${i.msg}`);
  const warnings = issues.filter((i) => i.level === 'warn').map((i) => `${i.path}: ${i.msg}`);
  if (!parsed) return { ok: false, spec: null, errors, warnings };

  const spec: FusionSpec = { ...parsed, dsl: 1 };
  const refs: Refs = { statuses: new Map(), projectiles: new Map(), zones: new Map(), vars: new Map(), vfx: new Map() };
  const noteVfx = (id: string | undefined, where: string) => {
    if (id && !refs.vfx.has(id)) refs.vfx.set(id, where);
  };

  // Definitions
  const defined = {
    statuses: new Set<string>(),
    projectiles: new Set<string>(['bullet']),
    zones: new Set<string>(),
    vars: new Set<string>(),
    vfx: new Set<string>(),
  };
  for (const d of spec.vfx ?? []) {
    if (defined.vfx.has(d.id)) errors.push(`vfx: duplicate id "${d.id}"`);
    defined.vfx.add(d.id);
  }
  for (const s of spec.statuses ?? []) {
    if (BUILTIN.has(s.id)) errors.push(`statuses: custom status id "${s.id}" collides with a built-in status; rename it`);
    if (defined.statuses.has(s.id)) errors.push(`statuses: duplicate id "${s.id}"`);
    defined.statuses.add(s.id);
  }
  for (const p of spec.projectiles ?? []) {
    if (p.id === 'bullet' || defined.projectiles.has(p.id)) errors.push(`projectiles: duplicate or reserved id "${p.id}"`);
    defined.projectiles.add(p.id);
  }
  for (const z of spec.zones ?? []) {
    if (defined.zones.has(z.id)) errors.push(`zones: duplicate id "${z.id}"`);
    defined.zones.add(z.id);
  }
  for (const v of spec.vars ?? []) {
    if (defined.vars.has(v.id)) errors.push(`vars: duplicate id "${v.id}"`);
    defined.vars.add(v.id);
  }

  // Uses
  spec.rules.forEach((r: Rule, i) => {
    const p = `rules[${i}]`;
    const ev = r.when.event;
    const hasTarget = !TARGETLESS_TRIGGERS.has(ev);
    if ('status' in r.when) refs.statuses.set(r.when.status, `${p}.when`);
    if (r.when.event === 'on_projectile_end') refs.projectiles.set(r.when.projectile, `${p}.when`);
    if (r.when.event === 'on_var_reached') refs.vars.set(r.when.var, `${p}.when`);
    for (const c of r.if ?? []) {
      if ('status' in c) refs.statuses.set(c.status, `${p}.if`);
      if ('var' in c) refs.vars.set(c.var, `${p}.if`);
      if (!hasTarget && (c.check.startsWith('target_') || c.check === 'first_hit_on_target')) {
        errors.push(`${p}.if: condition "${c.check}" needs a target but trigger "${ev}" provides none`);
      }
    }
    scanActions(r.do, `${p}.do`, refs, errors, hasTarget);
  });
  (spec.statuses ?? []).forEach((s, i) => {
    const p = `statuses[${i}]`;
    scanActions(s.tick?.do, `${p}.tick.do`, refs, errors, true);
    scanActions(s.on_apply, `${p}.on_apply`, refs, errors, true);
    scanActions(s.on_expire, `${p}.on_expire`, refs, errors, true);
    scanActions(s.on_death, `${p}.on_death`, refs, errors, true);
    if (s.dot && !valueHasDmg(s.dot.amount)) errors.push(`${p}.dot.amount must include {"dmg": x}`);
    if (s.damage_per_tile !== undefined && !valueHasDmg(s.damage_per_tile)) {
      errors.push(`${p}.damage_per_tile must include {"dmg": x}`);
    }
  });
  (spec.projectiles ?? []).forEach((pr, i) => {
    const p = `projectiles[${i}]`;
    if (!valueHasDmg(pr.amount)) errors.push(`${p}.amount must include {"dmg": x} (use {"dmg": 0} for no damage)`);
    scanActions(pr.on_hit, `${p}.on_hit`, refs, errors, true);
    scanActions(pr.on_end, `${p}.on_end`, refs, errors, false);
  });
  (spec.zones ?? []).forEach((z, i) => {
    const p = `zones[${i}]`;
    scanActions(z.tick?.do, `${p}.tick.do`, refs, errors, true);
    scanActions(z.on_enter, `${p}.on_enter`, refs, errors, true);
    scanActions(z.on_exit, `${p}.on_exit`, refs, errors, true);
  });

  const vis = spec.visual;
  if (vis) {
    noteVfx(vis.aura, 'visual.aura');
    noteVfx(vis.muzzle, 'visual.muzzle');
    noteVfx(vis.impact, 'visual.impact');
    noteVfx(vis.kill, 'visual.kill');
    noteVfx(vis.projectile?.emitter, 'visual.projectile.emitter');
  }
  (spec.statuses ?? []).forEach((s, i) => noteVfx(s.vfx, `statuses[${i}].vfx`));
  (spec.zones ?? []).forEach((z, i) => noteVfx(z.vfx, `zones[${i}].vfx`));
  (spec.projectiles ?? []).forEach((pr, i) => {
    noteVfx(pr.look?.emitter, `projectiles[${i}].look.emitter`);
    noteVfx(pr.impact, `projectiles[${i}].impact`);
  });
  for (const [id, where] of refs.vfx) {
    if (!defined.vfx.has(id) && !BUILTIN_VFX.has(id)) {
      errors.push(`${where}: unknown vfx "${id}" (define it in "vfx" or use a built-in: ${[...BUILTIN_VFX.keys()].join(', ')})`);
    }
  }

  for (const [id, where] of refs.statuses) {
    if (!BUILTIN.has(id) && !defined.statuses.has(id)) {
      errors.push(`${where}: unknown status "${id}" (built-ins: ${BUILTIN_STATUSES.join(', ')}; or define it in "statuses")`);
    }
  }
  for (const [id, where] of refs.projectiles) {
    if (!defined.projectiles.has(id)) errors.push(`${where}: unknown projectile "${id}" (define it in "projectiles" or use "bullet")`);
  }
  for (const [id, where] of refs.zones) {
    if (!defined.zones.has(id)) errors.push(`${where}: unknown zone "${id}" (define it in "zones")`);
  }
  for (const [id, where] of refs.vars) {
    if (!defined.vars.has(id)) errors.push(`${where}: unknown var "${id}" (declare it in "vars")`);
  }

  return { ok: errors.length === 0, spec: errors.length === 0 ? spec : null, errors, warnings };
}
