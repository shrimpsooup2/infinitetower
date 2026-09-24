// Fusion quality checks run on every LLM result:
//   * structural signature + Jaccard similarity (novelty),
//   * "is this really a fusion" lint (not just stats, not a copy),
//   * power-order checks: the BASE power must stay the heart of the design,
//     the SECONDARY must visibly shape it, and a TERTIARY evolution may only
//     change a little of its parent pair.
// Problems are phrased as instructions so they can be fed back to the LLM.

import type { Action, FusionSpec } from './types.ts';
import type { PowerDef } from '../sim/types.ts';

const COSMETIC = new Set(['vfx', 'sound']);
const PASSIVE = new Set(['modify_tower', 'set_var', 'add_var', 'vfx', 'sound']);

function walkActions(spec: FusionSpec, f: (a: Action, where: string) => void): void {
  spec.rules.forEach((r) => r.do.forEach((a) => f(a, `rule:${r.when.event}`)));
  for (const s of spec.statuses ?? []) {
    for (const list of [s.tick?.do, s.on_apply, s.on_expire, s.on_death]) list?.forEach((a) => f(a, 'status'));
  }
  for (const p of spec.projectiles ?? []) for (const list of [p.on_hit, p.on_end]) list?.forEach((a) => f(a, 'projectile'));
  for (const z of spec.zones ?? []) for (const list of [z.tick?.do, z.on_enter, z.on_exit]) list?.forEach((a) => f(a, 'zone'));
}

