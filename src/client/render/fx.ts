// Renderer for the VFX language: particle emitters, beams, animated shapes,
// orbiters, floating text and screen shake. One-shot effects come from sim
// FxEvents; continuous effects (auras, status looks, zones, projectile
// emitters, sprays) are emitted each frame by the renderer.

import type { BeamLayer, OrbitersLayer, ParticleLayer, ShapeLayer, VfxDef, VfxLayer } from '../../effects/types.ts';
import type { Palette3 } from '../../sim/types.ts';
import { isHex, shade } from '../../content/colors.ts';
import { circlePath, lerpHex, outlinedText, polyPath, quant, rgba, shapePath, softSprite, starPath, type Ctx2D } from './draw.ts';

export interface Cam {
  s: number;
  ox: number;
  oy: number;
}

export type BeamLook = Omit<BeamLayer, 'kind'>;

interface Particle {
  x: number; y: number; vx: number; vy: number; age: number; life: number;
  s0: number; s1: number; a0: number; a1: number; c0: string; c1: string;
  shape: string; rot: number; spin: number; gravity: number; drag: number; wobble: number; wob: number;
  outline: boolean; glow: boolean;
}

interface ShapeAnim { x: number; y: number; age: number; delay: number; layer: ShapeLayer; color: string; scale: number; rot: number }
interface BeamAnim { x1: number; y1: number; x2: number; y2: number; pts: number[] | null; age: number; dur: number; look: BeamLook; color: string; core: string | null; scale: number }
interface TextAnim { x: number; y: number; age: number; dur: number; text: string; color: string; size: number }
interface OrbAnim { x: number; y: number; age: number; dur: number; layer: OrbitersLayer; color: string; scale: number }

const MAX_PARTICLES = 4000;
const TAU = Math.PI * 2;

export function resolve(ref: string | undefined, colors: Palette3, dcolor: string, tint: string | null, fallback: string): string {
  if (!ref) return tint ?? fallback;
  if (ref === 'base' || ref === 'secondary' || ref === 'tertiary' || ref === 'damage') {
    if (tint) return tint;
    return ref === 'damage' ? dcolor : colors[ref];
  }
  return isHex(ref) ? ref : fallback;
}

const r2 = (v: [number, number] | undefined, a: number, b: number): [number, number] => v ?? [a, b];
const rnd = (a: number, b: number) => a + (b - a) * Math.random();

export class Fx {
  particles: Particle[] = [];
  shapes: ShapeAnim[] = [];
  beams: BeamAnim[] = [];
  texts: TextAnim[] = [];
  orbs: OrbAnim[] = [];
  shakeT = 0;
  shakeS = 0;
  time = 0;
  quality = 1;
  shakeEnabled = true;
  private acc = new Map<string, number>();

  clear(): void {
    this.particles.length = 0;
    this.shapes.length = 0;
    this.beams.length = 0;
    this.texts.length = 0;
    this.orbs.length = 0;
    this.acc.clear();
  }

  // ------------------------------------------------------------ spawning

  /** Play a VFX definition once. */
  play(def: VfxDef, x: number, y: number, x2: number, y2: number, ang: number, colors: Palette3, dcolor: string, size = 1, tint: string | null = null, text: string | null = null): void {
    for (const layer of def.layers) this.playLayer(layer, x, y, x2, y2, ang, colors, dcolor, size, tint, text);
  }

