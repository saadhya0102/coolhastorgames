import type { Palette } from "./types";

/**
 * NEON CONDUIT — single source of truth for tuning constants.
 *
 * Units: the tunnel lives in small abstract "tunnel units" (circumradius ~1).
 * A single scalar `UNIT` (derived from the viewport in camera.ts) converts
 * tunnel units -> CSS pixels, so every spatial constant below is in tunnel
 * units unless its name says otherwise (px, s, rad, rings).
 */

// --- Tunnel geometry --------------------------------------------------------
export const N_DEFAULT = 6; // hexagonal cross-section
export const RC = 1.0; // circumradius (center -> vertex)
export const SEG = 1.0; // z-length of one ring

/** Apothem (center -> face midpoint) for an N-gon. */
export const apothem = (n: number) => RC * Math.cos(Math.PI / n);
/** Half the side length of an N-gon face. */
export const halfSide = (n: number) => RC * Math.sin(Math.PI / n);

// --- Projection -------------------------------------------------------------
export const FOCAL = 3.2;
export const NEAR = 0.02;
export const FAR = 27; // visible depth in tunnel units (~27 rings)
export const Z_MIN = 0.02;
export const VIEW_FILL = 0.95; // fraction of min(W,H) the tube circumradius fills
export const VANISH_Y = 0.45; // vanishing point height (fraction of H)
export const Z_PLAYER = 2.3; // player drawn this far ahead of the camera

// --- Forward motion ---------------------------------------------------------
export const BASE_SPEED = 6.2; // rings/sec at the start
export const MAX_SPEED = 17.5; // rings/sec cap
export const SPEED_FULL_Z = 9000; // camZ at which MAX_SPEED is reached
export const DT_MAX = 0.05; // clamp huge frame gaps

// --- Roll (wall-running rotation) -------------------------------------------
export const ROLL_SNAP = 12; // exponential ease rate (1/sec)
export const ROLL_SETTLE = 0.14; // rad; buffered input applies within this
export const BANK_GAIN = 0.016; // rollVel -> bank lean
export const BANK_MAX = 0.17; // rad
export const BANK_SNAP = 9;

// --- Jump -------------------------------------------------------------------
export const JUMP_AIR_TIME = 0.64; // s aloft for a full jump
export const JUMP_PEAK = 0.95; // peak height (tunnel units) above floor
export const COYOTE_T = 0.1; // s of forgiveness after leaving ground
export const JUMP_BUFFER_T = 0.13; // s a jump press survives before landing
export const MAX_JUMP_RINGS = 2; // longest forced full-ring gap

// Derived projectile values (rise to JUMP_PEAK, return after JUMP_AIR_TIME).
export const GRAVITY = (8 * JUMP_PEAK) / (JUMP_AIR_TIME * JUMP_AIR_TIME);
export const JUMP_VY = (GRAVITY * JUMP_AIR_TIME) / 2;

// --- Procedural generation --------------------------------------------------
export const START_SAFE_RINGS = 11;
export const MIN_SAFE_GAP = 2;
export const MAX_SAFE_GAP = 7;
export const DIFF_FULL_Z = 13000; // distance points at which difficulty saturates
export const BIOME_LEN = 2200; // distance points per palette shift

// --- Fog / visuals ----------------------------------------------------------
export const FOG_FAR = 23;
export const FOG_MIN = 0.05;
export const GLOW_RINGS = 6; // only nearest rings get expensive shadow glow
export const STAR_COUNT = 130;
export const LIGHT_DIR = -Math.PI / 2; // key light from the floor direction

// --- Scoring ----------------------------------------------------------------
export const DIST_UNIT = SEG; // 1 distance point per ring advanced
export const MILESTONE = 250;
export const DEATH_DELAY = 0.72; // s of death flourish before gameOver()

// --- Palettes (biomes) ------------------------------------------------------
// Generated from a base hue so adding biomes is trivial and assets are zero.
const mkPalette = (
  hue: number,
  accentShift: number,
  name: string,
): Palette => {
  const h2 = (hue + accentShift) % 360;
  const rgb = (h: number, s: number, l: number): [number, number, number] => {
    // HSL -> RGB (0..255), compact and dependency-free.
    const S = s / 100;
    const L = l / 100;
    const a = S * Math.min(L, 1 - L);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const col = L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * col);
    };
    return [f(0), f(8), f(4)];
  };
  return {
    name,
    bgTop: `hsl(${hue}, 60%, 7%)`,
    bgBottom: `hsl(${(hue + 200) % 360}, 70%, 3%)`,
    nebula: `hsl(${h2}, 90%, 60%)`,
    tile: rgb(hue, 90, 58),
    tileDim: rgb((hue + 180) % 360, 60, 40),
    edge: `hsl(${h2}, 100%, 70%)`,
    player: "#ffffff",
    playerGlow: `hsl(${h2}, 100%, 65%)`,
  };
};

export const PALETTES: Palette[] = [
  mkPalette(190, 70, "Cyan Drift"), // cyan / magenta
  mkPalette(280, 60, "Violet Pulse"), // violet / lime
  mkPalette(330, 40, "Rose Circuit"), // pink / gold
  mkPalette(140, 80, "Emerald Run"), // green / orange
  mkPalette(35, 60, "Amber Forge"), // amber / blue
];

export const paletteFor = (biome: number): Palette =>
  PALETTES[((biome % PALETTES.length) + PALETTES.length) % PALETTES.length];
