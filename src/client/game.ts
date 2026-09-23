// A running game: fixed-step loop, input, and the in-game UI.

import { World, DT, type WorldSave } from '../sim/world.ts';
import type { Card, MapDef, TargetMode, Tower, TowerDef, DifficultyDef } from '../sim/types.ts';
import { TARGET_MODES } from '../sim/types.ts';
import { TOWERS, SOCKET_COST, SOCKET_ROLE } from '../content/towers.ts';
import { POWER_BY_ID, FAMILIES } from '../content/powers.ts';
import { ENEMY_BY_ID, DIMENSION_NAMES, dimensionOf } from '../content/enemies.ts';
import { RARITIES, rarityFactor } from '../content/rarity.ts';
import { PACKS, PACK_BY_ID, SCRAP_VALUE } from '../content/packs.ts';
import { drawPackArt } from './render/pack-art.ts';
import type { PackInst } from '../sim/world.ts';
import { waveSummary } from '../content/waves.ts';
import { describeSpec } from '../effects/describe.ts';
import { fusionKey } from '../effects/keys.ts';
import { Renderer, type RenderOpts } from './render/renderer.ts';
import { towerIcon } from './render/tower-art.ts';
import { enemyIcon } from './render/enemy-art.ts';
import { h, mount, clear, tone, fmtNum, fmtDate } from './ui/dom.ts';
import type { Audio } from './audio.ts';
import type { ForgeClient } from './forge.ts';
import { type Codex, type Settings, saveRun, clearRun, recordRun, saveSettings } from './storage.ts';
import { colorsFor } from '../sim/world.ts';

const BUILD_COLORS = ['#8efffb', '#b4ff8e', '#ff8e8e', '#ffeb8e', '#8eb2ff', '#b58eff', '#ffb08e', '#8effc3', '#e08eff', '#ff8ec8'];

export interface GameDeps {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  audio: Audio;
  settings: Settings;
  codex: Codex;
  forge: ForgeClient;
  exit(to: 'title' | 'maps'): void;
  restart(): void;
}

export class Game {
  readonly w: World;
  readonly r: Renderer;
  private d: GameDeps;
  private map: MapDef;
  private diff: DifficultyDef['id'];
  private raf = 0;
  private last = 0;
  private acc = 0;
  speed = 1;
  paused = false;
  private selected: Tower | null = null;
  private placing: TowerDef | null = null;
  private armed: number | null = null; // card uid
  private hoverCard: Card | null = null;
  private hoverTile: [number, number] | null = null;
  private sellArm = 0;
  private uiTimer = 0;
  private keys: Record<string, string> = {};
  private ended = false;
  private runKeys = new Set<string>();
  private worldFirsts = 0;
  private el: Record<string, HTMLElement> = {};
  private handKey = '';
  private sideKey = '';
  private previewKey = '';
  private buildKey = '';
  private hintKey = '';
  private modalPause = false;
  private packKey = '';
  private listeners: [EventTarget, string, EventListener][] = [];

  constructor(d: GameDeps, map: MapDef, diff: DifficultyDef['id'], save: WorldSave | null) {
    this.d = d;
    this.map = map;
    this.diff = diff;
    this.w = new World({ map, difficulty: diff, seed: save?.seed, specProvider: d.forge.provider, autoStart: d.settings.autoStart });
    if (save) this.w.restore(save);
    d.forge.attach(this.w);
    this.r = new Renderer(d.canvas);
    this.r.fx.quality = d.settings.particles === 'low' ? 0.45 : 1;
    this.r.fx.shakeEnabled = d.settings.shake;
    this.r.onSound = (p, pitch, vol) => d.audio.play(p, pitch, vol);
    this.w.onMessage = (m, kind) => this.toast(m, kind);
    this.buildUI();
    this.layout();
    this.bindInput();
  }

  // ------------------------------------------------------------ lifecycle

  start(): void {
    this.last = performance.now();
    const frame = (t: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    for (const [t, e, f] of this.listeners) t.removeEventListener(e, f);
    this.listeners = [];
    clear(this.d.ui);
  }

  private on<K extends keyof WindowEventMap>(t: EventTarget, e: K | string, f: (ev: never) => void): void {
    t.addEventListener(e, f as EventListener);
    this.listeners.push([t, e, f as EventListener]);
  }

  private tick(dt: number): void {
    const w = this.w;
    if (!this.paused && !this.modalPause && !this.ended) {
      this.acc += dt * this.speed;
      let steps = 0;
      const max = 10 * this.speed;
      while (this.acc >= DT && steps < max) {
        const wasWave = w.waveN;
        const hadActive = w.active.length;
        w.step();
        this.acc -= DT;
        steps++;
        this.r.consume(w, this.renderOpts());
        if (w.waveN !== wasWave) this.d.audio.play('wave', 1, 0.6);
        if (hadActive && !w.active.length && w.phase === 'running') this.autosave();
      }
      if (steps >= max) this.acc = 0;
    } else {
      this.r.consume(w, this.renderOpts());
    }
    this.r.render(w, this.paused ? 0 : Math.min(1, this.acc / DT), this.paused ? 0 : dt, this.renderOpts());
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      this.refresh();
    }
    if ((w.phase === 'victory' || w.phase === 'defeat') && !this.ended) this.end();
  }

  private renderOpts(): RenderOpts {
    return {
      selected: this.selected, hoverTile: this.hoverTile, placing: this.placing, showRanges: this.d.settings.showRanges,
      damageNumbers: this.d.settings.damageNumbers,
    };
  }

