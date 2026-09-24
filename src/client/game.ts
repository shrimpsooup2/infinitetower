// A running game: fixed-step loop, input, and the in-game UI.

import { World, DT, type WorldSave } from '../sim/world.ts';
import type { Card, MapDef, PowerDef, TargetMode, Tower, TowerDef, DifficultyDef } from '../sim/types.ts';
import { TARGET_MODES } from '../sim/types.ts';
import { TOWERS, SOCKET_COST, SOCKET_ROLE } from '../content/towers.ts';
import { POWER_BY_ID, FAMILIES } from '../content/powers.ts';
import { ENEMY_BY_ID, DIMENSION_NAMES, dimensionOf } from '../content/enemies.ts';
import { TUTORIAL_MAP } from '../content/maps.ts';
import { RARITIES, rarityFactor } from '../content/rarity.ts';
import { PACKS, PACK_BY_ID, SCRAP_VALUE } from '../content/packs.ts';
import { packArt } from './render/pack-art.ts';
import type { PackInst } from '../sim/world.ts';
import { waveSummary } from '../content/waves.ts';
import { describeSpec } from '../effects/describe.ts';
import { conceptEl } from './ui/concept.ts';
import { fusionKey } from '../effects/keys.ts';
import { Renderer, type RenderOpts } from './render/renderer.ts';
import { towerIcon, TOWER_TINT } from './render/tower-art.ts';
import { enemyIcon } from './render/enemy-art.ts';
import { h, mount, clear, tone, fmtNum, fmtDate } from './ui/dom.ts';
import type { Audio } from './audio.ts';
import type { ForgeClient } from './forge.ts';
import { type Codex, type Settings, DexLog, saveRun, clearRun, recordRun, saveSettings } from './storage.ts';
import { colorsFor } from '../sim/world.ts';
import { Tutorial } from './tutorial.ts';


export interface GameDeps {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  audio: Audio;
  settings: Settings;
  codex: Codex;
  forge: ForgeClient;
  exit(to: 'title' | 'maps'): void;
  restart(): void;
  /** Set for the guided tutorial run; `done` marks it finished. */
  tutorial?: { done(): void };
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
  private hudKey = '';
  private rulesOpen = false;
  private tut: Tutorial | null = null;
  private modalPause = false;
  private packKey = '';
  private readonly dex = new DexLog();
  private listeners: [EventTarget, string, EventListener][] = [];

