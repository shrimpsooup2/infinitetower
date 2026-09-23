// App shell: screens (title, campaign, codex, settings) and game sessions.

import { Game } from './game.ts';
import { Audio } from './audio.ts';
import { ForgeClient } from './forge.ts';
import { Codex, loadSettings, saveSettings, loadProgress, loadRun, clearRun, type Settings } from './storage.ts';
import { h, mount, clear, tone, fmtDate } from './ui/dom.ts';
import { MAPS, MAP_BY_ID, ACTS } from '../content/maps.ts';
import { DIFFICULTIES } from '../content/rules.ts';
import { TOWER_BY_ID, TOWERS } from '../content/towers.ts';
import { POWER_BY_ID } from '../content/powers.ts';
import { ENEMIES } from '../content/enemies.ts';
import { TOTAL_FUSIONS } from '../effects/keys.ts';
import { describeSpec } from '../effects/describe.ts';
import { PAL } from '../content/colors.ts';
import { drawEnemyBody } from './render/enemy-art.ts';
import { towerIcon } from './render/tower-art.ts';
import { Path } from '../sim/path.ts';
import { colorsFor } from '../sim/world.ts';
import { polyPath, fillStroke } from './render/draw.ts';
import type { DifficultyDef, MapDef } from '../sim/types.ts';

class Attract {
  private raf = 0;
  private shapes: { def: (typeof ENEMIES)[number]; x: number; y: number; vx: number; vy: number; r: number; rot: number; t: number }[] = [];
  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }
  start(): void {
    const pool = ENEMIES.filter((e) => !e.traits.includes('boss'));
    this.shapes = Array.from({ length: 26 }, (_, i) => {
      const def = pool[(i * 7) % pool.length];
      return { def, x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.02, vy: (Math.random() - 0.5) * 0.02, r: 14 + def.dim * 7 + Math.random() * 10, rot: Math.random() * 6, t: Math.random() * 10 };
    });
    let last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }
  stop(): void {
    cancelAnimationFrame(this.raf);
  }
  private draw(dt: number): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = PAL.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < W; x += 26) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y < H; y += 26) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
    for (const s of this.shapes) {
      s.x = (s.x + s.vx * dt + 1.1) % 1.1;
      s.y = (s.y + s.vy * dt + 1.1) % 1.1;
      s.rot += dt * 0.3;
      s.t += dt;
      drawEnemyBody(g, s.def, (s.x - 0.05) * W, (s.y - 0.05) * H, s.r, s.rot, s.t, s.def.color, 3);
    }
  }
}

function mapPreview(m: MapDef, w: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const s = w / m.cols;
  const hgt = s * m.rows;
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.fillStyle = PAL.bg;
  g.fillRect(0, 0, w, hgt);
  g.strokeStyle = 'rgba(0,0,0,0.07)';
  g.beginPath();
  for (let x = 0; x <= m.cols; x++) { g.moveTo(x * s, 0); g.lineTo(x * s, hgt); }
  for (let y = 0; y <= m.rows; y++) { g.moveTo(0, y * s); g.lineTo(w, y * s); }
  g.stroke();
  g.setLineDash([s * 0.3, s * 0.4]);
  g.strokeStyle = 'rgba(80,140,160,0.35)';
  g.lineWidth = Math.max(1, s * 0.12);
  for (const p of m.air) {
    g.beginPath();
    p.forEach(([cx, cy], i) => (i ? g.lineTo((cx + 0.5) * s, (cy + 0.5) * s) : g.moveTo((cx + 0.5) * s, (cy + 0.5) * s)));
    g.stroke();
  }
  g.setLineDash([]);
  for (const p of m.paths) {
    const path = new Path(p.map(([cx, cy]) => [cx + 0.5, cy + 0.5] as [number, number]));
    g.strokeStyle = '#b5b5b5';
    g.lineWidth = s * 0.8;
    g.lineCap = 'square';
    g.beginPath();
    path.xs.forEach((x, i) => (i ? g.lineTo(x * s, path.ys[i] * s) : g.moveTo(x * s, path.ys[i] * s)));
    g.stroke();
    const sx = Math.min(m.cols - 1, Math.max(0, path.xs[0] - 0.5)), sy = Math.min(m.rows - 1, Math.max(0, path.ys[0] - 0.5));
    g.fillStyle = 'rgba(241,78,84,0.4)';
    g.fillRect(sx * s - s * 0.5, sy * s - s * 0.5, s * 2, s * 2);
    const ex = Math.min(m.cols - 1, Math.max(0, path.xs[path.xs.length - 1] - 0.5)), ey = Math.min(m.rows - 1, Math.max(0, path.ys[path.ys.length - 1] - 0.5));
    g.fillStyle = 'rgba(0,178,225,0.4)';
    g.fillRect(ex * s - s * 0.5, ey * s - s * 0.5, s * 2, s * 2);
  }
  for (const [bx, by] of m.blocked) {
    polyPath(g, (bx + 0.5) * s, (by + 0.5) * s, s * 0.42, 6, 0.3);
    fillStroke(g, '#aaaaaa', 1, '#8a8a8a');
  }
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  return c;
}

