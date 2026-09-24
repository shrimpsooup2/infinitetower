// Map scenery: the ground, road, obstacles and decoration for each map theme.
// The campaign starts plain (the bare diep-style grid) and each act gets
// richer: graph paper and a garden in Flatland; a blueprint, a desert and a
// crystal cavern in Solidspace; neon, deep space and hyperspace at the end.
// Everything here is decoration. Gameplay only depends on the map's paths and
// blocked tiles, which every theme draws clearly. The static part is drawn
// once into the renderer's background layer; drawAmbient adds a little life
// (fireflies, motes, twinkling stars) each frame on the later themes.

import type { MapDef } from '../../sim/types.ts';
import { Rng } from '../../sim/rng.ts';
import { PAL } from '../../content/colors.ts';

type G = CanvasRenderingContext2D;

type Prop = 'rock' | 'doodle' | 'bush' | 'wirecube' | 'mesa' | 'crystal' | 'pillar' | 'asteroid' | 'hypercube';
type Scatter = 'tuft' | 'flower' | 'doodle' | 'pebble' | 'cactus' | 'crack' | 'shard' | 'plus' | 'star' | 'glyph' | 'spark';
type Ambient = 'none' | 'fireflies' | 'motes' | 'stars' | 'scan';

export interface Theme {
  name: string;
  dark: boolean;
  outside: string;
  outsideGrid: string | null;
  ground: string;
  ground2?: string;
  pattern: 'none' | 'paper' | 'stripes' | 'dunes' | 'hex' | 'nebula' | 'iridescent';
  grid: string;
  gridMajor?: { every: number; color: string };
  road: string;
  roadEdge: string;
  roadGlow?: string;
  roadCenter?: string;
  roadSpeckle?: string;
  chevron: string;
  air: string;
  prop: Prop;
  propColors: [string, string, string];
  scatter: { kind: Scatter; density: number; colors: string[] }[];
  frame: 'none' | 'shadow' | 'line' | 'glow';
  frameColor?: string;
  margin: number; // decorative props per 100 margin tiles
  ambient: Ambient;
  ambientColor?: string;
}

