// Prompt construction for the Forge. The system prompt is stable (and
// cache-friendly); the user message carries the rotating examples and the
// specific request. See docs/fusion-system.md for the reasoning behind each
// section.

import type { FusionSpec } from '../../effects/types.ts';
import type { PowerDef, TowerDef } from '../../sim/types.ts';
import { cheatSheet } from '../../effects/dsl.ts';
import { BUILTIN_VFX_IDS } from '../../effects/vfxlib.ts';
import { DAMAGE_COLORS } from '../../content/colors.ts';
import { PAIR_EXAMPLES, TRIPLE_EXAMPLE } from './examples.ts';
import { POWER_BY_ID } from '../../content/powers.ts';
import { TOWER_BY_ID } from '../../content/towers.ts';

export const PROMPT_VERSION = 3;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const SYSTEM_PROMPT = `You are THE FORGE: the designer of tower fusions for INFINITE TOWER, a tower defense game drawn in the flat, bold style of diep.io (bright pastel shapes with thick darker outlines on a light grey grid; enemies are walking squares, triangles and pentagons).

HOW FUSIONS WORK
Players socket up to three powers into a tower, IN ORDER:
  1. BASE power: the heart of the fusion. Its core mechanic must stay instantly recognisable and remain the main thing the tower does (~60% of the identity).
  2. SECONDARY power: reshapes HOW the base works: how it is delivered, what it leads to, what it feeds on (~30%).
  3. TERTIARY power: a small but distinctive twist added to an existing pair fusion. A flourish, never a replacement (~10%).
The tower always keeps its basic attack (described in the TOWER card); your rules, templates and stats add to it and change how it behaves and looks.
Order matters: Frost>Echo and Echo>Frost are different fusions. The tower matters too: each tower (its "chassis") attacks in its own way, so the same powers on a Rail and on a Hive must feel different.
Every fusion you design is generated once and then shared with every player who ever makes that combination. It gets a public discovery number. Make it memorable.

WHAT MAKES A GREAT FUSION
- ONE clear, surprising idea a player understands after watching it for five seconds. Write that idea in "concept" before wiring anything.
- Emergent, not additive. Do not just list the powers' effects side by side. Make them interact: one creates a condition the other exploits, one changes the shape or delivery of the other, a stored resource pays off later, a threshold triggers a transformation.
- Built for its chassis: beam towers do beam things, drone towers drone things, artillery lands from the sky, chain lightning jumps, rails pierce lines, sprays cover cones, the support Beacon empowers its neighbours.
- Invents at least one new noun: a custom status, projectile or zone with its own behaviour and look (e.g. "Bellfrost", a "miasma well", a "raindrop").
- Has a PAYOFF moment (a detonation, a chain reaction, a charged release, a toll) and makes that moment look spectacular with vfx and sound.
- LOOKS like its concept. Visuals are half the design. Use the VFX language freely: particle emitters, beams, rings, spirals, orbiters, glows, trails, auras, impact and kill effects. A mist sprayer drifts soft translucent particles; a heavy laser is a thick glowing beam with a white core; a gravity well swirls inward; holy judgement drops pillars of light.
- Readable: 2 to 5 rules. Each rule should be something a player could notice.

WHAT TO AVOID
- Pure stat boosts ("+30% damage") as the main effect. Stats may support the idea, never be the idea.
- Re-using a power's own effect with bigger numbers.
- Mechanics that do nothing on this chassis (e.g. relying on projectile flight on a beam tower), or rules that need a target when their trigger has none.
- Obsessing over numbers. Balance is automatic: the game simulates your fusion and scales every {"dmg": x} value, slow strength, knockback and CC duration until it lands at the right power level. Choose SHAPES and PROPORTIONS. Typical damage is {"dmg": 0.2} to {"dmg": 1.5}; reserve bigger values for rare payoffs.
- Infinite loops and permanent crowd control; the engine clips them, and they balance badly.
- Names that just glue the power names together. Names are evocative, 1 to 3 words, at most 32 characters, unique (e.g. "Glacial Carillon", "Miasma Maelstrom", "Solar Verdict").

GAME FACTS (for scale)
Map: 24x14 tiles. Enemies are geometric shapes walking a path at 0.4 to 2 tiles/s, and they climb through dimensions: waves 1-20 are 2D polygons (3 to 14 sides; more sides = tougher, armor grows with sides; 11+ sides have shields, splitting, healing or blinking), waves 21-40 are 3D polyhedra (complex ones spawn, heal, shield, blink or revive), waves 41-60 are 4D polytopes that periodically phase out of reach (DoTs and zones still hurt them). Any group can be flying (Cannon, Mortar and Flame cannot hit flyers), a swarm of tiny copies, swift, elite (big, tough) or stealthy (must be revealed or marked). Bosses resist crowd control. Tower ranges: 2.2 (Flame) to 8.6 (Mortar) tiles. Towers attack 0.4 to 5 times per second. Enemy HP grows about 15% per wave, so late-game fusions must scale: synergies, chain reactions and multiplicative payoffs matter.

THE EFFECT LANGUAGE
You never write code. You compose ONE JSON "fusion spec" from the building blocks below. Anything not listed does not exist.

${cheatSheet(BUILTIN_VFX_IDS)}

OUTPUT FORMAT
Reply with exactly ONE JSON object and nothing else: no markdown fences, no commentary. Start with "concept", then "name", then "flavor", then the rest. Every id is lowercase_snake_case. Every damage amount contains {"dmg": x}.`;

