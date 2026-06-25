/**
 * Putt Park — ball physics: integration, substepping, collisions and hazards.
 *
 * See PRD §5. The simulation is a single circle (the ball) integrated with a
 * fixed-distance substep so collisions stay stable at any speed. Walls use
 * closest-point-on-segment resolution + reflection with restitution; bumpers are
 * circle-vs-circle; movers are circle-vs-moving-rect; the cup applies a gravity
 * well and captures slow balls.
 */

import { CONST } from "./types";
import type { Bumper, Hole, Mover, Wall } from "./types";
import { closestOnSegment, pointInShape, polyEdges, reflect } from "./geometry";

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  /** visual roll angle, not physical */
  spin: number;
}

export interface PhysicsEvents {
  onWall?: (speed: number, x: number, y: number) => void;
  onBumper?: (b: Bumper, speed: number) => void;
  onMover?: (speed: number, x: number, y: number) => void;
  onSink?: () => void;
}

export interface StepResult {
  sunk: boolean;
  /** true if the ball is currently over water (caller resets the stroke) */
  inWater: boolean;
  inSand: boolean;
}

/** Build the full collidable wall list for a hole (boundary + interior). */
export function buildWalls(hole: Hole): Wall[] {
  const walls: Wall[] = [];
  for (const [a, b] of polyEdges(hole.green)) {
    walls.push({ a, b, kind: "rail" });
  }
  if (hole.walls) {
    for (const w of hole.walls) walls.push(w);
  }
  return walls;
}

/** Total arc length of a polyline path. */
function pathLength(path: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  return total;
}

/** Point at arc length `s` along an open polyline. */
function pointAtArc(
  path: { x: number; y: number }[],
  s: number,
): { x: number; y: number } {
  let remaining = s;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segLen || i === path.length - 2) {
      const t = segLen < 1e-6 ? 0 : remaining / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLen;
  }
  return { x: path[0].x, y: path[0].y };
}

/** Current center of a patrolling mover at a given time. */
export function moverCenter(m: Mover, time: number): { x: number; y: number } {
  const segLen = pathLength(m.path);
  if (segLen < 1e-6) return { x: m.path[0].x, y: m.path[0].y };
  const pingpong = m.pingpong !== false;
  const period = pingpong ? segLen * 2 : segLen;
  const phaseOffset = (m.phase ?? 0) * period;
  let s = (time * m.speed + phaseOffset) % period;
  if (s < 0) s += period;
  if (pingpong && s > segLen) s = period - s;
  return pointAtArc(m.path, s);
}

/** Finite-difference velocity of a mover. */
function moverVelocity(m: Mover, time: number): { x: number; y: number } {
  const h = 1 / 120;
  const a = moverCenter(m, time - h);
  const b = moverCenter(m, time + h);
  return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) };
}

/** Closest point on an axis-aligned rect to p, and whether p is inside. */
function closestOnRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
): { x: number; y: number; inside: boolean } {
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const inside = px >= left && px <= right && py >= top && py <= bottom;
  if (!inside) {
    return {
      x: Math.max(left, Math.min(right, px)),
      y: Math.max(top, Math.min(bottom, py)),
      inside: false,
    };
  }
  // inside: project to nearest edge
  const dl = px - left;
  const dr = right - px;
  const dt = py - top;
  const db = bottom - py;
  const min = Math.min(dl, dr, dt, db);
  if (min === dl) return { x: left, y: py, inside: true };
  if (min === dr) return { x: right, y: py, inside: true };
  if (min === dt) return { x: px, y: top, inside: true };
  return { x: px, y: bottom, inside: true };
}

function speedOf(b: Ball): number {
  return Math.hypot(b.vx, b.vy);
}

function clampSpeed(b: Ball, max: number): void {
  const s = Math.hypot(b.vx, b.vy);
  if (s > max) {
    const k = max / s;
    b.vx *= k;
    b.vy *= k;
  }
}

/**
 * Advance the ball by `dt` seconds. `dt` should already be capped by the caller
 * (index uses CONST.MAX_DT). Internally splits into fine substeps.
 */
