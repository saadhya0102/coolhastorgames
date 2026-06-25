/**
 * Hill Climb 2 — data tables & tuning.
 * Single source of truth for balance. No simulation logic here.
 */
import { clamp } from "@/engine";
import type {
  DerivedStats,
  StageDef,
  StageId,
  UpgradeKey,
  UpgradeLevels,
  VehicleDef,
  VehicleId,
} from "./types";

// ---------------------------------------------------------------------------
// Global constants (world units / seconds)
// ---------------------------------------------------------------------------
export const METER = 16;
export const VIEW_H = 360;
export const G_BASE = 1900;
export const MAXV = 2200;
export const MAXW = 18;
export const WHEEL_MAXV = 2400;
export const ANG_DAMP = 0.999;
export const AIR_THRESHOLD = 0.12;
export const START_X = 260;
export const LOOKAHEAD = 2600;
export const MAX_LEVEL = 8;

export const IDLE_DRAIN = 3.2;
export const GAS_DRAIN = 8.5;
export const CAN_REFILL = 36;
export const OUT_OF_FUEL_STOP = 6;

export const FLIP_COINS = 25;
export const AIRTIME_COINS = 4;
export const AIRTIME_CAP = 40;

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------
export const VEHICLES: Record<VehicleId, VehicleDef> = {
  jeep: {
    id: "jeep",
    name: "Trailblazer",
    blurb: "Balanced all-rounder. The perfect first ride.",
    cost: 0,
    power: 820,
    brake: 640,
    grip: 1.0,
    mass: 4.0,
    suspK: 640,
    suspC: 34,
    restLen: 26,
    wheelR: 16,
    wheelBase: 66,
    axleY: 9,
    airControl: 1.0,
    fuelUse: 1.0,
    tank: 100,
    fwd: 0.15,
    bodyW: 96,
    bodyH: 30,
    cabinH: 22,
    color: "#e8533c",
    accent: "#2c3e50",
    style: "jeep",
  },
  sports: {
    id: "sports",
    name: "Sprinter",
    blurb: "Fast & light. Low grip, twitchy in the air, sips fuel.",
    cost: 2500,
    power: 1020,
    brake: 560,
    grip: 0.8,
    mass: 3.2,
    suspK: 560,
    suspC: 30,
    restLen: 22,
    wheelR: 13,
    wheelBase: 74,
    axleY: 6,
    airControl: 1.3,
    fuelUse: 0.85,
    tank: 90,
    fwd: 0.1,
    bodyW: 104,
    bodyH: 24,
    cabinH: 16,
    color: "#2bd6c0",
    accent: "#16324a",
    style: "sports",
  },
  truck: {
    id: "truck",
    name: "Bigfoot",
    blurb: "Monster truck. Huge tyres, climbs anything, thirsty & slow.",
    cost: 7500,
    power: 760,
    brake: 760,
    grip: 1.25,
    mass: 6.2,
    suspK: 760,
    suspC: 44,
    restLen: 34,
    wheelR: 24,
    wheelBase: 80,
    axleY: 12,
    airControl: 0.7,
    fuelUse: 1.3,
    tank: 120,
    fwd: 0.35,
    bodyW: 100,
    bodyH: 34,
    cabinH: 26,
    color: "#ffb02e",
    accent: "#3a2a12",
    style: "truck",
  },
  bike: {
    id: "bike",
    name: "Trail Bike",
    blurb: "Featherweight flip machine. Almost no stability — expert toy.",
    cost: 15000,
    power: 900,
    brake: 520,
    grip: 0.9,
    mass: 2.2,
    suspK: 520,
    suspC: 26,
    restLen: 24,
    wheelR: 15,
    wheelBase: 42,
    axleY: 6,
    airControl: 1.8,
    fuelUse: 0.8,
    tank: 80,
    fwd: 0.0,
    bodyW: 64,
    bodyH: 16,
    cabinH: 14,
    color: "#ff4d6d",
    accent: "#1a1a22",
    style: "bike",
  },
  rover: {
    id: "rover",
    name: "Moon Rover",
    blurb: "Long, stable, plush suspension. The all-terrain endgame pick.",
    cost: 40000,
    power: 820,
    brake: 680,
    grip: 1.1,
    mass: 4.6,
    suspK: 820,
    suspC: 48,
    restLen: 34,
    wheelR: 18,
    wheelBase: 98,
    axleY: 10,
    airControl: 0.9,
    fuelUse: 1.05,
    tank: 130,
    fwd: 0.4,
    bodyW: 116,
    bodyH: 26,
    cabinH: 20,
    color: "#d8dee9",
    accent: "#2b3242",
    style: "rover",
  },
};