  private playLayer(l: VfxLayer, x: number, y: number, x2: number, y2: number, ang: number, colors: Palette3, dcolor: string, size: number, tint: string | null, text: string | null): void {
    switch (l.kind) {
      case 'particles': {
        const n = l.count ?? Math.round((l.rate ?? 10) * 0.4);
        this.emit(l, x, y, x2, y2, ang, colors, dcolor, tint, n, size);
        break;
      }
      case 'shape': {
        const count = l.count ?? 1;
        const dur = l.duration ?? 0.4;
        const color = resolve(l.color, colors, dcolor, tint, colors.base);
        for (let i = 0; i < count; i++) {
          if (this.shapes.length > 500) break;
          this.shapes.push({ x, y, age: 0, delay: (i * dur * 0.5) / Math.max(1, count - 1 || 1), layer: l, color, scale: size, rot: ang });
        }
        break;
      }
      case 'beam': {
        if (this.beams.length > 400) break;
        const color = resolve(l.color, colors, dcolor, tint, colors.base);
        const core = l.core ? resolve(l.core, colors, dcolor, null, '#ffffff') : null;
        const bx2 = x2 === x && y2 === y ? x + Math.cos(ang) * 2 * size : x2;
        const by2 = x2 === x && y2 === y ? y + Math.sin(ang) * 2 * size : y2;
        this.beams.push({ x1: x, y1: y, x2: bx2, y2: by2, pts: null, age: 0, dur: l.duration ?? 0.25, look: l, color, core, scale: size });
        break;
      }
      case 'orbiters':
        this.orbs.push({ x, y, age: 0, dur: 0.7, layer: l, color: resolve(l.color, colors, dcolor, tint, colors.base), scale: size });
        break;
      case 'text':
        this.text(x, y - 0.3, text ?? l.text, resolve(l.color, colors, dcolor, tint, '#ffffff'), (l.size ?? 0.45) * Math.min(2, size), l.duration ?? 0.9);
        break;
      case 'shake':
        this.shake(l.strength * Math.min(2, size), l.duration ?? 0.25);
        break;
    }
  }