class App {
  readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  readonly ui = document.getElementById('ui') as HTMLElement;
  readonly audio = new Audio();
  readonly settings: Settings = loadSettings();
  readonly codex = new Codex();
  readonly forge: ForgeClient;
  private game: Game | null = null;
  private attract = new Attract(this.canvas);
  private selMap = 'meadow';
  private selDiff: DifficultyDef['id'] = 'normal';
  private last: { map: string; diff: DifficultyDef['id'] } | null = null;

  constructor() {
    this.audio.volume = this.settings.volume;
    this.audio.enabled = this.settings.sound;
    this.forge = new ForgeClient(this.codex, {
      onForged: (e, fresh) => this.game?.onForged(e.name, e.discoveryNo, e.discoveredAt, fresh, e.key),
      onStage: () => undefined,
      onError: (_k, msg) => this.game?.toast(msg, 'info'),
    });
    void this.forge.health();
    const progress = loadProgress();
    const firstUnbeaten = MAPS.find((m) => !Object.values(progress.maps[m.id]?.won ?? {}).some(Boolean));
    if (firstUnbeaten && this.unlocked(firstUnbeaten)) this.selMap = firstUnbeaten.id;
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    this.title();
  }

  private stopGame(): void {
    this.game?.stop();
    this.game = null;
  }

  private screen(...children: Parameters<typeof h>[2][]): void {
    this.stopGame();
    this.attract.stop();
    this.attract.start();
    mount(this.ui, h('div', { class: 'screen' }, ...children));
  }

  title(): void {
    const stat = h('div', { class: 'stat-line' }, `${this.codex.size} fusions in your codex`);
    void this.forge.globalStats().then((s) => {
      if (s && typeof s.discovered === 'number') {
        stat.textContent = `${s.discovered.toLocaleString()} / ${s.total.toLocaleString()} fusions discovered worldwide · ${this.codex.size} in your codex`;
      }
    });
    const saved = loadRun();
    this.screen(
      h('div', { class: 'logo' }, 'INFINITE TOWER'),
      h('div', { class: 'tagline' }, 'Socket powers into towers, in order. Every combination is fused into a unique ability by an AI forge: discovered once, numbered, and shared with every player forever.'),
      h('div', { class: 'menu' },
        saved ? h('button', { class: 'btn gold', on: { click: () => this.resume() } }, `Continue: ${MAP_BY_ID.get(saved.save.map)?.name ?? '?'} · wave ${saved.save.waveN}`) : null,
        h('button', { class: 'btn blue', on: { click: () => this.maps() } }, 'Play'),
        h('button', { class: 'btn purple', on: { click: () => this.codexScreen() } }, 'Codex'),
        h('button', { class: 'btn grey', on: { click: () => this.settingsScreen() } }, 'Settings'),
      ),
      stat,
      h('div', { class: 'stat-line small muted' }, '10 towers · 40 powers · 656,000 ordered fusions · 2D, 3D and 4D enemies'),
    );
  }

  private unlocked(m: MapDef): boolean {
    if (this.settings.unlockAll) return true;
    const i = MAPS.indexOf(m);
    if (i === 0) return true;
    const p = loadProgress();
    return Object.values(p.maps[MAPS[i - 1].id]?.won ?? {}).some(Boolean);
  }

