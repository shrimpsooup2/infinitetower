// Towers are diep.io tanks: grey barrels under a coloured body. Each chassis
// and tier has its own silhouette. Unpowered towers are team blue; once a
// power is socketed the body takes the BASE power's colour, the secondary
// shows as an inner ring and the tertiary as the core.

import type { Palette3 } from '../../sim/types.ts';
import { PAL, shade } from '../../content/colors.ts';
import { circlePath, fillStroke, polyPath, starPath, softSprite, quant, type Ctx2D } from './draw.ts';

interface Barrel {
  len: number; // in body radii
  w: number;
  w2?: number; // end width (trapezoid)
  off?: number; // lateral offset
  ang?: number; // angle offset
  back?: number; // start offset along the barrel
  tri?: boolean;
}

const B = (len: number, w: number, o: Partial<Barrel> = {}): Barrel => ({ len, w, ...o });

const BARRELS: Record<string, Barrel[][]> = {
  bolt: [
    [B(1.85, 0.8)],
    [B(1.85, 0.72, { off: -0.42 }), B(1.85, 0.72, { off: 0.42 })],
    [B(1.7, 0.66, { off: -0.52, ang: -0.12 }), B(1.7, 0.66, { off: 0.52, ang: 0.12 }), B(2.0, 0.74)],
  ],
  cannon: [[B(1.8, 1.2)], [B(1.85, 1.42)], [B(1.9, 1.72)]],
  frost: [
    [B(1.55, 0.6, { off: -0.38 }), B(1.55, 0.6, { off: 0.38 })],
    [B(1.8, 0.6, { off: -0.38 }), B(1.8, 0.6, { off: 0.38 })],
    [B(1.8, 0.6, { off: -0.38 }), B(1.8, 0.6, { off: 0.38 }), B(1.3, 0.5, { ang: -0.8 }), B(1.3, 0.5, { ang: 0.8 })],
  ],
  arc: [[], [], []],
  rail: [
    [B(2.3, 0.58)],
    [B(2.65, 0.54)],
    [B(2.7, 0.54), B(1.15, 0.9, { w2: 1.35 })],
  ],
  mortar: [
    [B(1.45, 0.95, { w2: 1.4 })],
    [B(1.5, 1.05, { w2: 1.6 })],
    [B(1.55, 1.15, { w2: 1.8 }), B(1.0, 0.45, { ang: -1.1 }), B(1.0, 0.45, { ang: 1.1 })],
  ],
  flame: [
    [B(1.55, 0.7, { w2: 1.2 })],
    [B(1.7, 0.72, { w2: 1.35 })],
    [B(1.75, 0.72, { w2: 1.45 }), B(0.9, 0.6, { ang: Math.PI - 0.5 }), B(0.9, 0.6, { ang: Math.PI + 0.5 })],
  ],
  prism: [
    [B(1.7, 1.05, { tri: true })],
    [B(1.9, 1.2, { tri: true })],
    [B(1.95, 1.2, { tri: true }), B(1.2, 0.7, { tri: true, ang: -0.9 }), B(1.2, 0.7, { tri: true, ang: 0.9 })],
  ],
  beacon: [[], [], []],
  hive: [
    [B(1.25, 0.7, { w2: 1.15, ang: -Math.PI / 2 }), B(1.25, 0.7, { w2: 1.15, ang: Math.PI / 2 })],
    [B(1.35, 0.78, { w2: 1.3, ang: -Math.PI / 2 }), B(1.35, 0.78, { w2: 1.3, ang: Math.PI / 2 })],
    [0, 1, 2, 3].map((i) => B(1.3, 0.72, { w2: 1.25, ang: (i * Math.PI) / 2 + Math.PI / 4 })),
  ],
};

export function bodyRadius(tier: number): number {
  return [0.33, 0.37, 0.41][tier - 1] ?? 0.33;
}