  /** Emit `n` particles from a particle layer. */
  emit(l: Omit<ParticleLayer, 'kind'>, x: number, y: number, x2: number, y2: number, ang: number, colors: Palette3, dcolor: string, tint: string | null, n: number, scale = 1): void {
    n = Math.min(80, Math.round(n * this.quality));
    if (n <= 0) return;
    const c0 = resolve(l.color, colors, dcolor, tint, colors.base);
    const c1 = l.color_end ? resolve(l.color_end, colors, dcolor, tint, c0) : c0;
    const size = r2(l.size, 0.09, 0.02);
    const alpha = r2(l.alpha, 1, 0);
    const speed = r2(l.speed, 1, 3);
    const life = r2(l.life, 0.3, 0.6);
    const spread = ((l.spread ?? 30) * Math.PI) / 180;
    const dir = l.direction ?? 'random';
    const from = l.emit_from ?? 'point';
    const radius = (l.radius ?? 0.4) * scale;
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      let px = x, py = y;
      let ea = Math.random() * TAU;
      if (from === 'ring') {
        px = x + Math.cos(ea) * radius;
        py = y + Math.sin(ea) * radius;
      } else if (from === 'area') {
        const rr = radius * Math.sqrt(Math.random());
        px = x + Math.cos(ea) * rr;
        py = y + Math.sin(ea) * rr;
      } else if (from === 'line') {
        const t = Math.random();
        const lx2 = x2 === x && y2 === y ? x + Math.cos(ang) * radius * 2 : x2;
        const ly2 = x2 === x && y2 === y ? y + Math.sin(ang) * radius * 2 : y2;
        px = x + (lx2 - x) * t;
        py = y + (ly2 - y) * t;
      } else {
        ea = ang;
      }
      let a: number;
      switch (dir) {
        case 'aim': a = ang + (Math.random() - 0.5) * spread; break;
        case 'back': a = ang + Math.PI + (Math.random() - 0.5) * spread; break;
        case 'radial': a = from === 'point' ? Math.random() * TAU : Math.atan2(py - y, px - x) + (Math.random() - 0.5) * spread * 0.3; break;
        case 'inward': a = Math.atan2(y - py, x - px) + (Math.random() - 0.5) * spread * 0.3; break;
        case 'up': a = -Math.PI / 2 + (Math.random() - 0.5) * spread; break;
        case 'down': a = Math.PI / 2 + (Math.random() - 0.5) * spread; break;
        case 'sideways': a = ang + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 + (Math.random() - 0.5) * spread; break;
        default: a = Math.random() * TAU;
      }
      const sp = rnd(speed[0], speed[1]) * Math.sqrt(scale);
      let lf = rnd(life[0], life[1]);
      if (dir === 'inward' && from !== 'point') lf = Math.min(lf, radius / Math.max(0.1, sp));
      this.particles.push({
        x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: lf,
        s0: size[0] * scale, s1: size[1] * scale, a0: alpha[0], a1: alpha[1], c0, c1, shape: l.shape ?? 'circle',
        rot: Math.random() * TAU, spin: (l.spin ?? 0) * (Math.random() < 0.5 ? -1 : 1), gravity: l.gravity ?? 0,
        drag: l.drag ?? 0, wobble: l.wobble ?? 0, wob: Math.random() * TAU, outline: !!l.outline, glow: !!l.glow,
      });
    }
  }

  /** Continuous emission (rate-based layers) for an effect attached to something. */
  continuous(key: string, def: VfxDef, x: number, y: number, ang: number, dt: number, colors: Palette3, dcolor: string, scale = 1, tint: string | null = null): void {
    def.layers.forEach((l, i) => {
      if (l.kind !== 'particles') return;
      const rate = l.rate ?? (l.count ? l.count * 0.8 : 0);
      if (rate <= 0) return;
      const k = key + ':' + i;
      const acc = (this.acc.get(k) ?? Math.random()) + rate * dt * this.quality;
      const n = Math.floor(acc);
      this.acc.set(k, acc - n);
      if (n > 0) this.emit(l, x, y, x, y, ang, colors, dcolor, tint, n / this.quality, scale);
    });
  }

  /** Spray: continuous emission from a particle look (Flame cone etc.). */
  spray(key: string, l: Omit<ParticleLayer, 'kind'>, x: number, y: number, ang: number, dt: number, colors: Palette3, dcolor: string): void {
    const rate = l.rate ?? 40;
    const acc = (this.acc.get(key) ?? 0) + rate * dt * this.quality;
    const n = Math.floor(acc);
    this.acc.set(key, acc - n);
    if (n > 0) this.emit({ direction: 'aim', ...l }, x, y, x, y, ang, colors, dcolor, null, n / this.quality, 1);
  }

  forget(prefix: string): void {
    for (const k of this.acc.keys()) if (k.startsWith(prefix)) this.acc.delete(k);
  }

  beam(x1: number, y1: number, x2: number, y2: number, look: BeamLook, colors: Palette3, dcolor: string, dur: number, pts: number[] | null = null): void {
    if (this.beams.length > 400) return;
    this.beams.push({
      x1, y1, x2, y2, pts, age: 0, dur, look, color: resolve(look.color, colors, dcolor, null, colors.base),
      core: look.core ? resolve(look.core, colors, dcolor, null, '#ffffff') : null, scale: 1,
    });
  }

  text(x: number, y: number, text: string, color: string, size = 0.4, dur = 0.8): void {
    if (this.texts.length > 160) this.texts.shift();
    this.texts.push({ x, y, age: 0, dur, text, color, size });
  }

  shake(strength: number, dur: number): void {
    if (!this.shakeEnabled) return;
    this.shakeS = Math.max(this.shakeS, Math.min(1, strength));
    this.shakeT = Math.max(this.shakeT, dur);
  }

  shakeOffset(): [number, number] {
    if (this.shakeT <= 0) return [0, 0];
    const k = this.shakeS * 0.25;
    return [(Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k];
  }

  // ------------------------------------------------------------ update / draw

  update(dt: number): void {
    this.time += dt;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeS = 0;
    }
    let j = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.wobble) {
        p.wob += dt * 8;
        p.x += Math.cos(p.wob) * p.wobble * dt * 0.5;
      }
      p.rot += p.spin * dt;
      this.particles[j++] = p;
    }
    this.particles.length = j;
    this.shapes = this.shapes.filter((s) => (s.age += dt) < s.delay + (s.layer.duration ?? 0.4));
    this.beams = this.beams.filter((b) => (b.age += dt) < b.dur);
    this.texts = this.texts.filter((t) => (t.age += dt) < t.dur);
    this.orbs = this.orbs.filter((o) => (o.age += dt) < o.dur);
  }

  draw(ctx: Ctx2D, cam: Cam): void {
    for (const s of this.shapes) {
      const t = (s.age - s.delay) / (s.layer.duration ?? 0.4);
      if (t < 0) continue;
      drawShapeLayer(ctx, cam, s.layer, s.x, s.y, s.color, s.scale, t, s.rot + (s.layer.rotate ?? 0) * s.age);
    }
    for (const b of this.beams) {
      const t = b.age / b.dur;
      const alpha = 1 - t * t;
      drawBeam(ctx, cam, b.pts ?? [b.x1, b.y1, b.x2, b.y2], b.look, b.color, b.core, alpha, this.time, b.scale);
    }
    for (const o of this.orbs) drawOrbiters(ctx, cam, o.layer, o.x, o.y, o.color, o.scale, this.time, 1 - o.age / o.dur);
    this.drawParticles(ctx, cam);
    for (const t of this.texts) {
      const k = t.age / t.dur;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      outlinedText(ctx, t.text, cam.ox + t.x * cam.s, cam.oy + (t.y - k * 0.7) * cam.s, t.size * cam.s * (k < 0.1 ? 0.6 + k * 4 : 1), t.color);
    }
    ctx.globalAlpha = 1;
  }

  private drawParticles(ctx: Ctx2D, cam: Cam): void {
    const lw = Math.max(1, cam.s * 0.03);
    for (const p of this.particles) {
      const k = p.age / p.life;
      const a = p.a0 + (p.a1 - p.a0) * k;
      if (a <= 0.01) continue;
      const r = Math.max(0.005, p.s0 + (p.s1 - p.s0) * k) * cam.s;
      const x = cam.ox + p.x * cam.s, y = cam.oy + p.y * cam.s;
      const c = p.c0 === p.c1 ? p.c0 : lerpHex(p.c0, p.c1, k);
      if (p.glow || p.shape === 'soft' || p.shape === 'smoke') {
        ctx.globalAlpha = a * (p.shape === 'smoke' ? 0.8 : 1);
        if (p.glow) ctx.globalCompositeOperation = 'lighter';
        const img = softSprite(quant(c));
        const d = r * (p.shape === 'spark' ? 2.4 : 2.2);
        ctx.drawImage(img, x - d, y - d, d * 2, d * 2);
        ctx.globalCompositeOperation = 'source-over';
        if (p.shape === 'soft' || p.shape === 'smoke') continue;
      }
      ctx.globalAlpha = a;
      if (p.shape === 'spark' || p.shape === 'line') {
        const len = Math.max(r * 3, Math.hypot(p.vx, p.vy) * cam.s * 0.05);
        const ang = Math.atan2(p.vy, p.vx);
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(1, r * 0.7);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5);
        ctx.lineTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5);
        ctx.stroke();
        continue;
      }
      if (p.shape === 'ring' || p.shape === 'bubble') {
        circlePath(ctx, x, y, r);
        if (p.shape === 'bubble') {
          ctx.fillStyle = rgba(c, 0.25);
          ctx.fill();
        }
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.stroke();
        continue;
      }
      if (p.shape === 'flake') {
        shapePath(ctx, 'flake', x, y, r, p.rot);
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(1, r * 0.35);
        ctx.lineCap = 'round';
        ctx.stroke();
        continue;
      }
      const shp = p.shape === 'circle' ? 'circle' : p.shape;
      shapePath(ctx, shp === 'square' ? 'square' : shp, x, y, r, p.rot);
      ctx.fillStyle = c;
      ctx.fill();
      if (p.outline) {
        ctx.strokeStyle = shade(c, 0.72);
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------ shared draw helpers

export function drawShapeLayer(ctx: Ctx2D, cam: Cam, l: ShapeLayer, wx: number, wy: number, color: string, scale: number, t: number, rot: number, alphaMul = 1): void {
  const [r0, r1] = l.radius ?? [0.1, 0.8];
  const [a0, a1] = l.alpha ?? [1, 0];
  const k = Math.min(1, Math.max(0, t));
  const ease = 1 - (1 - k) * (1 - k);
  const r = (r0 + (r1 - r0) * ease) * scale * cam.s;
  const a = (a0 + (a1 - a0) * k) * alphaMul;
  if (a <= 0.01 || r <= 0.3) return;
  const x = cam.ox + wx * cam.s, y = cam.oy + wy * cam.s;
  const thick = Math.max(1, (l.thickness ?? 0.05) * cam.s * Math.max(0.6, Math.min(1.5, scale)));
  const fill = l.fill ?? l.shape === 'circle';
  ctx.globalAlpha = a;
  if (l.glow) {
    ctx.globalCompositeOperation = 'lighter';
    const img = softSprite(quant(color));
    ctx.drawImage(img, x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.setLineDash(l.dashed ? [thick * 2.5, thick * 2] : []);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sides = l.sides ?? 6;
  switch (l.shape ?? 'ring') {
    case 'circle':
    case 'ring':
      circlePath(ctx, x, y, r);
      break;
    case 'polygon':
      polyPath(ctx, x, y, r, Math.max(3, sides), rot);
      break;
    case 'star':
      starPath(ctx, x, y, r, Math.max(3, sides), rot, 0.5);
      break;
    case 'cross':
      shapePath(ctx, 'cross', x, y, r, rot);
      break;
    case 'crescent':
      shapePath(ctx, 'crescent', x, y, r / 1.3, rot);
      break;
    case 'spiral': {
      ctx.beginPath();
      const turns = 2.2;
      for (let i = 0; i <= 48; i++) {
        const f = i / 48;
        const aa = rot + f * turns * Math.PI * 2;
        const rr = r * f;
        const px = x + Math.cos(aa) * rr, py = y + Math.sin(aa) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      break;
    }
    case 'rays': {
      ctx.beginPath();
      const n = Math.max(3, sides);
      for (let i = 0; i < n; i++) {
        const aa = rot + (i / n) * Math.PI * 2;
        ctx.moveTo(x + Math.cos(aa) * r * 0.45, y + Math.sin(aa) * r * 0.45);
        ctx.lineTo(x + Math.cos(aa) * r, y + Math.sin(aa) * r);
      }
      break;
    }
    case 'glyph': {
      const n = Math.max(3, sides);
      polyPath(ctx, x, y, r, n, rot);
      ctx.strokeStyle = color;
      ctx.lineWidth = thick;
      ctx.stroke();
      starPath(ctx, x, y, r * 0.8, n, -rot * 1.5, 0.45);
      ctx.stroke();
      circlePath(ctx, x, y, r * 0.22);
      break;
    }
  }
  if (fill && l.shape !== 'rays' && l.shape !== 'spiral') {
    ctx.fillStyle = color;
    ctx.fill();
    if (!l.glow) {
      ctx.strokeStyle = shade(color, 0.75);
      ctx.lineWidth = Math.max(1, cam.s * 0.04);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = thick;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

export function drawOrbiters(ctx: Ctx2D, cam: Cam, l: OrbitersLayer, wx: number, wy: number, color: string, scale: number, time: number, alpha = 1): void {
  const n = l.count;
  const r = l.radius * scale;
  const size = (l.size ?? 0.07) * Math.min(1.6, scale) * cam.s;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const a = time * (l.speed ?? 2) + (i / n) * Math.PI * 2;
    const rr = r * (1 + (l.wobble ?? 0) * 0.2 * Math.sin(time * 4 + i));
    const x = cam.ox + (wx + Math.cos(a) * rr) * cam.s;
    const y = cam.oy + (wy + Math.sin(a) * rr) * cam.s;
    if (l.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(softSprite(quant(color)), x - size * 2.2, y - size * 2.2, size * 4.4, size * 4.4);
      ctx.globalCompositeOperation = 'source-over';
    }
    shapePath(ctx, l.shape === 'soft' ? 'circle' : l.shape ?? 'circle', x, y, size, a);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = shade(color, 0.72);
    ctx.lineWidth = Math.max(1, size * 0.3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A looping effect (aura / status / zone): shapes cycle, orbiters spin; particles are emitted separately. */
export function drawLoop(ctx: Ctx2D, cam: Cam, def: VfxDef, x: number, y: number, colors: Palette3, dcolor: string, time: number, scale = 1, alpha = 1, tint: string | null = null): void {
  for (const l of def.layers) {
    if (l.kind === 'shape') {
      const dur = l.duration ?? 1;
      const count = l.count ?? 1;
      for (let i = 0; i < count; i++) {
        const t = ((time + (i * dur) / count) % dur) / dur;
        drawShapeLayer(ctx, cam, l, x, y, resolve(l.color, colors, dcolor, tint, colors.base), scale, t, (l.rotate ?? 0) * time, alpha);
      }
    } else if (l.kind === 'orbiters') {
      drawOrbiters(ctx, cam, l, x, y, resolve(l.color, colors, dcolor, tint, colors.base), scale, time, alpha);
    }
  }
}

function beamPoints(x1: number, y1: number, x2: number, y2: number, style: string, amp: number, freq: number, phase: number, s: number): number[][] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
  const steps = Math.max(2, Math.min(80, Math.round(len * 6)));
  const out: number[][] = [];
  const strands = style === 'helix' ? 2 : 1;
  for (let k = 0; k < strands; k++) {
    const pts: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let off = 0;
      const d = t * len;
      if (style === 'wave' || style === 'helix') off = Math.sin(d * freq * Math.PI * 2 - phase + k * Math.PI) * amp;
      else if (style === 'zigzag') off = ((((d * freq * 2 - phase / Math.PI) % 2) + 2) % 2 - 1) * amp * (i % 2 ? 1 : -1);
      else if (style === 'lightning') off = i === 0 || i === steps ? 0 : (Math.random() - 0.5) * 2 * amp;
      const env = Math.min(1, t * 6, (1 - t) * 6);
      pts.push((x1 + (x2 - x1) * t + nx * off * env) * s, (y1 + (y2 - y1) * t + ny * off * env) * s);
    }
    out.push(pts);
  }
  return out;
}

/** Draw a beam along a polyline of world points [x1, y1, x2, y2, ...]. */
export function drawBeam(ctx: Ctx2D, cam: Cam, pts: number[], look: BeamLook, color: string, core: string | null, alpha: number, time: number, scale = 1): void {
  const style = look.style ?? 'solid';
  const [w0, w1] = look.width ?? [0.12, 0.1];
  const pulse = 1 + (look.pulse ?? 0) * Math.sin(time * 25);
  const flick = look.flicker ? 1 - look.flicker * Math.random() : 1;
  const a = alpha * flick;
  if (a <= 0.02) return;
  const amp = (look.amplitude ?? (style === 'lightning' ? 0.2 : 0.15)) * scale;
  const freq = look.frequency ?? (style === 'zigzag' ? 3 : 1.5);
  const phase = time * (look.scroll ?? (style === 'helix' || style === 'wave' ? 8 : 0));
  ctx.save();
  ctx.translate(cam.ox, cam.oy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x1 = pts[i], y1 = pts[i + 1], x2 = pts[i + 2], y2 = pts[i + 3];
    const width = (w0 + (w1 - w0) * (pts.length > 4 ? i / (pts.length - 2) : 0)) * cam.s * pulse * scale;
    const strands = style === 'solid' || style === 'dashed' || style === 'dotted' || style === 'chain' || style === 'twin'
      ? [[x1 * cam.s, y1 * cam.s, x2 * cam.s, y2 * cam.s]]
      : beamPoints(x1, y1, x2, y2, style, amp, freq, phase, cam.s);
    const drawPath = (p: number[]) => {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
    };
    if (look.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * 2.6;
      for (const p of strands) { drawPath(p); ctx.stroke(); }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = a;
    if (style === 'twin') {
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = (-(y2 - y1) / len) * width * 0.9, ny = ((x2 - x1) / len) * width * 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, width * 0.55);
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x1 * cam.s + nx * sgn, y1 * cam.s + ny * sgn);
        ctx.lineTo(x2 * cam.s + nx * sgn, y2 * cam.s + ny * sgn);
        ctx.stroke();
      }
    } else if (style === 'dotted' || style === 'chain') {
      const len = Math.hypot(x2 - x1, y2 - y1) * cam.s;
      const step = Math.max(3, width * (style === 'chain' ? 2.2 : 2.5));
      const off = ((time * (look.scroll ?? 3) * cam.s) % step + step) % step;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.fillStyle = color;
      ctx.strokeStyle = style === 'chain' ? shade(color, 0.7) : color;
      ctx.lineWidth = Math.max(1, width * 0.3);
      for (let d = off; d < len; d += step) {
        const px = x1 * cam.s + Math.cos(ang) * d, py = y1 * cam.s + Math.sin(ang) * d;
        ctx.beginPath();
        if (style === 'chain') {
          ctx.ellipse(px, py, width * 0.9, width * 0.5, ang + (Math.round(d / step) % 2 ? Math.PI / 2 : 0), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.arc(px, py, Math.max(1, width * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      if (style === 'dashed') {
        ctx.setLineDash([width * 3, width * 2]);
        ctx.lineDashOffset = -time * (look.scroll ?? 6) * cam.s;
      }
      // Dark outline, then the colour (diep look), then the core.
      ctx.strokeStyle = shade(color, 0.7);
      ctx.lineWidth = width + Math.max(1.5, cam.s * 0.04);
      if (!look.glow) for (const p of strands) { drawPath(p); ctx.stroke(); }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, width);
      for (const p of strands) { drawPath(p); ctx.stroke(); }
      ctx.setLineDash([]);
      if (core) {
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(1, width * 0.38);
        for (const p of strands) { drawPath(p); ctx.stroke(); }
      }
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
