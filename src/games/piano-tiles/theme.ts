/** Color + palette utilities for Tap Cascade.
 *
 * All visuals are procedural; this module centralizes the palette and small
 * color helpers (hex parsing, alpha, lighten/darken, mix) used by the renderer. */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse a #rgb or #rrggbb hex string into an RGB triple (0..255). */
export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Build an `rgba(...)` string from a hex color + alpha (0..1). */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

/** Build an `rgba(...)` string directly from an RGB triple + alpha. */
export function rgbaFrom(c: RGB, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${clamp01(alpha)})`;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linearly interpolate between two RGB colors. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/** Lighten a hex color toward white by `amount` (0..1). */
export function lighten(hex: string, amount: number): string {
  const c = mixRgb(hexToRgb(hex), { r: 255, g: 255, b: 255 }, amount);
  return rgbaFrom(c, 1);
}

/** Darken a hex color toward black by `amount` (0..1). */
export function darken(hex: string, amount: number): string {
  const c = mixRgb(hexToRgb(hex), { r: 0, g: 0, b: 0 }, amount);
  return rgbaFrom(c, 1);
}

/** The shared base palette (per-song accent comes from the SongDef). */
export const PALETTE = {
  bgTop: "#0a0e1a",
  bgBottom: "#10162a",
  laneA: "#0d1322",
  laneB: "#0f1730",
  laneSep: "#1b2440",
  tileBody: "#14141c",
  tileBodyTop: "#22232e",
  tileEdge: "#2c2f3d",
  text: "#eaf2ff",
  textDim: "#8895b8",
  danger: "#ff3b5c",
  good: "#46e0a0",
  great: "#19d3ff",
  perfect: "#ffd23f",
  gold: "#ffd23f",
} as const;

/** Accent colors used by the four authored songs + endless. */
export const SONG_ACCENTS = {
  morningDew: "#7ee0c0",
  neonSkies: "#ff5c8a",
  crystalCascade: "#19d3ff",
  midnightDrive: "#9b5cff",
  endless: "#ffb700",
} as const;
