/**
 * Original 2D circle physics solver tuned for a Suika-style stack.
 *
 * Design (see PRD §6): semi-implicit Euler integration on a fixed timestep with
 * sub-stepping and an iterative sequential solver that combines clamped
 * positional correction (projection with slop) and velocity response
 * (velocity-thresholded restitution + Coulomb friction). Sleeping removes
 * resting jitter. Every operation has a guardrail so the sim never explodes.
 *
 * Everything is in world units (jar interior: x in [0, WORLD_W], y in
 * [0, WORLD_H]; walls at x=0 / x=WORLD_W, floor at y=WORLD_H, open top).
 */
import { CONFIG, type Body } from "./types";
import { radiusOf } from "./fruits";

let nextId = 1;

export class World {
  bodies: Body[] = [];

  reset(): void {
    this.bodies.length = 0;
  }

  addBody(tier: number, x: number, y: number, vx = 0, vy = 0, popped = false): Body {
    const r = radiusOf(tier);
    const mass = r * r;
    const b: Body = {
      id: nextId++,
      tier,
      x,
      y,
      vx,
      vy,
      r,
      mass,
      invMass: 1 / mass,
      angle: 0,
      spin: 0,
      sleeping: false,
      sleepTimer: 0,
      age: 0,
      spawnPop: popped ? 1 : 0,
      dead: false,
    };
    this.bodies.push(b);
    return b;
  }

