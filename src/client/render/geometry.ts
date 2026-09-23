// 3D polyhedra and 4D polytopes for the renderer. Vertices come from their
// textbook coordinates (signed / even permutations with the golden ratio);
// edges are the vertex pairs at minimum distance (true for uniform shapes).
// 4D shapes are rotated through the 4th axis, projected and drawn as
// wireframes. 3D solids break from the flat style on purpose: they get real
// faces (a convex hull pass) and glossy early-2000s-render shading, drawn on a
// slightly low-resolution buffer.

import { shade } from '../../content/colors.ts';
import type { Ctx2D } from './draw.ts';

const PHI = (1 + Math.sqrt(5)) / 2;

type Vec = number[];

export interface Face {
  /** Vertex indices in winding order. */
  v: number[];
  /** Outward unit normal. */
  n: Vec;
}

export interface Model {
  dim: 3 | 4;
  verts: Vec[];
  edges: [number, number][];
  /** Faces of a 3D convex solid. */
  faces: Face[];
}

function permutations(a: number[], evenOnly: boolean): number[][] {
  const out: number[][] = [];
  const n = a.length;
  const idx = [...Array(n).keys()];
  const rec = (k: number, parity: number) => {
    if (k === n) {
      if (!evenOnly || parity === 0) out.push(idx.map((i) => a[i]));
      return;
    }
    for (let i = k; i < n; i++) {
      [idx[k], idx[i]] = [idx[i], idx[k]];
      rec(k + 1, parity ^ (i !== k ? 1 : 0));
      [idx[k], idx[i]] = [idx[i], idx[k]];
    }
  };
  rec(0, 0);
  return out;
}

function signs(a: number[]): number[][] {
  let out: number[][] = [[]];
  for (const x of a) {
    const next: number[][] = [];
    for (const o of out) {
      next.push([...o, x]);
      if (x !== 0) next.push([...o, -x]);
    }
    out = next;
  }
  return out;
}

function gen(bases: number[][], mode: 'all' | 'even' | 'none', filter?: (v: number[]) => boolean): Vec[] {
  const seen = new Set<string>();
  const out: Vec[] = [];
  for (const b of bases) {
    const perms = mode === 'none' ? [b] : permutations(b, mode === 'even');
    for (const p of perms) {
      for (const s of signs(p)) {
        if (filter && !filter(s)) continue;
        const k = s.map((x) => x.toFixed(4)).join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
      }
    }
  }
  return out;
}

function normalize(verts: Vec[]): Vec[] {
  let m = 0;
  for (const v of verts) m = Math.max(m, Math.hypot(...v));
  return verts.map((v) => v.map((x) => x / m));
}

function minEdges(verts: Vec[], tol = 1.02): [number, number][] {
  let min = Infinity;
  const d = (a: Vec, b: Vec) => Math.hypot(...a.map((x, i) => x - b[i]));
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) min = Math.min(min, d(verts[i], verts[j]));
  const edges: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) if (d(verts[i], verts[j]) <= min * tol) edges.push([i, j]);
  return edges;
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Faces of a convex solid centred on the origin: every supporting plane through 3+ vertices. */
export function hullFaces(v: Vec[]): Face[] {
  const faces: Face[] = [];
  const seen = new Set<string>();
  const n = v.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        let nm = cross(sub(v[j], v[i]), sub(v[k], v[i]));
        const len = Math.hypot(nm[0], nm[1], nm[2]);
        if (len < 1e-9) continue;
        nm = nm.map((x) => x / len);
        let d = dot(nm, v[i]);
        if (d < 0) { nm = nm.map((x) => -x); d = -d; }
        if (d < 1e-6) continue;
        let ok = true;
        for (let q = 0; q < n && ok; q++) if (dot(nm, v[q]) > d + 1e-6) ok = false;
        if (!ok) continue;
        const on = [...Array(n).keys()].filter((q) => Math.abs(dot(nm, v[q]) - d) < 1e-4);
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        // Order around the centroid, counter-clockwise seen from outside.
        const c = [0, 1, 2].map((a) => on.reduce((s, q) => s + v[q][a], 0) / on.length);
        const u = sub(v[on[0]], c);
        const ul = Math.hypot(u[0], u[1], u[2]);
        const U = u.map((x) => x / ul);
        const V = cross(nm, U);
        on.sort((a, b) => {
          const pa = sub(v[a], c), pb = sub(v[b], c);
          return Math.atan2(dot(pa, V), dot(pa, U)) - Math.atan2(dot(pb, V), dot(pb, U));
        });
        faces.push({ v: on, n: nm });
      }
    }
  }
  return faces;
}