  constructor(d: GameDeps, map: MapDef, diff: DifficultyDef['id'], save: WorldSave | null) {
    this.d = d;
    this.map = map;
    this.diff = diff;
    this.w = d.tutorial
      ? new World({ map: TUTORIAL_MAP, difficulty: 'casual', seed: 7, specProvider: d.forge.provider, autoStart: false, packs: false, startGold: 250 })
      : new World({ map, difficulty: diff, seed: save?.seed, specProvider: d.forge.provider, autoStart: d.settings.autoStart });
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
    if (d.tutorial) {
      this.tut = new Tutorial({
        w: this.w, ui: d.ui,
        selected: () => this.selected,
        placing: () => this.placing !== null,
        modalOpen: () => this.modalPause || this.paused || this.ended,
        tileRect: (x, y) => {
          const c = this.r.cam;
          return new DOMRect(c.ox + (x - 0.5) * c.s, c.oy + (y - 0.5) * c.s, c.s, c.s);
        },
        release: () => { this.w.autoStart = d.settings.autoStart; },
        skip: () => { d.tutorial?.done(); d.exit('maps'); },
      });
    }
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
    this.dex.flush();
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
    if (!this.paused && !this.modalPause && !this.ended && !this.tut?.blocking) {
      this.acc += dt * this.speed;
      let steps = 0;
      const max = 10 * this.speed;
      while (this.acc >= DT && steps < max) {
        const wasWave = w.waveN;
        const hadActive = w.active.length;
        w.step();
        this.acc -= DT;
        steps++;
        for (const ev of w.fx) if (ev.k === 'death') this.dex.defeat(ev.e.def.id);
        this.r.consume(w, this.renderOpts());
        if (w.waveN !== wasWave) this.d.audio.play('wave', 1, 0.6);
        if (hadActive && !w.active.length && w.phase === 'running') {
          this.autosave();
          this.dex.flush();
        }
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
      for (const e of w.enemies) this.dex.see(e.def.id);
    }
    if ((w.phase === 'victory' || w.phase === 'defeat') && !this.ended) this.end();
  }

  private renderOpts(): RenderOpts {
    return {
      selected: this.selected, hoverTile: this.hoverTile, placing: this.placing, showRanges: this.d.settings.showRanges,
      damageNumbers: this.d.settings.damageNumbers, beacon: this.tut?.beacon ?? null,
    };
  }

  private autosave(): void {
    if (this.tut) return;
    if (this.w.phase === 'running' && this.w.quiescent()) saveRun(this.w.snapshot());
  }

  // ------------------------------------------------------------ layout & input

  private layout(): void {
    this.r.resize();
    const W = window.innerWidth, H = window.innerHeight;
    const right = W > 1100 ? 320 : 8;
    const left = W > 760 ? 124 : 78;
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
      // Modals have their own buttons; a pack must be picked from before it closes.
      if (this.modalPause) return;
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
      case 'l':
        if (t) this.levelUp(t);
        break;
      case 's':
        if (t) this.sell(t);
        break;
      case 't':
        if (t) this.w.setTargetMode(t.id, TARGET_MODES[(TARGET_MODES.indexOf(t.targetMode) + 1) % TARGET_MODES.length]);
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

  private levelUp(t: Tower): void {
    const err = this.w.levelUp(t.id);
    if (err) {
      this.toast(err, 'bad');
      this.d.audio.play('error');
    } else this.d.audio.play('upgrade', 1.25);
  }

  private sell(t: Tower): void {
    const now = performance.now();
    if (now - this.sellArm > 1500) {
      this.sellArm = now;
      this.toast(`Sell for ${this.w.sellValue(t)} gold? Press again to confirm`, 'info');
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
    this.el.banner = h('div', {});
    this.el.modal = h('div', {});
    this.el.tip = h('div', { class: 'panel hidden', style: { position: 'absolute', maxWidth: '280px', pointerEvents: 'none', zIndex: '5' } });
    ui.append(this.el.tl, this.el.tr, this.el.tc, this.el.build, this.el.packs, this.el.hand, this.el.wavebar, this.el.side, this.el.toasts, this.el.banner, this.el.modal, this.el.tip);

    // Top-right controls.
    const speedBtns = [1, 2, 3].map((s) => h('button', { class: 'btn grey', on: { click: () => { this.speed = s; } } }, `${s}x`));
    this.el.tr.append(
      ...speedBtns,
      h('button', { class: 'btn grey', on: { click: () => this.togglePause() } }, 'II'),
    );
    this.keys.speed = '';
    (this.el.tr as HTMLElement & { speedBtns?: HTMLElement[] }).speedBtns = speedBtns;

    // Build bar.
    TOWERS.forEach((t) => {
      const btn = h('div', { class: 'tbtn', style: tone(TOWER_TINT[t.id]), on: { click: () => this.startPlacing(t) } },
        h('span', { class: 'key' }, t.hotkey),
        towerIcon(t.id, 1, 44, undefined, 0, 1.1),
        h('div', { class: 'lbl' }, h('span', { class: 'nm' }, t.name), h('span', { class: 'cost' }, `${t.cost}`)),
      );
      btn.dataset.id = t.id;
      this.el.build.append(btn);
    });
  }

  private refresh(): void {
    const w = this.w;
    // Top-left stats.
    const dim = dimensionOf(Math.max(1, w.waveN || 1));
    const hud = `${w.lives}:${fmtNum(w.gold)}:${w.waveN}:${w.totalWaves}:${w.endless}`;
    if (hud !== this.hudKey) this.hudKey = hud, mount(this.el.tl,
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
    this.tut?.update();
  }

  // ------------------------------------------------------------ packs

  private refreshPacks(): void {
    const w = this.w;
    const key = `${w.packs.map((p) => p.uid).join(',')}:${w.offer?.uid}:${Math.floor(w.gold / 20)}:${w.waveN}`;
    if (key === this.packKey) return;
    this.packKey = key;
    // Stack identical packs (a Family Pack of a different family is a different pack).
    const counts = new Map<string, PackInst[]>();
    for (const p of w.packs) {
      const k = `${p.type}:${p.family ?? ''}`;
      counts.set(k, [...(counts.get(k) ?? []), p]);
    }
    const stacks = [...counts.values()].map((list) => {
      const def = PACK_BY_ID.get(list[0].type)!;
      return h('div', { class: 'packstack', title: packTitle(def.name, list[0].family), on: { click: () => { this.d.audio.unlock(); this.openPackModal(list[0]); } } },
        packArt(def, 44, 60, list[0].family),
        list.length > 1 ? h('span', { class: 'count' }, `x${list.length}`) : null,
      );
    });
    // A pack that was opened but not finished (e.g. after reloading) waits here.
    const o = w.offer;
    const open = o
      ? h('div', { class: 'packstack opened', title: packTitle(PACK_BY_ID.get(o.type)!.name, o.family), on: { click: () => this.openPackModal(null) } },
        packArt(PACK_BY_ID.get(o.type)!, 44, 60, o.family), h('span', { class: 'count' }, '!'))
      : null;
    mount(this.el.packs,
      open,
      ...stacks,
      h('button', { class: 'btn gold shopbtn', on: { click: () => this.openShop() } }, 'Shop'),
    );
  }

  /** Open a pack (or show the pending one when `pk` is null) and keep its cards. */
  private openPackModal(pk: PackInst | null): void {
    const w = this.w;
    const type = pk?.type ?? w.offer?.type;
    if (!type) return;
    const def = PACK_BY_ID.get(type)!;
    const family = pk ? pk.family : w.offer?.family;
    const title = packTitle(def.name, family);
    this.modalPause = true;
    const art = packArt(def, 150, 205, family);
    art.classList.add('packbig');
    const pick = (fresh: boolean) => {
      const o = w.offer;
      if (!o) return this.closeModal();
      const best = Math.max(...o.cards.map((c) => c.rarity));
      const subtitle = h('div', { class: 'subtitle' });
      const foot = h('div', { class: 'foot' });
      const done = () => {
        foot.replaceChildren(
          w.packs.length ? h('button', { class: 'btn blue', on: { click: () => this.openPackModal(w.packs[0]) } }, `Open next (${w.packs.length})`) : '',
          h('button', { class: 'btn green', on: { click: () => this.closeModal() } }, 'Done'),
        );
      };
      const status = () => {
        const left = w.offer?.keep ?? 0;
        subtitle.textContent = left > 1 ? `Keep ${left}` : left === 1 ? (o.keep < (def.keep ?? 1) ? 'Keep one more' : 'Keep one') : 'Kept';
        if (w.offer && w.offer.rerolls > 0) {
          foot.replaceChildren(h('button', { class: 'btn purple', on: { click: () => {
            if (typeof w.rerollPack() === 'string') return;
            this.d.audio.play('whoosh', 1.1);
            pick(true);
          } } }, `Reroll all (${w.offer.rerolls} free)`));
        } else if (w.offer) foot.replaceChildren();
      };
      const els = o.cards.map((c, i) => {
        const el = this.bigCard(c, fresh ? i : 0);
        el.classList.add('pickable');
        el.addEventListener('click', () => {
          if (!w.offer || !w.offer.cards.includes(c)) return;
          const gold = w.gold;
          const r = w.pickCard(c.uid);
          if (typeof r === 'string') return;
          this.d.audio.play('upgrade', 1.2 + c.rarity * 0.1);
          el.classList.add('chosen');
          if (w.offer) return status();
          for (const x of els) if (!x.classList.contains('chosen')) x.classList.add('gone');
          if (def.perk === 'salvage' && w.gold > gold) {
            subtitle.textContent = `Kept · the rest salvaged for ${w.gold - gold} gold`;
            this.d.audio.play('pluck', 1.4);
          } else subtitle.textContent = 'Kept';
          done();
        });
        return el;
      });
      mount(this.el.modal, h('div', { class: 'modal-bg' }, h('div', { class: `modal pack t${def.tier}` },
        h('h1', null, title),
        subtitle,
        h('div', { class: `draft ${fresh ? 'reveal' : ''} ${best >= 2 ? `burst b${best}` : ''}` }, ...els),
        def.perk === 'salvage' ? h('div', { class: 'small o', style: { textAlign: 'center', marginTop: '8px' } },
          `The rest scrap for ${o.cards.map((c) => SCRAP_VALUE[c.rarity]).join(' / ')} gold`) : null,
        foot,
      )));
      status();
    };
    if (!pk) return pick(false);
    const open = () => {
      const cards = w.openPack(pk.uid);
      if (typeof cards === 'string') return this.closeModal();
      this.d.audio.play('whoosh', 0.8);
      const best = Math.max(...cards.map((c) => c.rarity));
      setTimeout(() => this.d.audio.play(best >= 3 ? 'fanfare' : 'chime', 1 + best * 0.12), 300);
      pick(true);
    };
    mount(this.el.modal, h('div', { class: 'modal-bg', on: { click: (e: MouseEvent) => { if (e.target === e.currentTarget) this.closeModal(); } } }, h('div', { class: `modal pack t${def.tier}`, style: { textAlign: 'center' } },
      h('h1', null, title),
      h('div', { class: 'subtitle' }, def.blurb),
      h('div', { class: 'packwrap', on: { click: open } }, art),
      h('div', { class: 'foot' }, h('button', { class: 'btn gold big', on: { click: open } }, 'Open'), h('button', { class: 'btn grey', on: { click: () => this.closeModal() } }, 'Later')),
    )));
  }

  private bigCard(c: Card, i: number): HTMLElement {
    const p = POWER_BY_ID.get(c.power)!;
    const rar = RARITIES[c.rarity];
    const el = h('div', { class: `dcard r${c.rarity} flip`, style: { ...tone(p.color, rar.color), animationDelay: `${0.15 + i * 0.22}s` } },
      c.rarity >= 1 ? h('span', { class: 'foil' }) : null,
      c.rarity >= 1 ? h('span', { class: 'glare' }) : null,
      c.rarity >= 3 ? h('span', { class: 'sparkles' }) : null,
      h('div', { class: 'glyph' }, p.icon),
      h('div', { class: 'nm' }, p.name),
      h('div', { class: 'fam' }, FAMILIES[p.family]),
      h('div', { class: 'rarity' }, `${rar.name}${rar.mult > 1 ? ` · ×${rar.mult}` : ''}`),
      h('div', { class: 'desc' }, p.blurb),
    );
    // Rarer cards tilt toward the pointer, and their foil and glare follow it.
    if (c.rarity >= 1) {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--mx', `${Math.round(x * 100)}%`);
        el.style.setProperty('--my', `${Math.round(y * 100)}%`);
        el.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(1)}deg`);
        el.style.setProperty('--ry', `${((x - 0.5) * 16).toFixed(1)}deg`);
      });
      el.addEventListener('pointerleave', () => {
        for (const k of ['--mx', '--my', '--rx', '--ry']) el.style.removeProperty(k);
      });
    }
    return el;
  }

  private openShop(): void {
    this.modalPause = true;
    const render = () => {
      const w = this.w;
      mount(this.el.modal, h('div', { class: 'modal-bg', on: { click: (e: MouseEvent) => { if (e.target === e.currentTarget) this.closeModal(); } } }, h('div', { class: 'modal shop' },
        h('h1', null, 'Card Shop'),
        h('div', { class: 'subtitle' }, `${fmtNum(w.gold)} gold`),
        h('div', { class: 'draft' }, ...PACKS.filter((p) => p.price).map((def) => {
          const price = w.packPrice(def.id)!;
          const block = w.packBlocker(def.id);
          const locked = (def.minWave ?? 0) > w.waveN;
          const family = def.perk === 'family' ? w.shopFamily() : undefined;
          return h('div', { class: `shopitem ${locked ? 'locked' : ''}` },
            packArt(def, 108, 148, family),
            h('div', { class: 'fusion-name' }, packTitle(def.name, family)),
            h('div', { class: 'info-card', style: { textAlign: 'center' } }, def.blurb, family ? ` This wave: ${FAMILIES[family]}.` : ''),
            h('button', { class: 'btn gold', disabled: !!block, title: block ?? '', on: { click: () => {
              const r = w.buyPack(def.id);
              if (typeof r === 'string') { this.toast(r, 'bad'); this.d.audio.play('error'); return; }
              this.d.audio.play('pluck', 1.5);
              render();
            } } }, locked ? `From wave ${def.minWave}` : `Buy ${price}g`),
          );
        })),
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
      c.rarity >= 1 ? h('span', { class: 'foil' }) : null,
      c.rarity >= 3 ? h('span', { class: 'sparkles' }) : null,
      c.rarity > 0 ? h('span', { class: 'rar' }, rar.name) : null,
      h('span', { class: 'glyph' }, p.icon),
      h('span', { class: 'nm' }, p.name),
      this.socketPrice(c),
    );
    return el;
  }

  /** What this card would cost to socket into the selected tower's next slot. */
  private socketPrice(c: Card): HTMLElement | null {
    const t = this.selected;
    if (!t || t.tier < t.sockets.length + 1) return null;
    const cost = this.w.socketCost(t, c.rarity);
    if (cost === null) return null;
    return h('span', { class: `sockcost ${this.w.gold < cost ? 'poor' : ''}` }, `${cost}g`);
  }

  private showTip(anchor: HTMLElement, c: Card): void {
    const p = POWER_BY_ID.get(c.power)!;
    const rar = RARITIES[c.rarity];
    mount(this.el.tip,
      h('div', { class: 'fusion-name' }, p.name),
      h('div', { class: 'row' }, h('span', { class: 'badge', style: { background: rar.color } }, `${rar.name} ×${rar.mult}`), h('span', { class: 'badge' }, FAMILIES[p.family])),
      h('div', { class: 'info-card' }, p.blurb),
      h('div', { class: 'flavor' }, p.spec.flavor),
    );
    const r = anchor.getBoundingClientRect();
    this.el.tip.classList.remove('hidden');
    this.el.tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, r.left - 40))}px`;
    this.el.tip.style.top = `${r.top - 10 - this.el.tip.offsetHeight}px`;
  }

  private refreshHand(): void {
    const w = this.w;
    const key = `${w.cards.map((c) => c.uid).join(',')}:${this.armed}:${this.selected?.id}:${this.selected?.sockets.length}:${this.selected?.tier}:${this.selected?.level}:${Math.floor(w.gold / 10)}`;
    if (key === this.handKey) return;
    this.handKey = key;
    if (!w.cards.length) {
      clear(this.el.hand);
      return;
    }
    const sorted = [...w.cards].sort((a, b) => b.rarity - a.rarity || a.power.localeCompare(b.power));
    mount(this.el.hand, ...sorted.map((c) => this.cardEl(c, () => {
      this.d.audio.unlock();
      if (this.selected) this.socket(this.selected, c.uid);
      else {
        this.armed = this.armed === c.uid ? null : c.uid;
        this.placing = null;
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
    let label = w.phase === 'build' ? 'Ready' : cur ? `Wave ${w.waveN} · ${left} shapes left` : `Wave ${w.waveN} cleared`;
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
      ? `t${t.id}:${t.tier}:${t.level}:${w.waveN}:${t.specKey}:${t.specState}:${t.targetMode}:${Math.floor(w.gold / 5)}:${this.hoverCard?.uid}:${Math.floor(t.dmgTotal / 50)}:${t.kills}:${Math.round(t.stats.range * 10)}:${Math.round(t.stats.rate * 100)}:${this.d.forge.stages.get(t.specKey)}`
      : `p${this.placing?.id}:${this.d.codex.size}`;
    if (key === this.sideKey) return;
    this.sideKey = key;
    if (!t) {
      if (this.placing) mount(this.el.side, this.towerInfo(this.placing));
      else clear(this.el.side);
      return;
    }
    const rt = t.rt;
    const header = h('div', { class: 'row' },
      towerIcon(t.def.id, t.tier, 46, colorsFor(t.sockets), t.sockets.length),
      h('div', { class: 'col', style: { gap: '2px' } },
        h('h2', null, `${t.def.name} ${'★'.repeat(t.tier)}${'☆'.repeat(3 - t.tier)}`),
        h('span', { class: 'row' }, h('span', { class: 'badge lvbadge' }, `Level ${t.level}`), h('span', { class: 'small o' }, t.def.role))),
    );
    // Fusion / power info.
    const info: (HTMLElement | null)[] = [];
    if (!rt) {
      info.push(h('div', { class: 'info-card' }, t.def.blurb));
    } else {
      const lines = describeSpec(rt.spec, { potency: rt.potency, dmgBase: t.stats.damage });
      const title = t.sockets.length === 1 ? POWER_BY_ID.get(t.sockets[0])!.name : rt.spec.name;
      info.push(
        h('div', { class: 'fusion-name', style: { color: rt.colors.base } }, title),
        this.statusBadge(t) ?? h('span', { class: 'badge' }, 'Single power'),
        conceptEl(t.specSrc?.spec ?? rt.spec, { level: t.level, potency: rt.potency, dmgBase: t.stats.damage }),
        rt.spec.flavor ? h('div', { class: 'flavor' }, rt.spec.flavor) : null,
        this.rulesDetails(lines),
      );
      const rf = rarityFactor(t.cards.map((c) => c.rarity));
      if (rf > 1.001) info.push(h('div', { class: 'small o' }, `Card rarity bonus: ×${rf.toFixed(2)} effect strength`));
    }
    // Sockets.
    const sockets = h('div', { class: 'sockets' }, ...[0, 1, 2].map((i) => {
      const c = t.cards[i];
      const prices = RARITIES.map((_, r) => w.slotCost(t, i, r));
      const mults = prices.map((x) => x.cost / prices[0].cost);
      const fmtMult = (m: number) => `×${Math.round(m * 10) / 10}`;
      const tip = `${SOCKET_ROLE[i]} slot, now: ${RARITIES.map((r, k) => `${r.name} ${prices[k].cost}g (${fmtMult(mults[k])})`).join(' · ')}\n` +
        `Rarity ×${RARITIES.map((_, k) => Math.round(prices[k].rarity * 10) / 10).join(' / ')} · level ${t.level} ×${prices[0].level.toFixed(2)}–${prices[3].level.toFixed(2)} · wave ${w.waveN} ×${prices[0].wave.toFixed(2)}–${prices[3].wave.toFixed(2)}`;
      if (c) {
        const p = POWER_BY_ID.get(c.power)!;
        return h('div', { class: 'socket filled', title: tip, style: tone(p.color, RARITIES[c.rarity].color) },
          h('span', { class: 'role' }, SOCKET_ROLE[i]), h('span', { style: { fontSize: '16px' } }, p.icon), h('span', null, p.name),
          c.rarity > 0 ? h('span', { class: 'paid' }, `×${Math.round(prices[c.rarity].rarity * 10) / 10}`) : null);
      }
      const locked = t.tier < i + 1;
      return h('div', { class: `socket ${locked ? 'locked' : ''}`, title: tip },
        h('span', { class: 'role' }, SOCKET_ROLE[i]),
        h('span', null, locked ? `Tier ${i + 1}` : `${prices[0].cost}g`),
        h('span', { class: 'mults' }, ...[1, 2, 3].map((r) => h('span', { style: { color: RARITIES[r].color } }, fmtMult(mults[r])))),
      );
    }));
    // Preview of what a hovered card would make (only if YOU have made it before).
    let preview: HTMLElement | null = null;
    const hc = this.hoverCard;
    if (hc && t.sockets.length < 3) {
      const k = fusionKey(t.def.id, [...t.sockets, hc.power]);
      const known = t.sockets.length + 1 >= 2 ? this.d.codex.get(k) : null;
      const block = w.socketBlocker(t, hc.rarity);
      const price = w.socketCost(t, hc.rarity);
      const b = w.slotCost(t, t.sockets.length, hc.rarity);
      const x2 = (m: number) => `×${Math.round(m * 100) / 100}`;
      preview = h('div', { class: 'panel', style: { background: 'rgba(0,0,0,0.45)' } },
        h('h3', null, `+ ${POWER_BY_ID.get(hc.power)!.name} as ${SOCKET_ROLE[t.sockets.length]}${price !== null ? ` · ${price}g` : ''}`),
        price !== null ? h('div', { class: 'small o costline' },
          `${SOCKET_COST[t.sockets.length]}g ${x2(b.rarity)} ${RARITIES[hc.rarity].name.toLowerCase()} ${x2(b.level)} level ${x2(b.wave)} wave`) : null,
        block ? h('div', { class: 'small o', style: { color: '#ff8e8e' } }, block) : null,
        t.sockets.length === 0 ? h('div', { class: 'info-card' }, POWER_BY_ID.get(hc.power)!.blurb)
          : known ? h('div', { class: 'col' }, h('div', { class: 'fusion-name' }, known.name), conceptEl(known.spec, { level: t.level, potency: known.potency, dmgBase: t.stats.damage }, known.concept))
            : h('div', { class: 'info-card' }, '???'),
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
    const lvCost = w.levelCost(t);
    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn blue', disabled: upCost === null || w.gold < upCost, on: { click: () => this.upgrade(t) } }, upCost === null ? 'Max tier' : `Upgrade ${upCost}g [U]`),
      h('button', { class: 'btn green lvbtn', disabled: lvCost === null || w.gold < lvCost, on: { click: () => this.levelUp(t) } }, lvCost === null ? 'Max level' : `Level ${lvCost}g [L]`),
      h('button', { class: 'btn red', on: { click: () => this.sell(t) } }, `Sell ${w.sellValue(t)}g [S]`),
    );
    mount(this.el.side,
      h('div', { class: 'panel' }, header, ...info),
      h('div', { class: 'panel' }, h('h3', null, 'Sockets'), sockets),
      preview,
      h('div', { class: 'panel' }, stats, targets, actions),
    );
  }

  /** The exact rules, folded away under the short concept; stays open once opened. */
  private rulesDetails(lines: string[]): HTMLElement {
    const d = h('details', { class: 'rules-box', attrs: this.rulesOpen ? { open: '' } : {}, on: { toggle: () => { this.rulesOpen = d.open; } } },
      h('summary', null, 'Details'),
      h('ul', { class: 'rules' }, ...lines.map((l) => h('li', null, l))));
    return d;
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
    );
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
      )));
      return;
    }
    if (!this.ended) clear(this.el.modal);
  }

  private end(): void {
    this.ended = true;
    this.dex.flush();
    const w = this.w;
    const won = w.phase === 'victory';
    if (this.tut) {
      this.tut.destroy();
      if (won) this.d.tutorial?.done();
      this.d.audio.play(won ? 'fanfare' : 'boom', won ? 1 : 0.6);
      mount(this.el.modal, h('div', { class: 'modal-bg' }, h('div', { class: 'modal', style: { minWidth: '360px', textAlign: 'center' } },
        h('h1', { style: { color: won ? '#85e37d' : '#f14e54' } }, won ? 'Tutorial complete!' : 'Defeat'),
        h('div', { class: 'foot' },
          won ? h('button', { class: 'btn green big', on: { click: () => this.d.exit('maps') } }, 'Start the campaign')
            : h('button', { class: 'btn green', on: { click: () => this.d.restart() } }, 'Try again'),
          h('button', { class: 'btn grey', on: { click: () => this.d.exit('title') } }, 'Title'),
        ),
      )));
      return;
    }
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

/** "Family Pack: Tempo" for family packs, the plain name otherwise. */
function packTitle(name: string, family?: PowerDef['family']): string {
  return family ? `${name}: ${FAMILIES[family]}` : name;
}
