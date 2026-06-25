import type { Dir } from "./config";

export type RoomType = "start" | "combat" | "treasure" | "shop" | "boss";

export type EnemyKind =
  | "crawler"
  | "spitter"
  | "blob"
  | "blobSmall"
  | "floater"
  | "boss";

export type PickupKind = "coin" | "heart" | "halfheart" | "item";

export interface GridCell {
  cx: number;
  cy: number;
}

export interface SpawnSpec {
  kind: EnemyKind;
  x: number;
  y: number;
}

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  /** item id when kind === "item" */
  itemId?: string;
  /** coin cost (shop only); 0/undefined = free */
  cost?: number;
  taken?: boolean;
  /** spawn-in animation timer */
  t: number;
}

export interface RoomDef {
  gx: number;
  gy: number;
  type: RoomType;
  doors: Record<Dir, boolean>;
  cleared: boolean;
  visited: boolean;
  /** enemies have been spawned at least once (so we don't respawn) */
  triggered: boolean;
  obstacles: GridCell[];
  spawns: SpawnSpec[];
  pickups: Pickup[];
  dist: number;
  /** trapdoor to descend (boss room, after clear) */
  trapdoor: boolean;
  trapOpen: boolean;
}

export interface PlayerStats {
  maxHp: number; // half-hearts
  hp: number; // half-hearts
  damage: number;
  fireDelay: number;
  moveSpeed: number;
  shotCount: number;
  piercing: number;
  shotSpeed: number;
  range: number; // seconds of flight
  luck: number;
  coins: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  maxLife: number;
  dmg: number;
  pierce: number;
  foe: boolean;
  /** ids of enemies already hit (for piercing), kept tiny */
  hitIds?: number[];
  dead?: boolean;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  touchDmg: number;
  flash: number;
  /** generic timers used by AI */
  t: number;
  fireT: number;
  /** for boss: phase + special timers + facing */
  phase: number;
  windup: number;
  charge: number;
  face: number;
  dead?: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav?: number;
}

export interface DamageNumber {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
  size: number;
}

export interface ItemDef {
  id: string;
  name: string;
  blurb: string;
  /** rarity weight for rolls */
  weight: number;
  /** apply to a mutable stats object */
  apply: (s: PlayerStats) => void;
}
