/**
 * Tank Battle — shared types.
 * Pure data / interface declarations only. No runtime logic lives here so that
 * `index.ts` and `levels.ts` can both depend on it without circular imports.
 */

/** Grid cell kinds. */
export enum Tile {
  Empty = 0,
  /** Indestructible steel; tanks & shells collide, shells ricochet. */
  Wall = 1,
  /** Wooden crate; destroyed by a shell or blast. */
  Breakable = 2,
  /** Pit; solid to tanks, shells fly over it. */
  Hole = 3,
}

/** High level machine driving overlays and simulation gating. */
export enum Phase {
  Title = "title",
  Intro = "intro",
  Playing = "playing",
  Cleared = "cleared",
  PlayerDead = "playerDead",
  GameOver = "gameOver",
}

/** Enemy behaviour preset. The player tank has `archetype = null`. */
export interface ArchetypeDef {
  id: string;
  name: string;
  /** palette */
  hull: string;
  tread: string;
  trim: string;
  /** movement speed in tiles/sec (0 = stationary turret) */
  speed: number;
  /** seconds between shots */
  fireInterval: number;
  /** acquire delay before firing at a freshly seen target (seconds) */
  reaction: number;
  /** ricochets on this tank's shells */
  bounces: number;
  /** active shell cap */
  maxShells: number;
  /** radians of random aim jitter */
  aimError: number;
  /** 0..1 velocity-lead factor */
  lead: number;
  /** 0..1 desire to close distance with the player */
  aggression: number;
  /** prefers ricochet bank shots */
  banker: boolean;
  /** lays mines */
  laysMines: boolean;
  /** engage range in tiles */
  awareness: number;
  /** dodges incoming shells */
  evasive: number;
  /** points awarded when destroyed */
  score: number;
}

export type AiState = "wander" | "engage" | "evade";

export interface Tank {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bodyAngle: number;
  turretAngle: number;
  radius: number;
  alive: boolean;
  isPlayer: boolean;
  archetype: ArchetypeDef | null;
  hull: string;
  tread: string;
  trim: string;
  fireCooldown: number;
  mineCooldown: number;
  activeShells: number;
  activeMines: number;
  /** scrolling tread animation offset */
  treadPhase: number;
  /** seconds of muzzle flash remaining */
  muzzle: number;
  /** recoil offset applied to barrel draw */
  recoil: number;
  /** respawn invulnerability timer (player) */
  invuln: number;
  // ---- AI scratch ----
  ai: AiState;
  aiTimer: number;
  wanderAngle: number;
  acquire: number;
  seesPlayer: boolean;
  /** desired turret angle (eased toward) */
  aimAngle: number;
  /** +1 / -1 strafing preference */
  strafeDir: number;
  /** seconds until this tank may lay another mine (AI) */
  mineTimer: number;
}

export interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number;
  owner: Tank;
  ownerGrace: number;
  life: number;
  radius: number;
  alive: boolean;
  /** trail point ring buffer */
  trail: Array<{ x: number; y: number }>;
}

export interface Mine {
  x: number;
  y: number;
  owner: Tank;
  fuse: number;
  arm: number;
  alive: boolean;
}

export type ParticleKind = "spark" | "smoke" | "debris" | "ring" | "flash";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: ParticleKind;
  /** for rings: current radius growth driver */
  grow: number;
}

export interface Decal {
  x: number;
  y: number;
  angle: number;
  life: number;
  max: number;
  kind: "tread" | "scorch";
  w: number;
  h: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
}

export interface LevelDef {
  cols: number;
  rows: number;
  /** ASCII rows; see legend in levels.ts */
  layout: string[];
}

/** A resolved spawn pulled out of a layout. */
export interface Spawn {
  x: number;
  y: number;
  archetypeId: string | null; // null => player
}