function compact(spec: FusionSpec): string {
  return JSON.stringify(spec);
}

function colourName(role: 'base' | 'secondary' | 'tertiary', p: PowerDef): string {
  return `${p.color} (use "${role}")`;
}

export function towerCard(t: TowerDef, tier: number): string {
  const i = tier - 1;
  const stats = t.chassis === 'aura'
    ? `aura radius ${t.range[i]} tiles, +${Math.round((t.auraRate?.[i] ?? 0) * 100)}% attack speed to towers inside; its own {"dmg"} reference is ${t.damage[i]}`
    : `${t.damage[i]} ${t.dtype} damage per hit (colour ${DAMAGE_COLORS[t.dtype]} = "damage"), ${t.rate[i]} attacks/s, range ${t.range[i]} tiles, hits flying: ${t.hitsAir ? 'yes' : 'no'}`;
  return `${t.name.toUpperCase()} — ${t.card}\n  At tier ${tier}: ${stats}.`;
}

export function powerCard(p: PowerDef, role: 'base' | 'secondary' | 'tertiary'): string {
  const label = { base: 'BASE power (1st socket: the heart of the design)', secondary: 'SECONDARY power (2nd socket: reshapes the base)', tertiary: 'TERTIARY power (3rd socket: a small twist)' }[role];
  return `${label}: ${p.name.toUpperCase()} — ${p.blurb}\n  Family: ${p.family}. Themes: ${p.tags.join(', ')}. Colour: ${colourName(role, p)}.\n  On its own it is this spec: ${compact(p.spec)}`;
}

/** Two examples that share neither tower nor powers with the request (so they inspire rather than get copied). */
export function pickExamples(tower: string, powers: string[], seed: number): typeof PAIR_EXAMPLES {
  const clash = (e: (typeof PAIR_EXAMPLES)[number]) => e.tower === tower || e.powers.some((p) => powers.includes(p));
  const ok = PAIR_EXAMPLES.filter((e) => !clash(e));
  const pool = ok.length >= 2 ? ok : PAIR_EXAMPLES;
  const start = seed % pool.length;
  return [pool[start], pool[(start + 1) % pool.length]];
}

function exampleBlock(ex: (typeof PAIR_EXAMPLES)[number]): string {
  const t = TOWER_BY_ID.get(ex.tower)!;
  const [b, s] = ex.powers.map((id) => POWER_BY_ID.get(id)!);
  return `EXAMPLE — ${t.name}: ${b.name} (base) > ${s.name} (secondary)\n${compact(ex.spec)}`;
}

export interface AvoidEntry {
  name: string;
  concept: string;
  powers: string[];
}

