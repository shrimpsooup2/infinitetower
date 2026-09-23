// The Forge: turns a fusion key into a stored, balanced, shareable fusion.
//
//   request -> DB hit? -> return
//           -> same key already generating? -> attach
//           -> queue -> (triple: make sure the parent pair exists first)
//              -> LLM design -> JSON -> validate -> lint -> novelty -> balance
//                 (problems are sent back to the LLM, up to MAX_REPAIRS times)
//              -> save with the next discovery number
//              -> total failure: save the offline combination as "provisional"
//                 (no number) and retry later in the background.

import { randomUUID } from 'node:crypto';
import type { Store, FusionRow } from '../db.ts';
import type { LLM } from './llm.ts';
import { extractJson } from './llm.ts';
import type { Balancer } from './balancer.ts';
import type { FusionSpec } from '../../effects/types.ts';
import type { PowerDef, TowerDef } from '../../sim/types.ts';
import { validateSpec } from '../../effects/validate.ts';
import { lintFusion, signature, jaccard } from '../../effects/lint.ts';
import { offlineFusion } from '../../effects/combiner.ts';
import { parseKey, parentKey as parentOf } from '../../effects/keys.ts';
import { hashString } from '../../sim/math.ts';
import { POWER_BY_ID } from '../../content/powers.ts';
import { TOWER_BY_ID } from '../../content/towers.ts';
import { TWIST_SEEDS } from '../../content/twists.ts';
import { pairPrompt, triplePrompt, repairMessages, tooStrongProblem, PROMPT_VERSION, type ChatMessage, type AvoidEntry } from './prompt.ts';

export type Stage = 'queued' | 'waiting_parent' | 'designing' | 'repairing' | 'balancing' | 'done' | 'failed';

export interface Job {
  key: string;
  tower: TowerDef;
  powers: PowerDef[];
  stage: Stage;
  attempt: number;
  ownerToken: string;
  createdAt: number;
  interactive: boolean;
  promise: Promise<FusionRow>;
  resolve: (r: FusionRow) => void;
  reject: (e: Error) => void;
  result: FusionRow | null;
  error: string | null;
}

export interface ForgeOptions {
  concurrency: number;
  maxRepairs: number;
  noveltyLimit: number;
}

export interface FusionDTO {
  key: string;
  tower: string;
  powers: string[];
  status: 'ready' | 'provisional';
  name: string;
  concept: string;
  flavor: string;
  spec: FusionSpec;
  potency: number;
  discoveryNo: number | null;
  discoveredAt: number | null;
  worldFirst?: boolean;
}

export function toDTO(r: FusionRow, worldFirst = false): FusionDTO {
  return {
    key: r.key, tower: r.tower, powers: r.powers, status: r.status, name: r.name, concept: r.concept, flavor: r.flavor,
    spec: r.spec, potency: r.potency, discoveryNo: r.discoveryNo, discoveredAt: r.discoveredAt, ...(worldFirst ? { worldFirst } : {}),
  };
}

export class Forge {
  readonly jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = 0;
  private store: Store;
  private llm: LLM | null;
  private balancer: Balancer;
  private opts: ForgeOptions;
  /** Tokens of clients that caused a generation (for the "WORLD FIRST" banner). */
  private firsts = new Map<string, string>();

  constructor(store: Store, llm: LLM | null, balancer: Balancer, opts: ForgeOptions) {
    this.store = store;
    this.llm = llm;
    this.balancer = balancer;
    this.opts = opts;
  }

  get enabled(): boolean {
    return !!this.llm;
  }

  /** Validate a key and resolve its tower / powers. */
  resolve(key: string): { tower: TowerDef; powers: PowerDef[] } | null {
    const p = parseKey(key);
    if (!p || p.powers.length < 2) return null;
    const tower = TOWER_BY_ID.get(p.tower);
    const powers = p.powers.map((id) => POWER_BY_ID.get(id));
    if (!tower || powers.some((x) => !x)) return null;
    return { tower, powers: powers as PowerDef[] };
  }

