// LLM providers. Default: Ollama's /api/chat, which works both for Ollama's
// cloud (https://ollama.com with an API key) and a local Ollama server.

import type { ChatMessage } from './prompt.ts';
import { specJsonSchema } from '../../effects/dsl.ts';
import { offlineFusion } from '../../effects/combiner.ts';
import { POWER_BY_ID } from '../../content/powers.ts';
import { TOWER_BY_ID } from '../../content/towers.ts';
import { parseKey } from '../../effects/keys.ts';
import type { FusionSpec } from '../../effects/types.ts';
import { autoScaling, extractLevelMarks, getAt, inlineLevelMarks, parsePath } from '../../effects/level.ts';
import type { PowerDef, TowerDef } from '../../sim/types.ts';

export interface ChatOptions {
  temperature: number;
  /** For the mock provider / logging. */
  key?: string;
}

export interface LLM {
  readonly name: string;
  chat(messages: ChatMessage[], o: ChatOptions): Promise<string>;
}

export interface OllamaConfig {
  host: string;
  apiKey: string | null;
  model: string;
  /** "schema" = full JSON Schema structured output, "json" = JSON mode, "none" = prompt only. */
  format: 'schema' | 'json' | 'none';
  think: string | null;
  timeoutMs: number;
}

export class OllamaLLM implements LLM {
  readonly name: string;
  private cfg: OllamaConfig;
  private formatFallback: OllamaConfig['format'] | null = null;

  constructor(cfg: OllamaConfig) {
    this.cfg = cfg;
    this.name = cfg.model;
  }

  async chat(messages: ChatMessage[], o: ChatOptions): Promise<string> {
    const format = this.formatFallback ?? this.cfg.format;
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      stream: false,
      options: { temperature: o.temperature, num_ctx: 32768 },
      keep_alive: '30m',
    };
    if (format === 'schema') body.format = specJsonSchema();
    else if (format === 'json') body.format = 'json';
    if (this.cfg.think) body.think = this.cfg.think === 'true' ? true : this.cfg.think === 'false' ? false : this.cfg.think;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.host.replace(/\/$/, '')}/api/chat`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // Some models / endpoints reject complex schemas: step down once.
        if (res.status === 400 && format !== 'none' && /format|schema|grammar/i.test(text)) {
          this.formatFallback = format === 'schema' ? 'json' : 'none';
          return this.chat(messages, o);
        }
        throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = JSON.parse(text) as { message?: { content?: string; thinking?: string } };
      const content = data.message?.content ?? '';
      if (!content.trim() && data.message?.thinking) return data.message.thinking;
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Deterministic stand-in for tests and local development without an API key
 * (LLM_PROVIDER=mock). It returns the offline combination with a new name and
 * a custom vfx, so the whole pipeline (validation, lint, balance, storage)
 * can be exercised end to end.
 */
export class MockLLM implements LLM {
  readonly name = 'mock';
  calls = 0;
  async chat(messages: ChatMessage[], o: ChatOptions): Promise<string> {
    this.calls++;
    const parsed = o.key ? parseKey(o.key) : null;
    if (!parsed) return '{"concept": "broken"}';
    const tower = TOWER_BY_ID.get(parsed.tower)!;
    const powers = parsed.powers.map((p) => POWER_BY_ID.get(p)!);
    const isRepair = messages.length > 2;
    const spec = powers.length === 3 ? this.evolve(messages, tower, powers, o.key!) : offlineFusion(tower, powers, o.key!);
    spec.name = `Mock ${this.calls}`;
    spec.vfx = [...(spec.vfx ?? []).filter((v) => v.id !== 'mock_burst'), {
      id: 'mock_burst',
      layers: [{ kind: 'particles', count: 12, shape: 'star', direction: 'radial', speed: [2, 4], life: [0.3, 0.6], color: 'secondary', glow: true }],
    }];
    spec.visual = { ...(spec.visual ?? {}), kill: 'mock_burst', impact: spec.visual?.impact ?? 'pop', aura: spec.visual?.aura ?? 'halo' };
    // On a repair, do what a model asked to fix its design would: keep a pair to
    // three rules and make sure not every rule fires on the same hit trigger.
    if (isRepair && powers.length === 2) {
      spec.rules = spec.rules.slice(0, 3);
      const triggers = new Set(spec.rules.map((r) => r.when.event));
      if (triggers.size === 1 && (triggers.has('on_hit') || triggers.has('on_attack'))) {
        const payoff: FusionSpec['rules'][number] = { when: { event: 'every_nth_attack', n: 4 }, do: [{ action: 'explode', at: 'target', radius: 1.2, amount: { dmg: 0.4 } }] };
        if (spec.rules.length >= 3) spec.rules[spec.rules.length - 1] = payoff;
        else spec.rules.push(payoff);
      }
    }
    // Like the real model: mark a number or two to grow with level and quote one in the concept.
    const grows = spec.scaling ?? autoScaling(spec).slice(0, 2);
    const quoted = grows[0] ? getAt(spec, parsePath(grows[0].path) ?? []) : null;
    spec.scaling = grows;
    spec.concept = typeof quoted === 'number' ? `Mock fusion for ${o.key}; its key number is {${quoted}}.` : `Mock fusion for ${o.key}, hitting for {dmg 0.4}.`;
    if (typeof quoted !== 'number') spec.rules.push({ when: { event: 'on_kill' }, do: [{ action: 'explode', at: 'target', radius: 1, amount: { dmg: 0.4 } }] });
    await new Promise((r) => setTimeout(r, isRepair ? 5 : 20));
    return '```json\n' + JSON.stringify(inlineLevelMarks(spec)) + '\n```';
  }

  /** A triple keeps its parent pair (quoted in the prompt) and adds one tertiary twist. */
  private evolve(messages: ChatMessage[], tower: TowerDef, powers: PowerDef[], key: string): FusionSpec {
    const user = String(messages.find((m) => m.role === 'user')?.content ?? '');
    const at = user.indexOf('PARENT FUSION');
    let parent: FusionSpec | null = null;
    try {
      if (at >= 0) {
        // The parent is quoted with its level marks inline; lift them out again.
        const lifted = extractLevelMarks(extractJson(user.slice(user.indexOf('\n', at))));
        parent = { ...(lifted.raw as FusionSpec), scaling: lifted.marks };
      }
    } catch {
      parent = null;
    }
    if (!parent) return offlineFusion(tower, powers, key);
    const spec: FusionSpec = JSON.parse(JSON.stringify(parent));
    const twist: FusionSpec['rules'][number] = {
      when: { event: 'on_kill' },
      do: [{ action: 'explode', at: 'target', radius: 1.4, amount: { dmg: 0.5 } }, { action: 'vfx', effect: 'mock_twist', at: 'target' }],
    };
    if (spec.rules.length >= 6) spec.rules[spec.rules.length - 1] = twist;
    else spec.rules.push(twist);
    spec.vfx = [...(spec.vfx ?? []).filter((v) => v.id !== 'mock_twist'), {
      id: 'mock_twist', layers: [{ kind: 'shape', shape: 'ring', color: 'tertiary', radius: [0.2, 1.4], duration: 0.4 }],
    }];
    return spec;
  }
}

/** Pull the first complete JSON object out of a model reply (fences, prose, trailing commas...). */
export function extractJson(text: string): unknown {
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no JSON object found');
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('JSON object is not closed (output truncated?)');
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    // Common slips: trailing commas and // comments.
    const cleaned = s.replace(/\/\/[^\n"]*$/gm, '').replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  }
}
