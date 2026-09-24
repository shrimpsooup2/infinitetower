// The guided tutorial: the one place the game explains itself. It runs on its
// own short map, points at the UI (or a tile) for each step, and waits for the
// player to actually do the thing before moving on.

import type { World } from '../sim/world.ts';
import type { Tower } from '../sim/types.ts';
import { POWER_BY_ID } from '../content/powers.ts';
import { h, mount } from './ui/dom.ts';

export interface TutorialHost {
  w: World;
  ui: HTMLElement;
  selected(): Tower | null;
  placing(): boolean;
  modalOpen(): boolean;
  /** Screen rectangle of a point given in tile units. */
  tileRect(x: number, y: number): DOMRect;
  /** Hand wave control back to the player's own settings. */
  release(): void;
  skip(): void;
}

/** A UI selector, or a point on the map in tile units. */
type Anchor = string | [number, number] | null;
type Side = 'right' | 'left' | 'above' | 'below';

interface Step {
  text: (t: Tutorial) => string;
  anchor?: (t: Tutorial) => Anchor;
  side?: Side;
  enter?: (t: Tutorial) => void;
  /** Advances by itself once this is true. */
  done?: (t: Tutorial) => boolean;
  /** Advances on a button instead; the game waits while it shows. */
  next?: string;
  freeze?: boolean;
}

const BUILD_TILE: [number, number] = [8.5, 5.5];

const tower = (t: Tutorial): Tower | null => t.w.towers[0] ?? null;
const towerTile = (t: Tutorial): Anchor => {
  const x = tower(t);
  return x ? [x.x, x.y] : null;
};
const topUp = (t: Tutorial, amount: number) => {
  if (t.w.gold < amount) t.w.gold = amount;
};
/** Enough gold to socket any card in the hand into the tutorial tower. */
const topUpSocket = (t: Tutorial) => {
  const x = tower(t);
  if (x) topUp(t, Math.max(0, ...t.w.cards.map((c) => t.w.socketCost(x, c.rarity) ?? 0)));
};
/** Point at the hand when a tower is selected, otherwise at the tower. */
const handOrTower = (t: Tutorial): Anchor => (t.host.selected() ? '.hand' : towerTile(t));

const STEPS: Step[] = [
  {
    text: () => 'Shapes march down the road toward your base on the right. Every shape that gets through costs lives. Stop them with towers.',
    anchor: () => '.pill.lives', side: 'below', next: 'Next',
  },
  {
    text: (t) => (t.host.placing() ? 'Now click the marked tile beside the road.' : 'Pick the Bolt tower (or press 1).'),
    anchor: (t) => (t.host.placing() ? BUILD_TILE : '.tbtn[data-id="bolt"]'), side: 'right',
    done: (t) => t.w.towers.length > 0,
  },
  {
    text: () => 'Send the first wave with the green button, or press Space.',
    anchor: () => '.callbtn', side: 'above',
    done: (t) => t.w.waveN >= 1,
  },
  {
    text: () => 'Towers aim and fire on their own at anything in range. Every shape you destroy pays gold.',
    anchor: () => '.pill.gold', side: 'below',
    done: (t) => t.w.waveN >= 1 && !t.w.active.length && !t.w.enemies.length,
  },
  {
    text: (t) => (t.host.selected() ? 'Upgrade it. Upgrades make a tower stronger and open more card sockets.' : 'Click your Bolt to select it.'),
    anchor: (t) => (t.host.selected() ? '.side .actions .btn.blue' : towerTile(t)), side: 'left',
    enter: (t) => { const x = tower(t); if (x) topUp(t, t.w.upgradeCost(x) ?? 0); },
    done: (t) => t.w.towers.some((x) => x.tier >= 2),
  },
  {
    text: () => 'You earned a card pack. Open it and keep one of its cards.',
    anchor: () => '.packstack', side: 'above',
    enter: (t) => { if (!t.w.packs.length && !t.w.offer && !t.w.cards.length) t.w.grantPack('starter'); },
    done: (t) => t.w.cards.length >= 1 || t.w.towers.some((x) => x.sockets.length),
  },
  {
    text: () => 'Each card is a power. Its frame shows its rarity: Common, Rare (blue), Epic (purple) or Legendary (gold). Rarer cards make their power stronger, and the most exotic powers only come as rare cards.',
    anchor: () => '.hand', side: 'above', next: 'Next',
  },
  {
    text: (t) => (t.host.selected() ? 'Click a card to socket it into your Bolt. The tower gains that power.' : 'Select your Bolt, then click a card to socket it.'),
    anchor: handOrTower, side: 'above',
    enter: topUpSocket,
    done: (t) => t.w.towers.some((x) => x.sockets.length >= 1),
  },
  {
    text: () => 'Another pack. Keep a second power.',
    anchor: () => '.packstack', side: 'above',
    enter: (t) => { if (!t.w.packs.length && !t.w.offer && !t.w.cards.length) t.w.grantPack('shape'); },
    done: (t) => t.w.cards.length >= 1 || t.w.towers.some((x) => x.sockets.length >= 2),
  },
  {
    text: (t) => (t.host.selected() ? 'Socket it into the same tower. Two powers in one tower fuse into a brand-new ability.' : 'Select your Bolt again, then socket the new card.'),
    anchor: handOrTower, side: 'above',
    enter: topUpSocket,
    done: (t) => t.w.towers.some((x) => x.sockets.length >= 2),
  },
  {
    text: () => 'The Forge AI designs each fusion the first time anyone makes it, then keeps it for every player. Be the first and it is your World First, numbered and dated forever.',
    anchor: (t) => (t.host.selected() ? '.side .panel' : towerTile(t)), side: 'left', next: 'Next',
  },
  {
    text: (t) => {
      const f = t.w.towers.find((x) => x.sockets.length >= 2);
      const [a, b] = (f?.sockets ?? ['frost', 'ember']).map((p) => POWER_BY_ID.get(p)?.name ?? p);
      return `Order matters. The first card is the base and sets the direction, the second bends it, and a third (at tier 3) adds a twist. ${a} then ${b} is a different fusion from ${b} then ${a}.`;
    },
    anchor: (t) => (t.host.selected() ? '.sockets' : null), side: 'left', next: 'Next',
  },
  {
    text: () => 'You only see what a fusion does once you have made it yourself. Everything you make is saved in your Codex.',
    next: 'Next',
  },
  {
    text: (t) => (t.host.selected()
      ? 'Level it up (or press L). Levels add damage, and the green numbers in a fusion grow too. A higher level makes that tower\'s next socket and upgrade cost more.'
      : 'Select your Bolt again.'),
    anchor: (t) => (t.host.selected() ? '.side .lvbtn' : towerTile(t)), side: 'left',
    enter: (t) => { const x = tower(t); if (x) topUp(t, t.w.levelCost(x) ?? 0); },
    done: (t) => t.w.towers.some((x) => x.level >= 2),
  },
  {
    text: () => 'More packs arrive every 3 waves and after each boss, and the Shop sells them for gold. Right-click a card you do not need to scrap it for gold.',
    anchor: () => '.shopbtn', side: 'above', next: 'Next',
  },
  {
    text: () => 'Shortcuts: 1-0 build · Space sends the wave · U upgrades · L levels up · S sells (press twice) · T changes targeting · F changes speed · Backspace removes the last card · Esc cancels or pauses.',
    next: 'Next',
  },
  {
    text: () => 'Survive the remaining waves to finish. The campaign goes from flat polygons to 3D solids and finally 4D shapes, each with tricks of their own.',
    enter: (t) => t.host.release(), next: 'Got it', freeze: false,
  },
];