export const THEMES: Record<string, Theme> = {
  plain: {
    name: 'Plain', dark: false, outside: PAL.outside, outsideGrid: 'rgba(0,0,0,0.06)', ground: PAL.bg, pattern: 'none', grid: PAL.grid,
    road: '#c3c3c3', roadEdge: 'rgba(0,0,0,0.07)', chevron: 'rgba(0,0,0,0.08)', air: 'rgba(80,140,160,0.22)',
    prop: 'rock', propColors: ['#aaaaaa', '#8a8a8a', '#bdbdbd'], scatter: [], frame: 'none', margin: 0, ambient: 'none',
  },
  paper: {
    name: 'Graph paper', dark: false, outside: '#cfc6b4', outsideGrid: null, ground: '#fbf8ef', pattern: 'paper', grid: 'rgba(90,150,210,0.22)',
    gridMajor: { every: 5, color: 'rgba(90,150,210,0.42)' },
    road: '#ece6d6', roadEdge: '#55627a', chevron: 'rgba(60,70,90,0.35)', air: 'rgba(200,80,80,0.3)',
    prop: 'doodle', propColors: ['#fbf8ef', '#44506a', '#9fb3cf'],
    scatter: [{ kind: 'doodle', density: 0.07, colors: ['#8b98ad', '#c9a0a0', '#9fb3cf'] }],
    frame: 'shadow', margin: 0, ambient: 'none',
  },
  garden: {
    name: 'Garden', dark: false, outside: '#6f9a5c', outsideGrid: null, ground: '#b9dc9c', ground2: '#b1d693', pattern: 'stripes', grid: 'rgba(40,80,20,0.07)',
    road: '#dcc596', roadEdge: '#b49868', roadSpeckle: 'rgba(120,90,50,0.35)', chevron: 'rgba(90,60,20,0.18)', air: 'rgba(60,110,160,0.25)',
    prop: 'bush', propColors: ['#5fa052', '#3f7a38', '#86c47a'],
    scatter: [
      { kind: 'tuft', density: 0.2, colors: ['#7fb866', '#91c878'] },
      { kind: 'flower', density: 0.06, colors: ['#ff9ec7', '#fff3a0', '#ffffff', '#c7a7ff'] },
    ],
    frame: 'shadow', margin: 9, ambient: 'fireflies', ambientColor: '#fff6a8',
  },
  blueprint: {
    name: 'Blueprint', dark: true, outside: '#123157', outsideGrid: 'rgba(255,255,255,0.05)', ground: '#1c4a80', pattern: 'none', grid: 'rgba(255,255,255,0.12)',
    gridMajor: { every: 4, color: 'rgba(255,255,255,0.26)' },
    road: 'rgba(255,255,255,0.09)', roadEdge: 'rgba(255,255,255,0.75)', roadCenter: 'rgba(255,255,255,0.35)', chevron: 'rgba(255,255,255,0.3)', air: 'rgba(255,220,120,0.35)',
    prop: 'wirecube', propColors: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.4)'],
    scatter: [{ kind: 'plus', density: 0.08, colors: ['rgba(255,255,255,0.3)'] }],
    frame: 'line', frameColor: 'rgba(255,255,255,0.8)', margin: 4, ambient: 'none',
  },
  desert: {
    name: 'Desert', dark: false, outside: '#c28a55', outsideGrid: null, ground: '#f0d39f', pattern: 'dunes', grid: 'rgba(120,70,20,0.07)',
    road: '#e2b97d', roadEdge: '#c3935a', roadSpeckle: 'rgba(140,90,40,0.3)', chevron: 'rgba(110,60,20,0.2)', air: 'rgba(80,120,170,0.25)',
    prop: 'mesa', propColors: ['#cf7c4a', '#9c5431', '#e59b66'],
    scatter: [
      { kind: 'pebble', density: 0.1, colors: ['#c9a06b', '#b98f5c'] },
      { kind: 'cactus', density: 0.03, colors: ['#5f9a54'] },
      { kind: 'crack', density: 0.04, colors: ['rgba(130,80,30,0.35)'] },
    ],
    frame: 'shadow', margin: 7, ambient: 'none',
  },
  crystal: {
    name: 'Crystal cavern', dark: true, outside: '#16122a', outsideGrid: null, ground: '#2c2548', pattern: 'hex', grid: 'rgba(170,150,255,0.07)',
    road: '#3b3264', roadEdge: '#9b86ee', roadGlow: '#8a70ff', chevron: 'rgba(200,190,255,0.3)', air: 'rgba(120,230,255,0.3)',
    prop: 'crystal', propColors: ['#7fe0ff', '#b18cff', '#ffffff'],
    scatter: [{ kind: 'shard', density: 0.07, colors: ['#8fe6ff', '#c3a6ff'] }],
    frame: 'glow', frameColor: '#9b86ee', margin: 8, ambient: 'motes', ambientColor: '#c9b8ff',
  },
  neon: {
    name: 'Neon grid', dark: true, outside: '#090418', outsideGrid: 'rgba(255,60,200,0.06)', ground: '#120a2c', pattern: 'none', grid: 'rgba(255,70,210,0.22)',
    road: '#1a1140', roadEdge: '#39f3ff', roadGlow: '#39f3ff', roadCenter: 'rgba(255,90,220,0.45)', chevron: 'rgba(57,243,255,0.45)', air: 'rgba(255,90,220,0.4)',
    prop: 'pillar', propColors: ['#1d1245', '#ff5ad8', '#39f3ff'],
    scatter: [{ kind: 'spark', density: 0.04, colors: ['#39f3ff', '#ff5ad8'] }],
    frame: 'glow', frameColor: '#ff5ad8', margin: 3, ambient: 'scan', ambientColor: '#39f3ff',
  },
  void: {
    name: 'Deep space', dark: true, outside: '#04050b', outsideGrid: null, ground: '#0b0f22', pattern: 'nebula', grid: 'rgba(160,180,255,0.06)',
    road: 'rgba(110,130,230,0.2)', roadEdge: 'rgba(170,190,255,0.6)', roadGlow: '#7f95ff', chevron: 'rgba(190,205,255,0.35)', air: 'rgba(255,200,120,0.35)',
    prop: 'asteroid', propColors: ['#6b6378', '#4a4455', '#8d869a'],
    scatter: [{ kind: 'star', density: 0.22, colors: ['#ffffff', '#c9d6ff', '#ffe6b0'] }],
    frame: 'glow', frameColor: '#6f86ff', margin: 5, ambient: 'stars', ambientColor: '#ffffff',
  },
  hyper: {
    name: 'Hyperspace', dark: true, outside: '#0d0820', outsideGrid: null, ground: '#160f30', ground2: '#0d2230', pattern: 'iridescent', grid: 'rgba(160,255,240,0.07)',
    road: '#241942', roadEdge: '#ff7ae6', roadGlow: '#7afff0', roadCenter: 'rgba(122,255,240,0.35)', chevron: 'rgba(122,255,240,0.4)', air: 'rgba(255,230,120,0.4)',
    prop: 'hypercube', propColors: ['rgba(122,255,240,0.1)', '#7afff0', '#ff7ae6'],
    scatter: [{ kind: 'glyph', density: 0.05, colors: ['rgba(122,255,240,0.35)', 'rgba(255,122,230,0.35)'] }],
    frame: 'glow', frameColor: '#7afff0', margin: 5, ambient: 'motes', ambientColor: '#ff9ef0',
  },
};

