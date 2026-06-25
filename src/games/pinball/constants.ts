/**
 * Neon Nexus — tuning constants.
 *
 * Everything gameplay-related is expressed in a fixed VIRTUAL coordinate space
 * (TABLE_W x TABLE_H). The renderer maps this space onto whatever canvas size we
 * are given, so physics is completely resolution independent.
 */

// ---- Virtual table dimensions ------------------------------------------------
export const TABLE_W = 560;
export const TABLE_H = 1000;

// ---- Ball --------------------------------------------------------------------
export const BALL_R = 12;

// ---- Physics integration -----------------------------------------------------
export const FIXED_DT = 1 / 240; // physics tick
export const MAX_FRAME_DT = 0.05; // clamp huge frame gaps (tab stalls)
export const GRAVITY = 1400; // virtual units / s^2 (downward, +y)
export const DRAG = 0.04; // linear velocity damping per second
export const MAX_SPEED = 3500; // hard velocity clamp
export const SUBSTEP_MAX = 16; // max micro-substeps per tick

// ---- Restitution / friction --------------------------------------------------
export const WALL_E = 0.35;
export const FRICTION = 0.02; // tangential damping on wall hits
export const BUMPER_E = 0.9;
export const BUMPER_KICK = 900;
export const SLING_E = 0.55;
export const SLING_KICK = 720;
export const FLIPPER_E = 0.4;
export const BALL_BALL_E = 0.6;

// ---- Flippers ----------------------------------------------------------------
export const FLIPPER_LEN = 150;
export const FLIPPER_R = 14;
export const FLIPPER_SWEEP_SPEED = 32; // rad/s
// Rest = pointing slightly down-outward; active = raised up-inward.
export const FLIPPER_REST_DEG = 28; // below horizontal (outer side lower)
export const FLIPPER_ACTIVE_DEG = 36; // above horizontal when raised

// ---- Plunger -----------------------------------------------------------------
export const PLUNGER_CHARGE_TIME = 0.9; // seconds to full power
export const MIN_LAUNCH = 1650;
export const MAX_LAUNCH = 3200;

// ---- Safety nets -------------------------------------------------------------
export const STUCK_SPEED = 24; // below this for STUCK_TIME => nudge
export const STUCK_TIME = 1.4;
export const STUCK_NUDGE = 220;

// ---- Game rules --------------------------------------------------------------
export const START_BALLS = 3;
export const COMBO_TIMEOUT = 1.5; // seconds before a combo chain resets
export const MULTIPLIER_MAX = 5;
export const CORE_HITS_FOR_MB = 3;
export const HIT_DEBOUNCE = 0.08; // per-collider per-ball scoring debounce (s)

// ---- Scoring (base, before multiplier) ---------------------------------------
export const SCORE_BUMPER = 100;
export const SCORE_SLING = 50;
export const SCORE_STANDUP = 250;
export const SCORE_DROP = 500;
export const SCORE_DROP_BANK = 5000;
export const SCORE_LANE = 200;
export const SCORE_LANE_SET = 3000;
export const SCORE_CORE = 750;
export const SCORE_MULTIBALL_START = 10000;
export const SCORE_JACKPOT = 2500;

// ---- Neon palette (original) -------------------------------------------------
export const COLORS = {
  bgTop: "#0b0a1f",
  bgBottom: "#05040d",
  cabinet: "#15132b",
  cabinetEdge: "#2a2550",
  playTop: "#0d0c24",
  playBottom: "#070617",
  grid: "rgba(90, 80, 180, 0.10)",
  wall: "#4cf0ff", // cyan — structure
  wallGlow: "#1fb6d6",
  bumper: "#34f5ff", // cyan
  sling: "#ff45c8", // magenta
  drop: "#9dff3c", // lime
  standup: "#ffb13c", // amber
  core: "#ffd23f", // amber-gold
  lane: "#8a7bff", // violet
  ball: "#eaf6ff",
  flipperL: "#ff45c8",
  flipperR: "#4cf0ff",
  text: "#eef0ff",
  textDim: "rgba(230,235,255,0.55)",
  jackpot: "#ff5c5c",
} as const;
