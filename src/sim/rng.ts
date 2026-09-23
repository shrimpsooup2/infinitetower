// Deterministic PRNG (sfc32). The sim never calls Math.random, so a run is
// reproducible from its seed and command log.

export class Rng {
  a: number;
  b: number;
  c: number;
  d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 15; i++) this.next();
  }

  /** Uniform float in [0, 1). */
  next(): number {
    const a = this.a, b = this.b, c = this.c, d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    this.d = (d + 1) | 0;
    this.a = b ^ (b >>> 9);
    this.b = (c + (c << 3)) | 0;
    this.c = (c << 21) | (c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.next() * (hiInclusive - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  state(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  restore(s: [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}
