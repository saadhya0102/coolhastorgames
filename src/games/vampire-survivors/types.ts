/**
 * Shared type definitions for Nightfall Survivors.
 *
 * These are pure interfaces with no runtime behavior, so both the data-driven
 * definitions (`defs.ts`) and the main game (`index.ts`) can depend on them
 * without creating a circular import. The `World` interface is the contract the
 * main game exposes to weapon / enemy update functions.
 */

export interface Vec {
  x: number;
  y: number;
}

export type EnemyKind = "chase" | "charger" | "shooter" | "boss";

/** A live enemy. Pooled — `alive` toggles membership. */
export interface Enemy {
  id: number;
  typeId: string;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  xp: number;
  /** white hit-flash timer (s) */
  flash: number;
  /** time until this enemy can deal contact damage again (s) */
  contactCd: number;
  /** remaining slow time (s) */
  slow: number;
  /** effective speed multiplier while slowed (0..1) */
  slowFactor: number;
  /** decaying knockback velocity */
  knockX: number;
  knockY: number;
  /** knockback resistance (0 = full knockback, 1 = immune) */
  kbResist: number;
  /** per weapon-slot re-hit cooldown for persistent weapons */
  hitTimers: number[];
  /** generic animation phase */
  anim: number;
  boss: boolean;
  /** charger/shooter timers */
  fireCd: number;
  windup: number;
  dashTime: number;
  dashX: number;
  dashY: number;
  alive: boolean;
}

export type ProjectileKind =
  | "shard"
  | "star"
  | "frost"
  | "boomerang"
  | "ember"
  | "comet"
  | "enemy";

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierce: number;
  life: number;
  maxLife: number;
  color: string;
  kind: ProjectileKind;
  spin: number;
  /** enemy ids already hit by this projectile (for pierce) */
  hits: number[];
  slotIndex: number;
  fromEnemy: boolean;
  /** explosion radius for ember; 0 otherwise */
  area: number;
  /** slow fraction applied on hit (0 = none) */
  slowOnHit: number;
  slowTime: number;
  knockback: number;
  crit: boolean;
  /** boomerang return bookkeeping */
  returning: boolean;
  originX: number;
  originY: number;
  /** trail sample positions (x,y pairs), newest last */
  trail: number[];
  alive: boolean;
}

export interface Gem {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  /** 0 = xp gem, 1 = heart, 2 = magnet */
  kind: number;
  attracting: boolean;
  anim: number;
  life: number;
  alive: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** drag applied per second */
  drag: number;
  /** 0 = circle, 1 = spark line, 2 = ring */
  shape: number;
  alive: boolean;
}

export interface DamageNumber {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
  alive: boolean;
}

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
  alive: boolean;
}

export interface Stats {
  damageMult: number;
  cooldownMult: number;
  areaMult: number;
  projSpeedMult: number;
  projCountBonus: number;
  moveMult: number;
  magnet: number;
  xpMult: number;
  regen: number;
  armorMult: number;
  durationMult: number;
  critChance: number;
  critMult: number;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpToNext: number;
  invuln: number;
  facingX: number;
  facingY: number;
  flash: number;
  regenAcc: number;
  anim: number;
  stats: Stats;
}

export interface WeaponState {
  defId: string;
  level: number;
  timer: number;
  /** rotation phase for orbiting weapons */
  angle: number;
  /** misc per-weapon scratch numbers */
  data: Record<string, number>;
}

export interface OwnedPassive {
  defId: string;
  level: number;
}

/** Options for damaging an enemy. */
export interface DamageOpts {
  knockback?: number;
  dirX?: number;
  dirY?: number;
  slow?: number;
  slowTime?: number;
  crit?: boolean;
  /** weapon slot index for persistent re-hit tracking */
  slot?: number;
  color?: string;
}

/**
 * The runtime surface that weapon/enemy definitions are allowed to touch.
 * Implemented by the main game in `index.ts`.
 */
export interface World {
  player: Player;
  time: number;
  /** total elapsed seconds (alias of time, kept for clarity) */
  enemyCount(): number;

  /** Nearest live enemy to a point, optionally within maxDist, excluding ids. */
  nearestEnemy(
    x: number,
    y: number,
    maxDist?: number,
    exclude?: number[],
  ): Enemy | null;

  /** Iterate live enemies within radius r of (x,y). */
  forEachEnemyInRadius(
    x: number,
    y: number,
    r: number,
    cb: (e: Enemy) => void,
  ): void;

  /** Approximate densest enemy cluster center within range (for Ember). */
  densestPoint(x: number, y: number, range: number): Vec | null;

  damageEnemy(e: Enemy, amount: number, opts?: DamageOpts): void;

  spawnProjectile(p: Partial<Projectile> & { x: number; y: number }): void;

  addParticle(p: Partial<Particle> & { x: number; y: number }): void;
  burst(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    size?: number,
  ): void;
  addDamageNumber(
    x: number,
    y: number,
    amount: number,
    color: string,
    crit?: boolean,
  ): void;
  addBeam(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width?: number,
    life?: number,
  ): void;

  shake(amount: number): void;
  /** random float in [min,max) */
  rand(min: number, max: number): number;
  audioTick(freq: number, dur?: number, vol?: number): void;
  audioNoise(dur?: number, vol?: number): void;
}

// ----- Definition interfaces (data-driven content) -----

export type DrawIcon = (
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
) => void;

export interface WeaponDef {
  id: string;
  name: string;
  color: string;
  maxLevel: number;
  short: string;
  /** description of what the NEXT level (the level being taken) grants */
  describe: (nextLevel: number) => string;
  icon: DrawIcon;
  update: (world: World, w: WeaponState, dt: number) => void;
  init?: (world: World, w: WeaponState) => void;
  /** optional world-space render (called inside the camera transform) */
  render?: (world: World, w: WeaponState, c: CanvasRenderingContext2D) => void;
  evolution?: { into: string; requires: string; name: string };
  /** true for weapons that are evolution-only (not offered as new) */
  evolved?: boolean;
}

export interface PassiveDef {
  id: string;
  name: string;
  color: string;
  maxLevel: number;
  short: string;
  describe: (nextLevel: number) => string;
  icon: DrawIcon;
  apply: (stats: Stats, level: number) => void;
}

export interface EnemyDef {
  id: string;
  name: string;
  kind: EnemyKind;
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  xp: number;
  color: string;
  kbResist: number;
  boss?: boolean;
  draw: (c: CanvasRenderingContext2D, e: Enemy, t: number) => void;
}

// ----- Upgrade offer (level-up screen) -----

export type OfferKind =
  | "weapon-new"
  | "weapon-up"
  | "passive-new"
  | "passive-up"
  | "evolution"
  | "heal"
  | "maxhp";

export interface Offer {
  kind: OfferKind;
  id: string;
  name: string;
  desc: string;
  tag: string;
  color: string;
  icon: DrawIcon;
  level: number;
  maxLevel: number;
}
