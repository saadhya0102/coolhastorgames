/**
 * Shared types, tuning constants and small math helpers for Fruit Frenzy.
 *
 * Everything that affects "feel" is expressed relative to the current screen
 * size (passed in as a `World` each frame) so the game plays consistently at
 * any aspect ratio or resolution, desktop or mobile.
 */

/** Live world bounds + derived scale, recomputed every frame from ctx. */
export interface World {
  w: number;
  h: number;
  /** min(w, h) — the canonical scale used for radii / speeds. */
  min: number;
  /** game time in seconds (accumulated, used for trail point ages etc). */
  time: number;
}

export type Phase = "title" | "countdown" | "playing" | "over";

export type Mode = "classic" | "zen" | "arcade";

/** Reason a run ended (drives the game-over headline). */
export type EndReason = "bomb" | "lives" | "time";

/** Identifiers for every sliceable thing. */
export type FruitKind =
  | "watermelon"
  | "apple"
  | "orange"
  | "lemon"
  | "banana"
  | "pineapple"
  | "strawberry"
  | "kiwi"
  | "plum"
  | "bomb"
  | "freeze"
  | "double"
  | "frenzy";

/** Static, art + scoring definition for a kind of object. */
export interface FruitDef {
  kind: FruitKind;
  /** outer skin base color */
  skin: string;
  /** darker shade for ambient occlusion / stripes */
  skinDark: string;
  /** inner flesh color shown on the cut face */
  flesh: string;
  /** juice color for particles + splats */
  juice: string;
  /** base points awarded on slice */
  points: number;
  /** relative size multiplier (1 = standard fruit radius) */
  sizeMul: number;
  /** spawn weight among normal fruit (ignored for specials/bomb) */
  weight: number;
  /** true for bomb + power-ups (handled specially, never cost a life) */
  special: boolean;
}

/** A whole, in-flight fruit (or bomb / power-up). */
export interface Fruit {
  def: FruitDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
  spin: number;
  sliced: boolean;
  /** golden variant — extra points, never costs a life, shimmer */
  golden: boolean;
  /** has the fruit reached / passed its apex (used for "miss" detection) */
  pastApex: boolean;
  wobble: number;
  seed: number;
}

/** One half of a sliced fruit, flying apart with its own physics. */
export interface Half {
  def: FruitDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
  spin: number;
  /** -1 = left of cut, +1 = right of cut */
  side: -1 | 1;
  /** orientation of the flat cut face (radians) */
  cutAngle: number;
  golden: boolean;
  seed: number;
  life: number;
}

export type ParticleKind = "juice" | "spark" | "ring" | "smoke" | "flash";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  kind: ParticleKind;
  /** for streak/elongated juice droplets */
  streak: number;
  /** for rings: current radius scale handled via life */
  spin: number;
  angle: number;
}

/** A lingering juice decal on the splat layer. */
export interface Splat {
  x: number;
  y: number;
  r: number;
  color: string;
  life: number;
  maxLife: number;
  seed: number;
}

/** A floating "+N" score number that rises and fades. */
export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

/** A point in the blade trail ring buffer. */
export interface TrailPoint {
  x: number;
  y: number;
  /** game-time at which the point was recorded */
  t: number;
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

export const MAX_DT = 1 / 20;
export const TRAIL_LIFETIME = 0.13;
export const TRAIL_MAX = 26;
/** speed gate (fraction of minDim per second) before the blade cuts */
export const MIN_SLICE_SPEED = 0.5;
export const GRAVITY_K = 1.5;
export const LAUNCH_K = 1.3;
export const FRUIT_R_K = 0.066;
export const COMBO_WINDOW = 0.45;
export const GRACE_TIME = 5;
export const MAX_OBJECTS = 16;
export const CLASSIC_LIVES = 3;
export const ZEN_TIME = 90;
export const ARCADE_TIME = 60;
export const SHAKE_DECAY = 6;
export const MAX_SPLATS = 60;

// ---------------------------------------------------------------------------
// Small math helpers (kept local; engine util also has clamp/lerp/dist)
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;

export const rand = (min: number, max: number): number =>
  min + Math.random() * (max - min);

export const randInt = (min: number, max: number): number =>
  Math.floor(min + Math.random() * (max - min + 1));

export const chance = (p: number): boolean => Math.random() < p;

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Shortest signed distance from point P to segment AB, returned squared-safe. */
export function distPointSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Deterministic per-seed pseudo-random in [0,1) given an integer index. */
export function seeded(seed: number, i: number): number {
  let t = (seed + i * 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Build an `rgba()` string from a hex color + alpha. */
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Lighten/darken a hex color by a signed amount (-1..1). */
export function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  const r = clampByte(Math.round(parseInt(n.slice(0, 2), 16) + 255 * amt));
  const g = clampByte(Math.round(parseInt(n.slice(2, 4), 16) + 255 * amt));
  const b = clampByte(Math.round(parseInt(n.slice(4, 6), 16) + 255 * amt));
  return `rgb(${r}, ${g}, ${b})`;
}
