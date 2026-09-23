// diep.io-style drawing primitives: flat fills, darker outlines, rounded joins.

import { shade } from '../../content/colors.ts';

export type Ctx2D = CanvasRenderingContext2D;

const rgbCache = new Map<string, [number, number, number]>();

export function rgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function lerpHex(a: string, b: string, t: number): string {
  if (a === b || t <= 0) return a;
  if (t >= 1) return b;
  const ca = rgb(a), cb = rgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bb = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bb).toString(16).slice(1);
}

/** Fill + darker stroke of the same hue, the core of the diep look. */
export function fillStroke(ctx: Ctx2D, fill: string, lw: number, outline?: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.strokeStyle = outline ?? shade(fill, 0.75);
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function polyPath(ctx: Ctx2D, x: number, y: number, r: number, sides: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function starPath(ctx: Ctx2D, x: number, y: number, r: number, points: number, rot: number, inner = 0.45): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function circlePath(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
}

export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Enemy / particle shape path centred on (x, y) with radius r. */
export function shapePath(ctx: Ctx2D, shape: string, x: number, y: number, r: number, rot: number): void {
  switch (shape) {
    case 'square': polyPath(ctx, x, y, r * 1.2, 4, rot + Math.PI / 4); break;
    case 'triangle': polyPath(ctx, x, y, r * 1.25, 3, rot - Math.PI / 2); break;
    case 'pentagon': polyPath(ctx, x, y, r * 1.1, 5, rot - Math.PI / 2); break;
    case 'hexagon': polyPath(ctx, x, y, r * 1.05, 6, rot); break;
    case 'heptagon': polyPath(ctx, x, y, r * 1.05, 7, rot); break;
    case 'octagon': polyPath(ctx, x, y, r * 1.05, 8, rot + Math.PI / 8); break;
    case 'diamond': {
      ctx.beginPath();
      const c = Math.cos(rot), s = Math.sin(rot);
      const pts: [number, number][] = [[r * 1.35, 0], [0, r * 0.85], [-r * 1.35, 0], [0, -r * 0.85]];
      pts.forEach(([px, py], i) => {
        const X = x + px * c - py * s, Y = y + px * s + py * c;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      break;
    }
    case 'star': starPath(ctx, x, y, r * 1.35, 5, rot - Math.PI / 2, 0.5); break;
    case 'shard': {
      ctx.beginPath();
      const c = Math.cos(rot), s = Math.sin(rot);
      const pts: [number, number][] = [[r * 1.6, 0], [0, r * 0.55], [-r * 1.1, 0], [0, -r * 0.55]];
      pts.forEach(([px, py], i) => {
        const X = x + px * c - py * s, Y = y + px * s + py * c;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      break;
    }
    case 'needle': {
      ctx.beginPath();
      const c = Math.cos(rot), s = Math.sin(rot);
      const pts: [number, number][] = [[r * 2, 0], [0, r * 0.4], [-r * 1.2, 0], [0, -r * 0.4]];
      pts.forEach(([px, py], i) => {
        const X = x + px * c - py * s, Y = y + px * s + py * c;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      break;
    }
    case 'crescent':
    case 'blade': {
      ctx.beginPath();
      const inner = shape === 'blade' ? 0.8 : 0.6;
      ctx.arc(x, y, r * 1.3, rot - 1.9, rot + 1.9);
      ctx.arc(x - Math.cos(rot) * r * 0.35, y - Math.sin(rot) * r * 0.35, r * 1.3 * inner, rot + 1.6, rot - 1.6, true);
      ctx.closePath();
      break;
    }
    case 'petal': {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r * 0.6, rot, 0, Math.PI * 2);
      break;
    }
    case 'drop': {
      ctx.beginPath();
      const c = Math.cos(rot), s = Math.sin(rot);
      ctx.arc(x, y, r * 0.8, rot + Math.PI / 2, rot - Math.PI / 2);
      ctx.lineTo(x + c * r * 1.6, y + s * r * 1.6);
      ctx.closePath();
      break;
    }
    case 'flake': {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = rot + (i * Math.PI) / 3;
        ctx.moveTo(x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3);
        ctx.lineTo(x - Math.cos(a) * r * 1.3, y - Math.sin(a) * r * 1.3);
      }
      break;
    }
    case 'cross': {
      ctx.beginPath();
      const w = r * 0.45;
      ctx.rect(x - r, y - w / 2, r * 2, w);
      ctx.rect(x - w / 2, y - r, w, r * 2);
      break;
    }
    default:
      circlePath(ctx, x, y, r);
  }
}

/** diep-style label: white bold text with a dark outline. */
export function outlinedText(ctx: Ctx2D, text: string, x: number, y: number, size: number, color = '#ffffff', align: CanvasTextAlign = 'center'): void {
  ctx.font = `700 ${Math.round(size)}px Ubuntu, "Trebuchet MS", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.strokeStyle = '#333333';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

const softCache = new Map<string, HTMLCanvasElement>();
/** A cached soft radial "glow" sprite for a colour. */
export function softSprite(hex: string): HTMLCanvasElement {
  let c = softCache.get(hex);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, rgba(hex, 1));
  grad.addColorStop(0.35, rgba(hex, 0.55));
  grad.addColorStop(1, rgba(hex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  if (softCache.size > 400) softCache.clear();
  softCache.set(hex, c);
  return c;
}

/** Quantize a colour so glow sprites can be cached. */
export function quant(hex: string): string {
  const [r, g, b] = rgb(hex);
  const q = (v: number) => Math.min(255, Math.round(v / 24) * 24);
  return '#' + ((1 << 24) | (q(r) << 16) | (q(g) << 8) | q(b)).toString(16).slice(1);
}