export function themeOf(map: MapDef): Theme {
  return THEMES[map.theme ?? 'plain'] ?? THEMES.plain;
}

// ------------------------------------------------------------ geometry helpers

/** Ground paths as polylines in tile units (tile centres at .5). */
function polylines(map: MapDef): [number, number][][] {
  return map.paths.map((p) => p.map(([c, r]) => [c + 0.5, r + 0.5] as [number, number]));
}

/** Tiles the ground paths run over. */
function pathTiles(map: MapDef): Set<number> {
  const set = new Set<number>();
  for (const p of map.paths) {
    for (let i = 1; i < p.length; i++) {
      const [c0, r0] = p[i - 1], [c1, r1] = p[i];
      const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
      for (let k = 0; k <= n; k++) {
        const c = Math.round(c0 + ((c1 - c0) * k) / Math.max(1, n)), r = Math.round(r0 + ((r1 - r0) * k) / Math.max(1, n));
        if (c >= 0 && r >= 0 && c < map.cols && r < map.rows) set.add(r * map.cols + c);
      }
    }
  }
  return set;
}

function strokePolyline(g: G, pts: [number, number][], s: number, ox: number, oy: number): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy + y * s) : g.moveTo(ox + x * s, oy + y * s)));
  g.stroke();
}

/** Points every `step` tiles along a polyline, with the heading there. */
function along(pts: [number, number][], start: number, step: number, end = 0.5): { x: number; y: number; a: number }[] {
  const out: { x: number; y: number; a: number }[] = [];
  let total = 0;
  const segs = pts.slice(1).map((p, i) => {
    const q = pts[i];
    const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const seg = { q, p, len, from: total };
    total += len;
    return seg;
  });
  for (let d = start; d < total - end; d += step) {
    const sg = segs.find((x) => d <= x.from + x.len) ?? segs[segs.length - 1];
    const k = (d - sg.from) / Math.max(1e-6, sg.len);
    out.push({ x: sg.q[0] + (sg.p[0] - sg.q[0]) * k, y: sg.q[1] + (sg.p[1] - sg.q[1]) * k, a: Math.atan2(sg.p[1] - sg.q[1], sg.p[0] - sg.q[0]) });
  }
  return out;
}

// ------------------------------------------------------------ props (obstacles and margin scenery)

