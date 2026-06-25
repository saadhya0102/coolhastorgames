import { mulberry32 } from "@/engine";
import {
  BASE_SPEED,
  DIFF_FULL_Z,
  FAR,
  MAX_JUMP_RINGS,
  MAX_SAFE_GAP,
  MAX_SPEED,
  MIN_SAFE_GAP,
  SEG,
  SPEED_FULL_Z,
  START_SAFE_RINGS,
} from "./config";
import type { Ring } from "./types";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** estimated forward speed (rings/sec) at a given distance — mirrors player.ts */
export const speedAtDist = (dist: number): number =>
  clamp(
    BASE_SPEED + (dist * (MAX_SPEED - BASE_SPEED)) / SPEED_FULL_Z,
    BASE_SPEED,
    MAX_SPEED,
  );

/** 0..1 difficulty from distance */
export const diffAtDist = (dist: number): number =>
  clamp(dist / DIFF_FULL_Z, 0, 1);

/**
 * The endless level.
 *
 * Generation guarantees a *clearable continuous route*: we first lay a "path
 * face" that is always solid and only ever drifts by one face per step, then
 * sprinkle holes everywhere else under two invariants:
 *   - the path face is never holed (a continuous wall-running line exists);
 *   - no run of >2 consecutive holes around the ring, so every hole always has
 *     a solid neighbour one step away (local escapability).
 * Full-ring gaps (jumps) are length <= MAX_JUMP_RINGS with solid landing rings
 * on both sides. Together these make every obstacle fair.
 */
export class Level {
  readonly n: number;
  private rings = new Map<number, Ring>();
  private rng: () => number;

  private cursor = 0; // next ring index to generate
  private pathFace: number;
  private sinceMove = 0;
  private gapRemaining = 0; // rings of full-gap still to emit
  private postGapSafe = 0; // forced solid landing rings after a gap
  private cooldown = 0; // rings until another gap is allowed
  private driftDir = 0; // spiral drift bias (-1,0,1)
  private driftLeft = 0; // rings remaining in current drift mood
  private denseLeft = 0; // rings remaining in a "pinch" dense mood

  constructor(n: number, startFace: number, seed: number) {
    this.n = n;
    this.pathFace = wrap(startFace, n);
    this.rng = mulberry32(seed >>> 0);
  }

  /** ensure rings are generated far enough ahead of the camera */
  ensure(camZ: number): void {
    const needTo = Math.ceil((camZ + FAR + SEG * 3) / SEG);
    while (this.cursor <= needTo) this.generate(this.cursor++);
    // evict rings well behind the camera
    const dropBelow = Math.floor(camZ / SEG) - 4;
    if (dropBelow > 0 && this.rings.has(dropBelow - 1)) {
      for (const r of this.rings.keys()) {
        if (r < dropBelow) this.rings.delete(r);
      }
    }
  }

  ring(r: number): Ring | undefined {
    return this.rings.get(r);
  }

  /** is face `f` solid at ring `r`? defaults to solid for out-of-range queries */
  solidAt(r: number, f: number): boolean {
    const ring = this.rings.get(r);
    if (!ring) return true;
    return ring.solid[wrap(f, this.n)];
  }

  // --- generation ----------------------------------------------------------

  private generate(r: number): void {
    const n = this.n;
    const dist = (r * SEG) >> 0;
    const biome = Math.floor((r * SEG) / 2200);
    const solid = new Array<boolean>(n).fill(true);

    // opening grace period: a clean runway to orient on
    if (r < START_SAFE_RINGS) {
      this.rings.set(r, { r, solid, biome });
      return;
    }

    const diff = diffAtDist(dist);
    const estSpeed = speedAtDist(dist);
    const minMoveGap = Math.max(1, Math.ceil(estSpeed * 0.17));

    // 1) finish an in-progress full gap (jump) ------------------------------
    if (this.gapRemaining > 0) {
      this.gapRemaining--;
      for (let i = 0; i < n; i++) solid[i] = false; // void: must be airborne
      if (this.gapRemaining === 0) this.postGapSafe = 1;
      this.rings.set(r, { r, solid, biome });
      return;
    }

    // 2) forced safe landing ring right after a gap -------------------------
    if (this.postGapSafe > 0) {
      this.postGapSafe--;
      this.cooldown = Math.max(this.cooldown, 1);
      this.sinceMove++;
      this.rings.set(r, { r, solid, biome });
      return;
    }

    // 3) maybe drift the safe path (gives wall-running rhythm / spirals) -----
    this.sinceMove++;
    if (this.driftLeft > 0) {
      this.driftLeft--;
      if (this.sinceMove >= minMoveGap) {
        this.pathFace = wrap(this.pathFace + this.driftDir, n);
        this.sinceMove = 0;
      }
    } else if (this.sinceMove >= minMoveGap) {
      const moveChance = 0.1 + diff * 0.33;
      if (this.rng() < moveChance) {
        // occasionally commit to a multi-step spiral drift for flavour
        if (diff > 0.25 && this.rng() < 0.3) {
          this.driftDir = this.rng() < 0.5 ? -1 : 1;
          this.driftLeft = 2 + Math.floor(this.rng() * 4);
        }
        const dir =
          this.driftLeft > 0 ? this.driftDir : this.rng() < 0.5 ? -1 : 1;
        this.pathFace = wrap(this.pathFace + dir, n);
        this.sinceMove = 0;
      }
    }

    // 4) maybe trigger a full gap (jump) ------------------------------------
    this.cooldown--;
    if (this.cooldown <= 0 && this.rng() < 0.05 + diff * 0.14) {
      const len = 1 + (this.rng() < 0.35 + diff * 0.3 ? 1 : 0);
      this.gapRemaining = Math.min(len, MAX_JUMP_RINGS);
      const gap = Math.round(
        MIN_SAFE_GAP + (MAX_SAFE_GAP - MIN_SAFE_GAP) * (1 - diff),
      );
      this.cooldown = gap + 2;
      // this ring is the solid lead-in so the gap is always telegraphed
      this.rings.set(r, { r, solid, biome });
      return;
    }

    // 5) scatter holes (everything except the always-solid path) ------------
    // enter/leave a "dense" pinch mood for variety
    if (this.denseLeft > 0) this.denseLeft--;
    else if (diff > 0.35 && this.rng() < 0.04) {
      this.denseLeft = 3 + Math.floor(this.rng() * 5);
    }
    const denseBoost = this.denseLeft > 0 ? 0.28 : 0;
    const holeProb = clamp(0.08 + diff * 0.4 + denseBoost, 0, 0.78);

    // random visiting order so hole clusters aren't biased to low indices
    const order: number[] = [];
    for (let i = 0; i < n; i++) order.push(i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }

    for (const f of order) {
      if (f === this.pathFace) continue; // never hole the guaranteed route
      if (this.rng() >= holeProb) continue;
      solid[f] = false;
      if (this.maxRun(solid, false) > 2) solid[f] = true; // keep escapability
    }

    this.rings.set(r, { r, solid, biome });
  }

  /** longest circular run of cells equal to `val` */
  private maxRun(arr: boolean[], val: boolean): number {
    const n = arr.length;
    // if every cell equals val the run is n
    let all = true;
    for (let i = 0; i < n; i++) if (arr[i] !== val) all = false;
    if (all) return n;
    let best = 0;
    let cur = 0;
    // iterate twice to handle wrap-around
    for (let i = 0; i < n * 2; i++) {
      if (arr[i % n] === val) {
        cur++;
        if (cur > best) best = cur;
      } else cur = 0;
    }
    return Math.min(best, n);
  }
}