function model(dim: 3 | 4, verts: Vec[], tol = 1.02): Model {
  const v = normalize(verts);
  return { dim, verts: v, edges: minEdges(v, tol), faces: dim === 3 ? hullFaces(v) : [] };
}

function prism(n: number): Vec[] {
  const s = 2 * Math.sin(Math.PI / n);
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a), Math.sin(a), s / 2], [Math.cos(a), Math.sin(a), -s / 2]);
  }
  return out;
}

function duoprism(p: number, q: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < q; j++) {
      const a = (i / p) * Math.PI * 2, b = (j / q) * Math.PI * 2;
      out.push([Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]);
    }
  }
  return out;
}

function geodesic(): Vec[] {
  const ico = gen([[0, 1, PHI]], 'even');
  const n = ico.map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });
  const edges = minEdges(n);
  const out = [...n];
  for (const [a, b] of edges) {
    const m = n[a].map((x, i) => (x + n[b][i]) / 2);
    const l = Math.hypot(...m);
    out.push(m.map((x) => x / l));
  }
  return out;
}

const cache = new Map<string, Model>();

const BUILDERS: Record<string, () => Model> = {
  tetrahedron: () => model(3, [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]),
  cube: () => model(3, gen([[1, 1, 1]], 'none')),
  octahedron: () => model(3, gen([[1, 0, 0]], 'all')),
  dodecahedron: () => model(3, [...gen([[1, 1, 1]], 'none'), ...gen([[0, 1 / PHI, PHI]], 'even')]),
  icosahedron: () => model(3, gen([[0, 1, PHI]], 'even')),
  prism3: () => model(3, prism(3)),
  truncated_tetrahedron: () => model(3, gen([[3, 1, 1]], 'all', (v) => v.filter((x) => x < 0).length % 2 === 0)),
  cuboctahedron: () => model(3, gen([[1, 1, 0]], 'all')),
  rhombic_dodecahedron: () => model(3, [...gen([[1, 1, 1]], 'none'), ...gen([[2, 0, 0]], 'all')]),
  truncated_octahedron: () => model(3, gen([[0, 1, 2]], 'all')),
  truncated_icosahedron: () => model(3, gen([[0, 1, 3 * PHI], [1, 2 + PHI, 2 * PHI], [PHI, 2, PHI * PHI * PHI]], 'even')),
  rhombicosidodecahedron: () => model(3, gen([[1, 1, PHI ** 3], [PHI ** 2, PHI, 2 * PHI], [2 + PHI, 0, PHI ** 2]], 'even')),
  geodesic: () => model(3, geodesic(), 1.25),
  cell5: () => model(4, [[1, 1, 1, -1 / Math.sqrt(5)], [1, -1, -1, -1 / Math.sqrt(5)], [-1, 1, -1, -1 / Math.sqrt(5)], [-1, -1, 1, -1 / Math.sqrt(5)], [0, 0, 0, 4 / Math.sqrt(5)]]),
  duo33: () => model(4, duoprism(3, 3)),
  tesseract: () => model(4, gen([[1, 1, 1, 1]], 'none')),
  duo55: () => model(4, duoprism(5, 5)),
  cell16: () => model(4, gen([[1, 0, 0, 0]], 'all')),
  cell24: () => model(4, gen([[1, 1, 0, 0]], 'all')),
  cell600: () => model(4, [
    ...gen([[0.5, 0.5, 0.5, 0.5]], 'none'),
    ...gen([[1, 0, 0, 0]], 'all'),
    ...gen([[PHI / 2, 0.5, 1 / (2 * PHI), 0]], 'even'),
  ]),
};

export function getModel(id: string): Model | null {
  let m = cache.get(id);
  if (m) return m;
  const b = BUILDERS[id];
  if (!b) return null;
  m = b();
  cache.set(id, m);
  return m;
}