function drawProp(g: G, kind: Prop, x: number, y: number, r: number, t: Theme, rng: Rng): void {
  const [c0, c1, c2] = t.propColors;
  const lw = Math.max(1, r * 0.12);
  g.save();
  g.translate(x, y);
  g.lineJoin = 'round';
  switch (kind) {
    case 'rock': {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = rng.next() * 0.3 + (i / 6) * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath();
      g.fillStyle = c0; g.fill(); g.strokeStyle = c1; g.lineWidth = lw; g.stroke();
      break;
    }
    case 'doodle': {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + rng.next() * 0.2; g.lineTo(Math.cos(a) * r * (0.85 + rng.next() * 0.2), Math.sin(a) * r * (0.85 + rng.next() * 0.2)); }
      g.closePath();
      g.fillStyle = c0; g.fill();
      g.save(); g.clip();
      g.strokeStyle = c2; g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath();
      for (let k = -r * 2; k < r * 2; k += r * 0.28) { g.moveTo(k, -r); g.lineTo(k + r, r); }
      g.stroke(); g.restore();
      g.strokeStyle = c1; g.lineWidth = Math.max(1, r * 0.09); g.stroke();
      break;
    }
    case 'bush': {
      const blobs = 3 + rng.int(0, 2);
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + rng.next(), d = r * 0.38;
        g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.5 + rng.next() * 0.12), 0, Math.PI * 2);
        g.fillStyle = c0; g.fill(); g.strokeStyle = c1; g.lineWidth = lw; g.stroke();
      }
      g.beginPath(); g.arc(0, 0, r * 0.52, 0, Math.PI * 2); g.fillStyle = c0; g.fill();
      g.beginPath(); g.arc(-r * 0.2, -r * 0.25, r * 0.22, 0, Math.PI * 2); g.fillStyle = c2; g.fill();
      break;
    }
    case 'wirecube': {
      const k = r * 0.62, o = r * 0.32;
      g.fillStyle = c0; g.fillRect(-k, -k + o * 0.5, k * 2 - o, k * 2 - o);
      g.strokeStyle = c1; g.lineWidth = Math.max(1, r * 0.07);
      g.strokeRect(-k, -k + o, k * 2 - o, k * 2 - o);
      g.strokeRect(-k + o, -k, k * 2 - o, k * 2 - o);
      g.beginPath();
      for (const [dx, dy] of [[0, 0], [k * 2 - o, 0], [0, k * 2 - o], [k * 2 - o, k * 2 - o]]) { g.moveTo(-k + dx, -k + o + dy); g.lineTo(-k + o + dx, -k + dy); }
      g.stroke();
      break;
    }
    case 'mesa': {
      const layers = 3;
      for (let i = 0; i < layers; i++) {
        const wdt = r * (1.7 - i * 0.4), hgt = r * 0.42, yy = r * 0.5 - i * hgt * 0.95;
        g.beginPath(); g.roundRect(-wdt / 2, yy - hgt / 2, wdt, hgt, hgt * 0.35);
        g.fillStyle = i % 2 ? c2 : c0; g.fill(); g.strokeStyle = c1; g.lineWidth = lw * 0.8; g.stroke();
      }
      break;
    }
    case 'crystal': {
      const n = 3 + rng.int(0, 2);
      g.shadowColor = c0; g.shadowBlur = r * 0.6;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.45 + (rng.next() - 0.5) * 0.2;
        const len = r * (0.8 + rng.next() * 0.55), wdt = r * 0.24;
        g.save(); g.rotate(a + Math.PI / 2);
        g.beginPath(); g.moveTo(-wdt, 0); g.lineTo(-wdt, -len * 0.75); g.lineTo(0, -len); g.lineTo(wdt, -len * 0.75); g.lineTo(wdt, 0); g.closePath();
        g.fillStyle = i % 2 ? c1 : c0; g.fill();
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len); g.lineTo(wdt, -len * 0.75); g.lineTo(wdt, 0); g.closePath();
        g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
        g.restore();
      }
      g.shadowBlur = 0;
      g.beginPath(); g.ellipse(0, r * 0.1, r * 0.55, r * 0.2, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(20,10,40,0.6)'; g.fill();
      break;
    }
    case 'pillar': {
      g.shadowColor = c1; g.shadowBlur = r * 0.7;
      g.fillStyle = c0; g.strokeStyle = c1; g.lineWidth = Math.max(1.2, r * 0.1);
      g.beginPath(); g.roundRect(-r * 0.6, -r * 0.6, r * 1.2, r * 1.2, r * 0.15); g.fill(); g.stroke();
      g.shadowColor = c2; g.strokeStyle = c2; g.lineWidth = Math.max(1, r * 0.07);
      g.beginPath(); g.roundRect(-r * 0.32, -r * 0.32, r * 0.64, r * 0.64, r * 0.08); g.stroke();
      g.shadowBlur = 0;
      break;
    }
    case 'asteroid': {
      g.beginPath();
      const pts = 9;
      for (let i = 0; i < pts; i++) { const a = (i / pts) * Math.PI * 2; const d = r * (0.72 + rng.next() * 0.3); g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
      g.closePath();
      const grd = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      grd.addColorStop(0, c2); grd.addColorStop(1, c1);
      g.fillStyle = grd; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = lw * 0.6; g.stroke();
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.arc((rng.next() - 0.5) * r, (rng.next() - 0.5) * r, r * (0.1 + rng.next() * 0.12), 0, Math.PI * 2);
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.fill();
      }
      break;
    }
    case 'hypercube': {
      const a = r * 0.75, b = r * 0.36, rot = rng.next() * 0.6;
      g.rotate(rot);
      g.shadowColor = c1; g.shadowBlur = r * 0.5;
      g.fillStyle = c0; g.fillRect(-a, -a, a * 2, a * 2);
      g.strokeStyle = c1; g.lineWidth = Math.max(1, r * 0.07);
      g.strokeRect(-a, -a, a * 2, a * 2);
      g.strokeStyle = c2; g.strokeRect(-b, -b, b * 2, b * 2);
      g.strokeStyle = c1;
      g.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.moveTo(sx * a, sy * a); g.lineTo(sx * b, sy * b); }
      g.stroke();
      g.shadowBlur = 0;
      break;
    }
  }
  g.restore();
}

