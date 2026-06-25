/**
 * Bubble Pop Saga — tuning constants and the candy palette.
 *
 * Everything here is original. Physical speeds are expressed as fractions of
 * the current canvas size at call sites so the feel is resolution independent.
 */

/** Number of bubbles in an EVEN row. Odd rows hold COLS - 1 (offset by R). */
export const COLS = 11;

/** Minimum connected same-color cluster size that pops. */
export const MATCH_MIN = 3;

/** Filled rows when a level starts. */
export const INITIAL_ROWS = 5;

/** Hard cap on how deep the jagged board array can grow. */
export const MAX_ROWS = 40;

/** Shots between ceiling descents at level 1 (clamped down as levels rise). */
export const SHOTS_PER_DESCENT_BASE = 6;
export const SHOTS_PER_DESCENT_MIN = 3;

/** Ceiling-drop slide-in animation duration (seconds). */
export const DESCEND_ANIM = 0.35;

/** Pop-in scale animation duration for a freshly placed/spawned bubble. */
export const SPAWN_ANIM = 0.18;

/** Shot flight speed as a multiple of canvas height per second. */
export const SHOT_SPEED_FACTOR = 2.05;

/** Max aim deviation from straight up, in radians (~78 degrees). */
export const AIM_CLAMP = (78 * Math.PI) / 180;

/** Keyboard aim nudge speed (radians per second). */
export const AIM_KEY_SPEED = 1.6;

/** Match scoring. */
export const POP_BASE = 10;
export const POP_SIZE_BONUS = 5; // per bubble above MATCH_MIN
export const DROP_BASE = 20; // k-th dropped bubble worth DROP_BASE * k
export const LEVEL_CLEAR_BONUS = 1000;

/** Combo multiplier ladder, indexed by combo step (capped at last entry). */
export const COMBO_STEPS = [1, 1.5, 2, 3, 4, 5];

/** Active color-count ramp by level (clamped to last entry, capped at palette). */
export const COLORS_BY_LEVEL = [4, 4, 5, 5, 6, 6];

/** Fraction of canvas height reserved at the top for the HUD band. */
export const HUD_FRACTION = 0.085;

/** How far above the launcher the death line sits, in row-heights. */
export const DEATH_MARGIN_ROWS = 1.15;

/** A single candy color: base + a darker shade for the body gradient + glyph. */
export interface PaletteEntry {
  /** Bright top-light color. */
  light: string;
  /** Saturated mid color. */
  base: string;
  /** Deep shadow color for the bottom of the sphere. */
  deep: string;
  /** Faint inner glyph shape for color-blind readability. */
  glyph: GlyphKind;
}

export type GlyphKind =
  | "dot"
  | "ring"
  | "star"
  | "diamond"
  | "triangle"
  | "flower";

/** Six original candy hues, each with a distinct inner glyph. */
export const PALETTE: PaletteEntry[] = [
  { light: "#ff8fae", base: "#ff4d7e", deep: "#c01e54", glyph: "dot" }, // strawberry
  { light: "#ffd27a", base: "#ffab2e", deep: "#c97606", glyph: "star" }, // mango
  { light: "#9fe9a8", base: "#3ed46b", deep: "#1d9447", glyph: "triangle" }, // lime
  { light: "#8fd9ff", base: "#36a9ff", deep: "#1366c4", glyph: "ring" }, // blueberry
  { light: "#d3acff", base: "#a767ff", deep: "#6f31c4", glyph: "diamond" }, // grape
  { light: "#9ff4ec", base: "#2fd6c4", deep: "#0e9587", glyph: "flower" }, // mint
];

/** Background gradient stops (top → bottom). */
export const BG_TOP = "#1b1030";
export const BG_MID = "#241845";
export const BG_BOT = "#120a22";

/** Wall / frame accent. */
export const FRAME_COLOR = "#4a3a78";
export const FRAME_GLOW = "#7c5cff";

/** Storage keys. */
export const KEY_BEST = "__best";
