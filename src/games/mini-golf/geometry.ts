/**
 * Putt Park — vector & geometry helpers (world space).
 *
 * Small, dependency-free utilities used by physics and rendering. Vectors are
 * plain `{ x, y }` objects; most helpers return new objects to keep call sites
 * easy to read (the physics hot loop uses the scalar variants where it matters).
 */

import type { Shape, Vec } from "./types";

export const v = (x: number, y: number): Vec => ({ x, y });

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec): number => a.x * a.x + a.y * a.y;
export const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Vec): Vec {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular of a vector. */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export function lerpVec(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Closest point on segment a->b to point p, plus the clamped parameter t.
 */
export function closestOnSegment(
  p: Vec,
  a: Vec,
  b: Vec,
): { point: Vec; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2ab = abx * abx + aby * aby;
  let t = 0;
  if (len2ab > 1e-9) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2ab;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return { point: { x: a.x + abx * t, y: a.y + aby * t }, t };
}

/** Point-in-polygon via ray casting. */
export function pointInPoly(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Test whether a point lies inside any of the supported shape kinds. */
export function pointInShape(p: Vec, s: Shape): boolean {
  switch (s.type) {
    case "rect":
      return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
    case "circle": {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      return dx * dx + dy * dy <= s.r * s.r;
    }
    case "poly":
      return pointInPoly(p, s.points);
  }
}

/** Centroid of a shape (used for chevron/label placement). */
export function shapeCenter(s: Shape): Vec {
  switch (s.type) {
    case "rect":
      return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    case "circle":
      return { x: s.x, y: s.y };
    case "poly": {
      let cx = 0;
      let cy = 0;
      for (const pt of s.points) {
        cx += pt.x;
        cy += pt.y;
      }
      return { x: cx / s.points.length, y: cy / s.points.length };
    }
  }
}

/** Axis-aligned bounding box of a shape. */
export function shapeBounds(s: Shape): { x: number; y: number; w: number; h: number } {
  switch (s.type) {
    case "rect":
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case "circle":
      return { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
    case "poly": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pt of s.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
}

/** Build the closed list of edges (as [a,b] pairs) of a polygon. */
export function polyEdges(poly: Vec[]): Array<[Vec, Vec]> {
  const edges: Array<[Vec, Vec]> = [];
  for (let i = 0; i < poly.length; i++) {
    edges.push([poly[i], poly[(i + 1) % poly.length]]);
  }
  return edges;
}

/** Reflect velocity vector about a unit normal with restitution. */
export function reflect(velX: number, velY: number, nx: number, ny: number, e: number): {
  x: number;
  y: number;
} {
  const vn = velX * nx + velY * ny;
  return { x: velX - (1 + e) * vn * nx, y: velY - (1 + e) * vn * ny };
}