  maps(): void {
    const p = loadProgress();
    const render = () => {
      const saved = loadRun();
      this.screen(
        h('div', { class: 'topbar' },
          h('button', { class: 'btn grey', on: { click: () => this.title() } }, 'Back'),
          h('h1', null, 'Campaign'),
          h('div', { class: 'diffs' }, ...DIFFICULTIES.map((d) => h('button', { class: `btn ${this.selDiff === d.id ? 'gold active' : 'grey'}`, title: `Enemy HP x${d.hp}, ${d.lives} lives, ${d.gold} starting gold`, on: { click: () => { this.selDiff = d.id; render(); } } }, d.name))),
          h('button', { class: 'btn green big', disabled: !this.unlocked(MAP_BY_ID.get(this.selMap)!), on: { click: () => { if (saved && !confirm('Starting a new run replaces your saved run. Continue?')) return; clearRun(); this.start(this.selMap, this.selDiff); } } }, 'Start'),
        ),
        h('div', { class: 'acts' }, ...ACTS.map((a) => h('div', { class: 'act' },
          h('h2', null, `Act ${['I', 'II', 'III'][a.act - 1]} · ${a.name}`),
          h('div', { class: 'blurb' }, a.blurb),
          h('div', { class: 'maps' }, ...MAPS.filter((m) => m.act === a.act).map((m) => {
            const unlocked = this.unlocked(m);
            const mp = p.maps[m.id];
            const wins = DIFFICULTIES.filter((d) => mp?.won[d.id]).map((d) => d.name);
            return h('div', { class: `mapcard ${this.selMap === m.id ? 'sel' : ''} ${unlocked ? '' : 'locked'}`, on: { click: () => { if (unlocked) { this.selMap = m.id; render(); } } } },
              mapPreview(m, 284),
              h('div', { class: 'row' }, h('span', { class: 'nm grow' }, m.name), h('span', { class: 'stars' }, '★'.repeat(m.difficulty) + '☆'.repeat(5 - m.difficulty))),
              h('div', { class: 'meta' }, unlocked ? m.blurb : 'Locked: beat the previous map to unlock.'),
              h('div', { class: 'meta' }, `${m.waves} waves · best ${mp?.best ?? 0}${wins.length ? ` · beaten on ${wins.join(', ')}` : ''}`),
            );
          })),
        ))),
      );
    };
    render();
  }

  private start(mapId: string, diff: DifficultyDef['id']): void {
    const map = MAP_BY_ID.get(mapId)!;
    this.attract.stop();
    this.stopGame();
    this.last = { map: mapId, diff };
    this.game = new Game({
      canvas: this.canvas, ui: this.ui, audio: this.audio, settings: this.settings, codex: this.codex, forge: this.forge,
      exit: (to) => (to === 'title' ? this.title() : this.maps()),
      restart: () => { clearRun(); this.start(mapId, diff); },
    }, map, diff, null);
    this.game.start();
  }

  private resume(): void {
    const saved = loadRun();
    if (!saved) return this.maps();
    const map = MAP_BY_ID.get(saved.save.map);
    if (!map) {
      clearRun();
      return this.maps();
    }
    this.attract.stop();
    this.stopGame();
    const diff = saved.save.difficulty;
    this.last = { map: map.id, diff };
    this.game = new Game({
      canvas: this.canvas, ui: this.ui, audio: this.audio, settings: this.settings, codex: this.codex, forge: this.forge,
      exit: (to) => (to === 'title' ? this.title() : this.maps()),
      restart: () => { clearRun(); this.start(map.id, diff); },
    }, map, diff, saved.save);
    this.game.start();
  }