  /** Start (or join) generation of a fusion. */
  request(key: string, interactive = true): { job: Job | null; row: FusionRow | null; token: string | null } {
    const row = this.store.get(key);
    if (row && (row.status === 'ready' || !this.llm)) return { job: null, row, token: null };
    const existing = this.jobs.get(key);
    if (existing) {
      if (interactive && !existing.interactive) {
        existing.interactive = true;
        this.queue.sort((a, b) => Number(b.interactive) - Number(a.interactive));
      }
      return { job: existing, row, token: null };
    }
    if (!this.llm) return { job: null, row, token: null };
    const r = this.resolve(key);
    if (!r) throw new Error('invalid fusion key');
    let resolve!: (x: FusionRow) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<FusionRow>((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => undefined);
    const job: Job = {
      key, tower: r.tower, powers: r.powers, stage: 'queued', attempt: 0, ownerToken: randomUUID(), createdAt: Date.now(),
      interactive, promise, resolve, reject, result: null, error: null,
    };
    this.jobs.set(key, job);
    if (interactive) this.queue.unshift(job);
    else this.queue.push(job);
    this.queue.sort((a, b) => Number(b.interactive) - Number(a.interactive));
    this.firsts.set(key, job.ownerToken);
    this.pump();
    return { job, row, token: job.ownerToken };
  }

  queuePosition(job: Job): number {
    const i = this.queue.indexOf(job);
    return i < 0 ? 0 : i + 1;
  }

  isWorldFirst(key: string, token: string | null): boolean {
    return !!token && this.firsts.get(key) === token;
  }

  private pump(): void {
    while (this.running < this.opts.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      this.run(job)
        .then((row) => {
          job.stage = 'done';
          job.result = row;
          job.resolve(row);
        })
        .catch((e: Error) => {
          job.stage = 'failed';
          job.error = e.message;
          job.reject(e);
        })
        .finally(() => {
          this.running--;
          // Keep finished jobs briefly so pollers can read the outcome.
          setTimeout(() => { if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); }, 5 * 60_000).unref();
          this.pump();
        });
    }
  }

  private async run(job: Job): Promise<FusionRow> {
    const pk = parentOf(job.key);
    let parent: FusionRow | null = null;
    if (pk) {
      parent = this.store.get(pk);
      if (!parent || (parent.status !== 'ready' && this.llm)) {
        job.stage = 'waiting_parent';
        const r = this.request(pk, job.interactive);
        parent = r.row && r.row.status === 'ready' ? r.row : r.job ? await r.job.promise.catch(() => this.store.get(pk)) : this.store.get(pk);
      }
      if (!parent) throw new Error('parent fusion unavailable');
    }
    try {
      return await this.generate(job, parent);
    } catch (e) {
      // Never leave the player without a fusion: store the offline combination.
      const spec = offlineFusion(job.tower, job.powers, job.key);
      return this.store.save({
        key: job.key, tower: job.tower.id, powers: job.powers.map((p) => p.id), parentKey: pk, status: 'provisional',
        name: spec.name, concept: spec.concept, flavor: spec.flavor, spec, potency: 0.9, ratio: null,
        balance: { error: (e as Error).message }, signature: [...signature(spec)], dslVersion: 1, promptVersion: PROMPT_VERSION,
        model: 'offline', attempts: job.attempt,
      });
    }
  }

  private avoidList(job: Job, parent: FusionRow | null): AvoidEntry[] {
    const rows = parent
      ? this.store.siblings(parent.key, job.key)
      : this.store.sameTowerBase(job.tower.id, job.powers[0].id, job.key, 8);
    return rows.slice(0, 8).map((r) => ({ name: r.name, concept: r.concept, powers: r.powers }));
  }

