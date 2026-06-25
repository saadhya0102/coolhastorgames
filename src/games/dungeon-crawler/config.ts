/** Static tunables, palette and tiny math helpers for the dungeon crawler.
 * Everything here is data + pure functions (no engine imports), so it can be
 * shared freely across the game modules without circular dependencies. */

/** Room interior is COLS x ROWS tiles including a 1-tile wall border. */
export const COLS = 15;
export const ROWS = 9;

/** Playable interior bounds in tile units (walls occupy [0,1] and [N-1,N]). */
export const WALL = 1;
export const MIN_X = WALL;
export const MAX_X = COLS - WALL;
export const MIN_Y = WALL;
export const MAX_Y = ROWS - WALL;

/** Door opening half-width (in tiles) centred on each wall. */
export const DOOR_HALF = 0.9;

/** Floor grid (rooms) dimensions for generation. */
export const FLOOR_GRID = 9;

/** Hard caps to keep the simulation bounded. */
export const MAX_PARTICLES = 320;
export const MAX_BULLETS = 600;

/** Maximum dt step (s) to avoid tunnelling after a stall. */
export const MAX_DT = 0.05;

export type Dir = "N" | "E" | "S" | "W";
export const DIRS: Dir[] = ["N", "E", "S", "W"];

export const DIR_VEC: Record<Dir, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

export const OPPOSITE: Record<Dir, Dir> = { N: "S", S: "N", E: "W", W: "E" };

/** Original crypt palette. */
export const COL = {
  bgTop: "#0b0710",
  bgBottom: "#140a18",
  floorA: "#241a2e",
  floorB: "#2b2036",
  floorSpeck: "#3a2c48",
  wall: "#0d0913",
  wallTop: "#3a2c4e",
  wallEdge: "#1a1224",
  doorFrame: "#5a4570",
  doorOpen: "#0a0610",
  doorBar: "#caa84a",
  bossDoor: "#c44a5a",
  treasureDoor: "#e0b84a",
  shopDoor: "#4ac6c4",

  player: "#7fe9ff",
  playerDark: "#2a7fa0",
  playerLantern: "#ffd66b",

  bullet: "#bdf3ff",
  bulletCore: "#ffffff",
  enemyBullet: "#ff7a4a",
  enemyBulletCore: "#ffd9a0",

  crawler: "#7cc46b",
  crawlerDark: "#3f6f37",
  spitter: "#b977e6",
  spitterDark: "#6a3f8f",
  blob: "#f2a23c",
  blobDark: "#a4631a",
  floater: "#9fd6ff",
  floaterDark: "#4f7fa8",
  boss: "#e2563f",
  bossDark: "#7a221a",
  bossEye: "#ffe27a",

  heart: "#ff5470",
  heartEmpty: "#3a2030",
  coin: "#ffd23f",
  itemGlow: "#ffe9a8",

  hudText: "#f3e9ff",
  hudDim: "#9b86b5",
  white: "#ffffff",
} as const;

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const len = (x: number, y: number) => Math.hypot(x, y);

/** Normalise a vector; returns {0,0} for a zero vector. */
export function norm(x: number, y: number): { x: number; y: number } {
  const l = Math.hypot(x, y);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: x / l, y: y / l };
}

export const angle = (x: number, y: number) => Math.atan2(y, x);

/** Snap an arbitrary angle to one of 4 cardinal directions (radians). */
export function snap4(a: number): number {
  return Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
}
