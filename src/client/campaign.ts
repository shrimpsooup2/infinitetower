// The campaign world map: one winding trail through the three acts with a stop
// for each stage, like a Battle Cats world map. Everything past the furthest
// stage you have reached is hidden under cloud, and beating a stage rolls the
// cloud back to the next one. Once every stage is beaten the whole map stays
// open. Each stretch of land is drawn in the theme of the stage that sits on
// it, so the map also previews how the campaign's look grows richer.

import { MAPS, ACTS } from '../content/maps.ts';
import { DIFFICULTIES } from '../content/rules.ts';
import { themeOf, drawProp, drawScatter, type Theme } from './render/scenery.ts';
import { towerIcon } from './render/tower-art.ts';
import { Rng } from '../sim/rng.ts';
import { h } from './ui/dom.ts';
import { markRevealed, type Progress } from './storage.ts';
import type { MapDef } from '../sim/types.ts';

type G = CanvasRenderingContext2D;

const H = 380;
const SX = 168;
const GAP = 96;
const LEFT = 140;
const RIGHT = 190;
/** Trail samples between two stops. */
const STEPS = 28;
/** How far past the last revealed stop the cloud begins. */
const FOG_PAD = 86;
/** Height of each stop within its act, as a fraction of the map. */
const WIND = [
  [0.66, 0.4, 0.62, 0.34, 0.56],
  [0.3, 0.6, 0.36, 0.68, 0.42],
  [0.64, 0.34, 0.6, 0.3, 0.52],
];
export const ACT_COLOR = ['#85e37d', '#00b2e1', '#bf7ff5'];
export const ROMAN = ['I', 'II', 'III'];
export const DIFF_COLOR: Record<string, string> = { casual: '#85e37d', normal: '#00b2e1', hard: '#ffe869', brutal: '#f14e54' };

interface Pt { x: number; y: number }
interface Stop extends Pt { map: MapDef; i: number; act: number; theme: Theme }
interface Band { s: Stop; x0: number; x1: number; blendL: boolean; blendR: boolean }

interface Layout {
  W: number;
  stops: Stop[];
  start: Pt;
  end: Pt;
  /** x of each border between two acts. */
  borders: number[];
  bands: Band[];
  /** The trail, sampled: home, every stop, then the goal. */
  trail: Pt[];
}

const stopAt = (i: number) => (i + 1) * STEPS;