export const VEHICLE_ORDER: VehicleId[] = [
  "jeep",
  "sports",
  "truck",
  "bike",
  "rover",
];

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------
export const STAGES: Record<StageId, StageDef> = {
  country: {
    id: "country",
    name: "Countryside",
    blurb: "Gentle rolling green hills. A forgiving warm-up.",
    cost: 0,
    gravityScale: 1.0,
    rampDist: 900,
    rampMax: 1.15,
    amps: [54, 26, 13, 7],
    waves: [560, 250, 120, 62],
    ridge: 0.0,
    fuelRate: 0.22,
    palette: {
      skyTop: "#3a7bd5",
      skyBottom: "#bfe3ff",
      sun: "#fff7d6",
      far: "#6f9fd8",
      mid: "#4f7e3f",
      groundTop: "#6fb43e",
      groundBottom: "#27451a",
      surfaceLine: "#8fe053",
      dust: "#caa45a",
      decor: "#2f6d2a",
      hudAccent: "#ffd23f",
      flair: "clouds",
    },
  },
  desert: {
    id: "desert",
    name: "Dust Bowl",
    blurb: "Tan dunes and sharp ridges shimmering in the heat.",
    cost: 4000,
    gravityScale: 1.0,
    rampDist: 750,
    rampMax: 1.35,
    amps: [70, 34, 16, 8],
    waves: [620, 260, 130, 60],
    ridge: 0.35,
    fuelRate: 0.18,
    palette: {
      skyTop: "#f5a85c",
      skyBottom: "#ffe7b0",
      sun: "#fff1c2",
      far: "#d98f55",
      mid: "#c47a3e",
      groundTop: "#e8b66a",
      groundBottom: "#8a5a26",
      surfaceLine: "#ffd98f",
      dust: "#e8c07a",
      decor: "#9c6b34",
      hudAccent: "#ff9f1c",
      flair: "haze",
    },
  },
  moon: {
    id: "moon",
    name: "Lunar Base",
    blurb: "Low gravity, huge floaty jumps, deep craters under the stars.",
    cost: 12000,
    gravityScale: 0.34,
    rampDist: 650,
    rampMax: 1.5,
    amps: [96, 40, 18, 9],
    waves: [760, 300, 150, 70],
    ridge: 0.1,
    fuelRate: 0.14,
    palette: {
      skyTop: "#05060f",
      skyBottom: "#1a1f3a",
      sun: "#9fb4ff",
      far: "#3a416a",
      mid: "#555c7e",
      groundTop: "#9aa0b4",
      groundBottom: "#3c4154",
      surfaceLine: "#d7dcef",
      dust: "#aeb4c6",
      decor: "#6b7290",
      hudAccent: "#9fb4ff",
      flair: "stars",
    },
  },
  mountain: {
    id: "mountain",
    name: "Alpine Peaks",
    blurb: "Steep, spiky, snow-capped climbs. The ultimate test.",
    cost: 30000,
    gravityScale: 1.06,
    rampDist: 600,
    rampMax: 1.7,
    amps: [86, 44, 22, 12],
    waves: [520, 210, 110, 54],
    ridge: 0.45,
    fuelRate: 0.16,
    palette: {
      skyTop: "#2a3566",
      skyBottom: "#cfe0ef",
      sun: "#ffe9c2",
      far: "#7d90b8",
      mid: "#5a6b94",
      groundTop: "#eef4ff",
      groundBottom: "#6b7794",
      surfaceLine: "#ffffff",
      dust: "#eef4ff",
      decor: "#2d4a2e",
      hudAccent: "#8fd3ff",
      flair: "aurora",
    },
  },
};

