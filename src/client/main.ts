// App shell: screens (title, campaign, codex, settings) and game sessions.

import { Game } from './game.ts';
import { Audio } from './audio.ts';
import { ForgeClient } from './forge.ts';
import { Codex, loadSettings, saveSettings, loadProgress, loadRun, clearRun, type Settings } from './storage.ts';
import { h, mount, clear, tone } from './ui/dom.ts';
import { MAPS, MAP_BY_ID, ACTS, TUTORIAL_MAP } from '../content/maps.ts';
import { DIFFICULTIES } from '../content/rules.ts';
import { TOTAL_FUSIONS } from '../effects/keys.ts';
import { drawScenery, themeOf } from './render/scenery.ts';
import { CampaignMap, ROMAN, DIFF_COLOR } from './campaign.ts';
import { dexScreen } from './dex.ts';
import { Attract } from './attract.ts';
import { codexScreen } from './codex-screen.ts';
import type { DifficultyDef, MapDef } from '../sim/types.ts';

/** A small picture of a map in its theme, for the campaign screen. */
function mapPreview(m: MapDef, w: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const s = w / m.cols;
  const hgt = s * m.rows;
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  drawScenery(g, m, { s, ox: 0, oy: 0, W: w, H: hgt });
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
  private attract = new Attract(this.canvas, this.audio);
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
      h('div', { class: 'menu' },
        saved ? h('button', { class: 'btn gold', on: { click: () => this.resume() } }, `Continue: ${MAP_BY_ID.get(saved.save.map)?.name ?? '?'} · wave ${saved.save.waveN}`) : null,
        this.settings.tutorialDone ? null : h('button', { class: 'btn green', on: { click: () => this.tutorial() } }, 'Tutorial'),
        h('button', { class: 'btn blue', on: { click: () => this.maps() } }, 'Play'),
        h('button', { class: 'btn purple', on: { click: () => this.codexScreen() } }, 'Codex'),
        h('button', { class: 'btn red', on: { click: () => this.dexScreen() } }, 'Shape Dex'),
        this.settings.tutorialDone ? h('button', { class: 'btn grey', on: { click: () => this.tutorial() } }, 'Tutorial') : null,
        h('button', { class: 'btn grey', on: { click: () => this.settingsScreen() } }, 'Settings'),
      ),
      stat,
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
    if (!this.unlocked(MAP_BY_ID.get(this.selMap)!)) this.selMap = [...MAPS].reverse().find((m) => this.unlocked(m))?.id ?? MAPS[0].id;
    const card = h('div', { class: 'stagecard' });
    const begin = () => {
      if (loadRun() && !confirm('Starting a new run replaces your saved run. Continue?')) return;
      clearRun();
      this.start(this.selMap, this.selDiff);
    };
    const renderCard = () => {
      const m = MAP_BY_ID.get(this.selMap)!;
      const mp = p.maps[m.id];
      const wins = DIFFICULTIES.filter((d) => mp?.won[d.id]);
      mount(card,
        mapPreview(m, 200),
        h('div', { class: 'info' },
          h('div', { class: 'row' }, h('h2', null, m.name), h('span', { class: 'stars' }, '★'.repeat(m.difficulty) + '☆'.repeat(5 - m.difficulty))),
          h('div', { class: 'meta' }, `Act ${ROMAN[m.act - 1]} · ${ACTS[m.act - 1].name} · ${m.waves} waves · ${m.cols} × ${m.rows} · ${themeOf(m).name}`),
          h('div', { class: 'meta' }, mp?.best ? `Best: wave ${mp.best}` : 'Not played yet'),
          wins.length ? h('div', { class: 'chips' }, ...wins.map((d) => h('span', { class: 'chip', style: tone(DIFF_COLOR[d.id]) }, `Cleared on ${d.name}`))) : null,
        ),
        h('div', { class: 'go' },
          h('div', { class: 'diffs' }, ...DIFFICULTIES.map((d) => h('button', { class: `btn ${this.selDiff === d.id ? 'gold active' : 'grey'}`, title: `Enemy HP x${d.hp}, ${d.lives} lives, ${d.gold} starting gold`, on: { click: () => { this.selDiff = d.id; renderCard(); } } }, d.name))),
          h('button', { class: 'btn green big', on: { click: begin } }, 'Start'),
        ),
      );
    };
    const world = new CampaignMap({
      progress: p,
      unlocked: (m) => this.unlocked(m),
      selected: this.selMap,
      onSelect: (id) => { this.selMap = id; renderCard(); },
      onStart: begin,
    });
    const cleared = MAPS.filter((m) => Object.values(p.maps[m.id]?.won ?? {}).some(Boolean)).length;
    this.screen(
      h('div', { class: 'topbar' },
        h('button', { class: 'btn grey', on: { click: () => this.title() } }, 'Back'),
        h('h1', null, 'Campaign'),
        h('div', { class: 'stat-line' }, `${cleared} / ${MAPS.length} stages cleared`),
      ),
      world.el,
      card,
    );
    renderCard();
    world.mounted();
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

  tutorial(): void {
    this.attract.stop();
    this.stopGame();
    const done = () => { this.settings.tutorialDone = true; saveSettings(this.settings); };
    this.game = new Game({
      canvas: this.canvas, ui: this.ui, audio: this.audio, settings: this.settings, codex: this.codex, forge: this.forge,
      exit: (to) => (to === 'title' ? this.title() : this.maps()),
      restart: () => this.tutorial(),
      tutorial: { done },
    }, TUTORIAL_MAP, 'casual', null);
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

  dexScreen(): void {
    this.screen(
      h('div', { class: 'topbar' },
        h('button', { class: 'btn grey', on: { click: () => this.title() } }, 'Back'),
        h('h1', null, 'Shape Dex'),
      ),
      ...dexScreen(loadProgress(), this.settings.unlockAll),
    );
  }

  codexScreen(): void {
    const count = h('div', { class: 'stat-line' }, `${this.codex.size} fusions made by you`);
    void this.forge.globalStats().then((s) => {
      if (s && typeof s.discovered === 'number') count.textContent = `${this.codex.size} fusions made by you · ${s.discovered.toLocaleString()} of ${TOTAL_FUSIONS.toLocaleString()} discovered worldwide`;
    });
    const view = codexScreen(this.codex);
    this.screen(
      h('div', { class: 'topbar' }, h('button', { class: 'btn grey', on: { click: () => this.title() } }, 'Back'), h('h1', null, 'Codex'), view.search),
      count,
      view.body,
    );
  }

  settingsScreen(): void {
    const s = this.settings;
    const save = () => {
      saveSettings(s);
      this.audio.volume = s.volume;
      this.audio.enabled = s.sound;
    };
    const toggle = (label: string, key: 'sound' | 'shake' | 'damageNumbers' | 'autoStart' | 'showRanges' | 'unlockAll') =>
      h('div', { class: 'setting' }, h('span', null, label),
        h('button', { class: `btn ${s[key] ? 'green' : 'grey'}`, on: { click: () => { s[key] = !s[key]; save(); this.settingsScreen(); } } }, s[key] ? 'On' : 'Off'));
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
        h('div', { class: 'setting' }, h('span', null, `Forge: ${this.forge.online ? `online (${this.forge.model})` : 'offline (offline fusions only)'}`)),
      ),
    );
  }
}

const app = new App();
(window as unknown as { __app: App }).__app = app;
void clear;