function spline(p: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

function layout(): Layout {
  const count = [0, 0, 0];
  const stops: Stop[] = MAPS.map((map, i) => {
    const a = map.act - 1;
    const k = count[a]++;
    return { map, i, act: a, theme: themeOf(map), x: LEFT + i * SX + a * GAP, y: H * WIND[a][k % WIND[a].length] };
  });
  const W = stops[stops.length - 1].x + RIGHT;
  const start = { x: 58, y: H * 0.5 }, end = { x: W - 76, y: H * 0.46 };
  const borders: number[] = [];
  for (let i = 1; i < stops.length; i++) if (stops[i].act !== stops[i - 1].act) borders.push((stops[i].x + stops[i - 1].x) / 2);
  const bands = stops.map((s, i): Band => {
    const prev = stops[i - 1], next = stops[i + 1];
    return {
      s,
      x0: !prev ? 0 : prev.act !== s.act ? borders[s.act - 1] : (prev.x + s.x) / 2,
      x1: !next ? W : next.act !== s.act ? borders[s.act] : (s.x + next.x) / 2,
      blendL: !!prev && prev.act === s.act && prev.theme !== s.theme,
      blendR: !!next && next.act === s.act && next.theme !== s.theme,
    };
  });
  return { W, stops, start, end, borders, bands, trail: spline([start, ...stops, end]) };
}

function pointAt(trail: Pt[], f: number): Pt {
  const i = Math.max(0, Math.min(trail.length - 1, Math.floor(f)));
  const j = Math.min(trail.length - 1, i + 1), t = Math.max(0, Math.min(1, f - i));
  return { x: trail[i].x + (trail[j].x - trail[i].x) * t, y: trail[i].y + (trail[j].y - trail[i].y) * t };
}

function makeCanvas(w: number, hgt: number): [HTMLCanvasElement, G, number] {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  return [c, g, dpr];
}

// ------------------------------------------------------------------ the land

function paintGround(g: G, t: Theme, x0: number, x1: number, rng: Rng): void {
  const w = x1 - x0, s = 24;
  g.save();
  g.beginPath();
  g.rect(x0, 0, w, H);
  g.clip();
  g.fillStyle = t.ground;
  g.fillRect(x0, 0, w, H);
  switch (t.pattern) {
    case 'stripes':
      g.fillStyle = t.ground2 ?? t.ground;
      for (let x = Math.floor(x0 / (s * 4)) * s * 4; x < x1; x += s * 4) g.fillRect(x, 0, s * 2, H);
      break;
    case 'dunes':
      g.strokeStyle = 'rgba(190,130,60,0.2)';
      g.lineWidth = 2;
      for (let y = -s; y < H + s; y += s * 1.3) {
        g.beginPath();
        for (let x = x0; x <= x1 + 8; x += 8) g.lineTo(x, y + Math.sin(x / 46 + y) * 8);
        g.stroke();
      }
      break;
    case 'hex': {
      g.strokeStyle = 'rgba(170,150,255,0.1)';
      g.lineWidth = 1;
      const hs = 17, dx = hs * 1.74;
      for (let row = 0, y = 0; y < H + hs; row++, y += hs * 1.5) {
        for (let x = Math.floor(x0 / dx) * dx - dx + (row % 2 ? dx / 2 : 0); x < x1 + hs; x += dx) {
          g.beginPath();
          for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(x + Math.cos(a) * hs, y + Math.sin(a) * hs); }
          g.closePath();
          g.stroke();
        }
      }
      break;
    }
    case 'nebula':
      for (let i = 0; i < 4; i++) {
        const x = x0 + rng.next() * w, y = rng.next() * H, r = 60 + rng.next() * 90;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, ['rgba(140,80,220,0.32)', 'rgba(40,160,200,0.26)', 'rgba(230,90,160,0.24)'][i % 3]);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    case 'iridescent': {
      const grd = g.createLinearGradient(x0, 0, x1, H);
      grd.addColorStop(0, t.ground);
      grd.addColorStop(0.5, t.ground2 ?? t.ground);
      grd.addColorStop(1, t.ground);
      g.fillStyle = grd;
      g.fillRect(x0, 0, w, H);
      break;
    }
    default:
      break;
  }
  // The theme's grid, aligned to the whole map so neighbouring stretches line up.
  if (t.pattern !== 'nebula') {
    const step = t.pattern === 'paper' ? 12 : s;
    const lines = (every: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = Math.floor(x0 / every) * every; x <= x1; x += every) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, H); }
      for (let y = 0; y <= H; y += every) { g.moveTo(x0, y + 0.5); g.lineTo(x1, y + 0.5); }
      g.stroke();
    };
    lines(step, t.pattern === 'paper' ? 'rgba(90,150,210,0.18)' : t.grid);
    if (t.gridMajor) lines(step * t.gridMajor.every, t.gridMajor.color);
  }
  g.restore();
}

function strokeTrail(g: G, trail: Pt[], upto: number): void {
  g.beginPath();
  g.moveTo(trail[0].x, trail[0].y);
  for (let i = 1; i <= Math.min(Math.floor(upto), trail.length - 1); i++) g.lineTo(trail[i].x, trail[i].y);
  const p = pointAt(trail, upto);
  g.lineTo(p.x, p.y);
}

function drawFlag(g: G, x: number, y: number): void {
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.beginPath(); g.ellipse(x, y + 18, 26, 8, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9a9a9a'; g.strokeStyle = '#555'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(x - 20, y - 4, 40, 22, 5); g.fill(); g.stroke();
  g.strokeStyle = '#555'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x, y - 46); g.stroke();
  g.fillStyle = '#f14e54'; g.strokeStyle = '#333'; g.lineWidth = 3; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x + 2, y - 46); g.quadraticCurveTo(x + 18, y - 48, x + 32, y - 38); g.lineTo(x + 2, y - 28); g.closePath(); g.fill(); g.stroke();
}

