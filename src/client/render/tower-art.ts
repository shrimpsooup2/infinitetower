// Towers are emplacements, deliberately unlike the flat diep look the rest of
// the world uses: a fixed stone plinth (its shape shows the tier) carries up
// to three socket gems, and a turret head with its own silhouette per tower
// turns to aim. Heads are inked with a dark outline and a glossy highlight.
// Unpowered heads wear the tower's own tint; once powered, the head takes the
// BASE power's colour, accents the secondary's and the core the tertiary's.

import type { Palette3 } from '../../sim/types.ts';
import { mix, shade } from '../../content/colors.ts';
import { circlePath, polyPath, starPath, softSprite, quant, type Ctx2D } from './draw.ts';

/** Each tower's own colour, used for its unpowered head and build button. */
export const TOWER_TINT: Record<string, string> = {
  bolt: '#6fc3ff', cannon: '#f0a95b', frost: '#9fe7ff', arc: '#ffe066', rail: '#b49bff',
  mortar: '#d7a26f', flame: '#ff7f50', prism: '#ff9be0', beacon: '#8ff0b5', hive: '#ffcc4d',
};

const INK = '#262a31';
const METAL = '#8f99a8';
const METAL_DARK = '#5b6472';
const HOLE = '#1d2127';
const PLATE = ['#838b97', '#7b8390', '#737b88'];
/** Plinth size in R units; keeps every tier inside its tile. */
const PLINTH = [1.1, 1.18, 1.16];
const GEM_OFF = '#2e333b';

export function bodyRadius(tier: number): number {
  return [0.33, 0.37, 0.41][tier - 1] ?? 0.33;
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

interface Look {
  body: string;
  accent: string;
  core: string;
  lw: number;
  R: number;
  time: number;
  tier: number;
}

function ink(ctx: Ctx2D, fill: string, lw: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Closed polygon from [x, y] pairs in R units. */
function poly(ctx: Ctx2D, R: number, pts: number[][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * R, y * R) : ctx.moveTo(x * R, y * R)));
  ctx.closePath();
}

function rrect(ctx: Ctx2D, R: number, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x * R, y * R, w * R, h * R, r * R);
}

