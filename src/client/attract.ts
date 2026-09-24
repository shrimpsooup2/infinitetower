// The drifting shapes behind the menus, and a toy to play with. They are made
// once per page load and keep drifting as you move between screens (and come
// back from a game); only a reload shuffles them.
//
//   * Shapes shy away from the cursor.
//   * Grab one and fling it: it keeps its momentum and knocks into the others.
//   * Click one: a polygon loses a side (hexagon, pentagon, ... triangle) and
//     then pops; solids and polytopes split in two until they are small enough
//     to pop. New shapes drift in to replace the popped ones.
//   * Click empty space for a little shockwave.
// Only clicks on the bare background count, never on buttons or panels.

import { ENEMIES, ENEMY_BY_ID } from '../content/enemies.ts';
import type { EnemyDef } from '../sim/types.ts';
import { PAL } from '../content/colors.ts';
import { drawEnemyBody } from './render/enemy-art.ts';
import type { Audio } from './audio.ts';

interface Shape {
  def: EnemyDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its own gentle drift, which it returns to after a fling. */
  dvx: number;
  dvy: number;
  r: number;
  rot: number;
  spin: number;
  t: number;
  /** Grows in from small when it appears. */
  grow: number;
}

interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number; max: number; size: number; color: string }
interface Ring { x: number; y: number; age: number; r: number }

