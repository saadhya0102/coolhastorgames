/** Shared types for Iron Vale (tower defense). No logic lives here. */

export interface Vec {
  x: number;
  y: number;
}

/** The four playable tower archetypes. */
export type TowerKind = "archer" | "cannon" | "frost" | "arcane";

/** Damage flavours. Magic ignores armor. */
export type DamageType = "physical" | "magic";

/** Enemy archetypes. */
export type EnemyKind =
  | "grub"
  | "sprinter"
  | "brute"
  | "wisp"
  | "swarmling"
  | "warden"
  | "titan";

/** High level finite-state-machine phases. */
export type Phase = "menu" | "playing" | "paused" | "gameover";

/** Per-level stats for a tower. */
export interface TowerLevel {
  /** gold cost to reach this level (build cost for L1, upgrade cost otherwise) */
  cost: number;
  /** attack range in grid units */
  range: number;
  /** damage per projectile/hit */
  damage: number;
  /** shots per second */
  fireRate: number;
  /** splash radius in grid units (0 = single target) */
  splash?: number;
  /** slow strength 0..1 applied on hit */
  slow?: number;
  /** slow duration in seconds */
  slowDur?: number;
  /** number of extra chain targets (arcane L3) */
  chain?: number;
  /** fires two projectiles per shot (archer L3) */
  multishot?: boolean;
  /** applies its slow as a small AoE around the target (frost L3) */
  aoeSlow?: boolean;
}

/** Static definition of a tower archetype. */
export interface TowerDef {
  kind: TowerKind;
  name: string;
  blurb: string;
  icon: string;
  damageType: DamageType;
  /** can this tower target flying enemies? */
  canHitFlying: boolean;
  /** projectile travel speed in grid units / second (large = near-instant) */
  projectileSpeed: number;
  /** body + accent colours used by the renderer */
  body: string;
  accent: string;
  /** L1..L3 */
  levels: TowerLevel[];
}

/** Static definition of an enemy archetype. */
export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  /** base hp at wave 1 */
  hp: number;
  /** grid units / second */
  speed: number;
  /** physical damage reduction 0..1 */
  armor: number;
  flying: boolean;
  /** lives lost if it reaches the keep */
  leak: number;
  /** gold granted on death */
  bounty: number;
  /** body radius in grid units */
  radius: number;
  body: string;
  accent: string;
}

/** A live tower on the board. */
export interface Tower {
  id: number;
  kind: TowerKind;
  /** tile column / row it occupies */
  col: number;
  row: number;
  /** center position in grid units (col+0.5, row+0.5) */
  x: number;
  y: number;
  /** 1-based current level */
  level: number;
  /** total gold sunk in (for sell refund) */
  invested: number;
  /** seconds until it can fire again */
  cooldown: number;
  /** current aim angle (radians) for the turret */
  angle: number;
  /** recoil / firing animation 0..1 */
  recoil: number;
  /** id of current target enemy (or -1) */
  targetId: number;
}

/** A live enemy. */
export interface Enemy {
  id: number;
  kind: EnemyKind;
  /** distance travelled along the path in grid units */
  dist: number;
  /** current position in grid units (derived from dist) */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  flying: boolean;
  leak: number;
  bounty: number;
  radius: number;
  /** remaining slow time */
  slowT: number;
  /** current slow strength 0..1 */
  slowAmt: number;
  /** animation phase for limbs/wings */
  anim: number;
  /** facing direction (unit vector) for eyes */
  faceX: number;
  faceY: number;
  /** hover bob phase for flyers */
  bob: number;
  /** white hit-flash timer */
  flash: number;
  dead: boolean;
  /** true once it leaked (for cleanup) */
  leaked: boolean;
}

/** A projectile in flight. */
export interface Projectile {
  kind: TowerKind;
  x: number;
  y: number;
  /** target enemy id (homing) */
  targetId: number;
  /** fallback impact point if target dies */
  tx: number;
  ty: number;
  speed: number;
  damage: number;
  damageType: DamageType;
  splash: number;
  slow: number;
  slowDur: number;
  chain: number;
  aoeSlow: boolean;
  /** trail/age in seconds */
  age: number;
  dead: boolean;
}

/** One enemy spawn group within a wave. */
export interface SpawnGroup {
  type: EnemyKind;
  count: number;
  /** seconds between spawns within the group */
  spacing: number;
  /** seconds after wave start before the group begins */
  delay: number;
  /** hp multiplier applied to this wave */
  hpMul: number;
  /** bounty multiplier applied to this wave */
  bountyMul: number;
}

export interface Wave {
  groups: SpawnGroup[];
  /** true if this wave contains a boss/mini-boss */
  boss: boolean;
}

/** A map definition. */
export interface GameMap {
  name: string;
  theme: string;
  cols: number;
  rows: number;
  /** path waypoints in grid coordinates (tile centers), incl. off-screen ends */
  waypoints: Vec[];
  /** buildable-blocking decorations (rocks/trees) at tile coords */
  decorations: Vec[];
  startGold: number;
  startLives: number;
  grass: string;
  grassAlt: string;
  road: string;
  roadEdge: string;
  accent: string;
}

/** Live runtime spawn cursor used while a wave is active. */
export interface SpawnState {
  group: SpawnGroup;
  remaining: number;
  timer: number;
}