/** Soft highlight toward the upper left, clipped to the current path. */
function gloss(ctx: Ctx2D, R: number, ang: number, size = 0.9): void {
  ctx.save();
  ctx.clip();
  ctx.rotate(-ang);
  ctx.beginPath();
  ctx.ellipse(-R * 0.3, -R * 0.35, R * size * 0.55, R * size * 0.32, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------ plinth

function plinth(ctx: Ctx2D, a: TowerArt, lk: Look): void {
  const { R, lw, tier } = lk;
  const fill = PLATE[tier - 1];
  const P = PLINTH[tier - 1];
  if (tier === 1) rrect(ctx, R, -P, -P, P * 2, P * 2, 0.34);
  else polyPath(ctx, 0, 0, R * P / Math.cos(Math.PI / 8), 8, Math.PI / 8);
  ink(ctx, fill, lw * 0.9);
  // Bevel: a lighter inner edge.
  const Q = P - 0.17;
  if (tier === 1) rrect(ctx, R, -Q, -Q, Q * 2, Q * 2, 0.26);
  else polyPath(ctx, 0, 0, R * Q / Math.cos(Math.PI / 8), 8, Math.PI / 8);
  ctx.strokeStyle = mix(fill, '#ffffff', 0.18);
  ctx.lineWidth = Math.max(1, lw * 0.6);
  ctx.stroke();
  if (tier === 3) {
    for (let i = 0; i < 4; i++) {
      const g = Math.PI / 4 + (i * Math.PI) / 2;
      circlePath(ctx, Math.cos(g) * R * 1.02, Math.sin(g) * R * 1.02, R * 0.09);
      ink(ctx, METAL, lw * 0.5);
    }
  }
}

/** Socket gems on the plinth's front edge, one per unlocked socket, lit with the power colours. */
function gems(ctx: Ctx2D, a: TowerArt, lk: Look): void {
  const { R, lw, tier } = lk;
  const cols = [a.colors.base, a.colors.secondary, a.colors.tertiary];
  for (let i = 0; i < tier; i++) {
    const g = Math.PI / 2 + (i - (tier - 1) / 2) * 0.66;
    const gx = Math.cos(g) * R * 0.98, gy = Math.sin(g) * R * 0.98;
    polyPath(ctx, gx, gy, R * 0.16, 4, 0);
    const lit = i < a.sockets;
    ink(ctx, lit ? cols[i] : GEM_OFF, Math.max(1, lw * 0.5));
    if (lit) {
      circlePath(ctx, gx - R * 0.05, gy - R * 0.05, R * 0.045);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
    }
  }
}

// ------------------------------------------------------------ heads
// Drawn in a frame rotated to the aim angle (+x forward), except where noted.

type Head = (ctx: Ctx2D, lk: Look, a: TowerArt, recoil: number) => void;

function tube(ctx: Ctx2D, R: number, x0: number, x1: number, w: number, off: number, lw: number, fill = METAL): void {
  rrect(ctx, R, x0, off - w / 2, x1 - x0, w, Math.min(w / 2, 0.08));
  ink(ctx, fill, lw);
}

const HEADS: Record<string, Head> = {
  bolt: (ctx, { R, lw, body, accent, tier }, _a, k) => {
    const rails = tier === 1 ? [0] : tier === 2 ? [-0.2, 0.2] : [-0.28, 0, 0.28];
    for (const off of rails) {
      const len = off === 0 && tier === 3 ? 1.95 : 1.75;
      tube(ctx, R, 0.2 - k, len - k, 0.2, off, lw * 0.8);
      tube(ctx, R, len - 0.22 - k, len - k, 0.3, off, lw * 0.8, METAL_DARK);
    }
    poly(ctx, R, [[0.95, 0], [0.1, -0.62], [-0.72, -0.34], [-0.72, 0.34], [0.1, 0.62]]);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
    circlePath(ctx, 0.05 * R, 0, R * 0.2);
    ink(ctx, accent, lw * 0.6);
  },
  cannon: (ctx, { R, lw, body, accent, tier }, _a, k) => {
    const w = [0.6, 0.72, 0.84][tier - 1];
    tube(ctx, R, 0 - k, 1.5 - k, w, 0, lw);
    tube(ctx, R, 1.26 - k, 1.6 - k, w + 0.2, 0, lw, METAL_DARK);
    if (tier === 3) {
      for (const s of [-1, 1]) {
        poly(ctx, R, [[-0.5, s * 0.72], [0.55, s * 0.72], [0.35, s * 1.0], [-0.4, s * 1.0]]);
        ink(ctx, shade(body, 0.8), lw * 0.8);
      }
    }
    polyPath(ctx, 0, 0, R * 0.9, 6, 0);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
    rrect(ctx, R, -0.62, -0.12, 1.1, 0.24, 0.1);
    ink(ctx, accent, lw * 0.6);
  },
  frost: (ctx, { R, lw, body, accent, tier, time }, _a, k) => {
    const shards = tier === 1 ? [0] : [-0.26, 0.26];
    for (const off of shards) {
      poly(ctx, R, [[0.3 - k, off - 0.13], [1.45 - k, off - 0.07], [1.68 - k, off], [1.45 - k, off + 0.07], [0.3 - k, off + 0.13]]);
      ink(ctx, mix(body, '#ffffff', 0.55), lw * 0.8);
    }
    ctx.save();
    ctx.rotate(time * 0.35);
    const n = tier === 3 ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const g = (i / n) * Math.PI * 2;
      ctx.save();
      ctx.rotate(g);
      poly(ctx, R, [[0.45, -0.14], [0.98, 0], [0.45, 0.14]]);
      ink(ctx, mix(body, '#ffffff', 0.35), lw * 0.7);
      ctx.restore();
    }
    ctx.restore();
    polyPath(ctx, 0, 0, R * 0.62, 6, Math.PI / 6);
    ink(ctx, body, lw);
    gloss(ctx, R, 0, 0.7);
    polyPath(ctx, 0, 0, R * 0.26, 6, Math.PI / 6);
    ink(ctx, accent, lw * 0.6);
  },
  rail: (ctx, { R, lw, body, accent, tier }, _a, k) => {
    const len = [2.2, 2.45, 2.55][tier - 1];
    for (const off of [-0.2, 0.2]) tube(ctx, R, 0.2 - k, len - k, 0.14, off, lw * 0.7);
    const coils = tier + 1;
    for (let i = 0; i < coils; i++) {
      const cx = 0.75 + (i * (len - 1.05)) / Math.max(1, coils - 1) - k;
      rrect(ctx, R, cx - 0.08, -0.36, 0.16, 0.72, 0.06);
      ink(ctx, accent, lw * 0.6);
    }
    if (tier === 3) {
      rrect(ctx, R, -1.05, -0.4, 0.4, 0.8, 0.1);
      ink(ctx, METAL_DARK, lw * 0.8);
    }
    rrect(ctx, R, -0.78, -0.5, 1.4, 1.0, 0.45);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
  },
  mortar: (ctx, { R, lw, body, accent, tier }, _a, k) => {
    circlePath(ctx, 0, 0, R * 0.92);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
    const holes = tier === 3 ? [-0.28, 0.28] : [0];
    const tr = tier === 3 ? 0.34 : [0.46, 0.52][tier - 1];
    for (const off of holes) {
      const hx = (0.16 - k * 0.3) * R, hy = off * R;
      circlePath(ctx, hx, hy, R * tr);
      ink(ctx, METAL, lw * 0.8);
      circlePath(ctx, hx + R * 0.04, hy, R * tr * 0.64);
      ctx.fillStyle = HOLE;
      ctx.fill();
    }
    if (tier >= 2) {
      for (let i = 0; i < 6; i++) {
        const g = (i / 6) * Math.PI * 2 + Math.PI / 6;
        circlePath(ctx, Math.cos(g) * R * 0.76, Math.sin(g) * R * 0.76, R * 0.08);
        ink(ctx, accent, lw * 0.4);
      }
    }
  },
  flame: (ctx, { R, lw, body, accent, tier, time }, _a, k) => {
    poly(ctx, R, [[0.3 - k, -0.2], [1.3 - k, -0.42], [1.3 - k, 0.42], [0.3 - k, 0.2]]);
    ink(ctx, METAL, lw * 0.8);
    rrect(ctx, R, 1.18 - k, -0.46, 0.2, 0.92, 0.06);
    ink(ctx, METAL_DARK, lw * 0.7);
    const cans = tier === 3 ? [-0.5, 0, 0.5] : [-0.34, 0.34];
    for (const off of cans) {
      circlePath(ctx, -0.82 * R, off * R, R * 0.3);
      ink(ctx, accent, lw * 0.7);
    }
    rrect(ctx, R, -0.72, -0.55, 1.2, 1.1, 0.35);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
    const f = 0.1 + 0.03 * Math.sin(time * 17);
    circlePath(ctx, (1.34 - k) * R, 0, R * f);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
  },
  prism: (ctx, { R, lw, body, accent, core, tier, time }) => {
    circlePath(ctx, 0, 0, R * 0.78);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.5, R * 0.12);
    ctx.stroke();
    const sats = tier - 1;
    for (let i = 0; i < sats; i++) {
      const g = time * 1.3 + (i / Math.max(1, sats)) * Math.PI * 2;
      polyPath(ctx, Math.cos(g) * R * 0.95, Math.sin(g) * R * 0.95, R * 0.2, 4, g);
      ink(ctx, core, lw * 0.5);
    }
    const L = [1.1, 1.2, 1.3][tier - 1];
    poly(ctx, R, [[L, 0], [0.05, -0.5], [-0.6, 0], [0.05, 0.5]]);
    ink(ctx, body, lw);
    // Facets.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, lw * 0.45);
    ctx.beginPath();
    ctx.moveTo(L * R, 0); ctx.lineTo(0.05 * R, 0);
    ctx.moveTo(0.05 * R, -0.5 * R); ctx.lineTo(0.05 * R, 0.5 * R);
    ctx.stroke();
    poly(ctx, R, [[0.05, -0.5], [L, 0], [0.05, 0]]);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
  },
};