  private autosave(): void {
    if (this.w.phase === 'running' && this.w.quiescent()) saveRun(this.w.snapshot());
  }

  // ------------------------------------------------------------ layout & input

  private layout(): void {
    this.r.resize();
    const W = window.innerWidth, H = window.innerHeight;
    const right = W > 1100 ? 320 : 8;
    const left = W > 760 ? 100 : 78;
    this.r.fit(this.w, { x: left, y: 48, w: W - left - right, h: H - 48 - (W > 760 ? 134 : 142) });
  }

  private bindInput(): void {
    const c = this.d.canvas;
    this.on(window, 'resize', () => this.layout());
    this.on(c, 'mousemove', (e: MouseEvent) => {
      this.hoverTile = this.r.screenToTile(e.clientX, e.clientY);
    });
    this.on(c, 'mouseleave', () => { this.hoverTile = null; });
    this.on(c, 'contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      this.cancel();
    });
    this.on(c, 'mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.d.audio.unlock();
      const [col, row] = this.r.screenToTile(e.clientX, e.clientY);
      this.clickTile(col, row, e.shiftKey);
    });
    this.on(window, 'keydown', (e: KeyboardEvent) => this.key(e));
    this.on(document, 'visibilitychange', () => {
      if (document.hidden && !this.paused && !this.ended) this.togglePause(true);
    });
  }

  private clickTile(c: number, r: number, keep: boolean): void {
    const w = this.w;
    const t = w.towerAt(c, r);
    if (this.placing) {
      if (t) {
        this.placing = null;
        this.select(t);
        return;
      }
      const res = w.place(this.placing.id, c, r);
      if (typeof res === 'string') {
        this.toast(res, 'bad');
        this.d.audio.play('error');
        return;
      }
      this.d.audio.play('place');
      if (!keep && w.gold < this.placing.cost) this.placing = null;
      else if (!keep) this.placing = null;
      this.select(res);
      return;
    }
    if (t) {
      if (this.armed !== null) {
        this.socket(t, this.armed);
        return;
      }
      this.select(t);
    } else {
      this.select(null);
    }
  }

  private key(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (this.placing || this.armed !== null || this.selected) this.cancel();
      else this.togglePause();
      return;
    }
    if (this.ended || this.modalPause) return;
    const def = TOWERS.find((t) => t.hotkey === k);
    if (def) {
      this.startPlacing(def);
      return;
    }
    const t = this.selected;
    switch (k) {
      case ' ':
        e.preventDefault();
        this.callWave();
        break;
      case 'u':
        if (t) this.upgrade(t);
        break;
      case 's':
        if (t) this.sell(t);
        break;
      case 't':
        if (t) this.w.setTargetMode(t.id, TARGET_MODES[(TARGET_MODES.indexOf(t.targetMode) + 1) % TARGET_MODES.length]);
        break;
      case 'backspace':
      case 'delete':
        if (t && t.sockets.length) this.unsocket(t);
        break;
      case 'f':
        this.speed = this.speed >= 3 ? 1 : this.speed + 1;
        break;
      case 'p':
        this.togglePause();
        break;
    }
  }

  private cancel(): void {
    if (this.placing) this.placing = null;
    else if (this.armed !== null) this.armed = null;
    else this.select(null);
  }

  private select(t: Tower | null): void {
    this.selected = t;
    this.sellArm = 0;
    if (t) this.d.audio.play('ui', 1.2, 0.5);
  }

  private startPlacing(def: TowerDef): void {
    this.placing = this.placing === def ? null : def;
    this.armed = null;
    this.d.audio.play('ui');
  }

  private callWave(): void {
    const err = this.w.callWave();
    if (err) this.toast(err, 'info');
  }

  private upgrade(t: Tower): void {
    const err = this.w.upgrade(t.id);
    if (err) {
      this.toast(err, 'bad');
      this.d.audio.play('error');
    } else this.d.audio.play('upgrade');
  }

  private sell(t: Tower): void {
    const now = performance.now();
    if (now - this.sellArm > 1500) {
      this.sellArm = now;
      this.toast(`Press S again to sell for ${this.w.sellValue(t)} gold${t.cards.length ? ' (cards return to your hand)' : ''}`, 'info');
      return;
    }
    this.w.sell(t.id);
    this.selected = null;
    this.d.audio.play('thud', 1.4);
  }

  private socket(t: Tower, uid: number): void {
    const err = this.w.socket(t.id, uid);
    if (err) {
      this.toast(err, 'bad');
      this.d.audio.play('error');
      return;
    }
    this.armed = null;
    this.selected = t;
    this.d.audio.play('upgrade', 1.3);
    if (t.sockets.length >= 2) this.runKeys.add(this.w.fusionKeyOf(t));
  }

  private unsocket(t: Tower): void {
    this.w.unsocket(t.id);
    this.d.audio.play('ui', 0.8);
  }

  private togglePause(force?: boolean): void {
    this.paused = force ?? !this.paused;
    this.renderModal();
  }

  // ------------------------------------------------------------ UI

  private buildUI(): void {
    const ui = this.d.ui;
    clear(ui);
    this.el.tl = h('div', { class: 'hud-tl' });
    this.el.tr = h('div', { class: 'hud-tr' });
    this.el.tc = h('div', { class: 'hud-tc' });
    this.el.build = h('div', { class: 'build' });
    this.el.hand = h('div', { class: 'hand' });
    this.el.packs = h('div', { class: 'packtray' });
    this.el.wavebar = h('div', { class: 'wavebar' });
    this.el.side = h('div', { class: 'side' });
    this.el.toasts = h('div', { class: 'toasts' });
    this.el.hint = h('div', { class: 'hint hidden' });
    this.el.banner = h('div', {});
    this.el.modal = h('div', {});
    this.el.tip = h('div', { class: 'panel hidden', style: { position: 'absolute', maxWidth: '280px', pointerEvents: 'none', zIndex: '5' } });
    ui.append(this.el.tl, this.el.tr, this.el.tc, this.el.build, this.el.packs, this.el.hand, this.el.wavebar, this.el.side, this.el.toasts, this.el.hint, this.el.banner, this.el.modal, this.el.tip);

    // Top-right controls.
    const speedBtns = [1, 2, 3].map((s) => h('button', { class: 'btn grey', on: { click: () => { this.speed = s; } } }, `${s}x`));
    this.el.tr.append(
      ...speedBtns,
      h('button', { class: 'btn grey', title: 'Pause (P / Esc)', on: { click: () => this.togglePause() } }, 'II'),
    );
    this.keys.speed = '';
    (this.el.tr as HTMLElement & { speedBtns?: HTMLElement[] }).speedBtns = speedBtns;

    // Build bar.
    TOWERS.forEach((t, i) => {
      const btn = h('div', { class: 'tbtn', style: tone(BUILD_COLORS[i]), title: `${t.name}: ${t.blurb} [${t.hotkey}]`, on: { click: () => this.startPlacing(t) } },
        h('span', { class: 'key' }, t.hotkey),
        towerIcon(t.id, 1, 50),
        h('div', null, t.name),
        h('div', { class: 'cost' }, `${t.cost}`),
      );
      btn.dataset.id = t.id;
      this.el.build.append(btn);
    });
  }

  private refresh(): void {
    const w = this.w;
    // Top-left stats.
    const dim = dimensionOf(Math.max(1, w.waveN || 1));
    mount(this.el.tl,
      h('div', { class: 'pill lives', title: 'Lives' }, h('span', { class: 'ico' }), String(w.lives)),
      h('div', { class: 'pill gold', title: 'Gold' }, h('span', { class: 'ico' }), fmtNum(w.gold)),
      h('div', { class: 'pill wave', title: 'Wave' }, h('span', { class: 'ico' }), `Wave ${w.waveN}/${w.totalWaves}${w.endless ? '+' : ''}`,
        h('span', { class: 'sub' }, DIMENSION_NAMES[dim])),
    );
    const sb = (this.el.tr as HTMLElement & { speedBtns?: HTMLElement[] }).speedBtns!;
    sb.forEach((b, i) => b.classList.toggle('active', this.speed === i + 1));

    this.refreshPreview();
    this.refreshBuild();
    this.refreshPacks();
    this.refreshHand();
    this.refreshWavebar();
    this.refreshSide();
    this.refreshHint();
  }

  // ------------------------------------------------------------ packs

  private refreshPacks(): void {
    const w = this.w;
    const key = `${w.packs.map((p) => p.uid).join(',')}:${Math.floor(w.gold / 20)}:${w.waveN}`;
    if (key === this.packKey) return;
    this.packKey = key;
    const counts = new Map<string, PackInst[]>();
    for (const p of w.packs) counts.set(p.type, [...(counts.get(p.type) ?? []), p]);
    const stacks = [...counts.entries()].map(([type, list]) => {
      const def = PACK_BY_ID.get(type as PackInst['type'])!;
      return h('div', { class: 'packstack', title: `${def.name}: ${def.blurb} Click to open.`, on: { click: () => { this.d.audio.unlock(); this.openPackModal(list[0]); } } },
        drawPackArt(def, 44, 60),
        list.length > 1 ? h('span', { class: 'count' }, `x${list.length}`) : null,
      );
    });
    mount(this.el.packs,
      ...stacks,
      h('button', { class: 'btn gold shopbtn', title: 'Buy card packs with gold', on: { click: () => this.openShop() } }, 'Shop'),
    );
  }

  private openPackModal(pk: PackInst): void {
    const def = PACK_BY_ID.get(pk.type)!;
    this.modalPause = true;
    const art = drawPackArt(def, 150, 205);
    art.classList.add('packbig');
    const open = () => {
      const cards = this.w.openPack(pk.uid);
      if (typeof cards === 'string') return this.closeModal();
      this.d.audio.play('whoosh', 0.8);
      const best = Math.max(...cards.map((c) => c.rarity));
      setTimeout(() => this.d.audio.play(best >= 3 ? 'fanfare' : 'chime', 1 + best * 0.12), 300);
      mount(this.el.modal, h('div', { class: 'modal-bg' }, h('div', { class: 'modal' },
        h('h1', null, def.name),
        h('div', { class: 'subtitle' }, 'These cards are now in your hand.'),
        h('div', { class: 'draft reveal' }, ...cards.map((c, i) => this.bigCard(c, i))),
        h('div', { class: 'foot' },
          this.w.packs.length ? h('button', { class: 'btn blue', on: { click: () => this.openPackModal(this.w.packs[0]) } }, `Open next (${this.w.packs.length})`) : null,
          h('button', { class: 'btn green', on: { click: () => this.closeModal() } }, 'Done'),
        ),
      )));
    };
    mount(this.el.modal, h('div', { class: 'modal-bg', on: { click: (e: MouseEvent) => { if (e.target === e.currentTarget) this.closeModal(); } } }, h('div', { class: 'modal', style: { textAlign: 'center' } },
      h('h1', null, def.name),
      h('div', { class: 'subtitle' }, def.blurb),
      h('div', { class: 'packwrap', on: { click: open } }, art),
      h('div', { class: 'foot' }, h('button', { class: 'btn gold big', on: { click: open } }, 'Open'), h('button', { class: 'btn grey', on: { click: () => this.closeModal() } }, 'Later')),
    )));
  }

  private bigCard(c: Card, i: number): HTMLElement {
    const p = POWER_BY_ID.get(c.power)!;
    const rar = RARITIES[c.rarity];
    return h('div', { class: `dcard r${c.rarity} flip`, style: { ...tone(p.color, rar.color), animationDelay: `${0.15 + i * 0.22}s` } },
      h('div', { class: 'glyph' }, p.icon),
      h('div', { class: 'nm' }, p.name),
      h('div', { class: 'fam' }, FAMILIES[p.family]),
      h('div', { class: 'rarity' }, `${rar.name}${rar.mult > 1 ? ` · ×${rar.mult}` : ''}`),
      h('div', { class: 'desc' }, p.blurb),
    );
  }

  private openShop(): void {
    this.modalPause = true;
    const render = () => {
      const w = this.w;
      mount(this.el.modal, h('div', { class: 'modal-bg', on: { click: (e: MouseEvent) => { if (e.target === e.currentTarget) this.closeModal(); } } }, h('div', { class: 'modal' },
        h('h1', null, 'Card Shop'),
        h('div', { class: 'subtitle' }, `You have ${fmtNum(w.gold)} gold. Packs get pricier as the waves climb, and so do the odds.`),
        h('div', { class: 'draft' }, ...PACKS.filter((p) => p.price).map((def) => {
          const price = w.packPrice(def.id)!;
          return h('div', { class: 'col', style: { alignItems: 'center', width: '200px' } },
            drawPackArt(def, 120, 164),
            h('div', { class: 'fusion-name' }, def.name),
            h('div', { class: 'info-card', style: { textAlign: 'center' } }, def.blurb),
            h('button', { class: 'btn gold', disabled: w.gold < price, on: { click: () => {
              const r = w.buyPack(def.id);
              if (typeof r === 'string') { this.toast(r, 'bad'); this.d.audio.play('error'); return; }
              this.d.audio.play('pluck', 1.5);
              render();
            } } }, `Buy ${price}g`),
          );
        })),
        h('div', { class: 'subtitle', style: { marginTop: '12px' } }, `Tip: right-click a card in your hand to scrap it (${SCRAP_VALUE.join(' / ')} gold by rarity).`),
        h('div', { class: 'foot' }, h('button', { class: 'btn green', on: { click: () => this.closeModal() } }, 'Close')),
      )));
    };
    render();
  }

  private closeModal(): void {
    this.modalPause = false;
    this.packKey = '';
    this.handKey = '';
    this.renderModal();
  }

  private refreshPreview(): void {
    const w = this.w;
    const n = w.waveN + 1;
    const key = `${n}:${w.totalWaves}:${w.endless}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    if (n > w.totalWaves && !w.endless) {
      clear(this.el.tc);
      return;
    }
    const wave = w.getWave(n);
    const items = waveSummary(wave).map((s) => {
      const def = ENEMY_BY_ID.get(s.enemy)!;
      const boss = def.traits.includes('boss');
      return h('span', { class: 'unit', title: `${def.name}${s.mods.length ? ` (${s.mods.join(', ')})` : ''}: ${def.blurb}` },
        enemyIcon(def, boss ? 26 : 20),
        boss ? h('span', { class: 'boss' }, def.name) : `${s.count}`,
        ...s.mods.map((m) => h('span', { class: 'mod' }, m)),
      );
    });
    mount(this.el.tc, h('div', { class: 'preview' }, h('span', null, `Next · ${n}`), ...items,
      wave.mutators.length ? h('span', { class: 'mod' }, wave.mutators.join(' ')) : null));
  }

  private refreshBuild(): void {
    const key = `${this.placing?.id}:${Math.floor(this.w.gold / 10)}`;
    if (key === this.buildKey) return;
    this.buildKey = key;
    for (const el of Array.from(this.el.build.children) as HTMLElement[]) {
      const def = TOWERS.find((t) => t.id === el.dataset.id)!;
      el.classList.toggle('sel', this.placing === def);
      el.classList.toggle('poor', this.w.gold < def.cost);
    }
  }

  private cardEl(c: Card, onClick: () => void, extra = ''): HTMLElement {
    const p = POWER_BY_ID.get(c.power)!;
    const rar = RARITIES[c.rarity];
    const el = h('div', {
      class: `card r${c.rarity} ${extra}`,
      style: tone(p.color, rar.color),
      on: {
        click: onClick,
        mouseenter: (e: MouseEvent) => { this.hoverCard = c; this.showTip(e.currentTarget as HTMLElement, c); this.sideKey = ''; },
        mouseleave: () => { this.hoverCard = null; this.el.tip.classList.add('hidden'); this.sideKey = ''; },
        contextmenu: (e: MouseEvent) => {
          e.preventDefault();
          const g = this.w.scrapCard(c.uid);
          if (typeof g === 'number') {
            this.toast(`Scrapped ${p.name} for ${g} gold`, 'info');
            this.d.audio.play('pluck', 0.7);
            this.hoverCard = null;
            this.el.tip.classList.add('hidden');
          }
        },
      },
    },
      c.rarity > 0 ? h('span', { class: 'rar' }, rar.name) : null,
      h('span', { class: 'glyph' }, p.icon),
      h('span', { class: 'nm' }, p.name),
    );
    return el;
  }

  private showTip(anchor: HTMLElement, c: Card): void {
    const p = POWER_BY_ID.get(c.power)!;
    const rar = RARITIES[c.rarity];
    mount(this.el.tip,
      h('div', { class: 'fusion-name' }, p.name),
      h('div', { class: 'row' }, h('span', { class: 'badge', style: { background: rar.color } }, `${rar.name} ×${rar.mult}`), h('span', { class: 'badge' }, FAMILIES[p.family])),
      h('div', { class: 'info-card' }, p.blurb),
      h('div', { class: 'flavor' }, p.spec.flavor),
      h('div', { class: 'small o muted' }, `Click: socket into the selected tower · Right-click: scrap for ${SCRAP_VALUE[c.rarity]} gold`),
    );
    const r = anchor.getBoundingClientRect();
    this.el.tip.classList.remove('hidden');
    this.el.tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, r.left - 40))}px`;
    this.el.tip.style.top = `${r.top - 10 - this.el.tip.offsetHeight}px`;
  }

  private refreshHand(): void {
    const w = this.w;
    const key = `${w.cards.map((c) => c.uid).join(',')}:${this.armed}:${this.selected?.id}`;
    if (key === this.handKey) return;
    this.handKey = key;
    if (!w.cards.length) {
      mount(this.el.hand, h('div', { class: 'empty' }, 'Open card packs (left) to get power cards. Select a tower, then click a card to socket it.'));
      return;
    }
    const sorted = [...w.cards].sort((a, b) => b.rarity - a.rarity || a.power.localeCompare(b.power));
    mount(this.el.hand, ...sorted.map((c) => this.cardEl(c, () => {
      this.d.audio.unlock();
      if (this.selected) this.socket(this.selected, c.uid);
      else {
        this.armed = this.armed === c.uid ? null : c.uid;
        this.placing = null;
        if (this.armed !== null) this.toast('Now click a tower to socket this card', 'info');
      }
    }, this.armed === c.uid ? 'armed' : '')));
  }

  private refreshWavebar(): void {
    const w = this.w;
    const cur = w.active.find((a) => a.def.n === w.waveN);
    let total = 0, spawned = 0;
    if (cur) {
      cur.def.groups.forEach((g, i) => { total += g.count; spawned += cur.groups[i].spawned; });
    }
    const alive = cur ? cur.alive : 0;
    const left = cur ? total - spawned + alive : 0;
    const frac = cur && total ? 1 - left / Math.max(1, total) : w.waveN ? 1 : 0;
    let label = w.phase === 'build' ? 'Build your defence, then send the first wave' : cur ? `Wave ${w.waveN} · ${left} shapes left` : `Wave ${w.waveN} cleared`;
    if (w.enemies.length && !cur) label = `${w.enemies.length} shapes on the field`;
    let btnText = '';
    let enabled = true;
    if (w.phase === 'build') btnText = 'Start wave 1  [Space]';
    else if (w.countdown !== null) {
      const bonus = Math.round(w.countdown * 1.2 * (1 + 0.1 * w.waveN));
      btnText = w.countdown > 0 ? `Next wave in ${Math.ceil(w.countdown)}s  (+${bonus}g)` : `Send wave ${w.waveN + 1}  [Space]`;
    } else if (w.phase === 'running') {
      btnText = `Wave ${w.waveN} arriving...`;
      enabled = false;
    } else btnText = '—';
    if (!this.el.wavebar.firstChild) {
      const fill = h('div', { class: 'fill' });
      const lab = h('div', { class: 'label' });
      const btn = h('button', { class: 'btn green callbtn', on: { click: () => this.callWave() } });
      this.el.wavebar.append(h('div', { class: 'bar' }, fill, lab), btn);
      Object.assign(this.el, { wfill: fill, wlabel: lab, wbtn: btn });
    }
    this.el.wfill.style.width = `${Math.round(frac * 100)}%`;
    this.el.wlabel.textContent = label;
    this.el.wbtn.textContent = btnText;
    (this.el.wbtn as HTMLButtonElement).disabled = !enabled;
  }

  private statusBadge(t: Tower): HTMLElement | null {
    if (t.sockets.length < 2) return null;
    const e = this.d.codex.get(t.specKey);
    switch (t.specState) {
      case 'forging': {
        const st = this.d.forge.stages.get(t.specKey) ?? 'queued';
        const label = { queued: 'Queued', waiting_parent: 'Forging its parent pair', designing: 'The Forge is designing', repairing: 'Refining the design', balancing: 'Balancing in simulation' }[st] ?? 'Forging';
        return h('span', { class: 'badge purple' }, `${label}...`);
      }
      case 'ready':
        return h('span', { class: 'row' },
          h('span', { class: 'badge gold' }, e?.discoveryNo ? `Fusion #${e.discoveryNo.toLocaleString()}` : 'Fusion'),
          e?.worldFirst ? h('span', { class: 'badge red' }, 'WORLD FIRST') : null,
          e?.discoveredAt ? h('span', { class: 'badge' }, `first forged ${fmtDate(e.discoveredAt)}`) : null);
      case 'provisional':
        return h('span', { class: 'badge grey' }, 'Provisional (the forge will retry)');
      case 'offline':
        return h('span', { class: 'badge grey' }, 'Offline fusion');
      default:
        return null;
    }
  }

  private refreshSide(): void {
    const t = this.selected && this.w.towerById.has(this.selected.id) ? this.selected : null;
    if (!t && this.selected) this.selected = null;
    const w = this.w;
    const key = t
      ? `t${t.id}:${t.tier}:${t.specKey}:${t.specState}:${t.targetMode}:${Math.floor(w.gold / 5)}:${this.hoverCard?.uid}:${Math.floor(t.dmgTotal / 50)}:${t.kills}:${Math.round(t.stats.range * 10)}:${Math.round(t.stats.rate * 100)}:${this.d.forge.stages.get(t.specKey)}`
      : `p${this.placing?.id}:${this.d.codex.size}`;
    if (key === this.sideKey) return;
    this.sideKey = key;
    if (!t) {
      mount(this.el.side, this.placing ? this.towerInfo(this.placing) : this.helpPanel());
      return;
    }
    const rt = t.rt;
    const header = h('div', { class: 'row' },
      towerIcon(t.def.id, t.tier, 46, colorsFor(t.sockets), t.sockets.length),
      h('div', { class: 'col', style: { gap: '2px' } },
        h('h2', null, `${t.def.name} ${'★'.repeat(t.tier)}${'☆'.repeat(3 - t.tier)}`),
        h('span', { class: 'small o' }, t.def.role)),
    );
    // Fusion / power info.
    const info: (HTMLElement | null)[] = [];
    if (!rt) {
      info.push(h('div', { class: 'info-card' }, t.def.blurb), h('div', { class: 'info-card muted' }, 'No powers socketed. Select a power card below to give this tower a new behaviour.'));
    } else {
      const lines = describeSpec(rt.spec, { potency: rt.potency, dmgBase: t.stats.damage });
      const title = t.sockets.length === 1 ? POWER_BY_ID.get(t.sockets[0])!.name : rt.spec.name;
      info.push(
        h('div', { class: 'fusion-name', style: { color: rt.colors.base } }, title),
        this.statusBadge(t) ?? h('span', { class: 'badge' }, 'Single power'),
        h('div', { class: 'flavor' }, rt.spec.flavor),
        t.sockets.length > 1 ? h('div', { class: 'info-card muted' }, rt.spec.concept) : null,
        h('ul', { class: 'rules' }, ...lines.map((l) => h('li', null, l))),
      );
      const rf = rarityFactor(t.cards.map((c) => c.rarity));
      if (rf > 1.001) info.push(h('div', { class: 'small o' }, `Card rarity bonus: ×${rf.toFixed(2)} effect strength`));
    }
    // Sockets.
    const sockets = h('div', { class: 'sockets' }, ...[0, 1, 2].map((i) => {
      const c = t.cards[i];
      if (c) {
        const p = POWER_BY_ID.get(c.power)!;
        const last = i === t.cards.length - 1;
        return h('div', { class: 'socket filled', style: tone(p.color, RARITIES[c.rarity].color), title: last ? 'Click to remove (the card returns to your hand)' : p.blurb, on: { click: () => { if (last) this.unsocket(t); } } },
          h('span', { class: 'role' }, SOCKET_ROLE[i]), h('span', { style: { fontSize: '16px' } }, p.icon), h('span', null, p.name),
          last ? h('span', { class: 'role' }, 'click to remove') : null);
      }
      const locked = t.tier < i + 1;
      const next = i === t.cards.length;
      return h('div', { class: `socket ${locked ? 'locked' : ''}` },
        h('span', { class: 'role' }, SOCKET_ROLE[i]),
        locked ? h('span', null, `Tier ${i + 1}`) : next ? h('span', null, `${SOCKET_COST[i]}g`) : h('span', null, '—'),
      );
    }));
    // Preview of what a hovered card would make (only if YOU have made it before).
    let preview: HTMLElement | null = null;
    const hc = this.hoverCard;
    if (hc && t.sockets.length < 3) {
      const k = fusionKey(t.def.id, [...t.sockets, hc.power]);
      const known = t.sockets.length + 1 >= 2 ? this.d.codex.get(k) : null;
      const block = w.socketBlocker(t);
      preview = h('div', { class: 'panel', style: { background: 'rgba(0,0,0,0.45)' } },
        h('h3', null, `+ ${POWER_BY_ID.get(hc.power)!.name} as ${SOCKET_ROLE[t.sockets.length]}`),
        block ? h('div', { class: 'small o', style: { color: '#ff8e8e' } }, block) : null,
        t.sockets.length === 0 ? h('div', { class: 'info-card' }, POWER_BY_ID.get(hc.power)!.blurb)
          : known ? h('div', { class: 'col' }, h('div', { class: 'fusion-name' }, known.name), h('div', { class: 'flavor' }, known.flavor), h('div', { class: 'info-card' }, known.concept))
            : h('div', { class: 'info-card' }, '??? An undiscovered fusion. Socket it to forge something new. If nobody has made it before, it becomes a world first.'),
      );
    }
    const s = t.stats;
    const dps = t.def.chassis === 'aura' ? 0 : s.damage * s.rate * (t.def.chassis === 'beam' ? 2 : 1);
    const stats = h('div', { class: 'statgrid' },
      h('span', null, 'Damage'), h('span', null, fmtNum(s.damage)),
      h('span', null, t.def.chassis === 'aura' ? 'Aura' : 'Attacks/s'), h('span', null, t.def.chassis === 'aura' ? `+${Math.round(s.auraRate * 100)}% speed` : s.rate.toFixed(2)),
      h('span', null, 'Range'), h('span', null, s.range.toFixed(1)),
      h('span', null, 'Base DPS'), h('span', null, dps ? fmtNum(dps) : '—'),
      h('span', null, 'This wave'), h('span', null, fmtNum(t.dmgWave)),
      h('span', null, 'Total / kills'), h('span', null, `${fmtNum(t.dmgTotal)} / ${t.kills}`),
    );
    const targets = t.def.chassis === 'aura' || t.def.chassis === 'drones' ? null : h('div', { class: 'targets' },
      ...TARGET_MODES.map((m: TargetMode) => h('button', { class: `btn grey ${t.targetMode === m ? 'active' : ''}`, on: { click: () => { this.w.setTargetMode(t.id, m); this.sideKey = ''; } } }, m)));
    const upCost = w.upgradeCost(t);
    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn blue', disabled: upCost === null || w.gold < upCost, on: { click: () => this.upgrade(t) } }, upCost === null ? 'Max tier' : `Upgrade ${upCost}g [U]`),
      h('button', { class: 'btn red', on: { click: () => this.sell(t) } }, `Sell ${w.sellValue(t)}g [S]`),
    );
    mount(this.el.side,
      h('div', { class: 'panel' }, header, ...info),
      h('div', { class: 'panel' }, h('h3', null, 'Sockets'), sockets, h('div', { class: 'small o muted' }, 'Order matters: the base power leads, the tertiary adds a twist.')),
      preview,
      h('div', { class: 'panel' }, stats, targets, actions),
    );
  }

  private towerInfo(def: TowerDef): HTMLElement {
    const row = (label: string, v: [number, number, number] | undefined, f = (x: number) => String(x)) =>
      v ? [h('span', null, label), h('span', null, v.map(f).join(' / '))] : [];
    return h('div', { class: 'panel' },
      h('div', { class: 'row' }, towerIcon(def.id, 3, 52), h('div', { class: 'col', style: { gap: '2px' } }, h('h2', null, def.name), h('span', { class: 'small o' }, def.role))),
      h('div', { class: 'info-card' }, def.blurb),
      h('div', { class: 'statgrid' },
        ...row('Damage', def.chassis === 'aura' ? undefined : def.damage),
        ...row('Attacks/s', def.chassis === 'aura' ? undefined : def.rate),
        ...row('Range', def.range),
        h('span', null, 'Cost'), h('span', null, `${def.cost} → +${def.upgradeCost[0]} → +${def.upgradeCost[1]}`),
        h('span', null, 'Hits flyers'), h('span', null, def.hitsAir ? 'yes' : 'no'),
      ),
      h('div', { class: 'small o muted' }, 'Click an empty tile to build. Shift+click to keep building. Right-click / Esc to cancel.'),
    );
  }

  private helpPanel(): HTMLElement {
    return h('div', { class: 'panel info-card' },
      h('h3', null, 'How to play'),
      h('div', null, 'Build towers from the left (keys 1-0). Shapes walk the road toward your blue base; each one that escapes costs lives.'),
      h('div', null, 'Every 3 waves (and after each boss) you earn a card pack; you can also buy packs in the Shop. Select a tower and click a card to socket it. Upgrading a tower opens more sockets.'),
      h('div', null, 'Two or three powers in a tower FUSE into a brand-new ability designed by the Forge AI. The first player to make a combination gets a world first, and the fusion is shared with everyone after that.'),
      h('div', { class: 'small muted' }, 'Space: send wave · U: upgrade · S: sell · T: targeting · F: speed · Backspace: remove last card · Esc: cancel / pause'),
      h('div', { class: 'small muted' }, `Your codex: ${this.d.codex.size} fusions · Forge: ${this.d.forge.online ? `online (${this.d.forge.model})` : 'offline, using offline fusions'}`),
    );
  }

  private refreshHint(): void {
    if (this.d.settings.tutorialDone) {
      this.el.hint.classList.add('hidden');
      return;
    }
    const w = this.w;
    let hint = '';
    if (w.packs.length && !w.cards.length && !w.towers.some((t) => t.sockets.length)) hint = 'Open your Starter Pack (bottom left) to get your first power cards. Rarer cards (blue, purple, gold) are stronger.';
    else if (!w.towers.length) hint = 'Build a tower: pick one on the left (or press 1) and click an empty grey tile next to the road.';
    else if (w.waveN === 0) hint = 'Press Space (or the green button) to send the first wave of shapes.';
    else if (w.cards.length && !w.towers.some((t) => t.sockets.length)) hint = 'Select a tower, then click a power card at the bottom to socket it.';
    else if (!w.towers.some((t) => t.tier >= 2) && w.towers.some((t) => t.sockets.length)) hint = 'Upgrade a tower (U) to open its second socket. Two powers in one tower fuse into a brand-new AI-forged ability.';
    else if (w.towers.some((t) => t.sockets.length >= 2)) {
      this.d.settings.tutorialDone = true;
      saveSettings(this.d.settings);
    }
    if (hint === this.hintKey) return;
    this.hintKey = hint;
    this.el.hint.classList.toggle('hidden', !hint);
    this.el.hint.textContent = hint;
  }

  // ------------------------------------------------------------ modals & messages

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.el.toasts.append(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild!.remove();
    setTimeout(() => t.remove(), 3000);
  }

  banner(big: string, sub: string, color = '#ffffff'): void {
    const b = h('div', { class: 'banner' }, h('div', { class: 'big', style: { color } }, big), h('div', { class: 'sub' }, sub));
    mount(this.el.banner, b);
    setTimeout(() => { if (b.parentNode) b.remove(); }, 4600);
  }

  /** Called by the app when the forge delivers a fusion. */
  onForged(name: string, no: number | null, date: number | null, worldFirst: boolean, key: string): void {
    this.sideKey = '';
    if (!this.runKeys.has(key)) return;
    if (worldFirst) {
      this.worldFirsts++;
      this.d.audio.play('fanfare');
      this.banner('WORLD FIRST!', `You discovered ${name}${no ? ` · Fusion #${no.toLocaleString()}` : ''}`, '#ffd166');
    } else {
      this.d.audio.play('chime', 1.2);
      this.banner(name, `${no ? `Fusion #${no.toLocaleString()}` : 'Fusion forged'}${date ? ` · first forged ${fmtDate(date)}` : ''}`, '#8efffb');
    }
  }

  private renderModal(): void {
    const w = this.w;
    if (this.paused && !this.ended) {
      mount(this.el.modal, h('div', { class: 'modal-bg' }, h('div', { class: 'modal', style: { minWidth: '320px' } },
        h('h1', null, 'Paused'),
        h('div', { class: 'subtitle' }, `${this.map.name} · ${w.diff.name} · wave ${w.waveN}/${w.totalWaves}`),
        h('div', { class: 'menu', style: { margin: '0 auto' } },
          h('button', { class: 'btn green', on: { click: () => this.togglePause(false) } }, 'Resume'),
          h('button', { class: `btn ${this.d.settings.showRanges ? 'blue' : 'grey'}`, on: { click: () => { this.d.settings.showRanges = !this.d.settings.showRanges; saveSettings(this.d.settings); this.renderModal(); } } }, `Show all ranges: ${this.d.settings.showRanges ? 'on' : 'off'}`),
          h('button', { class: `btn ${this.d.audio.enabled ? 'blue' : 'grey'}`, on: { click: () => { this.d.audio.enabled = !this.d.audio.enabled; this.d.settings.sound = this.d.audio.enabled; saveSettings(this.d.settings); this.renderModal(); } } }, `Sound: ${this.d.audio.enabled ? 'on' : 'off'}`),
          h('button', { class: 'btn gold', on: { click: () => { if (confirm('Restart this map? Your current run will be lost.')) { clearRun(); this.d.restart(); } } } }, 'Restart'),
          h('button', { class: 'btn red', on: { click: () => { this.autosave(); this.d.exit('maps'); } } }, 'Quit to map select'),
        ),
        h('div', { class: 'subtitle', style: { marginTop: '10px' } }, 'Your run is saved between waves.'),
      )));
      return;
    }
    if (!this.ended) clear(this.el.modal);
  }

  private end(): void {
    this.ended = true;
    const w = this.w;
    const won = w.phase === 'victory';
    clearRun();
    recordRun(this.map.id, this.diff, won ? w.totalWaves : Math.max(0, w.waveN - 1), won);
    this.d.audio.play(won ? 'fanfare' : 'boom', won ? 1 : 0.6);
    const best = [...w.towers].sort((a, b) => b.dmgTotal - a.dmgTotal)[0];
    const bestName = best ? (best.sockets.length > 1 && best.rt ? best.rt.spec.name : best.def.name) : '—';
    mount(this.el.modal, h('div', { class: 'modal-bg' }, h('div', { class: 'modal', style: { minWidth: '360px' } },
      h('h1', { style: { color: won ? '#85e37d' : '#f14e54' } }, won ? 'Victory!' : 'Defeat'),
      h('div', { class: 'subtitle' }, `${this.map.name} · ${w.diff.name}`),
      h('div', { class: 'endstats' },
        h('span', null, 'Waves survived'), h('span', null, `${won ? w.totalWaves : Math.max(0, w.waveN - 1)} / ${w.totalWaves}`),
        h('span', null, 'Shapes destroyed'), h('span', null, w.stats.kills.toLocaleString()),
        h('span', null, 'Damage dealt'), h('span', null, fmtNum(w.stats.damage)),
        h('span', null, 'Fusions made'), h('span', null, String(this.runKeys.size)),
        h('span', null, 'World firsts'), h('span', null, String(this.worldFirsts)),
        h('span', null, 'Top tower'), h('span', null, bestName),
      ),
      h('div', { class: 'foot' },
        won ? h('button', { class: 'btn purple', on: { click: () => { this.ended = false; w.continueEndless(); clear(this.el.modal); } } }, 'Keep going (endless)') : null,
        h('button', { class: 'btn green', on: { click: () => this.d.restart() } }, 'Play again'),
        h('button', { class: 'btn blue', on: { click: () => this.d.exit('maps') } }, 'Map select'),
      ),
    )));
  }
}
