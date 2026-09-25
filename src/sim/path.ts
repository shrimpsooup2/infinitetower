// A polyline path in tile units. Enemies store their position as a distance
// along the path, which makes push-back / rewind / teleport effects trivial.

import { atan2, clamp, dist } from './math.ts';

export class Path {
  readonly xs: number[];
  readonly ys: number[];
  readonly cum: number[];
  readonly length: number;
  readonly air: boolean;

  constructor(points: readonly (readonly [number, number])[], air = false) {
    this.xs = points.map((p) => p[0]);
    this.ys = points.map((p) => p[1]);
    this.air = air;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      this.cum.push(this.cum[i - 1] + dist(this.xs[i - 1], this.ys[i - 1], this.xs[i], this.ys[i]));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  private segAt(d: number): number {
    // Binary search for the segment containing distance d.
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Position + heading at distance d (clamped to the path). */
  at(d: number, out: { x: number; y: number; ang: number }): { x: number; y: number; ang: number } {
    d = clamp(d, 0, this.length);
    const i = this.segAt(d);
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen > 0 ? (d - this.cum[i]) / segLen : 0;
    const x0 = this.xs[i], y0 = this.ys[i], x1 = this.xs[i + 1], y1 = this.ys[i + 1];
    out.x = x0 + (x1 - x0) * t;
    out.y = y0 + (y1 - y0) * t;
    out.ang = atan2(y1 - y0, x1 - x0);
    return out;
  }

  /** Distance along the path of the point on the path closest to (x, y). */
  project(x: number, y: number): number {
    let best = Infinity;
    let bestD = 0;
    for (let i = 0; i < this.xs.length - 1; i++) {
      const ax = this.xs[i], ay = this.ys[i], bx = this.xs[i + 1], by = this.ys[i + 1];
      const abx = bx - ax, aby = by - ay;
      const len2 = abx * abx + aby * aby;
      const t = len2 > 0 ? clamp(((x - ax) * abx + (y - ay) * aby) / len2, 0, 1) : 0;
      const px = ax + abx * t, py = ay + aby * t;
      const dd = (px - x) * (px - x) + (py - y) * (py - y);
      if (dd < best) {
        best = dd;
        bestD = this.cum[i] + Math.sqrt(len2) * t;
      }
    }
    return bestD;
  }

  /** Minimum distance from (x, y) to the path. */
  distanceTo(x: number, y: number): number {
    const p = this.at(this.project(x, y), { x: 0, y: 0, ang: 0 });
    return dist(p.x, p.y, x, y);
  }
}
