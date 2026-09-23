// Enemy bodies: flat polygons (2D), rotating polyhedra (3D) and rotating
// 4D polytope projections (4D), all in the diep fill + outline style.

import type { EnemyDef } from '../../sim/types.ts';
import { fillStroke, polyPath, circlePath, type Ctx2D } from './draw.ts';
import { drawModel, drawSphere, getModel } from './geometry.ts';

export function drawEnemyBody(ctx: Ctx2D, def: EnemyDef, x: number, y: number, r: number, rot: number, time: number, fill: string, lw: number): void {
  if (def.dim === 2) {
    if (def.n === 0) circlePath(ctx, x, y, r);
    else polyPath(ctx, x, y, r * (def.n === 3 ? 1.25 : def.n === 4 ? 1.15 : 1.08), def.n, rot - Math.PI / 2);
    fillStroke(ctx, fill, lw);
    return;
  }
  if (def.poly === 'sphere' || def.poly === 'glome') {
    drawSphere(ctx, x, y, r, time, fill, lw, def.poly === 'glome');
    return;
  }
  const m = def.poly ? getModel(def.poly) : null;
  if (!m) {
    circlePath(ctx, x, y, r);
    fillStroke(ctx, fill, lw);
    return;
  }
  drawModel(ctx, m, x, y, r * (def.dim === 4 ? 1.3 : 1.2), time * (def.dim === 4 ? 0.8 : 0.6) + rot, fill, lw, def.dim === 4 ? 0.7 : 1);
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