// Heads that do not turn to aim.
const STILL: Record<string, Head> = {
  arc: (ctx, { R, lw, body, accent, tier, time }) => {
    starPath(ctx, 0, 0, R * 0.95, 10, time * 0.2, 0.84);
    ink(ctx, METAL, lw * 0.9);
    circlePath(ctx, 0, 0, R * 0.72);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
    for (const rr of [0.54, 0.4]) {
      circlePath(ctx, 0, 0, R * rr);
      ctx.strokeStyle = shade(body, 0.62);
      ctx.lineWidth = Math.max(1, lw * 0.7);
      ctx.stroke();
    }
    const prongs = [3, 4, 6][tier - 1];
    ctx.save();
    ctx.rotate(time * 2);
    for (let i = 0; i < prongs; i++) {
      const g = (i / prongs) * Math.PI * 2;
      circlePath(ctx, Math.cos(g) * R * 0.62, Math.sin(g) * R * 0.62, R * 0.09);
      ink(ctx, accent, lw * 0.5);
    }
    ctx.restore();
    const k = 0.26 + 0.03 * Math.sin(time * 9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(softSprite(quant(accent)), -R * 0.7, -R * 0.7, R * 1.4, R * 1.4);
    ctx.globalCompositeOperation = 'source-over';
    circlePath(ctx, 0, 0, R * k);
    ink(ctx, mix(accent, '#ffffff', 0.4), lw * 0.6);
  },
  beacon: (ctx, { R, lw, body, accent, core, tier, time }) => {
    const segs = 2 + tier;
    ctx.lineCap = 'round';
    for (let i = 0; i < segs; i++) {
      const g = time * 0.9 + (i / segs) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.02, g, g + (Math.PI * 2) / segs * 0.55);
      ctx.strokeStyle = INK;
      ctx.lineWidth = R * 0.22 + lw;
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.lineWidth = R * 0.22;
      ctx.stroke();
    }
    polyPath(ctx, 0, 0, R * 0.82, 4, Math.PI / 4 + time * 0.25);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
    polyPath(ctx, 0, 0, R * 0.46, 4, time * 0.25);
    ink(ctx, shade(body, 0.78), lw * 0.7);
    const k = 0.2 + 0.04 * Math.sin(time * 4);
    circlePath(ctx, 0, 0, R * k);
    ink(ctx, core, lw * 0.5);
  },
  hive: (ctx, { R, lw, body, accent, tier, time }) => {
    const doors = tier === 3 ? 4 : 2;
    for (let i = 0; i < doors; i++) {
      const g = time * 0.3 + (i / doors) * Math.PI * 2 + Math.PI / 2;
      ctx.save();
      ctx.rotate(g);
      rrect(ctx, R, 0.55, -0.3, 0.52, 0.6, 0.1);
      ink(ctx, METAL_DARK, lw * 0.8);
      ctx.restore();
    }
    polyPath(ctx, 0, 0, R * 0.9, 6, Math.PI / 6 + time * 0.3);
    ink(ctx, body, lw);
    gloss(ctx, R, 0);
    const cell = R * (tier === 1 ? 0.22 : 0.2);
    ctx.save();
    ctx.rotate(time * 0.3);
    const cells: [number, number][] = [[0, 0], ...[0, 1, 2, 3, 4, 5].map((i) => [Math.cos(i * Math.PI / 3) * cell * 1.8, Math.sin(i * Math.PI / 3) * cell * 1.8] as [number, number])];
    for (const [cx, cy] of cells) {
      polyPath(ctx, cx, cy, cell, 6, Math.PI / 6);
      ctx.strokeStyle = shade(body, 0.6);
      ctx.lineWidth = Math.max(1, lw * 0.55);
      ctx.stroke();
    }
    polyPath(ctx, 0, 0, cell * 0.8, 6, Math.PI / 6);
    ink(ctx, accent, lw * 0.4);
    ctx.restore();
  },
};

