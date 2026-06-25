/**
 * Hill Climb 2 — shared types.
 * Pure type declarations only; no runtime code lives here.
 */

export type VehicleId = "jeep" | "sports" | "truck" | "bike" | "rover";

export type StageId = "country" | "desert" | "moon" | "mountain";

export type UpgradeKey = "engine" | "tires" | "suspension" | "drive" | "fuel";

export type Phase = "garage" | "countdown" | "run" | "crashed" | "results";

export type GarageTab = "drive" | "gear" | "world";

/** Upgrade level per track, 0..MAX_LEVEL. */
export interface UpgradeLevels {
  engine: number;
  tires: number;
  suspension: number;
  drive: number;
  fuel: number;
}

/** Static, data-driven vehicle definition (see config.ts). */
export interface VehicleDef {
  id: VehicleId;
  name: string;
  blurb: string;
  /** coin cost to unlock (0 = free / starter) */
  cost: number;
  // --- performance base stats ---
  power: number; // base forward drive acceleration (wu/s^2 on tangent)
  brake: number; // base brake / reverse acceleration
  grip: number; // traction multiplier
  mass: number; // chassis mass
  suspK: number; // suspension stiffness
  suspC: number; // suspension damping
  restLen: number; // suspension rest length
  wheelR: number; // wheel radius
  wheelBase: number; // distance between the two axles (full)
  axleY: number; // vertical offset of axles below chassis centre
  airControl: number; // air-rotation torque multiplier
  fuelUse: number; // fuel consumption multiplier
  tank: number; // base fuel capacity
  fwd: number; // baseline drive split toward front wheel (0..1)
  // --- art ---
  bodyW: number;
  bodyH: number;
  cabinH: number;
  color: string;
  accent: string;
  /** decorative roll-cage / styling flag */
  style: "jeep" | "sports" | "truck" | "bike" | "rover";
}

/** Static, data-driven stage definition (see config.ts). */
export interface StageDef {
  id: StageId;
  name: string;
  blurb: string;
  cost: number;
  gravityScale: number; // multiplies G_BASE
  rampDist: number; // metres over which terrain amplitude ramps up
  rampMax: number; // peak amplitude multiplier
  amps: [number, number, number, number];
  waves: [number, number, number, number];
  ridge: number; // ridge-sharpening amount (0 = smooth)
  fuelRate: number; // probability a pickup is a fuel can
  palette: StagePalette;
}

export interface StagePalette {
  skyTop: string;
  skyBottom: string;
  sun: string;
  far: string; // far parallax silhouette
  mid: string; // mid parallax silhouette
  groundTop: string; // surface band
  groundBottom: string; // deep fill
  surfaceLine: string; // bright top stroke
  dust: string; // particle tint
  decor: string; // decoration accent
  hudAccent: string;
  /** kind of background flair to draw */
  flair: "clouds" | "haze" | "stars" | "aurora";
}

/** A coin / fuel pickup in the world. */
export interface Pickup {
  x: number;
  y: number;
  kind: "coin" | "fuel";
  got: boolean;
  bob: number;
}

/** A decorative prop sitting on the terrain surface. */
export interface Decoration {
  x: number;
  kind: number; // index into the stage's decoration variants
  scale: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vrot: number;
  grav: number;
  drag: number;
  color: string;
  kind: "dust" | "exhaust" | "sparkle" | "debris" | "coin";
  text: string;
}

/** Live, derived tuning for the currently selected vehicle + upgrades. */
export interface DerivedStats {
  driveAccel: number;
  brakeAccel: number;
  grip: number;
  wheelVtMax: number;
  mass: number;
  inertia: number;
  suspK: number;
  suspC: number;
  restLen: number;
  wheelR: number;
  axleX: number; // half wheelbase
  axleY: number;
  airTorque: number;
  fuelUse: number;
  maxFuel: number;
  fwd: number;
}

export interface SaveState {
  version: number;
  coins: number;
  selectedVehicle: VehicleId;
  selectedStage: StageId;
  ownedVehicles: VehicleId[];
  ownedStages: StageId[];
  upgrades: Record<VehicleId, UpgradeLevels>;
  bestByStage: Partial<Record<StageId, number>>;
  totalDistance: number;
}

/** Result of a single completed run, fed to the results screen. */
export interface RunResult {
  metres: number;
  coins: number;
  flipBonus: number;
  airBonus: number;
  pickupCoins: number;
  newBest: boolean;
  reason: "crash" | "fuel";
}
