// Everything the browser remembers: settings, campaign progress, the player's
// personal codex of fusions they have made (the only place previews come
// from), and the saved run. All access is wrapped: storage can be missing or
// full and the game must still work.

import type { FusionSpec } from '../effects/types.ts';
import type { WorldSave } from '../sim/world.ts';
import type { DifficultyDef } from '../sim/types.ts';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ settings

export interface Settings {
  volume: number;
  sound: boolean;
  shake: boolean;
  damageNumbers: boolean;
  autoStart: boolean;
  showRanges: boolean;
  particles: 'low' | 'high';
  unlockAll: boolean;
  tutorialDone: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  volume: 0.6, sound: true, shake: true, damageNumbers: true, autoStart: true, showRanges: false, particles: 'high',
  unlockAll: false, tutorialDone: false,
};

export function loadSettings(): Settings {
  return read('it.settings.v1', DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings): void {
  write('it.settings.v1', s);
}

// ------------------------------------------------------------------ progress

export interface MapProgress {
  best: number;
  won: Partial<Record<DifficultyDef['id'], boolean>>;
}

export interface Progress {
  maps: Record<string, MapProgress>;
  runs: number;
}

export function loadProgress(): Progress {
  return read<Progress>('it.progress.v1', { maps: {}, runs: 0 });
}

export function saveProgress(p: Progress): void {
  write('it.progress.v1', p);
}

export function recordRun(mapId: string, diff: DifficultyDef['id'], wave: number, won: boolean): Progress {
  const p = loadProgress();
  const m = (p.maps[mapId] ??= { best: 0, won: {} });
  m.best = Math.max(m.best, wave);
  if (won) m.won[diff] = true;
  p.runs++;
  saveProgress(p);
  return p;
}

// ------------------------------------------------------------------ codex

export interface CodexEntry {
  key: string;
  tower: string;
  powers: string[];
  name: string;
  concept: string;
  flavor: string;
  spec: FusionSpec | null;
  potency: number;
  status: 'ready' | 'provisional' | 'offline';
  discoveryNo: number | null;
  discoveredAt: number | null;
  worldFirst: boolean;
  firstSeen: number;
}

interface CodexFile {
  v: 1;
  entries: Record<string, CodexEntry>;
}

const CODEX_KEY = 'it.codex.v1';
const MAX_SPECS = 300;

export class Codex {
  private data: CodexFile;

  constructor() {
    this.data = read<CodexFile>(CODEX_KEY, { v: 1, entries: {} });
  }

  get(key: string): CodexEntry | null {
    return this.data.entries[key] ?? null;
  }

  has(key: string): boolean {
    return key in this.data.entries;
  }

  all(): CodexEntry[] {
    return Object.values(this.data.entries).sort((a, b) => b.firstSeen - a.firstSeen);
  }

  get size(): number {
    return Object.keys(this.data.entries).length;
  }

  put(e: Omit<CodexEntry, 'firstSeen' | 'worldFirst'> & { worldFirst?: boolean }): CodexEntry {
    const prev = this.data.entries[e.key];
    // A real forged fusion replaces an offline/provisional one; never downgrade.
    if (prev && prev.status === 'ready' && e.status !== 'ready') return prev;
    const entry: CodexEntry = { ...e, worldFirst: e.worldFirst || prev?.worldFirst || false, firstSeen: prev?.firstSeen ?? Date.now() };
    this.data.entries[e.key] = entry;
    this.persist();
    return entry;
  }

  private persist(): void {
    // Keep full specs only for the most recent fusions; older ones keep their
    // metadata and are re-fetched from the server if needed.
    const list = Object.values(this.data.entries).sort((a, b) => b.firstSeen - a.firstSeen);
    list.forEach((e, i) => { if (i >= MAX_SPECS && e.status === 'ready') e.spec = null; });
    if (!write(CODEX_KEY, this.data)) {
      for (const e of list.slice(MAX_SPECS / 2)) if (e.status === 'ready') e.spec = null;
      write(CODEX_KEY, this.data);
    }
  }
}

// ------------------------------------------------------------------ saved run

export interface RunSave {
  save: WorldSave;
  savedAt: number;
}

export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem('it.run.v2');
    return raw ? (JSON.parse(raw) as RunSave) : null;
  } catch {
    return null;
  }
}

export function saveRun(save: WorldSave): void {
  write('it.run.v2', { save, savedAt: Date.now() } satisfies RunSave);
}

export function clearRun(): void {
  try {
    localStorage.removeItem('it.run.v2');
  } catch {
    // ignore
  }
}