export class Tutorial {
  readonly host: TutorialHost;
  private i = -1;
  private el: HTMLElement;
  private glow: Element | null = null;
  private key = '';

  constructor(host: TutorialHost) {
    this.host = host;
    this.el = h('div', { class: 'coach hidden' });
    host.ui.append(this.el);
    this.advance();
  }

  get w(): World {
    return this.host.w;
  }

  private get step(): Step | undefined {
    return STEPS[this.i];
  }

  /** True while a read-and-continue step is on screen: the game waits. */
  get blocking(): boolean {
    const s = this.step;
    return !!s?.next && s.freeze !== false && !this.host.modalOpen();
  }

  /** Map tile to pulse, if the current step points at one. */
  get beacon(): [number, number] | null {
    const a = this.step?.anchor?.(this);
    return Array.isArray(a) ? a : null;
  }

  private advance(): void {
    this.i++;
    this.key = '';
    this.step?.enter?.(this);
  }

  update(): void {
    while (this.step && !this.step.next && this.step.done?.(this)) this.advance();
    this.render();
  }

  private render(): void {
    const s = this.step;
    const show = !!s && !this.host.modalOpen();
    const a = show ? s.anchor?.(this) ?? null : null;
    const target = typeof a === 'string' ? this.host.ui.querySelector(a) : null;
    if (target !== this.glow) {
      this.glow?.classList.remove('tut-glow');
      this.glow = target;
      target?.classList.add('tut-glow');
    }
    this.el.classList.toggle('hidden', !show);
    if (!show) return;
    const text = s.text(this);
    const key = `${this.i}:${text}`;
    if (key !== this.key) {
      this.key = key;
      mount(this.el,
        h('div', { class: 'coach-count' }, `${this.i + 1} / ${STEPS.length}`),
        h('div', { class: 'coach-text' }, text),
        h('div', { class: 'coach-foot' },
          h('button', { class: 'btn grey small', on: { click: () => this.host.skip() } }, 'Skip tutorial'),
          s.next ? h('button', { class: 'btn green', on: { click: () => { this.advance(); this.update(); } } }, s.next) : null,
        ),
      );
    }
    const rect = target ? target.getBoundingClientRect() : Array.isArray(a) ? this.host.tileRect(a[0], a[1]) : null;
    this.place(rect, s.side ?? 'above');
  }

  /** Put the bubble beside its anchor, trying the preferred side first. */
  private place(r: DOMRect | null, pref: Side): void {
    const b = this.el;
    const W = window.innerWidth, H = window.innerHeight;
    const bw = b.offsetWidth, bh = b.offsetHeight, gap = 16, m = 8;
    let x = (W - bw) / 2, y = 64;
    if (r) {
      const at: Record<Side, [number, number]> = {
        right: [r.right + gap, r.top + r.height / 2 - bh / 2],
        left: [r.left - gap - bw, r.top + r.height / 2 - bh / 2],
        above: [r.left + r.width / 2 - bw / 2, r.top - gap - bh],
        below: [r.left + r.width / 2 - bw / 2, r.bottom + gap],
      };
      const fits = ([px, py]: [number, number]) => px >= m && py >= m && px + bw <= W - m && py + bh <= H - m;
      const order: Side[] = [pref, ...(['right', 'left', 'above', 'below'] as Side[]).filter((s) => s !== pref)];
      const pick = order.find((s) => fits(at[s])) ?? pref;
      [x, y] = at[pick];
    }
    b.style.left = `${Math.round(Math.max(m, Math.min(W - bw - m, x)))}px`;
    b.style.top = `${Math.round(Math.max(m, Math.min(H - bh - m, y)))}px`;
  }

  destroy(): void {
    this.glow?.classList.remove('tut-glow');
    this.el.remove();
  }
}