function drawScatter(g: G, kind: Scatter, x: number, y: number, s: number, color: string, rng: Rng): void {
  g.save();
  g.translate(x, y);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  const u = s * 0.1;
  switch (kind) {
    case 'tuft':
      g.lineWidth = Math.max(1, u * 0.45);
      g.beginPath();
      for (const dx of [-1, 0, 1]) { g.moveTo(dx * u * 0.8, u); g.lineTo(dx * u * 1.4, -u * (0.8 + rng.next() * 0.6)); }
      g.stroke();
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * u * 0.6, Math.sin(a) * u * 0.6, u * 0.45, 0, Math.PI * 2); g.fill(); }
      g.beginPath(); g.arc(0, 0, u * 0.35, 0, Math.PI * 2); g.fillStyle = '#ffd24d'; g.fill();
      break;
    case 'doodle': {
      g.lineWidth = Math.max(1, u * 0.3);
      const k = rng.int(0, 2);
      g.beginPath();
      if (k === 0) { for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; g.lineTo(Math.cos(a) * u * 1.4, Math.sin(a) * u * 1.4); } g.closePath(); }
      else if (k === 1) { for (let i = 0; i < 20; i++) { const a = i * 0.6, d = i * u * 0.08; g.lineTo(Math.cos(a) * d, Math.sin(a) * d); } }
      else { g.moveTo(-u * 1.3, u); g.lineTo(0, -u * 1.2); g.lineTo(u * 1.3, u); g.closePath(); }
      g.stroke();
      break;
    }
    case 'pebble':
      g.beginPath(); g.ellipse(0, 0, u * (0.5 + rng.next() * 0.5), u * 0.4, rng.next() * 3, 0, Math.PI * 2); g.fill();
      break;
    case 'cactus':
      g.lineWidth = u * 0.9;
      g.beginPath(); g.moveTo(0, u * 1.8); g.lineTo(0, -u * 1.6); g.stroke();
      g.lineWidth = u * 0.6;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-u, 0); g.lineTo(-u, -u); g.moveTo(0, u * 0.6); g.lineTo(u, u * 0.6); g.lineTo(u, -u * 0.4); g.stroke();
      break;
    case 'crack':
      g.lineWidth = Math.max(1, u * 0.25);
      g.beginPath(); g.moveTo(-u * 2, 0);
      for (let i = -1; i <= 2; i++) g.lineTo(i * u, (rng.next() - 0.5) * u * 1.6);
      g.stroke();
      break;
    case 'shard':
      g.shadowColor = color; g.shadowBlur = u * 3;
      g.beginPath(); g.moveTo(0, -u * 1.2); g.lineTo(u * 0.5, 0); g.lineTo(0, u * 1.2); g.lineTo(-u * 0.5, 0); g.closePath(); g.fill();
      break;
    case 'plus':
      g.lineWidth = Math.max(1, u * 0.25);
      g.beginPath(); g.moveTo(-u, 0); g.lineTo(u, 0); g.moveTo(0, -u); g.lineTo(0, u); g.stroke();
      break;
    case 'star': {
      const r = u * (0.15 + rng.next() * 0.35);
      g.globalAlpha = 0.4 + rng.next() * 0.6;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'glyph':
      g.lineWidth = Math.max(1, u * 0.25);
      g.beginPath();
      g.moveTo(-u, -u); g.lineTo(u, -u); g.lineTo(-u, u); g.lineTo(u, u);
      if (rng.chance(0.5)) { g.moveTo(0, -u * 1.4); g.lineTo(0, u * 1.4); }
      g.stroke();
      break;
    case 'spark':
      g.shadowColor = color; g.shadowBlur = u * 4;
      g.beginPath(); g.arc(0, 0, u * 0.35, 0, Math.PI * 2); g.fill();
      break;
  }
  g.restore();
}

// ------------------------------------------------------------ the whole scene

export interface SceneView {
  s: number;
  ox: number;
  oy: number;
  /** Size of the canvas area to fill (CSS px). */
  W: number;
  H: number;
}