  codexScreen(): void {
    let filterTower = '';
    let q = '';
    const count = h('div', { class: 'stat-line' }, `${this.codex.size} fusions made by you`);
    void this.forge.globalStats().then((s) => {
      if (s && typeof s.discovered === 'number') count.textContent = `${this.codex.size} fusions made by you · ${s.discovered.toLocaleString()} of ${TOTAL_FUSIONS.toLocaleString()} discovered worldwide`;
    });
    const grid = h('div', { class: 'codex' });
    const renderGrid = () => {
      const list = this.codex.all().filter((e) => (!filterTower || e.tower === filterTower) &&
        (!q || `${e.name} ${e.powers.join(' ')} ${e.concept}`.toLowerCase().includes(q)));
      if (!list.length) {
        mount(grid, h('div', { class: 'stat-line' }, this.codex.size ? 'No fusions match.' : 'You have not made any fusions yet. Socket two powers into one tower to forge your first.'));
        return;
      }
      mount(grid, ...list.slice(0, 200).map((e) => {
        const tdef = TOWER_BY_ID.get(e.tower);
        return h('div', { class: 'centry' },
          h('div', { class: 'head' },
            tdef ? towerIcon(tdef.id, e.powers.length, 40, colorsFor(e.powers), e.powers.length) : null,
            h('div', { class: 'col grow', style: { gap: '2px' } },
              h('div', { class: 'fusion-name', style: { color: POWER_BY_ID.get(e.powers[0])?.color } }, e.name),
              h('div', { class: 'chips' }, h('span', { class: 'chip', style: tone('#8eb2ff') }, tdef?.name ?? e.tower),
                ...e.powers.flatMap((p, i) => [i ? h('span', { class: 'arrow' }, '>') : h('span', { class: 'arrow' }, ':'), h('span', { class: 'chip', style: tone(POWER_BY_ID.get(p)?.color ?? '#999') }, POWER_BY_ID.get(p)?.name ?? p)])),
            ),
          ),
          h('div', { class: 'row' },
            e.status === 'ready' ? h('span', { class: 'badge gold' }, e.discoveryNo ? `Fusion #${e.discoveryNo.toLocaleString()}` : 'Fusion') : h('span', { class: 'badge grey' }, e.status === 'offline' ? 'Offline fusion' : 'Provisional'),
            e.worldFirst ? h('span', { class: 'badge red' }, 'WORLD FIRST') : null,
            e.discoveredAt ? h('span', { class: 'badge' }, fmtDate(e.discoveredAt)) : null,
          ),
          h('div', { class: 'flavor' }, e.flavor),
          h('div', { class: 'info-card' }, e.concept),
          e.spec ? h('ul', { class: 'rules' }, ...describeSpec(e.spec, { potency: e.potency }).map((l) => h('li', null, l))) : null,
        );
      }));
    };
    const select = h('select', { class: 'search', on: { change: (ev: Event) => { filterTower = (ev.target as HTMLSelectElement).value; renderGrid(); } } },
      h('option', { attrs: { value: '' } }, 'All towers'), ...TOWERS.map((t) => h('option', { attrs: { value: t.id } }, t.name)));
    const search = h('input', { class: 'search', attrs: { placeholder: 'Search fusions...' }, on: { input: (ev: Event) => { q = (ev.target as HTMLInputElement).value.toLowerCase(); renderGrid(); } } });
    this.screen(
      h('div', { class: 'topbar' }, h('button', { class: 'btn grey', on: { click: () => this.title() } }, 'Back'), h('h1', null, 'Codex'), select, search),
      count,
      grid,
    );
    renderGrid();
  }

  settingsScreen(): void {
    const s = this.settings;
    const save = () => {
      saveSettings(s);
      this.audio.volume = s.volume;
      this.audio.enabled = s.sound;
    };
    const toggle = (label: string, key: 'sound' | 'shake' | 'damageNumbers' | 'autoStart' | 'showRanges' | 'unlockAll' | 'tutorialDone', invert = false) =>
      h('div', { class: 'setting' }, h('span', null, label),
        h('button', { class: `btn ${(invert ? !s[key] : s[key]) ? 'green' : 'grey'}`, on: { click: () => { s[key] = !s[key]; save(); this.settingsScreen(); } } }, (invert ? !s[key] : s[key]) ? 'On' : 'Off'));
    this.screen(
      h('div', { class: 'topbar', style: { width: 'min(520px, 94vw)' } }, h('button', { class: 'btn grey', on: { click: () => this.title() } }, 'Back'), h('h1', null, 'Settings')),
      h('div', { class: 'settings' },
        h('div', { class: 'setting' }, h('span', null, 'Volume'), h('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) }, on: { input: (e: Event) => { s.volume = Number((e.target as HTMLInputElement).value); save(); this.audio.play('pluck'); } } })),
        toggle('Sound', 'sound'),
        toggle('Screen shake', 'shake'),
        toggle('Gold / damage popups', 'damageNumbers'),
        toggle('Auto-start next wave', 'autoStart'),
        toggle('Always show tower ranges', 'showRanges'),
        h('div', { class: 'setting' }, h('span', null, 'Particles'), h('button', { class: 'btn grey', on: { click: () => { s.particles = s.particles === 'high' ? 'low' : 'high'; save(); this.settingsScreen(); } } }, s.particles === 'high' ? 'High' : 'Low')),
        toggle('Unlock all maps', 'unlockAll'),
        toggle('Tutorial hints', 'tutorialDone', true),
        h('div', { class: 'setting' }, h('span', null, `Forge: ${this.forge.online ? `online (${this.forge.model})` : 'offline (offline fusions only)'}`)),
      ),
    );
  }
}

const app = new App();
(window as unknown as { __app: App }).__app = app;
void clear;