// ------------------------------------------------------------ fusion decor

function decorBehind(ctx: Ctx2D, a: TowerArt, lk: Look): void {
  const { R, lw, time } = lk;
  switch (a.decor) {
    case 'spikes':
      starPath(ctx, 0, 0, R * 1.3, 8, time * 0.8, 0.7);
      ink(ctx, shade(lk.body, 0.55), lw * 0.8);
      break;
    case 'gear':
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate(time * 0.6 + (i * Math.PI) / 4);
        rrect(ctx, R, 0.78, -0.18, 0.4, 0.36, 0.06);
        ink(ctx, METAL, lw * 0.7);
        ctx.restore();
      }
      break;
    case 'petals':
      for (let i = 0; i < 6; i++) {
        const g = time * 0.4 + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.ellipse(Math.cos(g) * R * 0.95, Math.sin(g) * R * 0.95, R * 0.5, R * 0.26, g, 0, Math.PI * 2);
        ink(ctx, lk.accent, lw * 0.7);
      }
      break;
    case 'fins':
      for (let i = 0; i < 3; i++) {
        const g = time * 1.2 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(g - 0.35) * R * 0.8, Math.sin(g - 0.35) * R * 0.8);
        ctx.lineTo(Math.cos(g) * R * 1.45, Math.sin(g) * R * 1.45);
        ctx.lineTo(Math.cos(g + 0.35) * R * 0.8, Math.sin(g + 0.35) * R * 0.8);
        ctx.closePath();
        ink(ctx, lk.accent, lw * 0.7);
      }
      break;
  }
}