/** Draw a map's static scenery: surroundings, ground, road, bases and obstacles. */
export function drawScenery(g: G, map: MapDef, v: SceneView): void {
  const t = themeOf(map);
  const { s, ox, oy, W, H } = v;
  const aw = map.cols * s, ah = map.rows * s;
  const rng = new Rng(map.seed * 7919 + 17);

  // Surroundings.
  g.fillStyle = t.outside;
  g.fillRect(0, 0, W, H);
  if (t.pattern === 'nebula' || t.ambient === 'stars') {
    for (let i = 0; i < (W * H) / 900; i++) drawScatter(g, 'star', rng.next() * W, rng.next() * H, s, rng.chance(0.8) ? '#ffffff' : '#c9d6ff', rng);
  }
  if (t.outsideGrid) {
    g.strokeStyle = t.outsideGrid;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = ox % s; x < W; x += s) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, H); }
    for (let y = oy % s; y < H; y += s) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); }
    g.stroke();
  }
  // Big scenery in the margins around the arena.
  if (t.margin > 0) {
    const marginTiles = (W * H - aw * ah) / (s * s);
    const n = Math.round((marginTiles / 100) * t.margin);
    for (let i = 0, placed = 0; i < n * 6 && placed < n; i++) {
      const x = rng.next() * W, y = rng.next() * H, r = s * (0.8 + rng.next() * 1.2);
      if (x > ox - r && x < ox + aw + r && y > oy - r && y < oy + ah + r) continue;
      drawProp(g, t.prop, x, y, r, t, rng);
      placed++;
    }
  }

  // Frame under / around the arena.
  if (t.frame === 'shadow') {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(ox + s * 0.15, oy + s * 0.22, aw, ah);
  }

  // Ground.
  g.fillStyle = t.ground;
  g.fillRect(ox, oy, aw, ah);
  g.save();
  g.beginPath();
  g.rect(ox, oy, aw, ah);
  g.clip();
  switch (t.pattern) {
    case 'stripes':
      g.fillStyle = t.ground2 ?? t.ground;
      for (let c = 0; c < map.cols; c += 4) g.fillRect(ox + c * s, oy, s * 2, ah);
      break;
    case 'paper':
      g.strokeStyle = 'rgba(90,150,210,0.1)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0.5; x < map.cols; x += 1) { g.moveTo(ox + x * s, oy); g.lineTo(ox + x * s, oy + ah); }
      for (let y = 0.5; y < map.rows; y += 1) { g.moveTo(ox, oy + y * s); g.lineTo(ox + aw, oy + y * s); }
      g.stroke();
      g.strokeStyle = 'rgba(220,90,90,0.45)';
      g.lineWidth = Math.max(1, s * 0.05);
      g.beginPath(); g.moveTo(ox + s * 1.2, oy); g.lineTo(ox + s * 1.2, oy + ah); g.stroke();
      break;
    case 'dunes':
      g.strokeStyle = 'rgba(190,130,60,0.16)';
      g.lineWidth = Math.max(1, s * 0.08);
      for (let y = -s; y < ah + s; y += s * 1.4) {
        g.beginPath();
        for (let x = 0; x <= aw; x += s * 0.5) g.lineTo(ox + x, oy + y + Math.sin(x / (s * 2.2) + y) * s * 0.35);
        g.stroke();
      }
      break;
    case 'hex': {
      g.strokeStyle = 'rgba(170,150,255,0.07)';
      g.lineWidth = 1;
      const hs = s * 0.7;
      for (let row = 0, y = 0; y < ah + hs; row++, y += hs * 1.5) {
        for (let x = row % 2 ? hs * 0.87 : 0; x < aw + hs; x += hs * 1.74) {
          g.beginPath();
          for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(ox + x + Math.cos(a) * hs, oy + y + Math.sin(a) * hs); }
          g.closePath();
          g.stroke();
        }
      }
      break;
    }
    case 'nebula':
      for (let i = 0; i < 6; i++) {
        const x = ox + rng.next() * aw, y = oy + rng.next() * ah, r = s * (3 + rng.next() * 5);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, ['rgba(140,80,220,0.28)', 'rgba(40,160,200,0.22)', 'rgba(230,90,160,0.2)'][i % 3]);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    case 'iridescent': {
      const grd = g.createLinearGradient(ox, oy, ox + aw, oy + ah);
      grd.addColorStop(0, t.ground);
      grd.addColorStop(1, t.ground2 ?? t.ground);
      g.fillStyle = grd;
      g.fillRect(ox, oy, aw, ah);
      g.strokeStyle = 'rgba(122,255,240,0.05)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = -ah; k < aw; k += s * 0.8) { g.moveTo(ox + k, oy + ah); g.lineTo(ox + k + ah, oy); }
      g.stroke();
      break;
    }
  }
  // Tile grid (always there: it is how players read where towers can go).
  g.strokeStyle = t.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 0; c <= map.cols; c++) { g.moveTo(ox + c * s + 0.5, oy); g.lineTo(ox + c * s + 0.5, oy + ah); }
  for (let r = 0; r <= map.rows; r++) { g.moveTo(ox, oy + r * s + 0.5); g.lineTo(ox + aw, oy + r * s + 0.5); }
  g.stroke();
  if (t.gridMajor) {
    g.strokeStyle = t.gridMajor.color;
    g.beginPath();
    for (let c = 0; c <= map.cols; c += t.gridMajor.every) { g.moveTo(ox + c * s + 0.5, oy); g.lineTo(ox + c * s + 0.5, oy + ah); }
    for (let r = 0; r <= map.rows; r += t.gridMajor.every) { g.moveTo(ox, oy + r * s + 0.5); g.lineTo(ox + aw, oy + r * s + 0.5); }
    g.stroke();
  }
  // Small decoration on free tiles.
  const onPath = pathTiles(map);
  const blocked = new Set(map.blocked.map(([c, r]) => r * map.cols + c));
  for (const sc of t.scatter) {
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (onPath.has(r * map.cols + c) || blocked.has(r * map.cols + c) || !rng.chance(sc.density)) continue;
        drawScatter(g, sc.kind, ox + (c + 0.2 + rng.next() * 0.6) * s, oy + (r + 0.2 + rng.next() * 0.6) * s, s, sc.colors[rng.int(0, sc.colors.length - 1)], rng);
      }
    }
  }
  g.restore();

  // Frame on top of the ground edge.
  if (t.frame === 'line' || t.frame === 'glow') {
    g.save();
    g.strokeStyle = t.frameColor ?? '#ffffff';
    g.lineWidth = Math.max(1.5, s * 0.06);
    if (t.frame === 'glow') { g.shadowColor = t.frameColor ?? '#ffffff'; g.shadowBlur = s * 0.5; }
    g.strokeRect(ox, oy, aw, ah);
    g.restore();
  }

  // Air lanes.
  g.setLineDash([s * 0.25, s * 0.35]);
  g.strokeStyle = t.air;
  g.lineWidth = Math.max(1.5, s * 0.06);
  for (const p of map.air) strokePolyline(g, p.map(([c, r]) => [c + 0.5, r + 0.5] as [number, number]), s, ox, oy);
  g.setLineDash([]);

  // Road: an edge pass, then the fill, then details.
  const lines = polylines(map);
  g.lineCap = 'square';
  g.lineJoin = 'miter';
  g.save();
  if (t.roadGlow) { g.shadowColor = t.roadGlow; g.shadowBlur = s * 0.45; }
  g.strokeStyle = t.roadEdge;
  g.lineWidth = s * (t.roadGlow || t.roadCenter ? 0.94 : 1.0);
  for (const p of lines) strokePolyline(g, p, s, ox, oy);
  g.restore();
  g.strokeStyle = t.road;
  g.lineWidth = s * (t.roadGlow || t.roadCenter ? 0.84 : 0.86);
  if (t.road.startsWith('rgba')) {
    // A see-through road must not show the edge stroke through it: restore the ground first.
    g.save();
    g.strokeStyle = t.ground;
    for (const p of lines) strokePolyline(g, p, s, ox, oy);
    g.restore();
  }
  for (const p of lines) strokePolyline(g, p, s, ox, oy);
  if (t.roadCenter) {
    g.setLineDash([s * 0.3, s * 0.3]);
    g.strokeStyle = t.roadCenter;
    g.lineWidth = Math.max(1, s * 0.05);
    g.lineCap = 'butt';
    for (const p of lines) strokePolyline(g, p, s, ox, oy);
    g.setLineDash([]);
  }
  if (t.roadSpeckle) {
    g.fillStyle = t.roadSpeckle;
    for (const p of lines) {
      for (const q of along(p, 0.3, 0.45, 0)) {
        const jx = (rng.next() - 0.5) * 0.6, jy = (rng.next() - 0.5) * 0.6;
        g.beginPath(); g.arc(ox + (q.x + jx) * s, oy + (q.y + jy) * s, s * (0.02 + rng.next() * 0.03), 0, Math.PI * 2); g.fill();
      }
    }
  }
  // Direction chevrons.
  g.strokeStyle = t.chevron;
  g.lineWidth = Math.max(1.5, s * 0.07);
  g.lineCap = 'round';
  for (const p of lines) {
    for (const q of along(p, 1.5, 2.5)) {
      const x = ox + q.x * s, y = oy + q.y * s, k = s * 0.16;
      g.beginPath();
      g.moveTo(x - Math.cos(q.a - 0.9) * k, y - Math.sin(q.a - 0.9) * k);
      g.lineTo(x, y);
      g.lineTo(x - Math.cos(q.a + 0.9) * k, y - Math.sin(q.a + 0.9) * k);
      g.stroke();
    }
  }

  // Bases: enemy spawns (red) and yours (blue).
  const alpha = t.dark ? 0.34 : 0.22;
  const base = (px: number, py: number, color: string) => {
    const cx = Math.min(map.cols - 0.5, Math.max(0.5, px)), cy = Math.min(map.rows - 0.5, Math.max(0.5, py));
    g.fillStyle = color.replace('ALPHA', String(alpha));
    g.fillRect(ox + (cx - 1) * s, oy + (cy - 1) * s, s * 2, s * 2);
  };
  const seen = new Set<string>();
  for (const p of lines) {
    const [sx, sy] = p[0], [ex, ey] = p[p.length - 1];
    if (!seen.has(`s${sx},${sy}`)) { seen.add(`s${sx},${sy}`); base(sx, sy, 'rgba(241,78,84,ALPHA)'); }
    if (!seen.has(`e${ex},${ey}`)) { seen.add(`e${ex},${ey}`); base(ex, ey, 'rgba(0,178,225,ALPHA)'); }
  }

  // Obstacles on blocked tiles.
  for (const [c, r] of map.blocked) drawProp(g, t.prop, ox + (c + 0.5) * s, oy + (r + 0.5) * s, s * 0.42, t, rng);
}