  private noveltyProblems(job: Job, spec: FusionSpec, parent: FusionRow | null): string[] {
    const problems: string[] = [];
    if (this.store.nameTaken(spec.name, job.key)) problems.push(`The name "${spec.name}" is already taken by another fusion. Choose a different name.`);
    const sig = signature(spec);
    if (parent) {
      const parentSig = new Set(parent.signature);
      const mine = new Set([...sig].filter((x) => !parentSig.has(x)));
      for (const s of this.store.siblings(parent.key, job.key)) {
        const theirs = new Set(s.signature.filter((x) => !parentSig.has(x)));
        if (mine.size && jaccard(mine, theirs) >= 0.9) {
          problems.push(`Your twist works just like the existing evolution "${s.name}" (${s.concept}). Make the ${job.powers[2].name} twist different.`);
          break;
        }
      }
    } else {
      for (const s of this.store.sameTowerBase(job.tower.id, job.powers[0].id, job.key)) {
        if (jaccard(sig, new Set(s.signature)) >= this.opts.noveltyLimit) {
          problems.push(`This works almost exactly like the existing fusion "${s.name}" (${s.concept}). Find a different interaction between the powers.`);
          break;
        }
      }
    }
    return problems;
  }

  private async generate(job: Job, parent: FusionRow | null): Promise<FusionRow> {
    const llm = this.llm;
    if (!llm) throw new Error('no LLM configured');
    const seed = hashString(job.key);
    const twist = TWIST_SEEDS[seed % TWIST_SEEDS.length];
    const avoid = this.avoidList(job, parent);
    const [base, secondary] = job.powers;
    const initial: ChatMessage[] = parent
      ? triplePrompt(job.tower, job.powers, { name: parent.name, spec: parent.spec }, twist, avoid)
      : pairPrompt(job.tower, base, secondary, twist, avoid, seed);
    let messages = initial;
    let lastProblems: string[] = [];
    for (let attempt = 1; attempt <= 1 + this.opts.maxRepairs; attempt++) {
      job.attempt = attempt;
      job.stage = attempt === 1 ? 'designing' : 'repairing';
      const t0 = Date.now();
      let output = '';
      let problems: string[] = [];
      let spec: FusionSpec | null = null;
      try {
        output = await llm.chat(messages, { temperature: attempt === 1 ? 0.9 : 0.5, key: job.key });
      } catch (e) {
        this.store.log(job.key, attempt, llm.name, PROMPT_VERSION, Date.now() - t0, null, [`LLM error: ${(e as Error).message}`]);
        if (attempt >= 2) throw e;
        continue;
      }
      let raw: unknown = null;
      try {
        raw = extractJson(output);
      } catch (e) {
        problems.push(`Your reply was not a single valid JSON object (${(e as Error).message}). Reply with the JSON object only.`);
      }
      if (raw) {
        const v = validateSpec(raw);
        if (!v.ok || !v.spec) problems.push(...v.errors.slice(0, 12));
        else {
          spec = v.spec;
          problems.push(...lintFusion(spec, job.powers, parent?.spec ?? null).problems);
          if (!problems.length) problems.push(...this.noveltyProblems(job, spec, parent));
        }
      }
      let balance = null;
      if (spec && !problems.length) {
        job.stage = 'balancing';
        balance = await this.balancer.solve(job.tower.id, spec, job.powers.map((p) => p.id));
        if (balance.status === 'too_strong') problems.push(tooStrongProblem(balance.ratio, balance.report.perScenario));
      }
      this.store.log(job.key, attempt, llm.name, PROMPT_VERSION, Date.now() - t0, output, problems);
      if (spec && balance && !problems.length) {
        return this.store.save({
          key: job.key, tower: job.tower.id, powers: job.powers.map((p) => p.id), parentKey: parent?.key ?? null,
          status: 'ready', name: spec.name, concept: spec.concept, flavor: spec.flavor, spec, potency: balance.potency,
          ratio: balance.ratio, balance: { status: balance.status, perScenario: balance.report.perScenario },
          signature: [...signature(spec)], dslVersion: 1, promptVersion: PROMPT_VERSION, model: llm.name, attempts: attempt,
        });
      }
      lastProblems = problems;
      messages = repairMessages(initial, output, problems);
    }
    throw new Error(`gave up after ${job.attempt} attempts: ${lastProblems.slice(0, 3).join(' | ')}`);
  }

  /** Background: retry one provisional fusion (e.g. after an outage). */
  retryOneProvisional(): void {
    if (!this.llm || this.running >= this.opts.concurrency || this.queue.length) return;
    const row = this.store.oldestProvisional();
    if (row && !this.jobs.has(row.key)) this.request(row.key, false);
  }
}
