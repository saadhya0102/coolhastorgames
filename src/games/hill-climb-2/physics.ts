/**
 * Hill Climb 2 — vehicle physics.
 * A rigid chassis held up by two point-mass wheels on spring/damper
 * suspension, colliding against a single-valued terrain height function.
 * All integration is sub-stepped and aggressively clamped so the sim can never
 * explode, NaN, or tunnel through the ground.
 */
import { clamp } from "@/engine";
import {
  ANG_DAMP,
  MAXV,
  MAXW,
  START_X,
  WHEEL_MAXV,
} from "./config";
import type { Terrain } from "./terrain";
import type { DerivedStats } from "./types";

/** Seconds grounded before air-time/flip accumulators reset. */
const AIR_RESET = 0.06;

export interface Wheel {
  ax: number; // local anchor x (relative to chassis centre)
  ay: number; // local anchor y
  x: number; // world position
  y: number;
  vx: number;
  vy: number;
  spin: number; // visual rotation
  grounded: boolean;
  compression: number; // 0..1 for rendering the suspension
  slip: number; // 0..1 traction slip (drives dust)
  rear: boolean; // is this the driven rear wheel
}

export class Car {
  cx = 0;
  cy = 0;
  vx = 0;
  vy = 0;
  ang = 0;
  angVel = 0;
  wheels: Wheel[];
  crashed = false;
  airTime = 0;
  groundedTime = 0;
  /** accumulated signed rotation while airborne, for flip counting */
  airRotation = 0;
  /** strongest impact speed seen since last read (for landing fx) */
  landImpact = 0;
  engineOn = true;

  private s: DerivedStats;
  private terrain: Terrain;
  private gravity: number;

  constructor(stats: DerivedStats, terrain: Terrain, gravity: number) {
    this.s = stats;
    this.terrain = terrain;
    this.gravity = gravity;
    this.wheels = [
      {
        ax: -stats.axleX,
        ay: stats.axleY,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        spin: 0,
        grounded: false,
        compression: 0,
        slip: 0,
        rear: true,
      },
      {
        ax: stats.axleX,
        ay: stats.axleY,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        spin: 0,
        grounded: false,
        compression: 0,
        slip: 0,
        rear: false,
      },
    ];
    this.reset();
  }

  reset(): void {
    const s = this.s;
    this.cx = START_X;
    this.cy = this.terrain.height(START_X) - (s.restLen + s.wheelR + 6);
    this.vx = 0;
    this.vy = 0;
    this.ang = 0;
    this.angVel = 0;
    this.crashed = false;
    this.airTime = 0;
    this.groundedTime = 0;
    this.airRotation = 0;
    this.landImpact = 0;
    for (const w of this.wheels) {
      const wp = this.localToWorld(w.ax, w.ay);
      w.x = wp.x;
      w.y = wp.y + s.restLen;
      w.vx = 0;
      w.vy = 0;
      w.spin = 0;
      w.grounded = false;
      w.compression = 0;
      w.slip = 0;
    }
  }

  localToWorld(lx: number, ly: number): { x: number; y: number } {
    const ca = Math.cos(this.ang);
    const sa = Math.sin(this.ang);
    return {
      x: this.cx + lx * ca - ly * sa,
      y: this.cy + lx * sa + ly * ca,
    };
  }

