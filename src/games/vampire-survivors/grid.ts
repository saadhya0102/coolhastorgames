/**
 * Uniform spatial hash grid for fast nearest / radius queries over enemies.
 * Rebuilt every frame from the live enemy list. Cheap to clear (we keep a
 * generation stamp per bucket instead of reallocating).
 */
import type { Enemy } from "./types";

export class SpatialGrid {
  private cell: number;
  private buckets = new Map<number, Enemy[]>();
  private stamp = new Map<number, number>();
  private gen = 0;

  constructor(cell = 64) {
    this.cell = cell;
  }

  private key(cx: number, cy: number): number {
    // Pack two signed cell coords into one number key.
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  clear(): void {
    this.gen++;
  }

  insert(e: Enemy): void {
    const cx = Math.floor(e.x / this.cell);
    const cy = Math.floor(e.y / this.cell);
    const k = this.key(cx, cy);
    let b = this.buckets.get(k);
    if (this.stamp.get(k) !== this.gen) {
      if (!b) {
        b = [];
        this.buckets.set(k, b);
      } else {
        b.length = 0;
      }
      this.stamp.set(k, this.gen);
    } else if (!b) {
      b = [];
      this.buckets.set(k, b);
    }
    b.push(e);
  }

  /** Iterate enemies in cells overlapping the circle (x,y,r). */
  query(x: number, y: number, r: number, cb: (e: Enemy) => void): void {
    const minX = Math.floor((x - r) / this.cell);
    const maxX = Math.floor((x + r) / this.cell);
    const minY = Math.floor((y - r) / this.cell);
    const maxY = Math.floor((y + r) / this.cell);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const k = this.key(cx, cy);
        if (this.stamp.get(k) !== this.gen) continue;
        const b = this.buckets.get(k);
        if (!b) continue;
        for (let i = 0; i < b.length; i++) cb(b[i]);
      }
    }
  }
}