export function stepBall(
  ball: Ball,
  dt: number,
  walls: Wall[],
  hole: Hole,
  time: number,
  ev: PhysicsEvents,
): StepResult {
  const result: StepResult = { sunk: false, inWater: false, inSand: false };
  if (!ball.moving) return result;

  const speed0 = speedOf(ball);
  const sub = Math.max(
    1,
    Math.min(CONST.MAX_SUBSTEPS, Math.ceil((speed0 * dt) / CONST.MAX_STEP_DIST)),
  );
  const h = dt / sub;
  const cupR = hole.cupRadius ?? CONST.CUP_RADIUS;

  for (let i = 0; i < sub; i++) {
    if (!ball.moving) break;
    const subTime = time + (i / sub) * dt;

    // --- sand detection (affects friction this substep) ---
    let inSand = false;
    if (hole.sand) {
      for (const s of hole.sand) {
        if (pointInShape({ x: ball.x, y: ball.y }, s)) {
          inSand = true;
          break;
        }
      }
    }
    result.inSand = inSand;

    // --- slope / ramp acceleration ---
    if (hole.slopes) {
      for (const sl of hole.slopes) {
        if (pointInShape({ x: ball.x, y: ball.y }, sl.shape)) {
          const dl = Math.hypot(sl.dir.x, sl.dir.y) || 1;
          ball.vx += (sl.dir.x / dl) * sl.strength * h;
          ball.vy += (sl.dir.y / dl) * sl.strength * h;
        }
      }
    }

    // --- cup gravity well ---
    const dcx = hole.cup.x - ball.x;
    const dcy = hole.cup.y - ball.y;
    const dd = Math.hypot(dcx, dcy);
    if (dd < cupR * CONST.CUP_PULL_RANGE && dd > 1e-3) {
      const falloff = 1 - dd / (cupR * CONST.CUP_PULL_RANGE);
      const accel = CONST.CUP_PULL_ACCEL * falloff;
      ball.vx += (dcx / dd) * accel * h;
      ball.vy += (dcy / dd) * accel * h;
    }

    // --- friction / rolling resistance ---
    let speed = speedOf(ball);
    if (speed > 0) {
      const decel = inSand ? CONST.SAND_FRICTION : CONST.GREEN_FRICTION;
      let ns = speed - decel * h;
      ns *= 1 - CONST.VISCOUS * h;
      if (ns < CONST.STOP_SPEED) {
        ball.vx = 0;
        ball.vy = 0;
        ball.moving = false;
        speed = 0;
      } else {
        const k = ns / speed;
        ball.vx *= k;
        ball.vy *= k;
        speed = ns;
      }
    }

    // --- integrate ---
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    ball.spin += speed * h * 0.02;

    // --- wall collisions (iterate for corners) ---
    for (let iter = 0; iter < CONST.RESOLVE_ITERS; iter++) {
      let hitAny = false;
      for (const w of walls) {
        const { point } = closestOnSegment(
          { x: ball.x, y: ball.y },
          w.a,
          w.b,
        );
        let nx = ball.x - point.x;
        let ny = ball.y - point.y;
        let dist = Math.hypot(nx, ny);
        if (dist < CONST.BALL_R) {
          if (dist < 1e-6) {
            // degenerate: use segment normal
            const ex = w.b.x - w.a.x;
            const ey = w.b.y - w.a.y;
            const el = Math.hypot(ex, ey) || 1;
            nx = -ey / el;
            ny = ex / el;
            dist = 0.0001;
          } else {
            nx /= dist;
            ny /= dist;
          }
          ball.x = point.x + nx * (CONST.BALL_R + CONST.EPSILON);
          ball.y = point.y + ny * (CONST.BALL_R + CONST.EPSILON);
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            const e = w.restitution ?? CONST.WALL_RESTITUTION;
            const r = reflect(ball.vx, ball.vy, nx, ny, e);
            // light tangential friction on impact
            const tnx = -ny;
            const tny = nx;
            const vt = r.x * tnx + r.y * tny;
            ball.vx = r.x - tnx * vt * 0.05;
            ball.vy = r.y - tny * vt * 0.05;
            const impact = Math.abs(vn);
            if (impact > 40) ev.onWall?.(impact, ball.x, ball.y);
            hitAny = true;
          }
        }
      }
      if (!hitAny) break;
    }

    // --- bumper collisions ---
    if (hole.bumpers) {
      for (const b of hole.bumpers) {
        const nx0 = ball.x - b.x;
        const ny0 = ball.y - b.y;
        const dist = Math.hypot(nx0, ny0);
        const rad = b.r + CONST.BALL_R;
        if (dist < rad && dist > 1e-6) {
          const nx = nx0 / dist;
          const ny = ny0 / dist;
          ball.x = b.x + nx * (rad + CONST.EPSILON);
          ball.y = b.y + ny * (rad + CONST.EPSILON);
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            const e = b.restitution ?? CONST.BUMPER_RESTITUTION;
            const r = reflect(ball.vx, ball.vy, nx, ny, e);
            ball.vx = r.x;
            ball.vy = r.y;
            clampSpeed(ball, CONST.MAX_BALL_SPEED);
            ev.onBumper?.(b, Math.abs(vn));
          }
        }
      }
    }

    // --- moving block collisions ---
    if (hole.movers) {
      for (const m of hole.movers) {
        const c = moverCenter(m, subTime);
        const near = closestOnRect(ball.x, ball.y, c.x, c.y, m.w, m.h);
        let nx = ball.x - near.x;
        let ny = ball.y - near.y;
        let dist = Math.hypot(nx, ny);
        const collide = near.inside || dist < CONST.BALL_R;
        if (collide) {
          const mv = moverVelocity(m, subTime);
          if (near.inside || dist < 1e-6) {
            // resolve to nearest edge using rect geometry
            const left = c.x - m.w / 2;
            const right = c.x + m.w / 2;
            const top = c.y - m.h / 2;
            const bottom = c.y + m.h / 2;
            const dl = ball.x - left;
            const dr = right - ball.x;
            const dt2 = ball.y - top;
            const db = bottom - ball.y;
            const mn = Math.min(dl, dr, dt2, db);
            if (mn === dl) {
              nx = -1;
              ny = 0;
              ball.x = left - CONST.BALL_R - CONST.EPSILON;
            } else if (mn === dr) {
              nx = 1;
              ny = 0;
              ball.x = right + CONST.BALL_R + CONST.EPSILON;
            } else if (mn === dt2) {
              nx = 0;
              ny = -1;
              ball.y = top - CONST.BALL_R - CONST.EPSILON;
            } else {
              nx = 0;
              ny = 1;
              ball.y = bottom + CONST.BALL_R + CONST.EPSILON;
            }
          } else {
            nx /= dist;
            ny /= dist;
            ball.x = near.x + nx * (CONST.BALL_R + CONST.EPSILON);
            ball.y = near.y + ny * (CONST.BALL_R + CONST.EPSILON);
          }
          // reflect relative velocity, then add block velocity back
          const rvx = ball.vx - mv.x;
          const rvy = ball.vy - mv.y;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const r = reflect(rvx, rvy, nx, ny, CONST.WALL_RESTITUTION);
            ball.vx = r.x + mv.x;
            ball.vy = r.y + mv.y;
            clampSpeed(ball, CONST.MAX_BALL_SPEED);
            ev.onMover?.(Math.abs(vn), ball.x, ball.y);
          } else {
            // block pushing into a (near-)resting ball
            ball.vx += mv.x;
            ball.vy += mv.y;
          }
        }
      }
    }

    // --- cup capture / lip-out ---
    const ndx = hole.cup.x - ball.x;
    const ndy = hole.cup.y - ball.y;
    const ndist = Math.hypot(ndx, ndy);
    if (ndist < cupR) {
      const sp = speedOf(ball);
      if (sp <= CONST.CUP_CAPTURE_SPEED) {
        result.sunk = true;
        ball.moving = false;
        ev.onSink?.();
        return result;
      }
      // too fast: lip-out, bleed some speed
      ball.vx *= 0.84;
      ball.vy *= 0.84;
    }

    // --- water hazard ---
    if (hole.water) {
      for (const wt of hole.water) {
        if (pointInShape({ x: ball.x, y: ball.y }, wt)) {
          result.inWater = true;
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Lightweight, friction-less ray used to preview the first few bounces of a
 * putt. Reflects off boundary/interior walls only (ignores hazards/movers) for a
 * fixed number of segments. Returns a polyline in world space.
 */
export function previewPath(
  start: { x: number; y: number },
  dirX: number,
  dirY: number,
  power: number,
  walls: Wall[],
  hole: Hole,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [{ x: start.x, y: start.y }];
  const dl = Math.hypot(dirX, dirY);
  if (dl < 1e-6 || power <= 0) return pts;
  let px = start.x;
  let py = start.y;
  let dx = dirX / dl;
  let dy = dirY / dl;
  const cupR = hole.cupRadius ?? CONST.CUP_RADIUS;
  // total preview length scales with power
  let budget = 120 + power * 720;
  const step = 6;
  let bounces = 0;
  const maxBounces = 4;

  while (budget > 0 && bounces <= maxBounces) {
    px += dx * step;
    py += dy * step;
    budget -= step;

    // stop at the cup
    if (Math.hypot(hole.cup.x - px, hole.cup.y - py) < cupR) {
      pts.push({ x: hole.cup.x, y: hole.cup.y });
      break;
    }

    let bounced = false;
    for (const w of walls) {
      const { point } = closestOnSegment({ x: px, y: py }, w.a, w.b);
      let nx = px - point.x;
      let ny = py - point.y;
      const dist = Math.hypot(nx, ny);
      if (dist < CONST.BALL_R) {
        if (dist > 1e-6) {
          nx /= dist;
          ny /= dist;
        } else {
          const ex = w.b.x - w.a.x;
          const ey = w.b.y - w.a.y;
          const el = Math.hypot(ex, ey) || 1;
          nx = -ey / el;
          ny = ex / el;
        }
        px = point.x + nx * (CONST.BALL_R + 0.5);
        py = point.y + ny * (CONST.BALL_R + 0.5);
        const vn = dx * nx + dy * ny;
        dx = dx - 2 * vn * nx;
        dy = dy - 2 * vn * ny;
        pts.push({ x: px, y: py });
        bounces++;
        bounced = true;
        break;
      }
    }
    if (!bounced && pts.length > 0) {
      // record sparse points to keep the line light
      const last = pts[pts.length - 1];
      if (Math.hypot(px - last.x, py - last.y) > 22) {
        pts.push({ x: px, y: py });
      }
    }
  }
  pts.push({ x: px, y: py });
  return pts;
}
