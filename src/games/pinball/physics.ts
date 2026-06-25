/**
 * Neon Nexus — physics world.
 *
 * Steps every ball one fixed tick against all table colliders using adaptive
 * micro-substeps bounded by half the ball radius, which guarantees no tunneling
 * regardless of speed or frame rate. Physics is pure: it mutates ball state and
 * returns typed {@link HitEvent}s for the game layer to turn into score / juice.
 */
import {
  GRAVITY,
  DRAG,
  MAX_SPEED,
  SUBSTEP_MAX,
  BALL_R,
  WALL_E,
  FRICTION,
  BUMPER_E,
  BUMPER_KICK,
  SLING_E,
  SLING_KICK,
  BALL_BALL_E,
  TABLE_W,
  TABLE_H,
} from "./constants";
import type { TableLayout } from "./table";
import type { Ball } from "./ball";
import type { Flipper } from "./flipper";
import { resolveSegment, resolveCircle, resolveBallBall, movingThrough } from "./geometry";

export type HitType =
  | "wall"
  | "bumper"
  | "sling"
  | "drop"
  | "standup"
  | "core"
  | "flipper";

export interface HitEvent {
  type: HitType;
  id?: string;
  px: number;
  py: number;
  speed: number;
}

export class PhysicsWorld {
  constructor(
    private table: TableLayout,
    private flippers: Flipper[],
  ) {}

  /** advance all live, in-play balls by one fixed tick */
  step(balls: Ball[], h: number): HitEvent[] {
    const events: HitEvent[] = [];

    for (const ball of balls) {
      if (!ball.alive || ball.onPlunger) continue;

      // integrate forces
      ball.vel.y += GRAVITY * h;
      const damp = 1 - DRAG * h;
      ball.vel.x *= damp;
      ball.vel.y *= damp;

      // clamp speed
      let sp = Math.hypot(ball.vel.x, ball.vel.y);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        ball.vel.x *= k;
        ball.vel.y *= k;
        sp = MAX_SPEED;
      }

      // adaptive substeps so each micro-move <= half a ball radius
      const travel = sp * h;
      let n = Math.ceil(travel / (BALL_R * 0.5));
      if (n < 1) n = 1;
      else if (n > SUBSTEP_MAX) n = SUBSTEP_MAX;
      const sub = h / n;

      for (let i = 0; i < n; i++) {
        ball.pos.x += ball.vel.x * sub;
        ball.pos.y += ball.vel.y * sub;
        this.resolve(ball, events);
      }

      // hard bounds rescue (numerical safety net)
      if (ball.pos.x < BALL_R) {
        ball.pos.x = BALL_R;
        if (ball.vel.x < 0) ball.vel.x *= -0.4;
      } else if (ball.pos.x > TABLE_W - BALL_R) {
        ball.pos.x = TABLE_W - BALL_R;
        if (ball.vel.x > 0) ball.vel.x *= -0.4;
      }
      if (ball.pos.y < -40) {
        ball.pos.y = -40;
        if (ball.vel.y < 0) ball.vel.y *= -0.4;
      } else if (ball.pos.y > TABLE_H + 80) {
        ball.pos.y = TABLE_H + 80;
      }
    }

    // ball vs ball (multiball)
    for (let a = 0; a < balls.length; a++) {
      for (let b = a + 1; b < balls.length; b++) {
        const ba = balls[a];
        const bb = balls[b];
        if (!ba.alive || !bb.alive || ba.onPlunger || bb.onPlunger) continue;
        resolveBallBall(ba, bb, BALL_BALL_E);
      }
    }

    return events;
  }

  private resolve(ball: Ball, events: HitEvent[]) {
    const t = this.table;

    // walls
    for (const w of t.walls) {
      if (w.oneWay && movingThrough(ball.vel, w.oneWay)) continue;
      const c = resolveSegment(ball, w.ax, w.ay, w.bx, w.by, w.thick * 0.5, WALL_E, FRICTION);
      if (c && c.speed > 60) events.push({ type: "wall", px: c.px, py: c.py, speed: c.speed });
    }

    // bumpers
    for (const bm of t.bumpers) {
      const c = resolveCircle(ball, bm.x, bm.y, bm.r, BUMPER_E, BUMPER_KICK, true);
      if (c && c.speed > 20) events.push({ type: "bumper", id: bm.id, px: c.px, py: c.py, speed: c.speed });
    }

    // slingshots (face segment + kick along stored normal)
    for (const s of t.slings) {
      const c = resolveSegment(ball, s.ax, s.ay, s.bx, s.by, 5, SLING_E, 0);
      if (c && c.speed > 30) {
        ball.vel.x += s.nx * SLING_KICK;
        ball.vel.y += s.ny * SLING_KICK;
        events.push({ type: "sling", id: s.id, px: c.px, py: c.py, speed: c.speed });
      }
    }

    // drop targets (only collide while raised)
    for (const d of t.drops) {
      if (d.dropped) continue;
      const c = resolveSegment(ball, d.ax, d.ay, d.bx, d.by, 7, 0.25, 0);
      if (c && c.speed > 20) events.push({ type: "drop", id: d.id, px: c.px, py: c.py, speed: c.speed });
    }

    // standup targets
    for (const u of t.standups) {
      const c = resolveSegment(ball, u.ax, u.ay, u.bx, u.by, 7, 0.5, 0);
      if (c && c.speed > 20) events.push({ type: "standup", id: u.id, px: c.px, py: c.py, speed: c.speed });
    }

    // the core (acts like a firm bumper, counts hits)
    {
      const core = t.core;
      const c = resolveCircle(ball, core.x, core.y, core.r, 0.7, 240, true);
      if (c && c.speed > 30) events.push({ type: "core", px: c.px, py: c.py, speed: c.speed });
    }

    // flippers (live capsules)
    for (const f of this.flippers) {
      const c = f.collide(ball);
      if (c && c.speed > 40) events.push({ type: "flipper", id: f.spec.id, px: c.px, py: c.py, speed: c.speed });
    }
  }
}