function decorOnTop(ctx: Ctx2D, a: TowerArt, lk: Look): void {
  const { R, lw, time } = lk;
  switch (a.decor) {
    case 'shell':
      circlePath(ctx, 0, 0, R * 0.8);
      ctx.strokeStyle = lk.accent;
      ctx.lineWidth = R * 0.18;
      ctx.stroke();
      break;
    case 'crystal':
      polyPath(ctx, 0, 0, R * 0.34, 4, time);
      ink(ctx, lk.core, lw * 0.6);
      break;
    case 'eye':
      circlePath(ctx, 0, 0, R * 0.36);
      ink(ctx, '#ffffff', lw * 0.6);
      circlePath(ctx, Math.cos(a.angle) * R * 0.14, Math.sin(a.angle) * R * 0.14, R * 0.16);
      ctx.fillStyle = INK;
      ctx.fill();
      break;
    case 'core': {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(softSprite(quant(lk.accent)), -R * 0.9, -R * 0.9, R * 1.8, R * 1.8);
      ctx.globalCompositeOperation = 'source-over';
      circlePath(ctx, 0, 0, R * (0.24 + 0.05 * Math.sin(time * 5)));
      ink(ctx, lk.accent, lw * 0.5);
      break;
    }
    case 'halo_ring':
      circlePath(ctx, 0, 0, R * 1.3);
      ctx.setLineDash([R * 0.3, R * 0.2]);
      ctx.lineDashOffset = -time * R;
      ctx.strokeStyle = lk.accent;
      ctx.lineWidth = Math.max(1.5, R * 0.1);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
  }
}

// ------------------------------------------------------------ entry points

export function drawTower(ctx: Ctx2D, a: TowerArt): void {
  const { x, y, R, time } = a;
  const tint = TOWER_TINT[a.def] ?? '#9aa4b2';
  const powered = a.sockets > 0;
  const body = powered ? a.colors.base : tint;
  const lk: Look = {
    body,
    accent: a.sockets >= 2 ? a.colors.secondary : powered ? mix(body, '#ffffff', 0.45) : shade(tint, 0.7),
    core: a.sockets >= 3 ? a.colors.tertiary : '#ffffff',
    lw: Math.max(1, a.lw * 0.85),
    R, time, tier: Math.min(3, Math.max(1, a.tier)),
  };
  ctx.save();
  ctx.globalAlpha = a.alpha ?? 1;
  ctx.lineJoin = 'round';
  ctx.translate(x, y);
  plinth(ctx, a, lk);
  decorBehind(ctx, a, lk);
  const still = STILL[a.def];
  if (still) still(ctx, lk, a, 0);
  else {
    ctx.save();
    ctx.rotate(a.angle);
    (HEADS[a.def] ?? HEADS.bolt)(ctx, lk, a, (a.recoil ?? 0) * 0.25);
    ctx.restore();
  }
  decorOnTop(ctx, a, lk);
  gems(ctx, a, lk);
  if (a.disabled) {
    circlePath(ctx, 0, 0, R * 1.1);
    ctx.fillStyle = 'rgba(60,60,70,0.55)';
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
  const R = size * 0.25 * zoom;
  drawTower(ctx, {
    def, tier, x: size / 2, y: size / 2, R, angle: -Math.PI / 4, colors: colors ?? { base: '#ffffff', secondary: '#ffffff', tertiary: '#ffffff' },
    sockets, time: 0.6, lw: Math.max(1.5, size * 0.035),
  });
  return c;
}
