// Client side of the Forge. Supplies specs to the World:
//   * 1 power   -> the power's own spec;
//   * known key -> the fusion from the personal codex (instant);
//   * new key   -> the offline combination right away, while the server forges
//                  the real fusion; when it lands, it is applied and announced.
// Only fusions the player has made are ever shown (no previews).

import type { World, SpecProvider } from '../sim/world.ts';
import type { FusionSpec } from '../effects/types.ts';
import { POWER_BY_ID } from '../content/powers.ts';
import { offlineFusion } from '../effects/combiner.ts';
import { parseKey } from '../effects/keys.ts';
import { validateSpec } from '../effects/validate.ts';
import { TOWER_BY_ID } from '../content/towers.ts';
import type { Codex, CodexEntry } from './storage.ts';
import { api } from './config.ts';

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

export interface ForgeEvents {
  onForged(entry: CodexEntry, fresh: boolean): void;
  onStage(key: string, stage: string, position: number): void;
  onError(key: string, message: string): void;
}

export class ForgeClient {
  online: boolean | null = null;
  model: string | null = null;
  private codex: Codex;
  private world: World | null = null;
  private inflight = new Set<string>();
  private events: ForgeEvents;
  stages = new Map<string, string>();

  constructor(codex: Codex, events: ForgeEvents) {
    this.codex = codex;
    this.events = events;
  }

  async health(): Promise<void> {
    try {
      const r = await fetch(api('/api/health'), { cache: 'no-store' });
      const j = (await r.json()) as { forge: boolean; model: string | null };
      this.online = !!j.forge;
      this.model = j.model;
    } catch {
      this.online = false;
    }
  }

  attach(w: World): void {
    this.world = w;
  }

  readonly provider: SpecProvider = (_w, t, key) => {
    if (t.sockets.length === 1) {
      const p = POWER_BY_ID.get(t.sockets[0]);
      return p ? { spec: p.spec, potency: 1, state: 'single' } : null;
    }
    const known = this.codex.get(key);
    if (known?.spec && (known.status === 'ready' || !this.online)) {
      return { spec: known.spec, potency: known.potency, state: known.status === 'ready' ? 'ready' : known.status === 'offline' ? 'offline' : 'provisional' };
    }
    const powers = t.sockets.map((s) => POWER_BY_ID.get(s)!);
    const offline = offlineFusion(t.def, powers, key);
    if (this.online) {
      void this.forge(key);
      return { spec: known?.spec ?? offline, potency: known?.potency ?? 0.9, state: 'forging' };
    }
    // No server: the offline combination is this player's fusion for now.
    this.codex.put({
      key, tower: t.def.id, powers: [...t.sockets], name: offline.name, concept: offline.concept, flavor: offline.flavor,
      spec: offline, potency: 0.9, status: 'offline', discoveryNo: null, discoveredAt: null,
    });
    return { spec: offline, potency: 0.9, state: 'offline' };
  };

  private async forge(key: string): Promise<void> {
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const res = await fetch(api('/api/forge'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
      const j = (await res.json()) as { status: string; fusion?: FusionDTO | null; token?: string; position?: number; error?: string };
      if (j.status === 'ready' && j.fusion) return this.land(j.fusion, false);
      if (j.status === 'unavailable' || j.status === 'rate_limited' || j.status === 'daily_cap' || j.error) {
        if (j.fusion) this.land(j.fusion, false);
        else this.fallback(key, j.status === 'rate_limited' || j.status === 'daily_cap' ? 'The forge is busy. Using an offline fusion for now.' : 'The forge is offline. Using an offline fusion.');
        return;
      }
      await this.poll(key, j.token ?? null);
    } catch {
      this.fallback(key, 'Could not reach the forge. Using an offline fusion.');
    } finally {
      this.inflight.delete(key);
    }
  }

  private async poll(key: string, token: string | null): Promise<void> {
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, i < 10 ? 1200 : 2000));
      let j: { status: string; fusion?: FusionDTO | null; position?: number; attempt?: number; error?: string };
      try {
        const r = await fetch(api(`/api/forge?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token ?? '')}`), { cache: 'no-store' });
        j = await r.json();
      } catch {
        continue;
      }
      if (j.status === 'ready' && j.fusion) return this.land(j.fusion, !!j.fusion.worldFirst);
      if (j.status === 'provisional' && j.fusion) return this.land(j.fusion, false);
      if (j.status === 'failed' || j.status === 'unavailable' || j.status === 'unknown') {
        this.fallback(key, j.error ? `Forging failed: ${j.error.slice(0, 120)}` : 'Forging failed. Using an offline fusion.');
        return;
      }
      this.stages.set(key, j.status);
      this.events.onStage(key, j.status, j.position ?? 0);
    }
  }

  private land(f: FusionDTO, worldFirst: boolean): void {
    this.stages.delete(key(f));
    const v = validateSpec(f.spec);
    if (!v.ok || !v.spec) return this.fallback(f.key, 'The forged fusion was invalid; using an offline fusion.');
    const entry = this.codex.put({
      key: f.key, tower: f.tower, powers: f.powers, name: f.name, concept: f.concept, flavor: f.flavor, spec: v.spec,
      potency: f.potency, status: f.status, discoveryNo: f.discoveryNo, discoveredAt: f.discoveredAt, worldFirst,
    });
    this.apply(f.key, v.spec, f.potency, f.status === 'ready' ? 'ready' : 'provisional');
    this.events.onForged(entry, worldFirst);
  }

  private fallback(k: string, msg: string): void {
    this.stages.delete(k);
    const p = parseKey(k);
    if (!p) return;
    const tower = TOWER_BY_ID.get(p.tower)!;
    const spec = offlineFusion(tower, p.powers.map((id) => POWER_BY_ID.get(id)!), k);
    const entry = this.codex.put({
      key: k, tower: p.tower, powers: p.powers, name: spec.name, concept: spec.concept, flavor: spec.flavor, spec,
      potency: 0.9, status: 'offline', discoveryNo: null, discoveredAt: null,
    });
    this.apply(k, spec, 0.9, 'offline');
    this.events.onError(k, msg);
    void entry;
  }

  private apply(k: string, spec: FusionSpec, potency: number, state: 'ready' | 'provisional' | 'offline'): void {
    const w = this.world;
    if (!w) return;
    for (const t of w.towers) if (w.fusionKeyOf(t) === k) w.applySpec(t.id, k, spec, potency, state);
  }

  async globalStats(): Promise<{ discovered: number; total: number; recent: { no: number; tower: string; powers: string[]; at: number }[] } | null> {
    try {
      const r = await fetch(api('/api/stats'), { cache: 'no-store' });
      return await r.json();
    } catch {
      return null;
    }
  }
}

function key(f: FusionDTO): string {
  return f.key;
}
