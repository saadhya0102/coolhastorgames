import type { ItemDef, PlayerStats } from "./types";

/** Permanent run upgrades. Effects mutate the player's stat block. */
export const ITEMS: ItemDef[] = [
  {
    id: "ember",
    name: "Ember Shard",
    blurb: "+1 damage",
    weight: 10,
    apply: (s) => {
      s.damage += 1;
    },
  },
  {
    id: "fuse",
    name: "Quick Fuse",
    blurb: "Faster fire",
    weight: 9,
    apply: (s) => {
      s.fireDelay = Math.max(0.1, s.fireDelay - 0.07);
    },
  },
  {
    id: "boots",
    name: "Swift Boots",
    blurb: "+ Move speed",
    weight: 9,
    apply: (s) => {
      s.moveSpeed += 0.9;
    },
  },
  {
    id: "lens",
    name: "Split Lens",
    blurb: "+1 shot",
    weight: 6,
    apply: (s) => {
      s.shotCount += 1;
    },
  },
  {
    id: "pierce",
    name: "Piercing Bolt",
    blurb: "Shots pierce +1",
    weight: 6,
    apply: (s) => {
      s.piercing += 1;
    },
  },
  {
    id: "wick",
    name: "Long Wick",
    blurb: "+ Range & speed",
    weight: 8,
    apply: (s) => {
      s.range += 0.6;
      s.shotSpeed += 1.5;
    },
  },
  {
    id: "locket",
    name: "Heart Locket",
    blurb: "+1 heart container",
    weight: 7,
    apply: (s) => {
      s.maxHp += 2;
      s.hp = Math.min(s.maxHp, s.hp + 2);
    },
  },
  {
    id: "lucky",
    name: "Lucky Coin",
    blurb: "+ Luck & coins",
    weight: 6,
    apply: (s) => {
      s.luck += 1;
      s.coins += 5;
    },
  },
  {
    id: "twin",
    name: "Twin Sparks",
    blurb: "+1 shot, faster fire",
    weight: 3,
    apply: (s) => {
      s.shotCount += 1;
      s.fireDelay = Math.max(0.1, s.fireDelay - 0.03);
    },
  },
  {
    id: "glass",
    name: "Glass Cannon",
    blurb: "+3 damage, -1 heart",
    weight: 2,
    apply: (s) => {
      s.damage += 3;
      s.maxHp = Math.max(2, s.maxHp - 2);
      s.hp = Math.min(s.hp, s.maxHp);
    },
  },
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): ItemDef | undefined {
  return BY_ID.get(id);
}

export function applyItem(id: string, stats: PlayerStats): ItemDef | undefined {
  const def = BY_ID.get(id);
  if (def) def.apply(stats);
  return def;
}

/** Weighted random item id, optionally excluding some ids. rand() ∈ [0,1). */
export function rollItemId(
  rand: () => number,
  exclude: Set<string> = new Set(),
): string {
  const pool = ITEMS.filter((i) => !exclude.has(i.id));
  const list = pool.length ? pool : ITEMS;
  let total = 0;
  for (const i of list) total += i.weight;
  let r = rand() * total;
  for (const i of list) {
    r -= i.weight;
    if (r <= 0) return i.id;
  }
  return list[list.length - 1].id;
}