function drawBarrel(ctx: Ctx2D, b: Barrel, R: number, lw: number, recoil: number): void {
  ctx.save();
  if (b.ang) ctx.rotate(b.ang);
  const back = (b.back ?? 0) * R - recoil * R * 0.25;
  const len = b.len * R;
  const w = b.w * R;
  const w2 = (b.w2 ?? b.w) * R;
  const off = (b.off ?? 0) * R;
  ctx.beginPath();
  if (b.tri) {
    ctx.moveTo(back, off - w / 2);
    ctx.lineTo(back + len, off);
    ctx.lineTo(back, off + w / 2);
  } else {
    ctx.moveTo(back, off - w / 2);
    ctx.lineTo(back + len, off - w2 / 2);
    ctx.lineTo(back + len, off + w2 / 2);
    ctx.lineTo(back, off + w / 2);
  }
  ctx.closePath();
  fillStroke(ctx, PAL.barrel, lw, '#727272');
  ctx.restore();
}

export interface TowerArt {
  def: string;
  tier: number;
  x: number; // screen px
  y: number;
  R: number; // body radius in px
  angle: number;
  colors: Palette3;
  sockets: number;
  decor?: string;
  recoil?: number;
  time: number;
  alpha?: number;
  disabled?: boolean;
  lw: number;
}