const COUNT = 26;
const POOL = ENEMIES.filter((e) => !e.traits.includes('boss'));
/** Elements a click belongs to rather than the shapes behind them. */
const INTERACTIVE = 'button, a, input, select, textarea, summary, label, details, [tabindex], .panel, .modal, .topbar, .stagecard, .wm, .dex-focus, .dex-card, .cpage, .ctab, .chip, .setting, .coach';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Attract {
  private raf = 0;
  private readonly shapes: Shape[] = [];
  private shards: Shard[] = [];
  private rings: Ring[] = [];
  private readonly canvas: HTMLCanvasElement;
  private readonly audio: Audio | null;
  private W = window.innerWidth;
  private H = window.innerHeight;
  private pointer: { x: number; y: number; over: boolean } = { x: -1e4, y: -1e4, over: false };
  private trail: { x: number; y: number; t: number }[] = [];
  private held: { s: Shape; ox: number; oy: number; x0: number; y0: number; t0: number; moved: boolean } | null = null;
  private spawnTimer = 0;

  constructor(canvas: HTMLCanvasElement, audio: Audio | null = null) {
    this.canvas = canvas;
    this.audio = audio;
    for (let i = 0; i < COUNT; i++) this.shapes.push(this.make(POOL[(i * 7) % POOL.length], rand(0, this.W), rand(0, this.H), 1));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => this.release(0, 0));
  }

  private make(def: EnemyDef, x: number, y: number, grow: number, r = 14 + def.dim * 7 + Math.random() * 10): Shape {
    const dvx = rand(-15, 15), dvy = rand(-15, 15);
    return { def, x, y, vx: dvx, vy: dvy, dvx, dvy, r, rot: rand(0, 6), spin: rand(-0.4, 0.4), t: rand(0, 10), grow };
  }

  start(): void {
    if (this.raf) return;
    let last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.release(0, 0);
    document.body.classList.remove('shape-hover', 'shape-drag');
  }

  // ------------------------------------------------------------ input

  private background(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    if (!el || el.closest(INTERACTIVE)) return false;
    return el.id === 'game' || !!el.closest('.screen');
  }

  private hit(x: number, y: number): Shape | null {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < (s.r * 1.15) ** 2) return s;
    }
    return null;
  }

  private onMove(e: PointerEvent): void {
    if (!this.raf) return;
    this.pointer = { x: e.clientX, y: e.clientY, over: this.background(e.target) || !!this.held };
    const now = performance.now();
    this.trail.push({ x: e.clientX, y: e.clientY, t: now });
    while (this.trail.length > 2 && now - this.trail[0].t > 90) this.trail.shift();
    const h = this.held;
    if (h) {
      if (Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > 6) h.moved = true;
      h.s.x = e.clientX + h.ox;
      h.s.y = e.clientY + h.oy;
    }
    document.body.classList.toggle('shape-hover', !h && this.pointer.over && !!this.hit(e.clientX, e.clientY));
  }

  private onDown(e: PointerEvent): void {
    if (!this.raf || e.button !== 0 || !this.background(e.target)) return;
    this.audio?.unlock();
    const s = this.hit(e.clientX, e.clientY);
    if (!s) {
      this.shockwave(e.clientX, e.clientY);
      return;
    }
    this.held = { s, ox: s.x - e.clientX, oy: s.y - e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
    this.trail = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    // Bring it to the front.
    this.shapes.splice(this.shapes.indexOf(s), 1);
    this.shapes.push(s);
    document.body.classList.add('shape-drag');
    e.preventDefault();
  }

  private onUp(e: PointerEvent): void {
    const h = this.held;
    if (!h) return;
    if (!h.moved && performance.now() - h.t0 < 350) {
      this.release(0, 0);
      this.poke(h.s);
      return;
    }
    const a = this.trail[0], b = this.trail[this.trail.length - 1] ?? { x: e.clientX, y: e.clientY, t: performance.now() };
    const dt = Math.max(0.016, (b.t - (a?.t ?? b.t)) / 1000);
    const vx = ((b.x - (a?.x ?? b.x)) / dt), vy = ((b.y - (a?.y ?? b.y)) / dt);
    const sp = Math.hypot(vx, vy), max = 1800;
    const k = sp > max ? max / sp : 1;
    this.release(vx * k, vy * k);
  }

  private release(vx: number, vy: number): void {
    const h = this.held;
    this.held = null;
    document.body.classList.remove('shape-drag');
    if (!h) return;
    h.s.vx = vx;
    h.s.vy = vy;
    h.s.spin += (vx - vy) * 0.002;
    if (Math.hypot(vx, vy) > 500) this.audio?.play('whoosh', 1.3, 0.35);
  }

  // ------------------------------------------------------------ toy actions

  /** A click: lose a side, split, or pop. */
  private poke(s: Shape): void {
    const d = s.def;
    const poly = /^p(\d+)$/.exec(d.id);
    if (poly && Number(poly[1]) > 3) {
      const smaller = ENEMY_BY_ID.get(`p${Number(poly[1]) - 1}`);
      if (smaller) {
        s.def = smaller;
        s.spin += 2;
        s.grow = 0.8;
        this.burst(s, 5);
        this.audio?.play('ui', 0.7 + Number(poly[1]) * 0.06, 0.6);
        return;
      }
    }
    if (d.dim > 2 && s.r > 13) {
      const i = this.shapes.indexOf(s);
      const r = s.r * 0.72;
      const nx = rand(-1, 1), ny = rand(-1, 1), l = Math.hypot(nx, ny) || 1;
      const a = this.make(d, s.x + (nx / l) * r * 0.6, s.y + (ny / l) * r * 0.6, 0.6, r);
      const b = this.make(d, s.x - (nx / l) * r * 0.6, s.y - (ny / l) * r * 0.6, 0.6, r);
      a.vx = (nx / l) * 160; a.vy = (ny / l) * 160;
      b.vx = -(nx / l) * 160; b.vy = -(ny / l) * 160;
      this.shapes.splice(i, 1, a, b);
      this.burst(s, 6);
      this.audio?.play('pluck', 1.4, 0.45);
      return;
    }
    this.shapes.splice(this.shapes.indexOf(s), 1);
    this.burst(s, 16);
    this.audio?.play('pluck', 1.1 + Math.random() * 0.5, 0.6);
  }

  private burst(s: Shape, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, 320);
      this.shards.push({
        x: s.x, y: s.y, vx: Math.cos(a) * sp + s.vx * 0.3, vy: Math.sin(a) * sp + s.vy * 0.3, rot: rand(0, 6), vr: rand(-8, 8),
        life: 0, max: rand(0.45, 0.9), size: rand(3, 7) * (s.r / 24), color: s.def.color,
      });
    }
  }

  private shockwave(x: number, y: number): void {
    this.rings.push({ x, y, age: 0, r: 190 });
    for (const s of this.shapes) {
      const dx = s.x - x, dy = s.y - y, d = Math.hypot(dx, dy);
      if (d > 190 || d < 1) continue;
      const k = (1 - d / 190) * 520;
      s.vx += (dx / d) * k;
      s.vy += (dy / d) * k;
      s.spin += rand(-2, 2);
    }
    this.audio?.play('thud', 1.4, 0.35);
  }

  // ------------------------------------------------------------ simulation

  private update(dt: number): void {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    const { W, H } = this;
    const m = 60;
    const p = this.pointer;
    for (const s of this.shapes) {
      s.t += dt;
      s.grow = Math.min(1, s.grow + dt * 2.5);
      s.spin += (Math.sign(s.spin || 1) * 0.3 - s.spin) * Math.min(1, dt * 0.8);
      s.rot += s.spin * dt;
      if (this.held?.s === s) continue;
      // Back to a gentle drift after a fling.
      const k = Math.min(1, dt * 1.1);
      s.vx += (s.dvx - s.vx) * k;
      s.vy += (s.dvy - s.vy) * k;
      // Shy of the cursor.
      if (p.over && !this.held) {
        const dx = s.x - p.x, dy = s.y - p.y, d = Math.hypot(dx, dy);
        if (d < 120 && d > 1) {
          const f = (1 - d / 120) * 900 * dt;
          s.vx += (dx / d) * f;
          s.vy += (dy / d) * f;
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < -m) s.x += W + m * 2;
      else if (s.x > W + m) s.x -= W + m * 2;
      if (s.y < -m) s.y += H + m * 2;
      else if (s.y > H + m) s.y -= H + m * 2;
    }
    // Knocks: equal-mass bounces between overlapping shapes.
    for (let i = 0; i < this.shapes.length; i++) {
      const a = this.shapes[i];
      for (let j = i + 1; j < this.shapes.length; j++) {
        const b = this.shapes[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = (a.r + b.r) * 0.85;
        if (d >= min || d < 0.01) continue;
        const nx = dx / d, ny = dy / d, push = (min - d) / 2;
        const heldA = this.held?.s === a, heldB = this.held?.s === b;
        if (!heldA) { a.x -= nx * push * (heldB ? 2 : 1); a.y -= ny * push * (heldB ? 2 : 1); }
        if (!heldB) { b.x += nx * push * (heldA ? 2 : 1); b.y += ny * push * (heldA ? 2 : 1); }
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          if (!heldA) { a.vx += rel * nx; a.vy += rel * ny; }
          if (!heldB) { b.vx -= rel * nx; b.vy -= rel * ny; }
          if (-rel > 400) this.audio?.play('thud', 1.6 + Math.random() * 0.3, Math.min(0.35, -rel / 3000));
        }
      }
    }
    // New shapes drift in to replace popped ones.
    if (this.shapes.length < COUNT) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.7;
        const side = Math.floor(rand(0, 4));
        const x = side === 0 ? -40 : side === 1 ? W + 40 : rand(0, W);
        const y = side === 2 ? -40 : side === 3 ? H + 40 : rand(0, H);
        const s = this.make(POOL[Math.floor(rand(0, POOL.length))], x, y, 0.2);
        s.dvx = s.vx = (W / 2 - x) / W * 40 + rand(-10, 10);
        s.dvy = s.vy = (H / 2 - y) / H * 40 + rand(-10, 10);
        this.shapes.unshift(s);
      }
    }
    for (const sh of this.shards) {
      sh.life += dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.vx *= 1 - dt * 2.5;
      sh.vy = sh.vy * (1 - dt * 2.5) + 260 * dt;
      sh.rot += sh.vr * dt;
    }
    this.shards = this.shards.filter((sh) => sh.life < sh.max);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 0.45);
  }

  private draw(): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { W, H } = this;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
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
    for (const r of this.rings) {
      const k = r.age / 0.45;
      g.beginPath();
      g.arc(r.x, r.y, r.r * (0.2 + 0.8 * k), 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${(0.7 * (1 - k)).toFixed(3)})`;
      g.lineWidth = 4 * (1 - k) + 1;
      g.stroke();
    }
    for (const s of this.shapes) {
      const grow = s.grow < 1 ? 1 - (1 - s.grow) ** 3 : 1;
      const held = this.held?.s === s;
      drawEnemyBody(g, s.def, s.x, s.y, s.r * grow * (held ? 1.12 : 1), s.rot, s.t, s.def.color, 3, 3);
    }
    for (const sh of this.shards) {
      const a = 1 - sh.life / sh.max;
      g.save();
      g.globalAlpha = a;
      g.translate(sh.x, sh.y);
      g.rotate(sh.rot);
      g.beginPath();
      g.moveTo(0, -sh.size);
      g.lineTo(sh.size * 0.87, sh.size * 0.5);
      g.lineTo(-sh.size * 0.87, sh.size * 0.5);
      g.closePath();
      g.fillStyle = sh.color;
      g.fill();
      g.strokeStyle = 'rgba(40,40,50,0.7)';
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }
  }
}
