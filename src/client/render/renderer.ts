// Draws the World in the diep.io style and turns sim FxEvents into effects.

import type { World } from '../../sim/world.ts';
import type { Enemy, Palette3, Projectile, Tower, TowerDef, Zone } from '../../sim/types.ts';
import type { SoundPreset } from '../../effects/types.ts';
import { PAL, DAMAGE_COLORS, shade } from '../../content/colors.ts';
import { BUILTIN_VFX } from '../../effects/vfxlib.ts';
import { resolveVfx } from '../../effects/runtime.ts';
import { Fx, drawBeam, drawLoop, resolve, type BeamLook, type Cam } from './fx.ts';
import { drawTower, bodyRadius } from './tower-art.ts';
import { drawEnemyBody } from './enemy-art.ts';
import { pathOf } from '../../sim/combat.ts';
import { drawAmbient, drawScenery } from './scenery.ts';
import {
  circlePath, fillStroke, lerpHex, outlinedText, polyPath, rgba, roundRectPath, shapePath, softSprite, quant, type Ctx2D,
} from './draw.ts';

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ghost {
  x: number; y: number; r: number; shape: string; color: string; rot: number; age: number; dur: number; air: boolean;
  enemy?: Enemy;
}

interface Trail {
  pts: number[];
  seen: number;
}

export interface RenderOpts {
  selected: Tower | null;
  hoverTile: [number, number] | null;
  placing: TowerDef | null;
  showRanges: boolean;
  damageNumbers: boolean;
  /** Tile (in tile units, centre) the tutorial is pointing at. */
  beacon?: [number, number] | null;
}

