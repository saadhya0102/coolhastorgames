/** An animated flipper: a capsule rotating about a fixed pivot that imparts its
 * surface velocity to the ball (so tip shots are stronger than base shots). */
import { FLIPPER_R, FLIPPER_E, FLIPPER_SWEEP_SPEED, MAX_SPEED } from "./constants";
import type { FlipperSpec } from "./table";
import type { Body, Contact } from "./geometry";
import { closestOnSegment } from "./geometry";
import type { Vec2 } from "./vec";

export class Flipper {
  readonly spec: FlipperSpec;
  angle: number;
  private prevAngle: number;
  omega = 0;
  active = false;

  constructor(spec: FlipperSpec) {
    this.spec = spec;
    this.angle = spec.restAngle;
    this.prevAngle = spec.restAngle;
  }

  /** advance the flipper toward its target orientation at a finite rate */
  update(h: number, active: boolean) {
    this.active = active;
    const target = active ? this.spec.activeAngle : this.spec.restAngle;
    const maxStep = FLIPPER_SWEEP_SPEED * h;
    const diff = target - this.angle;
    if (Math.abs(diff) <= maxStep) this.angle = target;
    else this.angle += Math.sign(diff) * maxStep;
    this.omega = (this.angle - this.prevAngle) / h;
    this.prevAngle = this.angle;
  }

  tip(): Vec2 {
    return {
      x: this.spec.pivot.x + Math.cos(this.angle) * this.spec.length,
      y: this.spec.pivot.y + Math.sin(this.angle) * this.spec.length,
    };
  }

  /** resolve a ball against the flipper capsule, applying surface velocity */
  collide(body: Body): Contact | null {
    const p = this.spec.pivot;
    const t = this.tip();
    const c = closestOnSegment(body.pos.x, body.pos.y, p.x, p.y, t.x, t.y);
    const dx = body.pos.x - c.x;
    const dy = body.pos.y - c.y;
    const rad = body.radius + FLIPPER_R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rad * rad) return null;

    let d = Math.sqrt(d2);
    let nx: number;
    let ny: number;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
    } else {
      // degenerate: push perpendicular to the flipper
      const fx = t.x - p.x;
      const fy = t.y - p.y;
      const fl = Math.hypot(fx, fy) || 1;
      nx = -fy / fl;
      ny = fx / fl;
      d = 0;
    }

    // push out of penetration
    const pen = rad - d;
    body.pos.x += nx * pen;
    body.pos.y += ny * pen;

    // surface velocity at the contact point: omega x r (2D)
    const rx = c.x - p.x;
    const ry = c.y - p.y;
    const svx = -this.omega * ry;
    const svy = this.omega * rx;

    // resolve in the flipper's moving frame
    const relx = body.vel.x - svx;
    const rely = body.vel.y - svy;
    const vn = relx * nx + rely * ny;
    let speed = 0;
    if (vn < 0) {
      speed = -vn;
      const jrelx = relx - (1 + FLIPPER_E) * vn * nx;
      const jrely = rely - (1 + FLIPPER_E) * vn * ny;
      body.vel.x = svx + jrelx;
      body.vel.y = svy + jrely;
      // clamp
      const sp = Math.hypot(body.vel.x, body.vel.y);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        body.vel.x *= k;
        body.vel.y *= k;
      }
    }
    return { nx, ny, px: c.x, py: c.y, speed };
  }
}
