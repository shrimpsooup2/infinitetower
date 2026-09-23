// Worker thread: runs the balance simulation off the main (HTTP) thread.

import { parentPort } from 'node:worker_threads';
import { solvePotency } from '../../balance/bench.ts';

parentPort!.on('message', (m: { id: number; tower: string; spec: unknown; sockets: string[] }) => {
  try {
    const r = solvePotency(m.tower, m.spec as never, m.sockets);
    parentPort!.postMessage({ id: m.id, ok: true, r });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, ok: false, error: (e as Error).message });
  }
});
