/** The pinball itself: a moving circle with a short position history used for
 * the motion-blur trail. */
import { BALL_R } from "./constants";
import type { Vec2 } from "./vec";

export class Ball {
  pos: Vec2;
  vel: Vec2;
  radius = BALL_R;
  /** newest-first ring of recent positions for the trail */
  trail: Vec2[] = [];
  private trailTimer = 0;
  /** when true the ball is pinned to the plunger and physics is skipped */
  onPlunger = false;
  /** seconds spent below the "stuck" speed threshold */
  stuckTimer = 0;
  alive = true;

  constructor(x: number, y: number, vx = 0, vy = 0) {
    this.pos = { x, y };
    this.vel = { x: vx, y: vy };
  }

  recordTrail(dt: number) {
    this.trailTimer += dt;
    if (this.trailTimer >= 1 / 60) {
      this.trailTimer = 0;
      this.trail.unshift({ x: this.pos.x, y: this.pos.y });
      if (this.trail.length > 12) this.trail.pop();
    }
  }

  speed(): number {
    return Math.hypot(this.vel.x, this.vel.y);
  }
}
