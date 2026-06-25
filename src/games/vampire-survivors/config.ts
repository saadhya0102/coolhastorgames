/** Tunables, palette, caps and curves for Nightfall Survivors. */

export const CAPS = {
  enemies: 350,
  projectiles: 520,
  particles: 420,
  gems: 600,
  damageNumbers: 220,
  beams: 80,
} as const;

export const PLAYER = {
  baseMove: 165,
  baseMaxHp: 100,
  radius: 16,
  startInvuln: 0.55,
  hitInvuln: 0.6,
  contactWindow: 0.45,
} as const;

export const LIMITS = {
  maxWeapons: 6,
  maxPassives: 6,
  maxWeaponSlots: 8,
} as const;

export const DIRECTOR = {
  bossEvery: 90,
  swarmEvery: 40,
} as const;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.floor(5 + level * 6 + Math.pow(level, 1.55) * 1.2);
}

/** Seconds between spawn ticks, shrinking with time. */
export function spawnInterval(t: number): number {
  return Math.max(0.18, 1.15 - t * 0.012);
}

/** How many enemies per spawn tick. */
export function spawnBatch(t: number): number {
  return Math.min(7, 1 + Math.floor(t / 28));
}

export function hpScale(t: number): number {
  return 1 + t / 45;
}

export function dmgScale(t: number): number {
  return 1 + t / 120;
}

export function speedScale(t: number): number {
  return Math.min(1.35, 1 + t / 320);
}

export function xpScale(t: number): number {
  return 1 + t / 200;
}

export function bossHp(t: number): number {
  return Math.floor(560 * (1 + t / 26));
}

/** Color palette — original neon-noir theme. */
export const COLORS = {
  bgTop: "#0a0813",
  bgBottom: "#150d24",
  grid: "rgba(120, 90, 200, 0.07)",
  vignette: "rgba(0,0,0,0.55)",
  player: "#7af5e6",
  playerDark: "#1d6f73",
  lantern: "#ffe27a",
  xp: "#74e36a",
  xpHi: "#bdf58e",
  hp: "#ff5d6c",
  hpBack: "rgba(255,255,255,0.12)",
  text: "#f4f1ff",
  textDim: "rgba(244,241,255,0.6)",
  gold: "#ffcf5a",
  evolve: "#ffd24a",
  boss: "#ff4d6d",
  crit: "#ffd24a",
  dmg: "#ffffff",
} as const;

/** Gem tier color by value. */
export function gemColor(value: number): string {
  if (value >= 20) return "#ffcf5a";
  if (value >= 8) return "#c07bff";
  if (value >= 3) return "#6aa8ff";
  return "#74e36a";
}
