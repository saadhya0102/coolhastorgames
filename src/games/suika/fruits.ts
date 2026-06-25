/**
 * The fruit chain: 11 original tiers, smallest to largest. Radii are in world
 * units (world width = 1.0). Colors and decoration flags drive procedural
 * rendering. See PRD §4.
 */
import { CONFIG, MAX_TIER, type FruitTier } from "./types";

export const TIERS: readonly FruitTier[] = [
  {
    name: "Pip",
    r: 0.03,
    color: "#ff5d73",
    accent: "#c8324b",
    light: "#ffb0bb",
    leaf: false,
    stripes: false,
    net: false,
    dimples: false,
    face: true,
    spawnable: true,
  },
  {
    name: "Berry",
    r: 0.042,
    color: "#8a5cff",
    accent: "#5b34c4",
    light: "#c7b0ff",
    leaf: false,
    stripes: false,
    net: false,
    dimples: false,
    face: true,
    spawnable: true,
  },
  {
    name: "Grape",
    r: 0.056,
    color: "#7bd14f",
    accent: "#4f9b2e",
    light: "#c2ec9f",
    leaf: true,
    stripes: false,
    net: false,
    dimples: false,
    face: false,
    spawnable: true,
  },
  {
    name: "Kumquat",
    r: 0.072,
    color: "#ffae3b",
    accent: "#d9821a",
    light: "#ffd699",
    leaf: false,
    stripes: false,
    net: false,
    dimples: true,
    face: true,
    spawnable: true,
  },
  {
    name: "Lemon",
    r: 0.09,
    color: "#ffe14d",
    accent: "#d8b62a",
    light: "#fff3a8",
    leaf: false,
    stripes: false,
    net: false,
    dimples: true,
    face: false,
    spawnable: true,
  },
  {
    name: "Tangerine",
    r: 0.11,
    color: "#ff8c34",
    accent: "#d9631a",
    light: "#ffc190",
    leaf: true,
    stripes: false,
    net: false,
    dimples: true,
    face: true,
    spawnable: false,
  },
  {
    name: "Apple",
    r: 0.132,
    color: "#ff4d57",
    accent: "#c22b39",
    light: "#ffa9af",
    leaf: true,
    stripes: false,
    net: false,
    dimples: false,
    face: false,
    spawnable: false,
  },
  {
    name: "Peach",
    r: 0.156,
    color: "#ff9aa8",
    accent: "#e06a86",
    light: "#ffd2da",
    leaf: true,
    stripes: false,
    net: false,
    dimples: false,
    face: true,
    spawnable: false,
  },
  {
    name: "Pomelo",
    r: 0.182,
    color: "#c7e06a",
    accent: "#95b23f",
    light: "#e7f3b4",
    leaf: false,
    stripes: false,
    net: false,
    dimples: true,
    face: false,
    spawnable: false,
  },
  {
    name: "Melon",
    r: 0.21,
    color: "#6fce8f",
    accent: "#3f9d68",
    light: "#b6e8c6",
    leaf: false,
    stripes: false,
    net: true,
    dimples: false,
    face: false,
    spawnable: false,
  },
  {
    name: "Sunmelon",
    r: 0.24,
    color: "#25b15a",
    accent: "#176e39",
    light: "#5fd389",
    leaf: true,
    stripes: true,
    net: false,
    dimples: false,
    face: true,
    spawnable: false,
  },
];

/** Spawn weights for tiers 0..SPAWN_MAX_TIER (bias toward small fruit). */
const SPAWN_WEIGHTS: readonly number[] = [0.3, 0.26, 0.2, 0.14, 0.1];

/** Pick a random spawnable tier index, weighted toward smaller fruit. */
export function rollSpawnTier(): number {
  const max = CONFIG.SPAWN_MAX_TIER;
  let total = 0;
  for (let i = 0; i <= max; i++) total += SPAWN_WEIGHTS[i] ?? 0;
  let roll = Math.random() * total;
  for (let i = 0; i <= max; i++) {
    roll -= SPAWN_WEIGHTS[i] ?? 0;
    if (roll <= 0) return i;
  }
  return 0;
}

export function radiusOf(tier: number): number {
  return TIERS[tier].r;
}

/** Triangular scoring on the produced tier (see PRD §9). */
export function scoreForTier(producedTier: number): number {
  return (producedTier * (producedTier + 1)) / 2;
}

/** Pleasant ascending pitch (Hz) for the merge sfx, keyed by produced tier. */
export function mergePitch(producedTier: number): number {
  // C major-ish scale climbing with tier; clamps within an audible, cute range.
  const base = 330;
  const semis = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const s = semis[Math.min(producedTier, semis.length - 1)] ?? 0;
  return base * Math.pow(2, s / 12);
}

export { MAX_TIER };
