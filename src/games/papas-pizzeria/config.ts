import { clamp } from "@/engine";
import type {
  DayProfile,
  ToppingDef,
  ToppingId,
  UpgradeDef,
  UpgradeId,
} from "./types";

/** Central palette for the whole game. */
export const PALETTE = {
  wall: "#f4e3c8",
  wallDark: "#e7cfa6",
  wood: "#7a4a25",
  woodDark: "#5e3417",
  woodLight: "#9c6336",
  counter: "#c9883f",
  counterTop: "#e3a85a",
  tile: "#fff6e6",
  tileLine: "#e0c79a",
  brick: "#b4543a",
  brickDark: "#8c3c28",
  ovenMouth: "#2a140c",
  flame: "#ff9c2a",
  flameHot: "#ffd84d",
  tomato: "#e6452f",
  tomatoDark: "#c0301f",
  cheese: "#f2c14e",
  cheeseLight: "#f6d579",
  crust: "#e8b765",
  crustRaw: "#f2d49a",
  crustDark: "#9c6b2e",
  basil: "#4c9a3a",
  cream: "#fff3df",
  ink: "#3a2418",
  inkSoft: "#6b4a33",
  accent: "#ff6b3d",
  accent2: "#ffb03a",
  green: "#46c46a",
  amber: "#ffb53a",
  red: "#ec4d3c",
  panel: "#fffdf7",
  panelEdge: "#d8b483",
  shadow: "rgba(58,36,24,0.28)",
} as const;

/** Topping catalogue — all art is procedural; see pizza.ts for drawKind. */
export const TOPPINGS: Record<ToppingId, ToppingDef> = {
  pepperoni: { id: "pepperoni", name: "Pepperoni", short: "Pep", color: "#c4362a", accent: "#e0584a", drawKind: "disc", size: 1 },
  mushroom: { id: "mushroom", name: "Mushroom", short: "Mush", color: "#e7d5b5", accent: "#b9a079", drawKind: "cap", size: 1.05 },
  pepper: { id: "pepper", name: "Green Pepper", short: "Pepr", color: "#3fa34d", accent: "#2c7d38", drawKind: "arc", size: 1.1 },
  olive: { id: "olive", name: "Black Olive", short: "Oliv", color: "#33312f", accent: "#56524d", drawKind: "ring", size: 0.78 },
  onion: { id: "onion", name: "Onion", short: "Onin", color: "#efe4f0", accent: "#c9a9d6", drawKind: "ring", size: 1.15 },
  sausage: { id: "sausage", name: "Sausage", short: "Saus", color: "#8a5230", accent: "#a8693f", drawKind: "disc", size: 0.85 },
  bacon: { id: "bacon", name: "Bacon", short: "Bcn", color: "#b8503f", accent: "#e9c0a0", drawKind: "strip", size: 1.1 },
  pineapple: { id: "pineapple", name: "Pineapple", short: "Pine", color: "#f4d44e", accent: "#e0b232", drawKind: "chunk", size: 0.9 },
  ham: { id: "ham", name: "Ham", short: "Ham", color: "#e89aa4", accent: "#d2727f", drawKind: "chunk", size: 1 },
  jalapeno: { id: "jalapeno", name: "Jalapeño", short: "Jal", color: "#4faa3c", accent: "#357a26", drawKind: "ring", size: 0.7 },
};

