// Enemy bodies. 2D polygons stay flat (fill + outline). 3D solids break the
// style on purpose: glossy, tumbling polyhedra in the manner of an early-2000s
// render, drawn on a buffer at half resolution or so and scaled up without
// smoothing, for a touch of aliasing. 4D polytopes are rotating wireframes.

import type { EnemyDef } from '../../sim/types.ts';
import { fillStroke, polyPath, circlePath, type Ctx2D } from './draw.ts';
import { drawModel, drawShadedSphere, drawSolid, drawSphere, getModel } from './geometry.ts';

let scratch: HTMLCanvasElement | null = null;
let sctx: CanvasRenderingContext2D | null = null;

/** Draw via a lower-resolution buffer, snapped to a `px`-sized screen grid. */
function pixelated(ctx: Ctx2D, x: number, y: number, r: number, px: number, draw: (c: Ctx2D, cx: number, cy: number, rr: number) => void): void {
  const half = Math.ceil((r * 1.4) / px) + 1;
  const n = half * 2;
  if (!scratch || scratch.width < n) {
    scratch = document.createElement('canvas');
    scratch.width = scratch.height = Math.max(64, n);
    sctx = scratch.getContext('2d', { willReadFrequently: true })!;
  }
  const c = sctx!;
  c.clearRect(0, 0, n, n);
  const ox = Math.round(x / px) - half, oy = Math.round(y / px) - half;
  draw(c, x / px - ox, y / px - oy, r / px);
  // Hard pixel edges: anti-aliased fringe pixels become fully on or off.
  const img = c.getImageData(0, 0, n, n);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    // ImageData is not premultiplied, so only the alpha needs snapping.
    const a = d[i];
    if (a !== 0 && a !== 255) d[i] = a < 110 ? 0 : 255;
  }
  c.putImageData(img, 0, 0);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, n, n, ox * px, oy * px, n * px, n * px);
  ctx.imageSmoothingEnabled = smooth;
}

/**
 * `px` is the size of one art pixel for 3D solids in screen units; 1 or less
 * draws them smooth (small UI icons).
 */
/** A star polygon {n/k}: every k-th vertex joined; when n and k share a factor it is a compound (a hexagram is two triangles). */
function starPolygonPath(ctx: Ctx2D, x: number, y: number, r: number, n: number, k: number, rot: number): void {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const parts = g(n, k);
  ctx.beginPath();
  for (let p = 0; p < parts; p++) {
    for (let i = 0; i <= n / parts; i++) {
      const a = rot + ((p + i * k) % n) * ((Math.PI * 2) / n);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}

/** The digon: two sides meeting at both ends, drawn as a lens. */
function lensPath(ctx: Ctx2D, x: number, y: number, r: number, rot: number): void {
  const ux = Math.cos(rot), uy = Math.sin(rot);
  const ax = x - ux * r * 1.35, ay = y - uy * r * 1.35, bx = x + ux * r * 1.35, by = y + uy * r * 1.35;
  const nx = -uy * r * 0.62, ny = ux * r * 0.62;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(x + nx * 2, y + ny * 2, bx, by);
  ctx.quadraticCurveTo(x - nx * 2, y - ny * 2, ax, ay);
  ctx.closePath();
}

/** An apeirogon: infinitely many sides, straightened into a zigzag that never ends. */
function drawZigzag(ctx: Ctx2D, x: number, y: number, r: number, rot: number, time: number, fill: string, lw: number): void {
  const seg = 5;
  const ux = Math.cos(rot), uy = Math.sin(rot), nx = -uy, ny = ux;
  const pts: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg - 0.5) * 2.4 * r;
    const o = (i % 2 ? 1 : -1) * r * 0.55 * (1 + 0.15 * Math.sin(time * 4 + i));
    pts.push([x + ux * t + nx * o, y + uy * t + ny * o]);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [w, c] of [[r * 0.62 + lw * 2, 'rgba(40,40,50,0.9)'], [r * 0.62, fill]] as [number, string][]) {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  // The line runs on forever: faded tails at both ends.
  ctx.globalAlpha *= 0.35;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[0][0] - ux * r * 0.8 + nx * r * 0.5, pts[0][1] - uy * r * 0.8 + ny * r * 0.5);
  ctx.moveTo(pts[seg][0], pts[seg][1]);
  ctx.lineTo(pts[seg][0] + ux * r * 0.8 + nx * r * 0.5, pts[seg][1] + uy * r * 0.8 + ny * r * 0.5);
  ctx.strokeStyle = fill;
  ctx.lineWidth = r * 0.4;
  ctx.stroke();
  ctx.globalAlpha /= 0.35;
}

export function drawEnemyBody(ctx: Ctx2D, def: EnemyDef, x: number, y: number, r: number, rot: number, time: number, fill: string, lw: number, px = 0): void {
  if (def.dim === 2) {
    if (def.shape === 'zigzag') return drawZigzag(ctx, x, y, r, rot, time, fill, lw);
    if (def.shape === 'lens') lensPath(ctx, x, y, r, rot);
    else if (def.n === 0) circlePath(ctx, x, y, r);
    else if (def.star) starPolygonPath(ctx, x, y, r * 1.3, def.n, def.star, rot - Math.PI / 2);
    else polyPath(ctx, x, y, r * (def.n === 3 ? 1.25 : def.n === 4 ? 1.15 : 1.08), def.n, rot - Math.PI / 2);
    fillStroke(ctx, fill, lw);
    return;
  }
  if (def.dim === 3) {
    const m = def.poly && def.poly !== 'sphere' ? getModel(def.poly) : null;
    const t = time * 0.6 + rot;
    const body = (c: Ctx2D, cx: number, cy: number, rr: number, ol: number) =>
      m ? drawSolid(c, m, cx, cy, rr * 1.38, t, fill, ol) : drawShadedSphere(c, cx, cy, rr, t, fill, ol);
    if (px > 1) pixelated(ctx, x, y, r, px, (c, cx, cy, rr) => body(c, cx, cy, rr, 1));
    else body(ctx, x, y, r, Math.max(1, lw * 0.6));
    return;
  }
  if (def.poly === 'glome') {
    drawSphere(ctx, x, y, r, time, fill, lw, true);
    return;
  }
  const m = def.poly ? getModel(def.poly) : null;
  if (!m) {
    circlePath(ctx, x, y, r);
    fillStroke(ctx, fill, lw);
    return;
  }
  drawModel(ctx, m, x, y, r * 1.3, time * 0.8 + rot, fill, lw, 0.7);
}

/** Small standalone canvas of an enemy for the UI (wave preview, codex). */
export function enemyIcon(def: EnemyDef, size: number, time = 0.7): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  drawEnemyBody(ctx, def, size / 2, size / 2, size * 0.34, 0.3, time, def.color, Math.max(1.5, size * 0.06));
  return c;
}
