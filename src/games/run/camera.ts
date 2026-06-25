import {
  BANK_GAIN,
  BANK_MAX,
  BANK_SNAP,
  FOCAL,
  FOG_FAR,
  FOG_MIN,
  ROLL_SNAP,
  VANISH_Y,
  VIEW_FILL,
  Z_MIN,
} from "./config";

const clamp = (v: number, a: number, b: number) =>
  v < a ? a : v > b ? b : v;

export interface Projected {
  sx: number;
  sy: number;
  s: number;
}

/**
 * Camera owns the pseudo-3D projection plus the two rotations that give the
 * game its identity:
 *   - `roll`   : the gameplay rotation that puts the active face "down".
 *   - `bank`   : a small cosmetic screen lean driven by roll velocity.
 *
 * It re-derives `cx, cy, unit` from the live viewport every frame so any
 * size / aspect (including portrait + mobile) works without cached pixels.
 */
export class Camera {
  W = 1;
  H = 1;
  cx = 0;
  cy = 0;
  unit = 1;

  /** continuous (unwrapped) roll in radians */
  roll = 0;
  rollTarget = 0;
  rollVel = 0;
  bank = 0;

  recompute(W: number, H: number): void {
    this.W = W;
    this.H = H;
    this.cx = W / 2;
    this.cy = H * VANISH_Y;
    this.unit = Math.min(W, H) * VIEW_FILL;
  }

  /** perspective shrink factor at camera-relative depth dz */
  scale(dz: number): number {
    const z = dz < Z_MIN ? Z_MIN : dz;
    return FOCAL / (FOCAL + z);
  }

  /** project a cross-section point (already rolled) at depth dz to screen px */
  project(wx: number, wy: number, dz: number): Projected {
    const s = this.scale(dz);
    return {
      sx: this.cx + wx * this.unit * s,
      sy: this.cy - wy * this.unit * s,
      s,
    };
  }

  /** depth fog factor (1 near -> FOG_MIN far) */
  fog(dz: number): number {
    return clamp(1 - dz / FOG_FAR, FOG_MIN, 1);
  }

  /**
   * Ease roll toward its target with a framerate-independent exponential.
   * Exponential easing is unconditionally stable for any dt (unlike a raw
   * spring), which matters on slow frames.
   */
  update(dt: number): void {
    const prev = this.roll;
    const k = 1 - Math.exp(-ROLL_SNAP * dt);
    this.roll += (this.rollTarget - this.roll) * k;
    this.rollVel = dt > 0 ? (this.roll - prev) / dt : 0;

    const bankTarget = clamp(this.rollVel * BANK_GAIN, -BANK_MAX, BANK_MAX);
    this.bank += (bankTarget - this.bank) * (1 - Math.exp(-BANK_SNAP * dt));
  }

  /** apply the cosmetic bank as a canvas transform around the vanishing point */
  applyBank(c: CanvasRenderingContext2D): void {
    c.translate(this.cx, this.cy);
    c.rotate(this.bank);
    c.translate(-this.cx, -this.cy);
  }

  /** true once roll has settled close enough to its target */
  rollSettled(eps: number): boolean {
    return Math.abs(this.rollTarget - this.roll) < eps;
  }
}

export { clamp, FOG_FAR };
