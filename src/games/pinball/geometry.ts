/** Low-level collision primitives used by the physics world.
 *
 * All functions operate on a {@link Body} (anything with a position, velocity
 * and radius) and resolve it against a static collider, mutating the body's
 * position (push-out) and velocity (reflection / kick). They return a
 * {@link Contact} describing the hit (or null when there was none) so the caller
 * can spawn juice / score. */
import type { Vec2 } from "./vec";
import { dot, norm } from "./vec";

export interface Body {
  pos: Vec2;
  vel: Vec2;
  radius: number;
}

export interface Contact {
  /** unit normal pointing away from the surface, toward the ball */
  nx: number;
  ny: number;
  /** contact point in virtual coords */
  px: number;
  py: number;
  /** speed of approach along the normal at impact (>= 0) */
  speed: number;
}

/** Closest point on segment A->B to point P. */
export function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): Vec2 {
  const abx = bx - ax;
  const aby = by - ay;
  const denom = abx * abx + aby * aby;
  let t = denom > 1e-9 ? ((px - ax) * abx + (py - ay) * aby) / denom : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: ax + abx * t, y: ay + aby * t };
}

/**
 * Resolve a moving circle against a (thick) line segment.
 * `halfThick` lets the wall behave like a rounded capsule of that radius.
 * `e` = restitution, `friction` = tangential damping fraction.
 * Returns a Contact if the bodies overlapped, else null.
 */
export function resolveSegment(
  body: Body,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfThick: number,
  e: number,
  friction: number,
): Contact | null {
  const c = closestOnSegment(body.pos.x, body.pos.y, ax, ay, bx, by);
  const dx = body.pos.x - c.x;
  const dy = body.pos.y - c.y;
  const rad = body.radius + halfThick;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rad * rad) return null;

  let nx: number;
  let ny: number;
  const d = Math.sqrt(d2);
  if (d > 1e-6) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // ball center exactly on the segment: use segment normal
    const sn = norm({ x: -(by - ay), y: bx - ax });
    nx = sn.x;
    ny = sn.y;
  }

  // push out of penetration
  const pen = rad - d;
  body.pos.x += nx * pen;
  body.pos.y += ny * pen;

  const vn = body.vel.x * nx + body.vel.y * ny;
  let speed = 0;
  if (vn < 0) {
    speed = -vn;
    // reflect normal component with restitution
    body.vel.x -= (1 + e) * vn * nx;
    body.vel.y -= (1 + e) * vn * ny;
    // damp tangential component a touch
    if (friction > 0) {
      const tx = -ny;
      const ty = nx;
      const vt = body.vel.x * tx + body.vel.y * ty;
      body.vel.x -= vt * friction * tx;
      body.vel.y -= vt * friction * ty;
    }
  }
  return { nx, ny, px: c.x, py: c.y, speed };
}

/**
 * Resolve a moving circle against a static circle.
 * When `keepOutside` is true the body must stay OUTSIDE the circle (bumpers,
 * posts). When false the body must stay INSIDE it (concave arch wall).
 * `kick` adds an extra outward impulse along the normal (bumpers).
 */
export function resolveCircle(
  body: Body,
  cx: number,
  cy: number,
  R: number,
  e: number,
  kick: number,
  keepOutside: boolean,
): Contact | null {
  if (keepOutside) {
    const dx = body.pos.x - cx;
    const dy = body.pos.y - cy;
    const rad = body.radius + R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rad * rad) return null;
    const d = Math.sqrt(d2);
    let nx: number;
    let ny: number;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
    } else {
      nx = 0;
      ny = -1;
    }
    body.pos.x = cx + nx * rad;
    body.pos.y = cy + ny * rad;
    const vn = body.vel.x * nx + body.vel.y * ny;
    let speed = 0;
    if (vn < 0) {
      speed = -vn;
      body.vel.x -= (1 + e) * vn * nx;
      body.vel.y -= (1 + e) * vn * ny;
      if (kick > 0) {
        body.vel.x += nx * kick;
        body.vel.y += ny * kick;
      }
    }
    return { nx, ny, px: cx + nx * R, py: cy + ny * R, speed };
  }

  // concave: stay inside circle of radius R
  const dx = body.pos.x - cx;
  const dy = body.pos.y - cy;
  const allowed = R - body.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 <= allowed * allowed) return null;
  const d = Math.sqrt(d2) || 1e-6;
  // inward normal (toward center)
  const nx = -dx / d;
  const ny = -dy / d;
  body.pos.x = cx - (nx * allowed); // place on the boundary
  body.pos.y = cy - (ny * allowed);
  const vn = body.vel.x * nx + body.vel.y * ny;
  let speed = 0;
  if (vn < 0) {
    speed = -vn;
    body.vel.x -= (1 + e) * vn * nx;
    body.vel.y -= (1 + e) * vn * ny;
  }
  return { nx, ny, px: cx + (dx / d) * R, py: cy + (dy / d) * R, speed };
}

/** Elastic-ish collision between two equal-mass moving balls. */
export function resolveBallBall(a: Body, b: Body, e: number): boolean {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const rad = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rad * rad || d2 < 1e-9) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  // separate equally
  const pen = (rad - d) * 0.5;
  a.pos.x -= nx * pen;
  a.pos.y -= ny * pen;
  b.pos.x += nx * pen;
  b.pos.y += ny * pen;
  // relative normal velocity
  const rvn = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
  if (rvn > 0) return true; // separating already
  const j = -(1 + e) * rvn * 0.5; // equal mass
  a.vel.x -= j * nx;
  a.vel.y -= j * ny;
  b.vel.x += j * nx;
  b.vel.y += j * ny;
  return true;
}

/** Project P onto segment, returning param t in [0,1] and the distance. */
export function pointSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const c = closestOnSegment(p.x, p.y, a.x, a.y, b.x, b.y);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

/** Signed side of point P relative to directed segment A->B (>0 left). */
export function sideOf(p: Vec2, a: Vec2, b: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** True when a ball traveling with `vel` is moving along `passDir` (one-way). */
export function movingThrough(vel: Vec2, passDir: Vec2): boolean {
  return dot(vel, passDir) > 0;
}