function hull(pts: number[][]): number[][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: number[][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: number[][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Draw a 3D / 4D model centred at (x, y) with screen radius r. */
export function drawModel(ctx: Ctx2D, m: Model, x: number, y: number, r: number, t: number, color: string, lw: number, fillAlpha = 1): void {
  const ay = t * 0.7, ax = t * 0.43 + 0.5;
  const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
  const cw = Math.cos(t * 0.55), sw = Math.sin(t * 0.55);
  const cz = Math.cos(t * 0.31), sz = Math.sin(t * 0.31);
  const P: number[][] = [];
  for (const v of m.verts) {
    let X = v[0], Y = v[1], Z = v[2];
    if (m.dim === 4) {
      let W = v[3];
      // Rotate in the XW and ZW planes, then project 4D -> 3D with perspective.
      const x1 = X * cw - W * sw;
      W = X * sw + W * cw;
      X = x1;
      const z1 = Z * cz - W * sz;
      W = Z * sz + W * cz;
      Z = z1;
      const k = 1.6 / (2.6 - W);
      X *= k; Y *= k; Z *= k;
    }
    // 3D rotation (Y then X axis).
    const x2 = X * cy + Z * sy;
    const z2 = -X * sy + Z * cy;
    const y2 = Y * cx - z2 * sx;
    const z3 = Y * sx + z2 * cx;
    P.push([x + x2 * r, y + y2 * r, z3]);
  }
  const h = hull(P);
  ctx.beginPath();
  h.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.globalAlpha *= fillAlpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha /= fillAlpha;
  const edgeColor = shade(color, m.dim === 4 ? 0.62 : 0.7);
  ctx.lineCap = 'round';
  // Back edges faint, front edges solid.
  const back: [number, number][] = [];
  const front: [number, number][] = [];
  for (const e of m.edges) ((P[e[0]][2] + P[e[1]][2]) / 2 < 0 ? back : front).push(e);
  const ga = ctx.globalAlpha;
  ctx.strokeStyle = edgeColor;
  ctx.globalAlpha = ga * 0.35;
  ctx.lineWidth = Math.max(1, lw * 0.5);
  ctx.beginPath();
  for (const [a, b] of back) { ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); }
  ctx.stroke();
  ctx.globalAlpha = ga;
  ctx.lineWidth = Math.max(1, lw * (m.dim === 4 ? 0.6 : 0.75));
  ctx.beginPath();
  for (const [a, b] of front) { ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); }
  ctx.stroke();
  ctx.beginPath();
  h.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.strokeStyle = shade(color, 0.72);
  ctx.lineWidth = lw;
  ctx.stroke();
}

// ------------------------------------------------------------ shaded solids
// The look of an early-2000s render: shading that runs smoothly across each
// face, a hard white specular hotspot, a cool fresnel rim and sky-tinted
// upward faces. Meant for a slightly low-resolution buffer (see enemy-art).

type RGB = [number, number, number];

const unit = (v: Vec): Vec => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; };
/** Key light from the upper left, toward the viewer (view space, +z out of the screen, +y down). */
const LIGHT = unit([-0.5, -0.72, 0.75]);
const HALF = unit([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
const RIM: RGB = [205, 228, 255];
const rgbCache = new Map<string, RGB>();

function rgbOf(hex: string): RGB {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    if (rgbCache.size > 500) rgbCache.clear();
    rgbCache.set(hex, c);
  }
  return c;
}

const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

/** Lit colour of a surface with normal n. */
function lit(base: RGB, n: Vec, shine = 18): RGB {
  const diff = Math.max(0, dot(n, LIGHT));
  const amb = 0.26 + 0.14 * -n[1];
  const spec = Math.pow(Math.max(0, dot(n, HALF)), shine) * 0.75;
  const rim = Math.pow(1 - Math.max(0, n[2]), 3) * 0.4;
  const k = amb + 0.82 * diff;
  return [0, 1, 2].map((i) => Math.min(255, base[i] * k + 255 * spec + RIM[i] * rim)) as RGB;
}

/** A tumbling, glossy 3D solid. */
export function drawSolid(ctx: Ctx2D, m: Model, x: number, y: number, r: number, t: number, color: string, outline = 1): void {
  const ay = t * 0.9, ax = t * 0.53 + 0.6, az = Math.sin(t * 0.37) * 0.5;
  const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax), cz = Math.cos(az), sz = Math.sin(az);
  const rot = (v: Vec): Vec => {
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    const y1 = v[1] * cx - z1 * sx, z2 = v[1] * sx + z1 * cx;
    return [x1 * cz - y1 * sz, x1 * sz + y1 * cz, z2];
  };
  const R = m.verts.map(rot);
  const P = R.map((q) => {
    const k = 3.4 / (3.4 - q[2]);
    return [x + q[0] * r * k, y + q[1] * r * k, q[2]];
  });
  const base = rgbOf(color);
  ctx.lineJoin = 'round';
  // Convex solid: back-face culling is all the sorting it needs.
  for (const f of m.faces) {
    const nf = rot(f.n);
    if (nf[2] <= 0.02) continue;
    // Per-vertex colours from a normal bent toward the vertex, so light runs across the face.
    const cols = f.v.map((i) => lit(base, unit([nf[0] * 0.62 + R[i][0] * 0.38, nf[1] * 0.62 + R[i][1] * 0.38, nf[2] * 0.62 + R[i][2] * 0.38])));
    let lo = 0, hi = 0;
    cols.forEach((c, i) => {
      if (lum(c) < lum(cols[lo])) lo = i;
      if (lum(c) > lum(cols[hi])) hi = i;
    });
    ctx.beginPath();
    f.v.forEach((i, j) => (j ? ctx.lineTo(P[i][0], P[i][1]) : ctx.moveTo(P[i][0], P[i][1])));
    ctx.closePath();
    const a = P[f.v[lo]], b = P[f.v[hi]];
    let fill: string | CanvasGradient;
    if (lo !== hi && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5) {
      const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
      g.addColorStop(0, css(cols[lo]));
      g.addColorStop(1, css(cols[hi]));
      fill = g;
    } else fill = css(cols[hi]);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // Specular hotspot where the face catches the light.
    const sf = Math.pow(Math.max(0, dot(nf, HALF)), 30);
    if (sf > 0.03) {
      let fx = 0, fy = 0, fr = 0;
      for (const i of f.v) { fx += P[i][0]; fy += P[i][1]; }
      fx /= f.v.length; fy /= f.v.length;
      for (const i of f.v) fr = Math.max(fr, Math.hypot(P[i][0] - fx, P[i][1] - fy));
      const hx = fx + LIGHT[0] * fr * 0.35, hy = fy + LIGHT[1] * fr * 0.35;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, fr * 0.85);
      g.addColorStop(0, `rgba(255,255,255,${Math.min(0.95, sf).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
  }
  if (outline > 0) {
    const h = hull(P);
    ctx.beginPath();
    h.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(25,25,40,0.45)';
    ctx.lineWidth = outline;
    ctx.stroke();
  }
}

/** The Sphere boss in the same style: a glossy ball with drifting bands. */
export function drawShadedSphere(ctx: Ctx2D, x: number, y: number, r: number, t: number, color: string, outline = 1): void {
  const base = rgbOf(color);
  const hx = x + LIGHT[0] * r * 0.55, hy = y + LIGHT[1] * r * 0.55;
  const g = ctx.createRadialGradient(hx, hy, r * 0.05, x, y, r);
  g.addColorStop(0, css(lit(base, LIGHT, 60)));
  g.addColorStop(0.55, css(lit(base, unit([0.1, 0.1, 1]))));
  g.addColorStop(0.9, css(lit(base, unit([0.7, 0.6, 0.35]))));
  g.addColorStop(1, css(lit(base, unit([0.8, 0.5, 0.05]))));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = Math.max(1, r * 0.1);
  for (let i = 0; i < 3; i++) {
    const a = t * 0.8 + (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(Math.cos(a)) * r, r, 0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  const s = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.38);
  s.addColorStop(0, 'rgba(255,255,255,0.95)');
  s.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = s;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
  if (outline > 0) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(25,25,40,0.45)';
    ctx.lineWidth = outline;
    ctx.stroke();
  }
}

/** Smooth limits: the Sphere and the Glome (hypersphere). */
export function drawSphere(ctx: Ctx2D, x: number, y: number, r: number, t: number, color: string, lw: number, hyper: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = shade(color, 0.72);
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.lineWidth = Math.max(1, lw * 0.55);
  ctx.strokeStyle = shade(color, hyper ? 0.6 : 0.8);
  const n = hyper ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const a = t * (0.6 + i * 0.15) + (i * Math.PI) / n;
    ctx.beginPath();
    ctx.ellipse(x, y, r * Math.abs(Math.cos(a)), r, i * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    if (hyper) {
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * Math.abs(Math.sin(a * 1.3)), -i * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
