/** Minimal 2D vector helpers. Vectors are plain mutable objects so we can avoid
 * per-frame allocations in the physics hot path where it matters. */
export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const clone = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular (rotate +90deg). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const fromAngle = (ang: number, r = 1): Vec2 => ({
  x: Math.cos(ang) * r,
  y: Math.sin(ang) * r,
});

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

export const reflect = (vel: Vec2, n: Vec2): Vec2 => {
  const d = 2 * dot(vel, n);
  return { x: vel.x - d * n.x, y: vel.y - d * n.y };
};