  remove(b: Body): void {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  /** Advance the simulation by one fixed step `h` (seconds). */
  step(h: number): void {
    const bs = this.bodies;
    const n = bs.length;

    // --- integrate (symplectic Euler) ---
    const maxSpeed2 = CONFIG.MAX_SPEED * CONFIG.MAX_SPEED;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      b.age += h;
      if (b.spawnPop > 0) b.spawnPop = Math.max(0, b.spawnPop - h * 4);
      if (b.sleeping) continue;

      b.vy += CONFIG.GRAVITY * h;
      b.vx *= CONFIG.LINEAR_DAMP;
      b.vy *= CONFIG.LINEAR_DAMP;

      const s2 = b.vx * b.vx + b.vy * b.vy;
      if (s2 > maxSpeed2) {
        const k = CONFIG.MAX_SPEED / Math.sqrt(s2);
        b.vx *= k;
        b.vy *= k;
      }

      b.x += b.vx * h;
      b.y += b.vy * h;
      b.spin *= 0.96;
      b.angle += b.spin * h;
    }

    // --- solver iterations ---
    for (let it = 0; it < CONFIG.SOLVER_ITERS; it++) {
      for (let i = 0; i < n; i++) this.resolveWall(bs[i]);
      for (let i = 0; i < n; i++) {
        const a = bs[i];
        for (let j = i + 1; j < n; j++) {
          const b = bs[j];
          if (a.sleeping && b.sleeping) continue;
          this.resolvePair(a, b);
        }
      }
    }

    // --- sleeping + NaN guard ---
    const sleepLin2 = CONFIG.SLEEP_LINEAR * CONFIG.SLEEP_LINEAR;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
        // Defensive: should never happen. Snap back inside, kill velocity.
        b.x = Math.min(Math.max(b.x || 0.5, b.r), CONFIG.WORLD_W - b.r);
        b.y = Math.min(Math.max(b.y || 0.5, b.r), CONFIG.WORLD_H - b.r);
        b.vx = 0;
        b.vy = 0;
      }
      if (b.sleeping) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 < sleepLin2) {
        b.sleepTimer += h;
        if (b.sleepTimer >= CONFIG.SLEEP_TIME) {
          b.sleeping = true;
          b.vx = 0;
          b.vy = 0;
          b.spin = 0;
        }
      } else {
        b.sleepTimer = 0;
      }
    }
  }

  private wake(b: Body): void {
    if (b.sleeping) {
      b.sleeping = false;
      b.sleepTimer = 0;
    }
  }

  /** Resolve a body against the jar walls + floor (infinite-mass planes). */
  private resolveWall(b: Body): void {
    const { SLOP, CORRECT_PERCENT, MAX_CORRECTION, RESTITUTION, REST_THRESHOLD, FRICTION } = CONFIG;
    const wakeThresh = SLOP * CONFIG.WAKE_FACTOR;

    // left wall, normal points +x (into the jar)
    let pen = b.r - b.x;
    if (pen > 0) this.resolvePlane(b, 1, 0, pen, wakeThresh, SLOP, CORRECT_PERCENT, MAX_CORRECTION, RESTITUTION, REST_THRESHOLD, FRICTION);
    // right wall, normal -x
    pen = b.x + b.r - CONFIG.WORLD_W;
    if (pen > 0) this.resolvePlane(b, -1, 0, pen, wakeThresh, SLOP, CORRECT_PERCENT, MAX_CORRECTION, RESTITUTION, REST_THRESHOLD, FRICTION);
    // floor, normal -y (up)
    pen = b.y + b.r - CONFIG.WORLD_H;
    if (pen > 0) this.resolvePlane(b, 0, -1, pen, wakeThresh, SLOP, CORRECT_PERCENT, MAX_CORRECTION, RESTITUTION, REST_THRESHOLD, FRICTION);
  }

  private resolvePlane(
    b: Body,
    nx: number,
    ny: number,
    pen: number,
    wakeThresh: number,
    slop: number,
    percent: number,
    maxCorr: number,
    rest: number,
    restThresh: number,
    friction: number,
  ): void {
    if (pen > wakeThresh) this.wake(b);

    // positional correction (wall is immovable => body takes the full push)
    const corr = Math.min(Math.max(pen - slop, 0) * percent, maxCorr);
    b.x += nx * corr;
    b.y += ny * corr;

    // velocity response
    const velN = b.vx * nx + b.vy * ny;
    if (velN < 0) {
      const e = -velN < restThresh ? 0 : rest;
      const j = -(1 + e) * velN;
      b.vx += nx * j;
      b.vy += ny * j;

      // friction along the tangent
      const tx = -ny;
      const ty = nx;
      const vt = b.vx * tx + b.vy * ty;
      let jt = -vt;
      const jtMax = friction * j;
      if (jt > jtMax) jt = jtMax;
      else if (jt < -jtMax) jt = -jtMax;
      b.vx += tx * jt;
      b.vy += ty * jt;
      // cosmetic roll from floor contact
      if (ny !== 0) b.spin += -(b.vx) / Math.max(b.r, 0.01) * 0.02;
    }
  }

  /** Resolve a circle/circle contact. */
  private resolvePair(a: Body, b: Body): void {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    const rsum = a.r + b.r;
    if (d >= rsum) return;

    let nx: number;
    let ny: number;
    if (d > 1e-9) {
      nx = dx / d;
      ny = dy / d;
    } else {
      // coincident centers (e.g. fresh merge): deterministic fallback
      nx = 0;
      ny = -1;
      d = 0;
    }
    const pen = rsum - d;

    const { SLOP, CORRECT_PERCENT, MAX_CORRECTION, RESTITUTION, REST_THRESHOLD, FRICTION } = CONFIG;
    if (pen > SLOP * CONFIG.WAKE_FACTOR) {
      this.wake(a);
      this.wake(b);
    }

    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) return;

    // positional correction, distributed by inverse mass, clamped
    const corr = Math.min(Math.max(pen - SLOP, 0) * CORRECT_PERCENT, MAX_CORRECTION);
    const ca = corr * (a.invMass / invSum);
    const cb = corr * (b.invMass / invSum);
    a.x -= nx * ca;
    a.y -= ny * ca;
    b.x += nx * cb;
    b.y += ny * cb;

    // velocity response
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velN = rvx * nx + rvy * ny;
    if (velN < 0) {
      const e = -velN < REST_THRESHOLD ? 0 : RESTITUTION;
      const j = (-(1 + e) * velN) / invSum;
      const ix = nx * j;
      const iy = ny * j;
      a.vx -= ix * a.invMass;
      a.vy -= iy * a.invMass;
      b.vx += ix * b.invMass;
      b.vy += iy * b.invMass;

      // Coulomb friction
      const tx = -ny;
      const ty = nx;
      const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
      let jt = -vt / invSum;
      const jtMax = FRICTION * j;
      if (jt > jtMax) jt = jtMax;
      else if (jt < -jtMax) jt = -jtMax;
      const fx = tx * jt;
      const fy = ty * jt;
      a.vx -= fx * a.invMass;
      a.vy -= fy * a.invMass;
      b.vx += fx * b.invMass;
      b.vy += fy * b.invMass;
    }
  }
}