export const STAGE_ORDER: StageId[] = ["country", "desert", "moon", "mountain"];

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------
export interface UpgradeDef {
  key: UpgradeKey;
  name: string;
  blurb: string;
  base: number; // base cost
}

export const UPGRADE_DEFS: UpgradeDef[] = [
  { key: "engine", name: "ENGINE", blurb: "More power & top speed", base: 220 },
  { key: "tires", name: "TIRES", blurb: "Grip, climbing & braking", base: 200 },
  { key: "suspension", name: "SUSPENSION", blurb: "Smoother landings", base: 210 },
  { key: "drive", name: "4WD", blurb: "Front-wheel drive for climbs", base: 300 },
  { key: "fuel", name: "FUEL TANK", blurb: "Bigger fuel capacity", base: 180 },
];

export const upgradeCost = (key: UpgradeKey, level: number): number => {
  const def = UPGRADE_DEFS.find((u) => u.key === key);
  const base = def ? def.base : 220;
  return Math.round(base * Math.pow(1.45, level));
};

export const defaultUpgrades = (): UpgradeLevels => ({
  engine: 0,
  tires: 0,
  suspension: 0,
  drive: 0,
  fuel: 0,
});

// ---------------------------------------------------------------------------
// Derive live tuning from a vehicle + its upgrades
// ---------------------------------------------------------------------------
export function deriveStats(
  vehicleId: VehicleId,
  upg: UpgradeLevels,
): DerivedStats {
  const v = VEHICLES[vehicleId];
  const engine = upg.engine;
  const tires = upg.tires;
  const susp = upg.suspension;
  const drive = upg.drive;
  const fuel = upg.fuel;

  const driveAccel = v.power * (1 + 0.12 * engine);
  const brakeAccel = v.brake * (1 + 0.05 * tires);
  const grip = v.grip * (1 + 0.1 * tires);
  const wheelVtMax = (640 + 60 * engine) * (1 + 0.05 * engine);
  const mass = v.mass;
  const inertia = mass * (160 + v.wheelBase * 8);
  const suspK = v.suspK * (1 + 0.08 * susp);
  const suspC = v.suspC * (1 + 0.1 * susp);
  const restLen = v.restLen * (1 + 0.04 * susp);
  const airTorque = 9 * v.airControl;
  const fwd = clamp(v.fwd + 0.09 * drive, 0, 1);
  const maxFuel = v.tank * (1 + 0.18 * fuel);

  return {
    driveAccel,
    brakeAccel,
    grip,
    wheelVtMax,
    mass,
    inertia,
    suspK,
    suspC,
    restLen,
    wheelR: v.wheelR,
    axleX: v.wheelBase / 2,
    axleY: v.axleY,
    airTorque,
    fuelUse: v.fuelUse,
    maxFuel,
    fwd,
  };
}

/** A 0..1 normalised rating used by the garage stat bars. */
export function vehicleRatings(v: VehicleDef): {
  power: number;
  grip: number;
  susp: number;
  speed: number;
  stability: number;
} {
  return {
    power: clamp((v.power - 700) / 400, 0, 1),
    grip: clamp((v.grip - 0.75) / 0.6, 0, 1),
    susp: clamp((v.suspK - 500) / 360, 0, 1),
    speed: clamp((v.power / v.mass - 130) / 200, 0, 1),
    stability: clamp((v.wheelBase - 40) / 60, 0, 1),
  };
}
