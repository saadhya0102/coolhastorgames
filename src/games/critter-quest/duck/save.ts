import type { GameStorage } from "@/engine";
import { clamp } from "@/engine";

/** The three trainable disciplines. */
export type Discipline = "run" | "swim" | "fly";

export type HatKind = "none" | "cap" | "goggles" | "aviator" | "visor" | "crown";

export interface HatDef {
  id: string;
  name: string;
  /** stat boosted, or null for an all-round boost */
  stat: Discipline | null;
  boost: number;
  cost: number;
  hat: HatKind;
  color: string;
}

export interface FoodDef {
  id: string;
  name: string;
  energy: number;
  cost: number;
  color: string;
}

export interface SaveData {
  version: number;
  hatched: boolean;

  run: number;
  swim: number;
  fly: number;
  runXp: number;
  swimXp: number;
  flyXp: number;

  coins: number;
  energy: number;
  lastEnergyTs: number;

  league: number;
  bestLeague: number;

  owned: string[];
  equipped: string | null;

  bestPower: number;
  races: number;
  wins: number;
}

export const SAVE_VERSION = 1;
export const MAX_ENERGY = 100;
export const TRAIN_COST = 15;
export const ENERGY_REGEN_SECONDS = 18;
export const LEAGUE_COUNT = 4;

export const LEAGUE_NAMES = [
  "Pond Cup",
  "River Rapids",
  "Mountain Lake",
  "Sky Marathon",
];

export const DISCIPLINES: Discipline[] = ["run", "swim", "fly"];
export const DISC_NAME: Record<Discipline, string> = {
  run: "Running",
  swim: "Swimming",
  fly: "Flying",
};

export const FOODS: FoodDef[] = [
  { id: "crumb", name: "Bread Crumbs", energy: 25, cost: 12, color: "#e8c486" },
  { id: "worm", name: "Juicy Worm", energy: 55, cost: 26, color: "#ff8a6b" },
  { id: "feast", name: "Royal Feast", energy: MAX_ENERGY, cost: 55, color: "#ffd24a" },
];

export const HATS: HatDef[] = [
  { id: "cap", name: "Speed Cap", stat: "run", boost: 2, cost: 70, hat: "cap", color: "#ff5b6e" },
  { id: "goggles", name: "Dive Goggles", stat: "swim", boost: 2, cost: 70, hat: "goggles", color: "#36b6ff" },
  { id: "aviator", name: "Aviator Cap", stat: "fly", boost: 2, cost: 70, hat: "aviator", color: "#8a6a4a" },
  { id: "visor", name: "Sun Visor", stat: null, boost: 1, cost: 150, hat: "visor", color: "#39d98a" },
  { id: "crown", name: "Golden Crown", stat: null, boost: 3, cost: 340, hat: "crown", color: "#ffd24a" },
];

const KEY = "save";

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    hatched: false,
    run: 1,
    swim: 1,
    fly: 1,
    runXp: 0,
    swimXp: 0,
    flyXp: 0,
    coins: 40,
    energy: MAX_ENERGY,
    lastEnergyTs: Date.now(),
    league: 0,
    bestLeague: 0,
    owned: [],
    equipped: null,
    bestPower: 0,
    races: 0,
    wins: 0,
  };
}

export function loadSave(storage: GameStorage): SaveData {
  const stored = storage.get<Partial<SaveData>>(KEY, {});
  const save: SaveData = { ...defaultSave(), ...stored };
  // validate equipped against owned
  if (save.equipped && !save.owned.includes(save.equipped)) save.equipped = null;
  save.league = clamp(save.league, 0, LEAGUE_COUNT - 1);
  save.bestLeague = clamp(save.bestLeague, 0, LEAGUE_COUNT - 1);
  return save;
}

export function persist(storage: GameStorage, d: SaveData): void {
  storage.set(KEY, d);
}

/** XP required to advance FROM level L to L+1. */
export function xpForLevel(level: number): number {
  return Math.round(12 + level * 7 + level * level * 0.6);
}

export function statLevel(d: SaveData, disc: Discipline): number {
  return disc === "run" ? d.run : disc === "swim" ? d.swim : d.fly;
}

export function statXp(d: SaveData, disc: Discipline): number {
  return disc === "run" ? d.runXp : disc === "swim" ? d.swimXp : d.flyXp;
}

/** Leaderboard score = sum of stat levels. */
export function power(d: SaveData): number {
  return d.run + d.swim + d.fly;
}

export function equippedHat(d: SaveData): HatDef | null {
  return HATS.find((h) => h.id === d.equipped) ?? null;
}

/** Effective stat including the equipped hat, used for racing. */
export function effectiveStat(d: SaveData, disc: Discipline): number {
  let v = statLevel(d, disc);
  const hat = equippedHat(d);
  if (hat) {
    if (hat.stat === disc) v += hat.boost;
    else if (hat.stat === null) v += hat.boost;
  }
  return v;
}

/** Add XP to a discipline; returns number of levels gained. */
export function addXp(d: SaveData, disc: Discipline, amount: number): number {
  let levels = 0;
  let xp = statXp(d, disc) + amount;
  let lvl = statLevel(d, disc);
  while (xp >= xpForLevel(lvl)) {
    xp -= xpForLevel(lvl);
    lvl += 1;
    levels += 1;
  }
  if (disc === "run") {
    d.run = lvl;
    d.runXp = xp;
  } else if (disc === "swim") {
    d.swim = lvl;
    d.swimXp = xp;
  } else {
    d.fly = lvl;
    d.flyXp = xp;
  }
  return levels;
}

export function coinsFromXp(xp: number): number {
  return Math.round(xp * 1.2);
}

/** Apply real-time energy regeneration. Mutates + returns the save. */
export function regenEnergy(d: SaveData, now = Date.now()): SaveData {
  if (d.energy >= MAX_ENERGY) {
    d.lastEnergyTs = now;
    return d;
  }
  const elapsed = (now - d.lastEnergyTs) / 1000;
  const gained = Math.floor(elapsed / ENERGY_REGEN_SECONDS);
  if (gained > 0) {
    d.energy = clamp(d.energy + gained, 0, MAX_ENERGY);
    d.lastEnergyTs = d.lastEnergyTs + gained * ENERGY_REGEN_SECONDS * 1000;
    if (d.energy >= MAX_ENERGY) d.lastEnergyTs = now;
  }
  return d;
}

export function secondsToNextEnergy(d: SaveData, now = Date.now()): number {
  if (d.energy >= MAX_ENERGY) return 0;
  const elapsed = (now - d.lastEnergyTs) / 1000;
  return Math.max(0, ENERGY_REGEN_SECONDS - (elapsed % ENERGY_REGEN_SECONDS));
}

/** Growth stage 0..4 derived from total Power (drives duck size + detail). */
export function growthStage(d: SaveData): number {
  const p = power(d);
  if (p >= 60) return 4;
  if (p >= 36) return 3;
  if (p >= 18) return 2;
  if (p >= 8) return 1;
  return 0;
}

/** Race coin payout by placement (0 = 1st). */
export function racePayout(place: number, league: number): number {
  switch (place) {
    case 0:
      return 60 + league * 40;
    case 1:
      return 35 + league * 22;
    case 2:
      return 18 + league * 12;
    default:
      return 8 + league * 6;
  }
}