function drawGoal(g: G, x: number, y: number): void {
  g.save();
  g.translate(x, y);
  g.shadowColor = '#7afff0';
  g.shadowBlur = 18;
  g.lineWidth = 3;
  for (let k = 0; k < 3; k++) {
    const a = 34 - k * 10;
    g.save();
    g.rotate(k * 0.35 + 0.2);
    g.strokeStyle = ['#7afff0', '#ff7ae6', '#ffe869'][k];
    g.strokeRect(-a, -a, a * 2, a * 2);
    g.restore();
  }
  g.restore();
}

/** The static land: ground, scenery, act borders, the dotted trail, home and goal. */
function drawWorld(g: G, L: Layout, dpr: number): void {
  const rng = new Rng(4242);
  const F = 46;
  // Ground: one stretch per run of stops that share a theme, fading into the
  // previous stretch when both are in the same act.
  const runs: { t: Theme; x0: number; x1: number; blendL: boolean; blendR: boolean }[] = [];
  for (const b of L.bands) {
    const r = runs[runs.length - 1];
    if (r && r.t === b.s.theme && !b.blendL && L.stops[b.s.i - 1]?.act === b.s.act) {
      r.x1 = b.x1;
      r.blendR = b.blendR;
    } else runs.push({ t: b.s.theme, x0: b.x0, x1: b.x1, blendL: b.blendL, blendR: b.blendR });
  }
  for (const b of runs) {
    const lo = b.x0 - (b.blendL ? F : 0), hi = b.x1 + (b.blendR ? F : 0);
    if (!b.blendL) {
      paintGround(g, b.t, lo, hi, rng);
      continue;
    }
    // Fade in over the previous stretch so two themes in one act melt together.
    const off = document.createElement('canvas');
    off.width = Math.ceil((hi - lo) * dpr);
    off.height = Math.ceil(H * dpr);
    const og = off.getContext('2d')!;
    og.setTransform(dpr, 0, 0, dpr, -lo * dpr, 0);
    paintGround(og, b.t, lo, hi, rng);
    og.globalCompositeOperation = 'destination-in';
    const mask = og.createLinearGradient(lo, 0, lo + F * 2, 0);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(1, 'rgba(0,0,0,1)');
    og.fillStyle = mask;
    og.fillRect(lo, 0, hi - lo, H);
    g.drawImage(off, lo, 0, hi - lo, H);
  }

  const clearOf = (x: number, y: number, r: number) =>
    L.trail.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > r * r) &&
    L.stops.every((s) => (s.x - x) ** 2 + (s.y + 26 - y) ** 2 > (r + 44) ** 2);

  for (const b of L.bands) {
    const t = b.s.theme, w = b.x1 - b.x0;
    g.save();
    g.beginPath();
    g.rect(b.x0, 0, w, H);
    g.clip();
    for (const sc of t.scatter) {
      const n = Math.round(((sc.density * w * H) / (24 * 24)) * 0.8);
      for (let i = 0; i < n; i++) {
        const x = b.x0 + rng.next() * w, y = rng.next() * H;
        if (clearOf(x, y, 14)) drawScatter(g, sc.kind, x, y, 24, rng.pick(sc.colors), rng);
      }
    }
    const props: (Pt & { r: number })[] = [];
    const want = t.margin > 0 ? 6 : 3;
    for (let tries = 0; tries < 80 && props.length < want; tries++) {
      const r = 11 + rng.next() * 13;
      const x = b.x0 + r + rng.next() * (w - 2 * r), y = 52 + r + rng.next() * (H - 2 * r - 58);
      if (!clearOf(x, y, r + 20) || props.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (p.r + r + 6) ** 2)) continue;
      props.push({ x, y, r });
    }
    props.sort((a, c) => a.y - c.y);
    for (const p of props) drawProp(g, t.prop, p.x, p.y, p.r, t, rng);
    g.restore();
  }

  // Act borders: a ridge, crossed by a portal where the trail goes through.
  L.borders.forEach((x, a) => {
    const ridge = () => {
      g.beginPath();
      for (let y = -10; y <= H + 10; y += 8) g.lineTo(x + Math.sin(y * 0.06 + a * 2) * 7 + Math.sin(y * 0.19) * 3, y);
    };
    ridge(); g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 10; g.stroke();
    ridge(); g.strokeStyle = ACT_COLOR[a + 1]; g.lineWidth = 3; g.stroke();
  });

  // The trail, dotted, in a colour that reads on each stretch.
  for (const b of L.bands) {
    g.save();
    g.beginPath();
    g.rect(b.x0 - (b.s.i === 0 ? 200 : 0), 0, b.x1 - b.x0 + (b.s.i === 0 ? 200 : 0) + (b.s.i === L.stops.length - 1 ? 200 : 0), H);
    g.clip();
    const dark = b.s.theme.dark;
    strokeTrail(g, L.trail, L.trail.length - 1);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
    g.lineWidth = 26;
    g.stroke();
    g.setLineDash([1, 13]);
    g.strokeStyle = dark ? 'rgba(255,255,255,0.5)' : 'rgba(60,50,35,0.42)';
    g.lineWidth = 7;
    g.stroke();
    g.setLineDash([]);
    g.restore();
  }
  L.borders.forEach((x, a) => {
    const p = L.trail.find((q) => q.x >= x) ?? L.end;
    g.save();
    g.shadowColor = ACT_COLOR[a + 1];
    g.shadowBlur = 16;
    g.strokeStyle = ACT_COLOR[a + 1];
    g.lineWidth = 5;
    g.beginPath(); g.ellipse(p.x, p.y, 11, 30, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  });
  // A little pad under each stop.
  for (const s of L.stops) {
    g.fillStyle = s.theme.dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.2)';
    g.beginPath(); g.ellipse(s.x, s.y + 24, 32, 9, 0, 0, Math.PI * 2); g.fill();
  }
  drawFlag(g, L.start.x, L.start.y);
  drawGoal(g, L.end.x, L.end.y);
}