const DEFAULT_SPRAY = {
  shape: 'circle' as const, rate: 55, color: '#ffe45c', color_end: '#fc7677', size: [0.08, 0.34] as [number, number],
  alpha: [0.95, 0] as [number, number], speed: [3.2, 5] as [number, number], life: [0.3, 0.5] as [number, number], spread: 50, drag: 1.5, outline: true,
};
const DEFAULT_PRISM: BeamLook = { style: 'solid', width: [0.14, 0.1], color: 'base', core: '#ffffff', glow: true };

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx2D;
  readonly fx = new Fx();
  cam: Cam = { s: 40, ox: 0, oy: 0 };
  view: ViewRect = { x: 0, y: 0, w: 800, h: 600 };
  private dpr = 1;
  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';
  private ghosts: Ghost[] = [];
  private trails = new Map<number, Trail>();
  private lastProj = new Map<number, Projectile>();
  private time = 0;
  onSound: ((preset: SoundPreset, pitch: number, vol: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.bgKey = '';
  }

  /** Fit the map into the view rect (CSS px). */
  fit(w: World, view: ViewRect): void {
    this.view = view;
    const s = Math.floor(Math.min(view.w / w.cols, view.h / w.rows));
    this.cam = {
      s: Math.max(8, s),
      ox: Math.round(view.x + (view.w - s * w.cols) / 2),
      oy: Math.round(view.y + (view.h - s * w.rows) / 2),
    };
  }

  screenToTile(px: number, py: number): [number, number] {
    return [Math.floor((px - this.cam.ox) / this.cam.s), Math.floor((py - this.cam.oy) / this.cam.s)];
  }

  // ------------------------------------------------------------ static background

  private buildBackground(w: World): void {
    const key = `${w.map.id}:${this.cam.s}:${this.cam.ox}:${this.cam.oy}:${this.canvas.width}`;
    if (key === this.bgKey && this.bg) return;
    this.bgKey = key;
    const c = this.bg ?? document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { s, ox, oy } = this.cam;
    drawScenery(g, w.map, { s, ox, oy, W: this.canvas.width / this.dpr, H: this.canvas.height / this.dpr });
    this.bg = c;
  }

  // ------------------------------------------------------------ fx events

  consume(w: World, opts: RenderOpts): void {
    for (const ev of w.fx) {
      switch (ev.k) {
        case 'shot':
          this.onSound?.(ev.sound, ev.pitch * (0.95 + Math.random() * 0.1), 0.35);
          break;
        case 'hit':
          if (ev.vfx) this.fx.play(ev.vfx, ev.x, ev.y, ev.x, ev.y, 0, ev.colors, ev.dcolor, ev.size);
          else if (this.ghosts.length < 300) this.ghosts.push({ x: ev.x, y: ev.y, r: Math.max(0.05, ev.size), shape: 'circle', color: ev.dcolor, rot: 0, age: 0, dur: 0.14, air: false });
          break;
        case 'boom':
          this.fx.play(ev.vfx ?? BUILTIN_VFX.get('ring')!, ev.x, ev.y, ev.x, ev.y, 0, ev.colors, ev.dcolor, Math.max(0.6, ev.r));
          if (ev.r > 1) this.onSound?.('boom', 1.2 - Math.min(0.5, ev.r * 0.15), 0.3);
          break;
        case 'beam':
          this.fx.beam(ev.x1, ev.y1, ev.x2, ev.y2, ev.look, ev.colors, ev.dcolor, ev.dur, ev.pts ?? null);
          break;
        case 'death': {
          const e = ev.e;
          this.ghosts.push({ x: e.x, y: e.y, r: e.size * e.visScale, shape: 'enemy', color: e.def.color, rot: e.rot, age: 0, dur: 0.18, air: e.air, enemy: e });
          if (ev.vfx) this.fx.play(ev.vfx, e.x, e.y, e.x, e.y, e.heading, ev.colors, e.def.color, Math.max(0.7, e.size * 2.5));
          if (e.traitSet.has('boss')) {
            this.fx.play(BUILTIN_VFX.get('shockwave')!, e.x, e.y, e.x, e.y, 0, ev.colors, e.def.color, 2.5);
            this.onSound?.('boom', 0.5, 0.8);
          }
          break;
        }
        case 'text':
          this.fx.text(ev.x, ev.y, ev.text, ev.color, ev.big ? 0.55 : 0.32, ev.big ? 1.4 : 0.8);
          break;
        case 'leak':
          this.fx.text(ev.x, ev.y, `-${ev.lives}`, '#f14e54', 0.55, 1);
          this.fx.shake(0.35, 0.25);
          this.onSound?.('thud', 0.6, 0.7);
          break;
        case 'sound':
          this.onSound?.(ev.preset, ev.pitch, ev.vol);
          break;
        case 'vfx':
          this.fx.play(ev.def, ev.x, ev.y, ev.x2, ev.y2, ev.ang, ev.colors, ev.dcolor, ev.size, ev.tint, ev.text);
          break;
        case 'stomp':
          this.fx.play(BUILTIN_VFX.get('shockwave')!, ev.x, ev.y, ev.x, ev.y, 0, w.defaultColors, '#8c9dff', ev.r);
          this.fx.shake(0.6, 0.35);
          this.onSound?.('boom', 0.5, 0.7);
          break;
        case 'blink':
          this.fx.beam(ev.x1, ev.y1, ev.x2, ev.y2, { style: 'dotted', width: [0.08, 0.08], color: '#bf7ff5' }, w.defaultColors, '#bf7ff5', 0.3);
          break;
        case 'gold':
          if (opts.damageNumbers) this.fx.text(ev.x, ev.y - 0.2, `+${ev.amount}`, PAL.gold, 0.28, 0.7);
          break;
      }
    }
    w.fx.length = 0;
  }

  // ------------------------------------------------------------ frame

  render(w: World, alpha: number, dt: number, opts: RenderOpts): void {
    const ctx = this.ctx;
    this.time += dt;
    this.fx.update(dt);
    this.buildBackground(w);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg!, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawAmbient(ctx, w.map, this.cam, this.time);
    const [sx, sy] = this.fx.shakeOffset();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, sx * this.cam.s * this.dpr, sy * this.cam.s * this.dpr);
    const cam = this.cam;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    // Zones (ground level).
    for (const z of w.zones) this.drawZone(z, dt);

    // Ranges.
    if (opts.selected) this.drawRange(opts.selected.x, opts.selected.y, opts.selected.stats.range, opts.selected.def, true);
    if (opts.showRanges) for (const t of w.towers) if (t !== opts.selected) this.drawRange(t.x, t.y, t.stats.range, t.def, false);

    // Ground-level projectiles (mines, crawlers) and lob shadows.
    for (const p of w.projectiles) {
      if (p.motion === 'mine' || p.motion === 'path_crawl') this.drawProjectile(p, lerp(p.px, p.x), lerp(p.py, p.y));
      if (p.motion === 'lob' || p.motion === 'sky_drop') {
        const gx = p.motion === 'sky_drop' ? p.tx : lerp(p.px, p.x), gy = p.motion === 'sky_drop' ? p.ty : lerp(p.py, p.y);
        circlePath(ctx, cam.ox + gx * cam.s, cam.oy + gy * cam.s, cam.s * (p.motion === 'sky_drop' ? 0.1 + 0.25 * (1 - p.height / 3) : 0.14));
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fill();
      }
    }

    // Ground enemies.
    for (const e of w.enemies) if (!e.air) this.drawEnemy(w, e, lerp(e.px, e.x), lerp(e.py, e.y), dt);

    // Towers.
    for (const t of w.towers) this.drawTowerEntity(w, t, dt, opts);

    // Beams (Prism) and sprays (Flame).
    for (const t of w.towers) {
      if (t.def.chassis === 'beam' && t.beamTargets.length && w.tick >= t.disabledUntil) {
        const look = { ...DEFAULT_PRISM, ...(t.rt?.spec.visual?.beam ?? {}) };
        const colors = t.rt?.colors ?? w.defaultColors;
        const color = resolve(look.color, colors, DAMAGE_COLORS[t.def.dtype], null, colors.base);
        const core = look.core ? resolve(look.core, colors, DAMAGE_COLORS[t.def.dtype], null, '#ffffff') : null;
        const R = bodyRadius(t.tier);
        const sx0 = t.x + Math.cos(t.angle) * R * 1.25, sy0 = t.y + Math.sin(t.angle) * R * 1.25;
        t.beamTargets.forEach((id, i) => {
          const e = w.enemyById.get(id);
          if (!e) return;
          const k = i === 0 ? 0.7 + t.beamRamp * 0.3 : 0.7;
          const lk = { ...look, width: [(look.width?.[0] ?? 0.14) * k, (look.width?.[1] ?? 0.1) * k] as [number, number] };
          drawBeam(ctx, cam, [sx0, sy0, lerp(e.px, e.x), lerp(e.py, e.y)], lk, color, core, 1, this.time);
        });
      }
      if (t.def.chassis === 'cone' && t.coneOn && w.tick >= t.disabledUntil) {
        const look = { ...DEFAULT_SPRAY, ...(t.rt?.spec.visual?.spray ?? {}) };
        const colors = t.rt?.colors ?? { base: '#ffa94d', secondary: '#fc7677', tertiary: '#ffe45c' };
        const R = bodyRadius(t.tier);
        const spread = (t.def.coneAngle ?? 55) + t.stats.multishot * 15;
        const speed = look.speed ?? DEFAULT_SPRAY.speed;
        const life = look.life ?? DEFAULT_SPRAY.life;
        // Particle reach should match the cone range.
        const reach = t.stats.range / (((speed[0] + speed[1]) / 2) * ((life[0] + life[1]) / 2));
        this.fx.spray(`spray${t.id}`, { ...look, spread, speed: [speed[0] * reach, speed[1] * reach] }, t.x + Math.cos(t.angle) * R * 1.5, t.y + Math.sin(t.angle) * R * 1.5, t.angle, dt, colors, DAMAGE_COLORS[t.def.dtype]);
      }
    }

    // Projectiles and drones.
    const alive = new Set<number>();
    for (const p of w.projectiles) {
      alive.add(p.id);
      if (p.motion === 'mine' || p.motion === 'path_crawl') continue;
      this.drawProjectile(p, lerp(p.px, p.x), lerp(p.py, p.y));
    }
    // diep-style fade-out for bullets that just ended.
    for (const [id, p] of this.lastProj) {
      if (!alive.has(id) && p.motion !== 'hitscan' && this.ghosts.length < 400) {
        this.ghosts.push({ x: p.x, y: p.y, r: p.radius * 1.1, shape: p.look.shape === 'circle' || p.look.shape === 'orb' ? 'circle' : p.look.shape, color: p.look.color, rot: Math.atan2(p.vy, p.vx), age: 0, dur: 0.12, air: false });
        this.trails.delete(id);
      }
    }
    this.lastProj.clear();
    for (const p of w.projectiles) this.lastProj.set(p.id, p);
    for (const d of w.drones) {
      const x = cam.ox + lerp(d.px, d.x) * cam.s, y = cam.oy + lerp(d.py, d.y) * cam.s;
      shapePath(ctx, 'triangle', x, y, cam.s * (d.isBase ? 0.14 : 0.11), d.angle + Math.PI / 2);
      fillStroke(ctx, d.color, Math.max(1.2, cam.s * 0.04));
    }

    // Flying enemies (with shadows).
    for (const e of w.enemies) if (e.air) this.drawEnemy(w, e, lerp(e.px, e.x), lerp(e.py, e.y), dt);

    // Death / bullet ghosts: grow and fade (diep).
    this.ghosts = this.ghosts.filter((g) => (g.age += dt) < g.dur);
    for (const g of this.ghosts) {
      const k = g.age / g.dur;
      ctx.globalAlpha = 1 - k;
      const gx = cam.ox + g.x * cam.s, gy = cam.oy + (g.y - (g.air ? 0.18 : 0)) * cam.s, gr = g.r * cam.s * (1 + k * 0.6);
      if (g.enemy) drawEnemyBody(ctx, g.enemy.def, gx, gy, gr, g.rot, this.time + g.enemy.id, g.color, Math.max(1.2, cam.s * 0.05), this.artPixel());
      else {
        shapePath(ctx, g.shape, gx, gy, gr, g.rot);
        fillStroke(ctx, g.color, Math.max(1.2, cam.s * 0.05));
      }
    }
    ctx.globalAlpha = 1;

    this.fx.draw(ctx, cam);

    // Health bars and status icons on top.
    for (const e of w.enemies) this.drawBars(e, lerp(e.px, e.x), lerp(e.py, e.y));

    if (opts.placing && opts.hoverTile) this.drawPlacement(w, opts.placing, opts.hoverTile);
    if (opts.beacon) this.drawBeacon(opts.beacon[0], opts.beacon[1]);
    this.drawBossBar(w);
  }

  /** Size of one art pixel for the 3D solids' slightly low-res look, in CSS px. */
  private artPixel(): number {
    return Math.min(3, Math.max(2, Math.round(this.cam.s / 24)));
  }

  /** Pulsing rings the tutorial uses to point at something on the map. */
  private drawBeacon(x: number, y: number): void {
    const ctx = this.ctx, cam = this.cam;
    const cx = cam.ox + x * cam.s, cy = cam.oy + y * cam.s;
    for (let i = 0; i < 2; i++) {
      const k = (this.time * 0.9 + i * 0.5) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#ffe869';
      ctx.lineWidth = Math.max(2, cam.s * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, cam.s * (0.55 + k * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ pieces

  private drawRange(x: number, y: number, r: number, def: TowerDef, strong: boolean): void {
    const ctx = this.ctx, cam = this.cam;
    const cx = cam.ox + x * cam.s, cy = cam.oy + y * cam.s;
    circlePath(ctx, cx, cy, r * cam.s);
    ctx.fillStyle = def.chassis === 'aura' ? 'rgba(191,127,245,0.13)' : `rgba(255,255,255,${strong ? 0.22 : 0.1})`;
    ctx.fill();
    ctx.setLineDash([cam.s * 0.2, cam.s * 0.15]);
    ctx.strokeStyle = strong ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    if (def.minRange) {
      circlePath(ctx, cx, cy, def.minRange * cam.s);
      ctx.strokeStyle = 'rgba(241,78,84,0.35)';
      ctx.stroke();
    }
  }

  private drawPlacement(w: World, def: TowerDef, [c, r]: [number, number]): void {
    if (c < 0 || r < 0 || c >= w.cols || r >= w.rows) return;
    const ok = w.canBuild(c, r) && w.gold >= def.cost;
    const ctx = this.ctx, cam = this.cam;
    ctx.fillStyle = ok ? 'rgba(255,255,255,0.25)' : 'rgba(241,78,84,0.3)';
    ctx.fillRect(cam.ox + c * cam.s, cam.oy + r * cam.s, cam.s, cam.s);
    this.drawRange(c + 0.5, r + 0.5, def.range[0], def, true);
    drawTower(ctx, {
      def: def.id, tier: 1, x: cam.ox + (c + 0.5) * cam.s, y: cam.oy + (r + 0.5) * cam.s, R: bodyRadius(1) * cam.s,
      angle: -Math.PI / 2, colors: w.defaultColors, sockets: 0, time: this.time, alpha: ok ? 0.75 : 0.4, lw: Math.max(1.5, cam.s * 0.05),
    });
  }

  private drawTowerEntity(w: World, t: Tower, dt: number, opts: RenderOpts): void {
    const ctx = this.ctx, cam = this.cam;
    const rt = t.rt;
    const colors = rt?.colors ?? w.defaultColors;
    const cx = cam.ox + t.x * cam.s, cy = cam.oy + t.y * cam.s;
    const R = bodyRadius(t.tier) * cam.s;
    const vis = rt?.spec.visual;
    const aura = resolveVfx(rt, vis?.aura);
    if (aura) {
      drawLoop(ctx, cam, aura, t.x, t.y, colors, DAMAGE_COLORS[t.def.dtype], this.time + t.id, bodyRadius(t.tier) / 0.36, 0.9);
      this.fx.continuous(`t${t.id}`, aura, t.x, t.y, t.angle, dt, colors, DAMAGE_COLORS[t.def.dtype], bodyRadius(t.tier) / 0.36);
    }
    if (t.specState === 'forging') {
      // Forging: a spinning dashed ring in the fusion colours.
      circlePath(ctx, cx, cy, R * 1.55);
      ctx.setLineDash([R * 0.35, R * 0.25]);
      ctx.lineDashOffset = -this.time * R * 3;
      ctx.strokeStyle = colors.secondary;
      ctx.lineWidth = Math.max(2, R * 0.14);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (opts.selected === t) {
      circlePath(ctx, cx, cy, R * 1.62);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawTower(ctx, {
      def: t.def.id, tier: t.tier, x: cx, y: cy, R, angle: t.angle, colors, sockets: t.sockets.length, decor: vis?.body,
      recoil: t.recoil, time: this.time + t.id * 0.3, disabled: w.tick < t.disabledUntil, lw: Math.max(1.5, cam.s * 0.055),
    });
    if (t.aura > 0) {
      polyPath(ctx, cx + R * 0.95, cy - R * 0.95, Math.max(3, cam.s * 0.08), 4, Math.PI / 4);
      fillStroke(ctx, PAL.purple, 1.2);
    }
    if (t.level > 1) this.drawLevelTag(cx - R * 1.05, cy + R * 0.95, t.level);
  }

  /** A small green tag with the tower's level on the corner of its plinth. */
  private drawLevelTag(x: number, y: number, level: number): void {
    const ctx = this.ctx;
    const hgt = Math.max(10, this.cam.s * 0.26);
    const text = String(level);
    ctx.font = `700 ${Math.round(hgt * 0.78)}px Ubuntu, 'Trebuchet MS', sans-serif`;
    const wdt = Math.max(hgt, ctx.measureText(text).width + hgt * 0.5);
    ctx.beginPath();
    ctx.roundRect(x - wdt / 2, y - hgt / 2, wdt, hgt, hgt * 0.3);
    ctx.fillStyle = '#4fbf5c';
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, hgt * 0.12);
    ctx.strokeStyle = '#2d6b35';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + hgt * 0.04);
  }

  private drawZone(z: Zone, dt: number): void {
    const ctx = this.ctx, cam = this.cam;
    const tpl = z.tpl;
    const x = cam.ox + z.x * cam.s, y = cam.oy + z.y * cam.s;
    const r = tpl.radius * cam.s;
    const fade = Math.min(1, (z.life - z.age) / 0.4, z.age / 0.15);
    const c = tpl.color;
    ctx.globalAlpha = fade;
    switch (tpl.style) {
      case 'none':
        break;
      case 'dashed':
        circlePath(ctx, x, y, r);
        ctx.fillStyle = rgba(c, 0.12);
        ctx.fill();
        ctx.setLineDash([r * 0.2, r * 0.15]);
        ctx.strokeStyle = rgba(c, 0.7);
        ctx.lineWidth = Math.max(1.5, cam.s * 0.05);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'ripples':
        for (let i = 0; i < 3; i++) {
          const k = ((this.time * 0.8 + i / 3) % 1);
          circlePath(ctx, x, y, r * k);
          ctx.strokeStyle = rgba(c, 0.6 * (1 - k));
          ctx.lineWidth = Math.max(1.5, cam.s * 0.05);
          ctx.stroke();
        }
        break;
      case 'spiral':
      case 'vortex': {
        circlePath(ctx, x, y, r);
        ctx.fillStyle = rgba(c, 0.14);
        ctx.fill();
        ctx.strokeStyle = rgba(c, 0.55);
        ctx.lineWidth = Math.max(1.5, cam.s * 0.05);
        for (let arm = 0; arm < 3; arm++) {
          ctx.beginPath();
          for (let i = 0; i <= 20; i++) {
            const f = i / 20;
            const a = -this.time * (tpl.style === 'vortex' ? 3 : 1.5) + arm * 2.09 + f * 3;
            const px = x + Math.cos(a) * r * f, py = y + Math.sin(a) * r * f;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        break;
      }
      case 'hazard': {
        circlePath(ctx, x, y, r);
        ctx.fillStyle = rgba(c, 0.18);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = rgba(shade(c, 0.7), 0.45);
        ctx.lineWidth = Math.max(2, cam.s * 0.1);
        for (let d = -r * 2; d < r * 2; d += cam.s * 0.3) {
          ctx.beginPath();
          ctx.moveTo(x + d - r, y - r);
          ctx.lineTo(x + d + r, y + r);
          ctx.stroke();
        }
        ctx.restore();
        circlePath(ctx, x, y, r);
        ctx.strokeStyle = rgba(shade(c, 0.7), 0.7);
        ctx.lineWidth = Math.max(1.5, cam.s * 0.05);
        ctx.stroke();
        break;
      }
      case 'glyph':
        polyPath(ctx, x, y, r, 6, this.time);
        ctx.fillStyle = rgba(c, 0.12);
        ctx.fill();
        ctx.strokeStyle = rgba(c, 0.7);
        ctx.lineWidth = Math.max(1.5, cam.s * 0.05);
        ctx.stroke();
        polyPath(ctx, x, y, r * 0.6, 3, -this.time * 1.5);
        ctx.stroke();
        break;
      case 'grid': {
        ctx.save();
        circlePath(ctx, x, y, r);
        ctx.fillStyle = rgba(c, 0.12);
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = rgba(c, 0.45);
        ctx.lineWidth = 1.5;
        const step = cam.s * 0.25;
        ctx.beginPath();
        for (let d = -r; d <= r; d += step) {
          ctx.moveTo(x + d, y - r);
          ctx.lineTo(x + d, y + r);
          ctx.moveTo(x - r, y + d);
          ctx.lineTo(x + r, y + d);
        }
        ctx.stroke();
        ctx.restore();
        break;
      }
      default: {
        if (tpl.shape === 'ring') {
          circlePath(ctx, x, y, r);
          ctx.strokeStyle = rgba(c, 0.55);
          ctx.lineWidth = cam.s * 0.5;
          ctx.stroke();
        } else {
          circlePath(ctx, x, y, r);
          ctx.fillStyle = rgba(c, 0.2);
          ctx.fill();
          ctx.strokeStyle = rgba(shade(c, 0.75), 0.6);
          ctx.lineWidth = Math.max(1.5, cam.s * 0.05);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    if (tpl.vfx) {
      drawLoop(ctx, cam, tpl.vfx, z.x, z.y, z.rt.colors, DAMAGE_COLORS.kinetic, this.time, tpl.radius, fade);
      this.fx.continuous(`z${z.id}`, tpl.vfx, z.x, z.y, 0, dt, z.rt.colors, DAMAGE_COLORS.kinetic, Math.max(0.5, tpl.radius));
    }
  }

  private drawProjectile(p: Projectile, wx: number, wy: number): void {
    const ctx = this.ctx, cam = this.cam;
    const look = p.look;
    const lift = p.height * 0.45;
    const x = cam.ox + wx * cam.s, y = cam.oy + (wy - (p.motion === 'sky_drop' ? p.height : 0)) * cam.s;
    const r = Math.max(2, p.radius * cam.s * (1 + lift * 0.4));
    const ang = Math.atan2(p.vy, p.vx);
    // Trails.
    if (look.trail !== 'none') {
      let tr = this.trails.get(p.id);
      if (!tr) {
        tr = { pts: [], seen: 0 };
        this.trails.set(p.id, tr);
      }
      tr.pts.push(x, y);
      if (tr.pts.length > 20) tr.pts.splice(0, 2);
      const n = tr.pts.length / 2;
      if (n > 1) {
        if (look.trail === 'line' || look.trail === 'ribbon') {
          for (let i = 1; i < n; i++) {
            const k = i / n;
            ctx.globalAlpha = k * 0.7;
            ctx.strokeStyle = look.trailColor;
            ctx.lineWidth = look.trail === 'ribbon' ? r * 1.4 * k : Math.max(1, r * 0.45);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(tr.pts[i * 2 - 2], tr.pts[i * 2 - 1]);
            ctx.lineTo(tr.pts[i * 2], tr.pts[i * 2 + 1]);
            ctx.stroke();
          }
        } else if (look.trail === 'dots') {
          for (let i = 0; i < n - 1; i += 2) {
            ctx.globalAlpha = (i / n) * 0.8;
            circlePath(ctx, tr.pts[i * 2], tr.pts[i * 2 + 1], r * 0.35);
            ctx.fillStyle = look.trailColor;
            ctx.fill();
          }
        } else if (look.trail === 'ghost') {
          for (let i = 0; i < n - 1; i += 3) {
            ctx.globalAlpha = (i / n) * 0.35;
            shapePath(ctx, look.shape === 'orb' ? 'circle' : look.shape, tr.pts[i * 2], tr.pts[i * 2 + 1], r, ang + (look.spin ? p.age * 12 : 0));
            ctx.fillStyle = look.trailColor;
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    if (look.emitter) this.fx.continuous(`p${p.id}`, look.emitter, wx, wy, ang + Math.PI, 1 / 60, p.rt?.colors ?? { base: look.color, secondary: look.trailColor, tertiary: look.trailColor }, look.color, 0.6);
    if (look.glow || look.shape === 'orb') {
      ctx.globalCompositeOperation = 'lighter';
      const d = r * 3.2;
      ctx.drawImage(softSprite(quant(look.color)), x - d, y - d, d * 2, d * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    const rot = look.spin ? p.age * 14 : ang;
    const shape = look.shape === 'orb' ? 'circle' : look.shape;
    if (p.motion === 'mine') {
      const pulse = 1 + 0.12 * Math.sin(p.age * 8);
      shapePath(ctx, shape === 'circle' ? 'star' : shape, x, y, r * pulse * 1.3, p.age);
    } else {
      shapePath(ctx, shape, x, y, r, rot);
    }
    fillStroke(ctx, look.color, Math.max(1.2, cam.s * 0.045));
  }

  private drawEnemy(w: World, e: Enemy, wx: number, wy: number, dt: number): void {
    const ctx = this.ctx, cam = this.cam;
    // Flyers hover; 3D solids float and bob above their shadow.
    const solid = e.def.dim === 3;
    const hover = e.air ? 0.18 + Math.sin(this.time * 3 + e.id) * 0.03 : solid ? 0.2 + Math.sin(this.time * 2.3 + e.id * 1.7) * 0.06 : 0;
    const x = cam.ox + wx * cam.s, y = cam.oy + (wy - hover) * cam.s;
    const r = e.size * e.visScale * cam.s;
    const lw = Math.max(1.5, cam.s * 0.055);
    const stealthed = e.traitSet.has('stealth') && e.revealedUntil <= w.tick;
    let alpha = 1;
    if (stealthed) alpha = 0.28;
    if (e.burrowed) alpha = 0.3;
    if (hover > 0) {
      const k = 1 - hover * 0.9;
      ctx.beginPath();
      ctx.ellipse(cam.ox + wx * cam.s, cam.oy + (wy + 0.08) * cam.s, r * 0.95 * k, r * 0.42 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${(0.2 * k * alpha).toFixed(3)})`;
      ctx.fill();
    }
    // Status looks (under the body).
    for (const s of e.statuses) {
      if (s.def.vfx) {
        drawLoop(ctx, cam, s.def.vfx, wx, wy - hover, s.def.owner?.colors ?? w.defaultColors, s.def.tint, this.time, Math.max(0.6, e.size * 2.2), alpha);
        this.fx.continuous(`e${e.id}${s.def.key}`, s.def.vfx, wx, wy - hover, 0, dt, s.def.owner?.colors ?? w.defaultColors, s.def.tint, Math.max(0.5, e.size * 2));
      }
      if (s.def.overlay === 'glow') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6 * alpha;
        ctx.drawImage(softSprite(quant(s.def.tint)), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }
    // Tint from statuses + hit flash.
    let fill = e.def.color;
    if (e.def.abilities.some((a) => a.kind === 'mimic')) {
      let best = 0;
      let bt: string | null = null;
      for (const [k, v] of Object.entries(e.resist)) if ((v ?? 0) > best) { best = v ?? 0; bt = k; }
      if (bt) fill = lerpHex(fill, DAMAGE_COLORS[bt as keyof typeof DAMAGE_COLORS], Math.min(0.8, best * 1.2));
    }
    const tint = e.statuses.find((s) => s.def.overlay !== 'none' || !s.def.builtin);
    if (tint) fill = lerpHex(fill, tint.def.tint, 0.35);
    if (e.hitFlash > 0) fill = lerpHex(fill, '#ffffff', 0.35);
    // Two places at once: the hemicube's ghost shows where it will jump next.
    if (e.ghost >= 0 && !e.hardCC) {
      const g = pathOf(w, e).at(e.ghost, { x: 0, y: 0, ang: 0 });
      const gx = cam.ox + g.x * cam.s, gy = cam.oy + (g.y - hover) * cam.s;
      ctx.globalAlpha = 0.22 + 0.12 * Math.sin(this.time * 6 + e.id);
      drawEnemyBody(ctx, e.def, gx, gy, r, e.rot + Math.PI, this.time + e.id, e.def.color, lw, 0);
      ctx.globalAlpha = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(gx, gy);
      ctx.strokeStyle = rgba(e.def.color, 0.45);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Swift and dashing shapes leave speed streaks.
    if ((e.mods.includes('swift') || w.tick < e.dashUntil) && !e.hardCC) {
      ctx.strokeStyle = rgba(e.def.color, 0.5);
      ctx.lineWidth = Math.max(1.5, cam.s * 0.04);
      ctx.lineCap = 'round';
      for (const o of [-0.5, 0, 0.5]) {
        const bx = x - Math.cos(e.heading) * r * 1.2 - Math.sin(e.heading) * r * o;
        const by = y - Math.sin(e.heading) * r * 1.2 + Math.cos(e.heading) * r * o;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - Math.cos(e.heading) * r * 0.9, by - Math.sin(e.heading) * r * 0.9);
        ctx.stroke();
      }
    }
    if (e.mods.includes('elite')) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 * alpha;
      ctx.drawImage(softSprite(quant('#ffd166')), x - r * 2, y - r * 2, r * 4, r * 4);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = alpha;
    drawEnemyBody(ctx, e.def, x, y, r, e.rot, this.time * (e.hardCC ? 0 : 1) + e.id, fill, lw, this.artPixel());
    // Wings for flying shapes.
    if (e.air && e.def.dim === 2) {
      for (const sgn of [-1, 1]) {
        const wx2 = x - Math.sin(e.heading) * r * 1.15 * sgn, wy2 = y + Math.cos(e.heading) * r * 1.15 * sgn;
        polyPath(ctx, wx2, wy2, r * 0.45, 3, e.heading + Math.PI);
        fillStroke(ctx, lerpHex(fill, '#ffffff', 0.35), Math.max(1, lw * 0.7));
      }
    }
    if (e.immune) {
      circlePath(ctx, x, y, r * 1.2);
      ctx.strokeStyle = DAMAGE_COLORS[e.immune];
      ctx.lineWidth = lw * 1.4;
      ctx.stroke();
    }
    if (e.shield > 0 && e.maxShield > 0) {
      circlePath(ctx, x, y, r * 1.45);
      ctx.strokeStyle = rgba(PAL.shield, 0.35 + 0.5 * (e.shield / e.maxShield));
      ctx.lineWidth = Math.max(2, cam.s * 0.07);
      ctx.stroke();
    }
    if (e.traitSet.has('stealth') && !stealthed) {
      circlePath(ctx, x, y, r * 1.3);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(80,80,110,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e.burrowed && e.def.dim === 4) {
      // Phased through the 4th axis: a dashed hypersphere outline.
      circlePath(ctx, x, y, r * 1.4);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(191,127,245,0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Overlays on top.
    for (const s of e.statuses) this.drawOverlay(s.def.overlay, x, y, r, s.def.tint, e.id);
    ctx.globalAlpha = 1;
  }

  private drawOverlay(kind: string, x: number, y: number, r: number, tint: string, seed: number): void {
    const ctx = this.ctx, t = this.time;
    switch (kind) {
      case 'shell':
        polyPath(ctx, x, y, r * 1.35, 6, 0.3);
        ctx.fillStyle = rgba(tint, 0.35);
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', 0.8);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      case 'flames':
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + (i - 1) * 0.6;
          const h = r * (0.7 + 0.3 * Math.sin(t * 12 + i + seed));
          polyPath(ctx, x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, h * 0.45, 3, -Math.PI / 2);
          ctx.fillStyle = rgba(i === 1 ? '#ffe45c' : '#ff7a45', 0.85);
          ctx.fill();
        }
        break;
      case 'bubbles':
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.8 + i / 3 + seed * 0.1) % 1;
          circlePath(ctx, x + Math.sin(i * 2 + seed) * r * 0.6, y - k * r * 1.6, r * 0.18 * (1 - k * 0.5));
          ctx.strokeStyle = rgba(tint, 1 - k);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        break;
      case 'sparks':
        ctx.strokeStyle = rgba(tint, 0.9);
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const a = t * 9 + i * 2.1 + seed;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
          ctx.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4);
          ctx.stroke();
        }
        break;
      case 'orbit':
        for (let i = 0; i < 3; i++) {
          const a = t * 4 + (i * Math.PI * 2) / 3;
          circlePath(ctx, x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4, Math.max(2, r * 0.16));
          fillStroke(ctx, tint, 1);
        }
        break;
      case 'cracks':
        ctx.strokeStyle = 'rgba(60,40,20,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y - r * 0.3);
        ctx.lineTo(x, y + r * 0.1);
        ctx.lineTo(x + r * 0.4, y - r * 0.2);
        ctx.moveTo(x, y + r * 0.1);
        ctx.lineTo(x - r * 0.1, y + r * 0.6);
        ctx.stroke();
        break;
      case 'shadow':
        circlePath(ctx, x, y, r * 1.1);
        ctx.fillStyle = 'rgba(40,20,60,0.35)';
        ctx.fill();
        break;
      case 'drip': {
        const k = (t * 1.5 + seed * 0.3) % 1;
        shapePath(ctx, 'drop', x + r * 0.3, y + r * (0.6 + k), r * 0.2, Math.PI / 2);
        ctx.fillStyle = rgba(tint, 1 - k);
        ctx.fill();
        break;
      }
      case 'chains':
        ctx.strokeStyle = 'rgba(90,90,90,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        circlePath(ctx, x, y, r * 1.3);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
    }
  }

  private drawBars(e: Enemy, wx: number, wy: number): void {
    if (e.traitSet.has('boss')) return;
    const ctx = this.ctx, cam = this.cam;
    const stealthed = e.traitSet.has('stealth') && e.revealedUntil <= 0;
    const damaged = e.hp < e.maxHp - 0.5;
    const hasShield = e.maxShield > 0;
    const x = cam.ox + wx * cam.s, y = cam.oy + (wy + e.size * e.visScale + 0.2 - (e.air ? 0.18 : e.def.dim === 3 ? 0.12 : 0)) * cam.s;
    const bw = Math.max(0.55, e.size * 2.3) * cam.s, bh = Math.max(3, cam.s * 0.09);
    if ((damaged || (hasShield && e.shield < e.maxShield)) && !stealthed) {
      roundRectPath(ctx, x - bw / 2 - 1.5, y - bh / 2 - 1.5, bw + 3, bh + 3, bh);
      ctx.fillStyle = PAL.hpBg;
      ctx.fill();
      roundRectPath(ctx, x - bw / 2, y - bh / 2, Math.max(bh, bw * Math.max(0, e.hp / e.maxHp)), bh, bh / 2);
      ctx.fillStyle = PAL.hpFill;
      ctx.fill();
      if (hasShield && e.shield > 0) {
        roundRectPath(ctx, x - bw / 2, y - bh / 2 - bh - 1, Math.max(bh, bw * (e.shield / e.maxShield)), bh * 0.7, bh / 2);
        ctx.fillStyle = PAL.shield;
        ctx.fill();
      }
    }
    // Status icons.
    let n = 0;
    for (const s of e.statuses) {
      if (n >= 4) break;
      const ix = x + (n - 1.5) * cam.s * 0.2, iy = cam.oy + (wy - e.size * e.visScale - 0.2 - (e.air ? 0.18 : 0)) * cam.s;
      const ir = Math.max(2.5, cam.s * 0.07);
      const icon = s.def.icon;
      const shape = icon === 'flame' ? 'triangle' : icon === 'drop' ? 'drop' : icon === 'diamond' ? 'diamond' : icon === 'star' ? 'star' : icon === 'cross' ? 'cross' : icon === 'triangle' ? 'triangle' : icon === 'skull' ? 'pentagon' : icon === 'eye' ? 'circle' : icon === 'bell' ? 'pentagon' : icon === 'spiral' ? 'hexagon' : 'circle';
      shapePath(ctx, shape, ix, iy, ir, shape === 'drop' ? -Math.PI / 2 : 0);
      fillStroke(ctx, s.def.tint, 1.2);
      if (s.stacks > 1) outlinedText(ctx, String(s.stacks), ix + ir, iy + ir, ir * 1.6);
      n++;
    }
  }

  private drawBossBar(w: World): void {
    const boss = w.enemies.find((e) => e.traitSet.has('boss') && e.alive);
    if (!boss) return;
    const ctx = this.ctx;
    const bw = Math.min(460, this.view.w * 0.6);
    const x = this.view.x + this.view.w / 2 - bw / 2;
    const y = this.view.y + 10;
    roundRectPath(ctx, x - 3, y - 3, bw + 6, 20, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    roundRectPath(ctx, x, y, Math.max(14, bw * (boss.hp / boss.maxHp)), 14, 7);
    ctx.fillStyle = '#f14e54';
    ctx.fill();
    if (boss.shield > 0 && boss.maxShield > 0) {
      roundRectPath(ctx, x, y, Math.max(14, bw * (boss.shield / boss.maxShield)), 5, 3);
      ctx.fillStyle = PAL.shield;
      ctx.fill();
    }
    outlinedText(ctx, boss.def.name, x + bw / 2, y + 7, 13);
  }
}

export type { Palette3 };
