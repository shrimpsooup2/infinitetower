// Uniform-grid spatial hash for enemy range queries. Rebuilt every tick.

export interface Positioned {
  id: number;
  x: number;
  y: number;
}

export class SpatialHash<T extends Positioned> {
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly ox: number;
  private readonly oy: number;
  private buckets: T[][];
  private readonly out: T[] = [];

  constructor(width: number, height: number, cell = 1.5, margin = 4) {
    this.cell = cell;
    this.ox = -margin;
    this.oy = -margin;
    this.cols = Math.ceil((width + margin * 2) / cell);
    this.rows = Math.ceil((height + margin * 2) / cell);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const b of this.buckets) b.length = 0;
  }

  private idx(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.ox) / this.cell)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.oy) / this.cell)));
    return r * this.cols + c;
  }

  insert(item: T): void {
    this.buckets[this.idx(item.x, item.y)].push(item);
  }

  /**
   * Items whose position lies within `radius` (+ `pad`) of (x, y). The returned
   * array is reused between calls; copy it if you need to keep it.
   */
  query(x: number, y: number, radius: number, pad = 0): T[] {
    const out = this.out;
    out.length = 0;
    const r = radius + pad;
    const r2 = r * r;
    const c0 = Math.max(0, Math.floor((x - r - this.ox) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r - this.ox) / this.cell));
    const r0 = Math.max(0, Math.floor((y - r - this.oy) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y + r - this.oy) / this.cell));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const b = this.buckets[rr * this.cols + cc];
        for (let i = 0; i < b.length; i++) {
          const it = b[i];
          const dx = it.x - x, dy = it.y - y;
          if (dx * dx + dy * dy <= r2) out.push(it);
        }
      }
    }
    return out;
  }
}