// ------------------------------------------------------------------ the cloud

interface Puff extends Pt { r: number }

function puff(g: G, x: number, y: number, r: number): void {
  g.fillStyle = '#c9d0dc';
  g.beginPath(); g.arc(x + r * 0.1, y + r * 0.16, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f3f5fa';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

// ------------------------------------------------------------------ the component

export interface CampaignOpts {
  progress: Progress;
  unlocked: (m: MapDef) => boolean;
  selected: string;
  onSelect: (id: string) => void;
  onStart: () => void;
}

export class CampaignMap {
  readonly el: HTMLElement;
  private readonly L = layout();
  private readonly opts: CampaignOpts;
  private readonly fog: G;
  private readonly nodes: HTMLElement[] = [];
  private readonly labels: HTMLElement[] = [];
  private readonly acts: HTMLElement[] = [];
  private readonly goal: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly edge: number[] = [];
  private readonly cloud: Puff[] = [];
  /** Stops open to play, in order. */
  private readonly reached: number;
  private readonly complete: boolean;
  private sel: number;
  /** Where the marker stands, as a trail index. */
  private at: number;
  /** Stops the map shows right now (one more than the stops once the goal is open). */
  private shown = 0;
  private raf = 0;

  constructor(opts: CampaignOpts) {
    this.opts = opts;
    const { L } = this;
    let r = 0;
    while (r < MAPS.length && opts.unlocked(MAPS[r])) r++;
    this.reached = Math.max(1, r);
    this.complete = MAPS.every((m) => Object.values(opts.progress.maps[m.id]?.won ?? {}).some(Boolean));
    const found = MAPS.findIndex((m) => m.id === opts.selected);
    this.sel = found >= 0 && found < this.reached ? found : this.reached - 1;
    this.at = stopAt(this.sel);

    const [land, lg, dpr] = makeCanvas(L.W, H);
    drawWorld(lg, L, dpr);
    const [fogCanvas, fg] = makeCanvas(L.W, H);
    this.fog = fg;
    const rng = new Rng(777);
    for (let y = -30; y < H + 50; y += 28) this.edge.push(rng.next());
    for (let x = 0; x < L.W + 80; x += 58) for (let y = 0; y < H + 60; y += 64) this.cloud.push({ x: x + rng.next() * 40, y: y + rng.next() * 40 - 20, r: 26 + rng.next() * 26 });

    const inner = h('div', { class: 'wm-inner', style: { width: `${L.W}px`, height: `${H}px` } }, land, fogCanvas);
    ACTS.forEach((_, a) => {
      const first = L.stops.find((s) => s.act === a)!;
      const el = h('div', { class: 'wm-act', style: { left: `${first.x}px` } }, h('small', null, `ACT ${ROMAN[a]}`), h('b', null, ACTS[a].name));
      this.acts.push(el);
      inner.append(el);
    });
    for (const s of L.stops) {
      const mp = opts.progress.maps[s.map.id];
      const won = Object.values(mp?.won ?? {}).some(Boolean);
      const node = h('button', {
        class: `wm-node ${won ? 'beaten' : 'current'}`,
        style: { left: `${s.x}px`, top: `${s.y}px`, '--c': ACT_COLOR[s.act], '--c2': shadeOf(s.act) },
        title: s.map.name,
        on: { click: () => this.select(s.i) },
      }, String(s.i + 1));
      const label = h('div', { class: 'wm-name', style: { left: `${s.x}px`, top: `${s.y + 30}px` } },
        s.map.name,
        h('div', { class: 'wm-pips' }, ...DIFFICULTIES.map((d) => h('i', { class: mp?.won[d.id] ? 'on' : '', style: { '--c': DIFF_COLOR[d.id] }, title: d.name }))),
      );
      this.nodes.push(node);
      this.labels.push(label);
      inner.append(node, label);
    }
    this.goal = h('div', { class: 'wm-goal', style: { left: `${L.end.x}px`, top: `${L.end.y}px` }, title: 'Campaign complete' }, '★');
    this.marker = h('div', { class: 'wm-marker' }, towerIcon('bolt', 2, 56, { base: '#ffe869', secondary: '#00b2e1', tertiary: '#bf7ff5' }, 2, 1.35));
    inner.append(this.goal, this.marker);

    this.el = h('div', { class: 'wm', attrs: { tabindex: '0' } }, inner);
    this.wire();
  }

  private get target(): number {
    return this.complete ? MAPS.length + 1 : this.reached;
  }

  /** Call once the element is in the page: scrolls into place and plays any reveal. */
  mounted(): void {
    const seen = Math.min(this.opts.progress.revealed ?? 0, this.target);
    const from = seen >= 1 && seen < this.target ? seen : this.target;
    if (from < this.target) {
      this.sel = from - 1;
      if (MAPS[this.sel].id !== this.opts.selected) this.opts.onSelect(MAPS[this.sel].id);
      this.show(from, stopAt(from - 1));
      this.at = stopAt(from - 1);
      this.place();
      this.scrollTo(pointAt(this.L.trail, this.at).x, false);
      this.reveal(from);
    } else {
      this.show(from, stopAt(from - 1));
      this.place();
      this.scrollTo(this.L.stops[this.sel].x, false);
    }
    markRevealed(this.target);
    this.el.focus({ preventScroll: true });
  }

  /** Show the first `n` stops (n = stops + 1 opens the goal too), with the cloud at trail index `upto`. */
  private show(n: number, upto: number): void {
    this.shown = n;
    this.nodes.forEach((el, i) => {
      el.classList.toggle('hidden', i >= n);
      el.classList.toggle('sel', i === this.sel);
    });
    this.labels.forEach((el, i) => el.classList.toggle('hidden', i >= n));
    this.acts.forEach((el, a) => el.classList.toggle('hidden', !this.L.stops.some((s) => s.act === a && s.i < n)));
    this.goal.classList.toggle('hidden', n <= MAPS.length);
    this.drawFog(upto, n > MAPS.length);
  }

  private drawFog(upto: number, open: boolean): void {
    const { L } = this;
    const g = this.fog;
    g.clearRect(0, 0, L.W, H);
    // The road travelled so far, in gold.
    strokeTrail(g, L.trail, Math.min(upto, this.complete ? L.trail.length - 1 : stopAt(this.reached - 1)));
    g.lineCap = 'round';
    g.setLineDash([1, 13]);
    g.strokeStyle = 'rgba(40,30,10,0.6)';
    g.lineWidth = 11;
    g.stroke();
    g.strokeStyle = '#ffe869';
    g.lineWidth = 6;
    g.stroke();
    g.setLineDash([]);
    if (open) return;
    const fx = pointAt(L.trail, upto).x + FOG_PAD;
    const grd = g.createLinearGradient(fx - 70, 0, fx + 30, 0);
    grd.addColorStop(0, 'rgba(243,245,250,0)');
    grd.addColorStop(1, 'rgba(243,245,250,1)');
    g.fillStyle = grd;
    g.fillRect(fx - 70, 0, 100, H);
    g.fillStyle = '#e9edf4';
    g.fillRect(fx + 30, 0, L.W - fx, H);
    for (const p of this.cloud) if (p.x - p.r > fx + 30) puff(g, p.x, p.y, p.r * 0.9);
    this.edge.forEach((j, k) => {
      const y = -30 + k * 28;
      puff(g, fx + Math.sin(y * 0.05) * 12 + j * 16, y, 30 + j * 20);
    });
  }

  private place(): void {
    const p = pointAt(this.L.trail, this.at);
    this.marker.style.left = `${p.x - 28}px`;
    this.marker.style.top = `${p.y - 84}px`;
  }

  private scrollTo(x: number, smooth: boolean): void {
    const left = Math.max(0, x - this.el.clientWidth / 2);
    if (smooth) this.el.scrollTo({ left, behavior: 'smooth' });
    else this.el.scrollLeft = left;
  }

  /** Roll the cloud back from stop `from` to the target, walking the marker along. */
  private reveal(from: number): void {
    const a = stopAt(from - 1);
    const b = this.complete ? this.L.trail.length - 1 : stopAt(this.reached - 1);
    const dur = 900 + 450 * (this.target - from);
    const t0 = performance.now();
    cancelAnimationFrame(this.raf);
    const frame = (now: number) => {
      if (!this.el.isConnected) return;
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const head = a + (b - a) * e;
      let n = from;
      while (n < MAPS.length + 1 && stopAt(n) <= head + 0.5) n++;
      if (n > this.shown) {
        for (let i = this.shown; i < Math.min(n, MAPS.length); i++) this.nodes[i].classList.add('pop');
        if (n > MAPS.length) this.goal.classList.add('pop');
      }
      this.show(Math.max(this.shown, n), head);
      this.at = Math.min(head, stopAt(MAPS.length - 1));
      this.place();
      const x = pointAt(this.L.trail, head).x;
      this.el.scrollLeft += (Math.max(0, x - this.el.clientWidth * 0.55) - this.el.scrollLeft) * 0.2;
      if (k < 1) this.raf = requestAnimationFrame(frame);
      else this.select(this.reached - 1);
    };
    this.raf = requestAnimationFrame(frame);
  }

  select(i: number): void {
    if (i < 0 || i >= this.shown || i >= this.reached) return;
    const changed = i !== this.sel;
    this.sel = i;
    this.nodes.forEach((el, k) => el.classList.toggle('sel', k === i));
    if (changed) this.opts.onSelect(MAPS[i].id);
    this.walk(stopAt(i));
    const x = this.L.stops[i].x;
    if (x < this.el.scrollLeft + 80 || x > this.el.scrollLeft + this.el.clientWidth - 80) this.scrollTo(x, true);
  }

  /** Walk the marker along the trail to trail index `to`. */
  private walk(to: number): void {
    const from = this.at;
    if (Math.abs(to - from) < 0.01) return;
    const dur = Math.min(900, 180 + (Math.abs(to - from) / STEPS) * 140);
    const t0 = performance.now();
    cancelAnimationFrame(this.raf);
    const frame = (now: number) => {
      if (!this.el.isConnected) return;
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      this.at = from + (to - from) * e;
      this.place();
      if (k < 1) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private wire(): void {
    const el = this.el;
    el.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.select(this.sel + 1);
      else if (e.key === 'ArrowLeft') this.select(this.sel - 1);
      else if (e.key === 'Enter') this.opts.onStart();
      else return;
      e.preventDefault();
    });
    // Drag to pan. A drag that moved swallows the click that ends it.
    let down: { x: number; left: number } | null = null;
    let dragged = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      down = { x: e.clientX, left: el.scrollLeft };
      dragged = false;
    });
    const move = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 5) dragged = true;
      if (dragged) {
        el.scrollLeft = down.left - dx;
        el.classList.add('drag');
      }
    };
    const up = () => {
      down = null;
      el.classList.remove('drag');
      if (!el.isConnected) {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('click', (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }
}

function shadeOf(act: number): string {
  return ['#6fc567', '#0096bf', '#a567d9'][act];
}