export function pairPrompt(tower: TowerDef, base: PowerDef, secondary: PowerDef, twist: string, avoid: AvoidEntry[], seed: number): ChatMessage[] {
  const examples = pickExamples(tower.id, [base.id, secondary.id], seed).map(exampleBlock).join('\n\n');
  const avoidText = avoid.length
    ? `\nALREADY DISCOVERED with this tower and base power. Do something clearly different from these:\n${avoid.map((a) => `- "${a.name}" (${a.powers.join(' > ')}): ${a.concept}`).join('\n')}\n`
    : '';
  const user = `Here are examples of excellent fusions (other towers and powers; do not copy them, match their quality):

${examples}

NOW DESIGN A NEW FUSION.

TOWER: ${towerCard(tower, 2)}

${powerCard(base, 'base')}

${powerCard(secondary, 'secondary')}
${base.id === secondary.id ? `\nThe same power is socketed twice: this is a PURE ${base.name.toUpperCase()} fusion. Take ${base.name}'s idea to its extreme, transformed rather than doubled.\n` : ''}
TWIST SEED: "${twist}". Use it as the seed of the concept (interpret it freely, it should be visible in the mechanics).
${avoidText}
Before answering, check:
- ${base.name} is the heart; ${secondary.name} visibly reshapes how it works; the twist seed shaped the idea.
- At least one custom status, projectile or zone, with its own look.
- At least one rule uses a trigger other than on_hit/on_attack.
- Rules whose trigger provides no target never use "target".
- Every damage amount uses {"dmg": x}.
- Visuals: a fitting "visual" block (aura, impact and/or kill, plus projectile/beam/spray look for this chassis), at least one custom "vfx", and vfx at the payoff moment. Use the colours "base" and "secondary".

Reply with the JSON object only.`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export function triplePrompt(
  tower: TowerDef, powers: PowerDef[], parent: { name: string; spec: FusionSpec }, twist: string, siblings: AvoidEntry[],
): ChatMessage[] {
  const [base, secondary, tertiary] = powers;
  const ex = TRIPLE_EXAMPLE;
  const exParent = PAIR_EXAMPLES[0];
  const sib = siblings.length
    ? `\nOTHER TERTIARY EVOLUTIONS of this same parent already exist. Make yours clearly different:\n${siblings.map((a) => `- "${a.name}" (+${a.powers[2]}): ${a.concept}`).join('\n')}\n`
    : '';
  const user = `You are EVOLVING an existing fusion by adding a TERTIARY power. The parent keeps its identity; the tertiary adds one distinctive twist.

EXAMPLE OF AN EVOLUTION — ${exParent.spec.name} + Storm (tertiary):
Parent: ${compact(exParent.spec)}
Evolved: ${compact(ex.spec)}
(It kept every parent rule and template, added one rule and one vfx, used the "tertiary" colour, and evolved the name.)

NOW EVOLVE THIS FUSION.

TOWER: ${towerCard(tower, 3)}

PARENT FUSION "${parent.name}" (${base.name} > ${secondary.name}):
${compact(parent.spec)}

${powerCard(tertiary, 'tertiary')}

TWIST SEED: "${twist}". Let it colour the twist.
${sib}
Rules for an evolution:
- Return the COMPLETE new spec, not a diff.
- Keep the parent's rules and templates. You may modify at most 2 rules, remove at most 1 rule, add at most 2 rules and at most 2 new templates (statuses / projectiles / zones / vfx).
- ${tertiary.name} must be clearly visible as a twist in the mechanics AND the visuals: use the "tertiary" colour somewhere prominent (a new vfx, an accent, a trail_color, a beam core...).
- Evolve the name: keep its root and add or change one word (e.g. "Glacial Carillon" -> "Thunder-Rung Carillon"). Rewrite concept and flavor to include the twist.
- Rules whose trigger provides no target never use "target". Every damage amount uses {"dmg": x}.

Reply with the JSON object only.`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export function repairMessages(prev: ChatMessage[], output: string, problems: string[]): ChatMessage[] {
  return [
    ...prev,
    { role: 'assistant', content: output.slice(0, 12000) },
    {
      role: 'user',
      content: `Your fusion spec has problems. Fix ALL of them and reply with the complete corrected JSON object only. Keep everything that was fine (concept, name, look) unless it must change to fix a problem.\n\nPROBLEMS:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    },
  ];
}

export function tooStrongProblem(ratio: number, perScenario: { id: string; ratio: number }[]): string {
  const worst = [...perScenario].sort((a, b) => b.ratio - a.ratio)[0];
  return `The balance simulation says this fusion is far too strong even with all damage and control scaled down to 10%: it is ${ratio.toFixed(1)}x as strong as the plain tower (worst: ${worst.id} scenario at ${worst.ratio.toFixed(1)}x). This usually means a near-permanent slow/stop/pushback loop, an effect that re-triggers itself every hit, or huge area coverage. Keep the concept but make the strongest effect rarer (cooldowns, every_nth, chance) or smaller in area.`;
}