export const TOPPING_ORDER: ToppingId[] = [
  "pepperoni",
  "mushroom",
  "pepper",
  "onion",
  "olive",
  "sausage",
  "bacon",
  "ham",
  "pineapple",
  "jalapeno",
];

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  oven_speed: { id: "oven_speed", name: "Faster Oven", desc: "Bakes slower & steadier — bigger timing window.", icon: "oven", baseCost: 55, costGrowth: 1.7, maxLevel: 3 },
  oven_slots: { id: "oven_slots", name: "Extra Rack", desc: "Bake more pizzas at once (+1 slot).", icon: "rack", baseCost: 90, costGrowth: 2.2, maxLevel: 2 },
  tray_quick: { id: "tray_quick", name: "Prepped Tray", desc: "Snappier topping placement & wider drop area.", icon: "tray", baseCost: 45, costGrowth: 1.6, maxLevel: 3 },
  seats: { id: "seats", name: "Comfy Seats", desc: "Customers arrive with more patience.", icon: "seat", baseCost: 50, costGrowth: 1.7, maxLevel: 3 },
  decor: { id: "decor", name: "Cozy Decor", desc: "Nice vibes — patience drains slower.", icon: "decor", baseCost: 60, costGrowth: 1.8, maxLevel: 3 },
  cutter: { id: "cutter", name: "Sharp Cutter", desc: "More forgiving slice evenness.", icon: "cutter", baseCost: 40, costGrowth: 1.6, maxLevel: 3 },
  sauce_auto: { id: "sauce_auto", name: "Signature Sauce", desc: "Premium base — small quality bonus on every pie.", icon: "sauce", baseCost: 70, costGrowth: 1, maxLevel: 1 },
  marketing: { id: "marketing", name: "Marketing", desc: "Famous pizzeria — fatter tips.", icon: "mega", baseCost: 65, costGrowth: 1.9, maxLevel: 3 },
};

export const UPGRADE_ORDER: UpgradeId[] = [
  "oven_speed",
  "oven_slots",
  "tray_quick",
  "seats",
  "decor",
  "cutter",
  "marketing",
  "sauce_auto",
];

/** Economy + tuning constants. */
export const TUNING = {
  basePrice: 12,
  pricePerDay: 1.5,
  tipMax: 0.9,
  /** floor of how much a botched-but-served pie still earns (fraction of pay) */
  payFloor: 0.25,
  bakeDuration: 9, // seconds to fill 0..1 at base oven speed
  bakeBandWidth: 0.16,
  bakeTolerance: 0.22, // falloff distance outside the band
  patienceBaseDay1: 42,
  patiencePerDay: -2.5,
  patienceFloor: 16,
  arrivalBaseDay1: 6.5,
  arrivalPerDay: -0.35,
  arrivalFloor: 2.4,
} as const;

export const upgradeCost = (id: UpgradeId, level: number): number => {
  const def = UPGRADES[id];
  return Math.round(def.baseCost * Math.pow(def.costGrowth, level));
};

export const emptyUpgrades = (): Record<UpgradeId, number> => ({
  oven_speed: 0,
  oven_slots: 0,
  tray_quick: 0,
  seats: 0,
  decor: 0,
  cutter: 0,
  sauce_auto: 0,
  marketing: 0,
});

/** Derived per-day difficulty profile, computed from formulas. */
export function makeDayProfile(day: number): DayProfile {
  const customers = 4 + day; // day1 = 5
  const minToppings = clamp(1 + Math.floor((day - 1) / 3), 1, 3);
  const maxToppings = clamp(2 + Math.floor((day - 1) / 2), 2, 5);
  const bandWidth = clamp(TUNING.bakeBandWidth - (day - 1) * 0.008, 0.08, 0.18);
  const sliceChoices =
    day <= 2 ? [2, 4] : day <= 4 ? [4, 6] : day <= 6 ? [4, 6, 8] : [6, 8, 10, 12];
  const patience = clamp(
    TUNING.patienceBaseDay1 + (day - 1) * TUNING.patiencePerDay,
    TUNING.patienceFloor,
    TUNING.patienceBaseDay1,
  );
  const arrivalInterval = clamp(
    TUNING.arrivalBaseDay1 + (day - 1) * TUNING.arrivalPerDay,
    TUNING.arrivalFloor,
    TUNING.arrivalBaseDay1,
  );
  const quota = Math.round((30 + day * 26) * (1 + (day - 1) * 0.05));
  return {
    day,
    customers,
    maxToppings,
    minToppings,
    bandWidth,
    sliceChoices,
    patience,
    arrivalInterval,
    quota,
  };
}
