// Small math helpers shared by the sim, renderer and tools. No DOM, no Node APIs.

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Rotate angle `a` toward `b` by at most `maxStep` radians. */
export function turnToward(a: number, b: number, maxStep: number): number {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** Squared distance from point P to segment AB. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist2(px, py, ax + abx * t, ay + aby * t);
}

/** Stable 32-bit string hash (FNV-1a). Used for deterministic seeds from keys. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '∞';
  const p = Math.pow(10, digits);
  return String(Math.round(n * p) / p);
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function pct(mult: number): string {
  return `${Math.round(mult * 100)}%`;
}

// ------------------------------------------------------------ portable math
//
// Engines disagree in the last bit of Math.sin, Math.cos and Math.pow (V8 12
// in Node 22 and V8 14 in Chrome 141 differ on about one call in ten), and a
// last bit is enough to make a long game play out differently. The sim uses
// these instead. They use only + - * / and Math.sqrt, which IEEE 754 makes
// exact everywhere, so a run is the same game in every engine. The kernels
// are fdlibm's (FreeBSD msun), accurate to about an ulp.

const PIO4 = 0.7853981633974483;
const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e+0;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;

function ksin(x: number, y: number, tail: boolean): number {
  const z = x * x, w = z * z;
  const r = 8.33333333332248946124e-3 + z * (-1.98412698298579493134e-4 + z * 2.75573137070700676789e-6)
    + z * w * (-2.50507602534068634195e-8 + z * 1.58969099521155010221e-10);
  const v = z * x;
  const s1 = -1.66666666666666324348e-1;
  return tail ? x - ((z * (0.5 * y - v * r) - y) - v * s1) : x + v * (s1 + z * r);
}

function kcos(x: number, y: number): number {
  const z = x * x, w = z * z;
  const r = z * (4.16666666666666019037e-2 + z * (-1.38888888888741095749e-3 + z * 2.48015872894767294178e-5))
    + w * w * (-2.75573143513906633035e-7 + z * (2.08757232129817482790e-9 + z * -1.13596475577881948265e-11));
  const hz = 0.5 * z;
  const a = 1 - hz;
  return a + (((1 - a) - hz) + (z * r - x * y));
}

/** x = n * PI/2 + (y0 + y1), with |y0| <= PI/4. Exact enough for |x| up to about 1e5. */
let ry0 = 0, ry1 = 0;
function reduce(x: number): number {
  const n = Math.round(x * INVPIO2);
  let r = x - n * PIO2_1;
  let w = n * PIO2_1T;
  const t = r;
  w = n * PIO2_2;
  r = t - w;
  w = n * PIO2_2T - ((t - r) - w);
  ry0 = r - w;
  ry1 = (r - ry0) - w;
  return ((n % 4) + 4) % 4;
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < 7.450580596923828e-9) return x;
  if (Math.abs(x) <= PIO4) return ksin(x, 0, false);
  switch (reduce(x)) {
    case 0: return ksin(ry0, ry1, true);
    case 1: return kcos(ry0, ry1);
    case 2: return -ksin(ry0, ry1, true);
    default: return -kcos(ry0, ry1);
  }
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= PIO4) return kcos(x, 0);
  switch (reduce(x)) {
    case 0: return kcos(ry0, ry1);
    case 1: return -ksin(ry0, ry1, true);
    case 2: return -kcos(ry0, ry1);
    default: return ksin(ry0, ry1, true);
  }
}

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e+0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const neg = x < 0;
  let a = Math.abs(x);
  let id: number;
  if (a >= 7.378697629483821e19) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3];
  if (a < 0.4375) {
    if (a < 7.450580596923828e-9) return x;
    id = -1;
  } else if (a < 1.1875) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); }
  } else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); } else { id = 3; a = -1 / a; }
  const z = a * a, w = z * z;
  const s1 = z * (3.33333333333329318027e-1 + w * (1.42857142725034663711e-1 + w * (9.09088713343650656196e-2
    + w * (6.66107313738753120669e-2 + w * (4.97687799461593236017e-2 + w * 1.62858201153657823623e-2)))));
  const s2 = w * (-1.99999999998764832476e-1 + w * (-1.11111104054623557880e-1 + w * (-7.69187620504482999495e-2
    + w * (-5.83357013379057348645e-2 + w * -3.65315727442169155270e-2))));
  if (id < 0) return neg ? -(a - a * (s1 + s2)) : a - a * (s1 + s2);
  const r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a);
  return neg ? -r : r;
}

const PI = 3.1415926535897931160e+0;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return atan(y);
  const yneg = y < 0 || Object.is(y, -0);
  if (y === 0) return x > 0 || Object.is(x, 0) ? y : yneg ? -PI : PI;
  if (x === 0) return yneg ? -PI / 2 : PI / 2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) return (yneg ? -1 : 1) * (x > 0 ? PI / 4 : (3 * PI) / 4);
    return x > 0 ? (yneg ? -0 : 0) : yneg ? -PI : PI;
  }
  if (!Number.isFinite(y)) return yneg ? -PI / 2 : PI / 2;
  const q = Math.abs(y / x);
  const z = q > 1.152921504606847e18 ? PI / 2 + 0.5 * PI_LO : x < 0 && q < 8.673617379884035e-19 ? 0 : atan(q);
  if (x > 0) return yneg ? -z : z;
  return yneg ? (z - PI_LO) - PI : PI - (z - PI_LO);
}

/**
 * b to the power n, by squaring. The sim only raises to whole powers (levels,
 * stacks, wave numbers); a fractional one falls back to exp and log, which
 * engines agree on today.
 */
export function pow(b: number, n: number): number {
  if (!Number.isInteger(n) || Math.abs(n) > 1e6) return Math.exp(n * Math.log(b));
  let e = Math.abs(n), r = 1, s = b;
  while (e > 0) {
    if (e % 2 === 1) r *= s;
    e = Math.floor(e / 2);
    if (e) s *= s;
  }
  return n < 0 ? 1 / r : r;
}

export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