/** Per-frame ambience for the livelier themes. Cheap: a few dozen dots at most. */
export function drawAmbient(g: G, map: MapDef, v: { s: number; ox: number; oy: number }, time: number): void {
  const t = themeOf(map);
  if (t.ambient === 'none') return;
  const { s, ox, oy } = v;
  const aw = map.cols * s, ah = map.rows * s;
  const hash = (i: number, k: number) => {
    const x = Math.sin(i * 127.1 + k * 311.7 + map.seed * 0.123) * 43758.5453;
    return x - Math.floor(x);
  };
  g.save();
  g.fillStyle = t.ambientColor ?? '#ffffff';
  switch (t.ambient) {
    case 'fireflies':
      g.shadowColor = t.ambientColor ?? '#ffffff';
      g.shadowBlur = s * 0.3;
      for (let i = 0; i < 14; i++) {
        const x = (hash(i, 1) * aw + Math.sin(time * 0.4 + i) * s * 1.2 + aw) % aw;
        const y = (hash(i, 2) * ah + Math.cos(time * 0.33 + i * 1.7) * s * 0.9 + ah) % ah;
        g.globalAlpha = 0.35 + 0.45 * Math.max(0, Math.sin(time * 1.6 + i * 2.1));
        g.beginPath(); g.arc(ox + x, oy + y, s * 0.05, 0, Math.PI * 2); g.fill();
      }
      break;
    case 'motes':
      for (let i = 0; i < 22; i++) {
        const x = hash(i, 1) * aw + Math.sin(time * 0.3 + i) * s * 0.4;
        const y = ((hash(i, 2) * ah - time * s * (0.12 + hash(i, 3) * 0.2)) % ah + ah) % ah;
        g.globalAlpha = 0.25 + 0.25 * Math.sin(time + i);
        g.beginPath(); g.arc(ox + x, oy + y, s * (0.03 + hash(i, 4) * 0.04), 0, Math.PI * 2); g.fill();
      }
      break;
    case 'stars':
      for (let i = 0; i < 26; i++) {
        const x = hash(i, 1) * aw, y = hash(i, 2) * ah;
        const tw = Math.max(0, Math.sin(time * (0.8 + hash(i, 3) * 1.5) + i * 3));
        g.globalAlpha = tw * 0.9;
        const r = s * 0.05 * (0.5 + tw);
        g.beginPath(); g.moveTo(ox + x - r * 2, oy + y); g.lineTo(ox + x + r * 2, oy + y); g.moveTo(ox + x, oy + y - r * 2); g.lineTo(ox + x, oy + y + r * 2);
        g.strokeStyle = t.ambientColor ?? '#ffffff'; g.lineWidth = Math.max(1, r * 0.5); g.stroke();
      }
      break;
    case 'scan': {
      const y = ((time * s * 1.2) % (ah + s * 2)) - s;
      const grd = g.createLinearGradient(0, oy + y - s, 0, oy + y + s);
      grd.addColorStop(0, 'rgba(57,243,255,0)');
      grd.addColorStop(0.5, 'rgba(57,243,255,0.08)');
      grd.addColorStop(1, 'rgba(57,243,255,0)');
      g.fillStyle = grd;
      g.fillRect(ox, oy + Math.max(0, y - s), aw, Math.min(ah, s * 2));
      break;
    }
  }
  g.restore();
}