export function drawTower(ctx: Ctx2D, a: TowerArt): void {
  const { x, y, R, lw, time } = a;
  const body = a.sockets > 0 ? a.colors.base : PAL.blue;
  ctx.save();
  ctx.globalAlpha = a.alpha ?? 1;
  ctx.lineJoin = 'round';
  ctx.translate(x, y);

  // Things behind the body.
  if (a.def === 'beacon') {
    const n = a.tier >= 3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const rr = R * (1.38 + a.tier * 0.06 - i * 0.12);
      polyPath(ctx, 0, 0, rr, 6, time * (i ? -1.4 : 1.1));
      fillStroke(ctx, '#4a4a4a', lw, '#353535');
    }
  }
  if (a.decor === 'spikes') {
    starPath(ctx, 0, 0, R * 1.42, 8, time * 0.8, 0.72);
    fillStroke(ctx, '#555555', lw, '#3d3d3d');
  } else if (a.decor === 'gear') {
    for (let i = 0; i < 8; i++) {
      const ang = time * 0.6 + (i * Math.PI) / 4;
      ctx.save();
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.rect(R * 0.8, -R * 0.2, R * 0.45, R * 0.4);
      fillStroke(ctx, PAL.barrel, lw * 0.8, '#727272');
      ctx.restore();
    }
  } else if (a.decor === 'petals') {
    for (let i = 0; i < 6; i++) {
      const ang = time * 0.4 + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.ellipse(Math.cos(ang) * R * 0.95, Math.sin(ang) * R * 0.95, R * 0.55, R * 0.3, ang, 0, Math.PI * 2);
      fillStroke(ctx, a.colors.secondary, lw * 0.8);
    }
  } else if (a.decor === 'fins') {
    for (let i = 0; i < 3; i++) {
      const ang = time * 1.2 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang - 0.35) * R * 0.8, Math.sin(ang - 0.35) * R * 0.8);
      ctx.lineTo(Math.cos(ang) * R * 1.55, Math.sin(ang) * R * 1.55);
      ctx.lineTo(Math.cos(ang + 0.35) * R * 0.8, Math.sin(ang + 0.35) * R * 0.8);
      ctx.closePath();
      fillStroke(ctx, a.colors.secondary, lw * 0.8);
    }
  }

  // Barrels (rotate with aim).
  ctx.save();
  ctx.rotate(a.angle);
  for (const b of BARRELS[a.def]?.[a.tier - 1] ?? []) drawBarrel(ctx, b, R, lw, a.recoil ?? 0);
  ctx.restore();

  // Body.
  circlePath(ctx, 0, 0, R);
  fillStroke(ctx, body, lw);

  if (a.def === 'arc') {
    const prongs = [3, 4, 6][a.tier - 1];
    ctx.save();
    ctx.rotate(time * 2);
    for (let i = 0; i < prongs; i++) {
      const ang = (i / prongs) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * R * 0.35, Math.sin(ang) * R * 0.35);
      ctx.lineTo(Math.cos(ang) * R * 0.78, Math.sin(ang) * R * 0.78);
      ctx.strokeStyle = shade(body, 0.6);
      ctx.lineWidth = lw * 1.2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
    circlePath(ctx, 0, 0, R * 0.42);
    fillStroke(ctx, PAL.barrel, lw, '#727272');
  }
  if (a.def === 'prism' || a.def === 'rail') {
    circlePath(ctx, Math.cos(a.angle) * R * 0.15, Math.sin(a.angle) * R * 0.15, R * 0.3);
    fillStroke(ctx, a.def === 'prism' ? '#ffffff' : PAL.barrel, lw * 0.8, a.def === 'prism' ? shade(body, 0.7) : '#727272');
  }

  // Socket markers: secondary inner ring, tertiary core.
  if (a.sockets >= 2 && a.decor !== 'shell') {
    circlePath(ctx, 0, 0, R * 0.62);
    ctx.strokeStyle = a.colors.secondary;
    ctx.lineWidth = Math.max(1.5, R * 0.16);
    ctx.stroke();
  }
  if (a.sockets >= 3) {
    circlePath(ctx, 0, 0, R * 0.26);
    fillStroke(ctx, a.colors.tertiary, lw * 0.7);
  }

  // Decorations on top.
  switch (a.decor) {
    case 'shell':
      circlePath(ctx, 0, 0, R * 0.78);
      ctx.strokeStyle = a.colors.secondary;
      ctx.lineWidth = R * 0.28;
      ctx.stroke();
      break;
    case 'crystal':
      polyPath(ctx, 0, 0, R * 0.5, 4, time);
      fillStroke(ctx, a.colors.tertiary, lw * 0.7);
      break;
    case 'eye': {
      circlePath(ctx, 0, 0, R * 0.45);
      fillStroke(ctx, '#ffffff', lw * 0.7, '#555555');
      circlePath(ctx, Math.cos(a.angle) * R * 0.18, Math.sin(a.angle) * R * 0.18, R * 0.2);
      ctx.fillStyle = '#333333';
      ctx.fill();
      break;
    }
    case 'core': {
      const k = 0.3 + 0.06 * Math.sin(time * 5);
      ctx.globalCompositeOperation = 'lighter';
      const img = softSprite(quant(a.colors.secondary));
      ctx.drawImage(img, -R * 0.9, -R * 0.9, R * 1.8, R * 1.8);
      ctx.globalCompositeOperation = 'source-over';
      circlePath(ctx, 0, 0, R * k);
      fillStroke(ctx, a.colors.secondary, lw * 0.6);
      break;
    }
    case 'halo_ring':
      circlePath(ctx, 0, 0, R * 1.35);
      ctx.setLineDash([R * 0.3, R * 0.2]);
      ctx.lineDashOffset = -time * R;
      ctx.strokeStyle = a.colors.secondary;
      ctx.lineWidth = Math.max(1.5, R * 0.1);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
  }

  if (a.disabled) {
    circlePath(ctx, 0, 0, R * 1.05);
    ctx.fillStyle = 'rgba(80,80,80,0.55)';
    ctx.fill();
  }
  ctx.restore();
}

/** Draw a tower onto a small standalone canvas (UI icons). */
export function towerIcon(def: string, tier: number, size: number, colors?: Palette3, sockets = 0, zoom = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const R = size * 0.2 * zoom;
  drawTower(ctx, {
    def, tier, x: size / 2, y: size / 2 + R * 0.25, R, angle: -Math.PI / 2 - 0.5, colors: colors ?? { base: PAL.blue, secondary: PAL.blue, tertiary: PAL.blue },
    sockets, time: 0.6, lw: Math.max(1.5, size * 0.035),
  });
  return c;
}