  get airborne(): boolean {
    return !this.wheels[0].grounded && !this.wheels[1].grounded;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Advance one fixed sub-step. */
  step(h: number, gas: boolean, brake: boolean): void {
    if (this.crashed) return;
    const s = this.s;
    const ca = Math.cos(this.ang);
    const sa = Math.sin(this.ang);
    // chassis local "down" axis in world coords
    const downX = -sa;
    const downY = ca;

    let fx = 0;
    let fy = this.gravity * s.mass;
    let torque = 0;

    for (const w of this.wheels) {
      // anchor world position + velocity (includes chassis rotation)
      const rx = w.ax * ca - w.ay * sa;
      const ry = w.ax * sa + w.ay * ca;
      const axw = this.cx + rx;
      const ayw = this.cy + ry;
      const avx = this.vx - this.angVel * ry;
      const avy = this.vy + this.angVel * rx;

      // suspension target along down axis
      const tx = axw + downX * s.restLen;
      const ty = ayw + downY * s.restLen;
      const ddx = tx - w.x;
      const ddy = ty - w.y;
      const rvx = w.vx - avx;
      const rvy = w.vy - avy;
      const sfx = s.suspK * ddx - s.suspC * rvx;
      const sfy = s.suspK * ddy - s.suspC * rvy;

      // integrate the wheel (spring + gravity)
      w.vx += (sfx / 1) * h;
      w.vy += (sfy / 1 + this.gravity) * h;

      // reaction on chassis
      fx += -sfx;
      fy += -sfy;
      torque += rx * -sfy - ry * -sfx;

      // visualise compression: how far the wheel sits from rest target
      const along = (w.x - axw) * downX + (w.y - ayw) * downY;
      w.compression = clamp(1 - along / Math.max(1, s.restLen), -0.4, 1);
    }

    // integrate chassis
    this.vx += (fx / s.mass) * h;
    this.vy += (fy / s.mass) * h;
    this.angVel += (torque / s.inertia) * h;

    // air control
    if (this.airborne) {
      if (gas) this.angVel -= s.airTorque * h;
      if (brake) this.angVel += s.airTorque * h;
    }
    this.angVel *= ANG_DAMP;

    // clamp chassis state
    this.vx = clamp(this.vx, -MAXV, MAXV);
    this.vy = clamp(this.vy, -MAXV, MAXV);
    this.angVel = clamp(this.angVel, -MAXW, MAXW);

    // integrate positions
    this.cx += this.vx * h;
    this.cy += this.vy * h;
    this.ang += this.angVel * h;

    // wheel integration + terrain contact
    let anyGrounded = false;
    for (const w of this.wheels) {
      w.x += w.vx * h;
      w.y += w.vy * h;
      const gy = this.terrain.height(w.x);
      const pen = w.y + s.wheelR - gy;
      w.grounded = false;
      w.slip *= 0.85;
      if (pen > 0) {
        w.grounded = true;
        anyGrounded = true;
        // positional correction (no tunnelling)
        w.y = gy - s.wheelR;

        const slope = this.terrain.slope(w.x);
        const tl = Math.hypot(1, slope);
        const tnx = 1 / tl;
        const tny = slope / tl;
        // outward normal (points up/away from ground)
        const nx = slope / tl;
        const ny = -1 / tl;

        let vn = w.vx * nx + w.vy * ny;
        let vt = w.vx * tnx + w.vy * tny;

        // record landing impact for fx
        if (vn < -40) {
          const imp = -vn;
          if (imp > this.landImpact) this.landImpact = imp;
        }
        // restitution
        if (vn < 0) vn = -vn * 0.08;

        // drive / brake along the tangent
        const driveShare = w.rear ? 1 : s.fwd;
        if (gas && this.engineOn) {
          vt += s.driveAccel * driveShare * h;
        }
        if (brake) {
          vt -= s.brakeAccel * h;
        }

        // grip / slip model: soft cap on tangential speed, extra drag over limit
        const vtMax = s.wheelVtMax;
        if (vt > vtMax) {
          w.slip = clamp(w.slip + (vt - vtMax) / vtMax, 0, 1);
          vt = vtMax + (vt - vtMax) * 0.4;
        } else if (vt < -vtMax * 0.8) {
          w.slip = clamp(w.slip + 0.3, 0, 1);
          vt = -vtMax * 0.8;
        }
        // rolling resistance scaled by (inverse) grip
        const roll = 0.9 / Math.max(0.5, s.grip);
        vt *= 1 - clamp(roll * h, 0, 0.5);

        w.vx = nx * vn + tnx * vt;
        w.vy = ny * vn + tny * vt;
        w.spin += (vt / s.wheelR) * h;
      } else {
        // airborne wheel keeps spinning, slowly decaying
        w.spin += (w.vx / s.wheelR) * h * 0.4;
      }

      // hard clamp wheel speed
      const sp = Math.hypot(w.vx, w.vy);
      if (sp > WHEEL_MAXV) {
        const k = WHEEL_MAXV / sp;
        w.vx *= k;
        w.vy *= k;
      }
    }

    // air / ground timers + flip accumulation
    if (anyGrounded) {
      this.groundedTime += h;
      if (this.groundedTime > AIR_RESET) {
        this.airTime = 0;
        this.airRotation = 0;
      }
    } else {
      this.groundedTime = 0;
      this.airTime += h;
      this.airRotation += this.angVel * h;
    }

    this.guardFinite();
  }

  /** Read + clear the landing impact accumulator. */
  takeLandImpact(): number {
    const v = this.landImpact;
    this.landImpact = 0;
    return v;
  }

  /** Returns true if the chassis roof / driver head is touching the ground. */
  roofHit(): boolean {
    const s = this.s;
    const half = s.axleX; // body half-length ~ wheelbase/2
    // roof points: above the cabin and along the top edge
    const pts: Array<[number, number]> = [
      [0, -(s.restLen * 0.2) - 26],
      [half * 0.3, -22],
      [-half * 0.4, -18],
    ];
    for (const [lx, ly] of pts) {
      const p = this.localToWorld(lx, ly);
      if (p.y >= this.terrain.height(p.x)) return true;
    }
    return false;
  }

  /** Inverted (roughly upside down). */
  get inverted(): boolean {
    const a = Math.abs(this.normalizeAngle(this.ang));
    return a > 2.3;
  }

  private normalizeAngle(a: number): number {
    let x = a % (Math.PI * 2);
    if (x > Math.PI) x -= Math.PI * 2;
    if (x < -Math.PI) x += Math.PI * 2;
    return x;
  }

  private guardFinite(): void {
    if (
      !Number.isFinite(this.cx) ||
      !Number.isFinite(this.cy) ||
      !Number.isFinite(this.vx) ||
      !Number.isFinite(this.vy) ||
      !Number.isFinite(this.ang) ||
      !Number.isFinite(this.angVel)
    ) {
      // recover to a safe stopped state and flag a crash
      this.vx = 0;
      this.vy = 0;
      this.angVel = 0;
      if (!Number.isFinite(this.cx)) this.cx = START_X;
      if (!Number.isFinite(this.cy)) this.cy = this.terrain.height(this.cx) - 60;
      if (!Number.isFinite(this.ang)) this.ang = 0;
      this.crashed = true;
    }
  }
}
