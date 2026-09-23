// A small pool of worker threads running the potency solver.

import { Worker } from 'node:worker_threads';
import type { FusionSpec } from '../../effects/types.ts';
import { solvePotency, type SolveResult } from '../../balance/bench.ts';

interface Pending {
  resolve: (r: SolveResult) => void;
  reject: (e: Error) => void;
}

export class Balancer {
  private workers: Worker[] = [];
  private next = 0;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      try {
        const w = new Worker(new URL('./balance-worker.ts', import.meta.url), { execArgv: ['--disable-warning=ExperimentalWarning'] });
        w.on('message', (m: { id: number; ok: boolean; r?: SolveResult; error?: string }) => {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.ok && m.r) p.resolve(m.r);
          else p.reject(new Error(m.error ?? 'balance failed'));
        });
        w.on('error', (e: Error) => {
          for (const [id, p] of this.pending) {
            p.reject(e);
            this.pending.delete(id);
          }
        });
        w.unref();
        this.workers.push(w);
      } catch {
        // Fall back to solving inline.
      }
    }
  }

  solve(tower: string, spec: FusionSpec, sockets: string[]): Promise<SolveResult> {
    if (!this.workers.length) return Promise.resolve(solvePotency(tower, spec, sockets));
    const id = ++this.seq;
    const w = this.workers[this.next++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, tower, spec, sockets });
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