/** Structural fingerprint of a spec: what it reacts to, what it does, what it creates. */
export function signature(spec: FusionSpec): Set<string> {
  const s = new Set<string>();
  for (const r of spec.rules) {
    s.add(`t:${r.when.event}`);
    for (const c of r.if ?? []) s.add(`c:${c.check}`);
    for (const a of r.do) if (!COSMETIC.has(a.action)) s.add(`e:${r.when.event}>${a.action}`);
  }
  walkActions(spec, (a, where) => {
    if (COSMETIC.has(a.action)) return;
    s.add(`a:${a.action}`);
    if (where !== 'rule:' && !where.startsWith('rule')) s.add(`n:${where}>${a.action}`);
    if (a.action === 'apply_status') s.add(`st:${a.status.replace(/^[abc]_/, '')}`);
    if ('type' in a && a.type) s.add(`d:${a.type}`);
  });
  for (const p of spec.projectiles ?? []) s.add(`m:${p.motion}`);
  for (const z of spec.zones ?? []) s.add(`z:${z.shape}`);
  for (const st of spec.statuses ?? []) {
    s.add('custom_status');
    if (st.hard_cc) s.add('status:hard_cc');
    if (st.reverse) s.add('status:reverse');
    if (st.stores_damage) s.add('status:stores');
    if (st.dot) s.add('status:dot');
    if (st.damage_taken_mult && st.damage_taken_mult > 1) s.add('status:amp');
    if (st.speed_mult && st.speed_mult < 1) s.add('status:slow');
  }
  if (spec.stats) for (const k of Object.keys(spec.stats)) s.add(`stat:${k}`);
  if (spec.attack?.motion) s.add(`attack:${spec.attack.motion}`);
  for (const v of spec.vars ?? []) s.add(`var:${v.reset ?? 'never'}`);
  return s;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Tokens that mark a power's identity (used to check the power "shows up" in a fusion). */
export function powerKeys(p: PowerDef): Set<string> {
  const k = new Set<string>();
  const sig = signature(p.spec);
  for (const x of sig) {
    if (x.startsWith('st:') || x.startsWith('m:') || x.startsWith('z:') || x.startsWith('stat:') || x.startsWith('status:')) k.add(x);
    if (x.startsWith('a:') && !PASSIVE.has(x.slice(2))) k.add(x);
    if (x.startsWith('t:') && x !== 't:on_hit' && x !== 't:on_attack') k.add(x);
  }
  // Semantic tags the LLM may express in other ways.
  for (const t of p.tags) k.add(`tag:${t}`);
  return k;
}

/** Tags a spec expresses (loosely), used alongside powerKeys. */
function specTags(spec: FusionSpec): Set<string> {
  const text = JSON.stringify(spec).toLowerCase();
  const tags = new Set<string>();
  const add = (tag: string, re: RegExp) => { if (re.test(text)) tags.add(`tag:${tag}`); };
  add('fire', /burn|fire|ember|flame/);
  add('cold', /chill|freeze|frost|ice/);
  add('shock', /shock|chain|lightning|storm/);
  add('toxic', /poison|toxic|venom/);
  add('stun', /"stun"|hard_cc/);
  add('pushback', /knockback|rewind_position|teleport_along_path/);
  add('mark', /"mark"|damage_taken_mult/);
  add('death', /on_kill|on_death|on_enemy_dies_in_range/);
  add('multi', /multishot|"count"|chain/);
  add('pierce', /pierce/);
  add('bounce', /bounce|nearest_other/);
  add('return', /boomerang/);
  add('orbit', /orbit/);
  add('spawn', /fire_projectile|summon_drone|create_zone/);
  add('ring', /explode|ring|nova/);
  add('sky', /sky_drop/);
  add('speed', /rate_mult|"rate"/);
  add('repeat', /repeat_attack|"repeat"|"delay"/);
  add('delay', /"delay"|repeat_attack/);
  add('nth', /every_nth/);
  add('ramp', /add_var/);
  add('charge', /on_idle|var_at_least/);
  add('time', /stores_damage|rewind|stasis/);
  add('rhythm', /on_beat/);
  add('crit', /crit/);
  add('gold', /grant_gold/);
  add('execute', /execute|target_hp_below/);
  add('random', /random|chance/);
  add('curse', /curse|jinx/);
  add('luck', /chance/);
  add('trap', /mine|path_segment/);
  add('summon', /summon_drone/);
  add('pull', /"pull"/);
  add('spread', /spread_statuses/);
  add('life', /restore_life/);
  add('grow', /add_var/);
  add('mirror', /"away"/);
  add('root', /"root"/);
  add('zone', /create_zone/);
  return tags;
}

function overlap(spec: FusionSpec, sig: Set<string>, p: PowerDef): number {
  const keys = powerKeys(p);
  const tags = specTags(spec);
  let n = 0;
  for (const k of keys) if (sig.has(k) || tags.has(k)) n++;
  return n;
}

export interface LintResult {
  problems: string[];
  notes: string[];
}

/** Quality lint for an LLM fusion. `powers` is in socket order. */
export function lintFusion(spec: FusionSpec, powers: PowerDef[], parent: FusionSpec | null): LintResult {
  const problems: string[] = [];
  const notes: string[] = [];
  const sig = signature(spec);

  const effectful = new Set<string>();
  walkActions(spec, (a) => { if (!PASSIVE.has(a.action)) effectful.add(a.action); });
  if (effectful.size === 0) problems.push('The fusion only changes stats/vars. It must DO something: damage, statuses, movement, projectiles, zones...');
  if (!parent && effectful.size < 2) problems.push('Too simple: use at least two different kinds of effect actions (e.g. a status plus a projectile or zone).');

  const triggers = new Set(spec.rules.map((r) => r.when.event));
  if (!parent && triggers.size === 1 && (triggers.has('on_hit') || triggers.has('on_attack'))) {
    problems.push('Every rule uses the same trigger. Build at least one rule around a different trigger (on_kill, every_nth_attack, on_status_applied, every, on_idle, on_beat, on_enemy_enters_range, ...).');
  }

  const [base, secondary, tertiary] = powers;
  const baseOverlap = overlap(spec, sig, base);
  if (baseOverlap === 0) problems.push(`The BASE power (${base.name}) is not recognisable. Its core mechanic (${base.blurb}) must be the heart of the design.`);
  if (secondary && !parent) {
    const so = overlap(spec, sig, secondary);
    if (so === 0) problems.push(`The SECONDARY power (${secondary.name}: ${secondary.blurb}) does not visibly shape the design.`);
    if (so > baseOverlap + 2) notes.push(`${secondary.name} dominates ${base.name}; the base power should lead.`);
  }
  if (!parent && jaccard(sig, signature(base.spec)) > 0.85) {
    problems.push(`This is nearly identical to plain ${base.name}. Transform it with the secondary power into something new.`);
  }

  // Words: a short plain concept and a name that says what the fusion does.
  const words = (x: string) => x.trim().split(/[\s-]+/).filter(Boolean);
  const nameWords = words(spec.name);
  if (nameWords.length > 3) problems.push(`The name "${spec.name}" is too long: use 1 or 2 plain words that say what the fusion does (3 at most).`);
  const forms = new Set(powers.flatMap((p) => [p.id, p.name, p.adj, p.noun]).map((w) => w.toLowerCase()));
  if (nameWords.length && nameWords.every((w) => forms.has(w.toLowerCase().replace(/[^a-z]/g, '')))) {
    problems.push(`The name "${spec.name}" just combines the power names. Name it after what it does, in 1 or 2 plain words (like "Ice Bells" or "Poison Well").`);
  }
  const conceptWords = words(spec.concept).length;
  if (conceptWords > 18) problems.push(`The concept is too long (${conceptWords} words). Say what happens in one plain sentence of at most 12 words.`);
  if (words(spec.flavor).length > 10) problems.push('The flavor is too long: at most 6 words.');

  // Pairs stay simple: one cause and effect, not a machine.
  if (!parent && powers.length === 2) {
    if (spec.rules.length > 4) problems.push(`Too complicated for a pair (${spec.rules.length} rules). Use 2 or 3 rules built around one cause and effect.`);
    const templates = (spec.statuses?.length ?? 0) + (spec.projectiles?.length ?? 0) + (spec.zones?.length ?? 0);
    if (templates > 2) problems.push(`Too many custom statuses/projectiles/zones for a pair (${templates}). Use at most one.`);
  }

  // Visual identity.
  const v = spec.visual ?? {};
  let visualHooks = 0;
  for (const k of ['aura', 'muzzle', 'impact', 'kill', 'projectile', 'beam', 'spray', 'body'] as const) if (v[k]) visualHooks++;
  let vfxActions = 0;
  walkActions(spec, (a) => { if (a.action === 'vfx' || (a.action === 'explode' && a.vfx)) vfxActions++; });
  const customVfx = spec.vfx?.length ?? 0;
  if (visualHooks + vfxActions + customVfx < 3) {
    problems.push('Visually bland: give it a distinct look using at least three of: visual.aura / muzzle / impact / kill / projectile / beam / spray / body, custom "vfx" definitions, and "vfx" actions at key moments.');
  }
  if (!parent && customVfx === 0) notes.push('No custom vfx defined; consider inventing one that matches the concept.');

  // Tertiary evolution must be a small change of its parent.
  if (parent && tertiary) {
    const d = specDiff(parent, spec);
    if (d.changed + d.added + d.removed === 0 && d.templatesAdded === 0) {
      problems.push(`The TERTIARY power (${tertiary.name}) changed nothing. Add one distinctive twist from it.`);
    }
    if (d.added > 2) problems.push(`The tertiary power may add at most 2 rules (you added ${d.added}). Keep the parent design and add a small twist.`);
    if (d.removed > 1) problems.push(`Keep the parent design: remove at most 1 of its rules (you removed ${d.removed}).`);
    if (d.changed > 2) problems.push(`Keep the parent design: modify at most 2 of its rules (you modified ${d.changed}).`);
    if (d.templatesAdded > 2) problems.push('The tertiary twist may add at most 2 new templates (statuses/projectiles/zones/vfx).');
    const to = overlap(spec, sig, tertiary) - overlap(parent, signature(parent), tertiary);
    if (to <= 0 && d.added + d.changed > 0) notes.push(`${tertiary.name} is only faintly present.`);
  }
  return { problems, notes };
}

export interface SpecDiff {
  added: number;
  removed: number;
  changed: number;
  templatesAdded: number;
}

/** Rule-level diff between a parent pair and its tertiary evolution. */
export function specDiff(a: FusionSpec, b: FusionSpec): SpecDiff {
  const key = (r: unknown) => JSON.stringify(r);
  const trig = (r: FusionSpec['rules'][number]) => JSON.stringify(r.when);
  const aRules = a.rules.map(key);
  const bRules = b.rules.map(key);
  const unchanged = bRules.filter((r) => aRules.includes(r)).length;
  const aLeft = a.rules.filter((r) => !bRules.includes(key(r)));
  const bLeft = b.rules.filter((r) => !aRules.includes(key(r)));
  // A rule is "changed" if a leftover rule in b shares its trigger with a leftover in a.
  let changed = 0;
  const aTrig = aLeft.map(trig);
  for (const r of bLeft) {
    const i = aTrig.indexOf(trig(r));
    if (i >= 0) {
      changed++;
      aTrig.splice(i, 1);
    }
  }
  const added = bLeft.length - changed;
  const removed = aLeft.length - changed;
  void unchanged;
  const ids = (s: FusionSpec) => new Set([
    ...(s.statuses ?? []).map((x) => 's' + x.id), ...(s.projectiles ?? []).map((x) => 'p' + x.id),
    ...(s.zones ?? []).map((x) => 'z' + x.id), ...(s.vfx ?? []).map((x) => 'v' + x.id),
  ]);
  const ai = ids(a);
  let templatesAdded = 0;
  for (const x of ids(b)) if (!ai.has(x)) templatesAdded++;
  return { added, removed, changed, templatesAdded };
}
