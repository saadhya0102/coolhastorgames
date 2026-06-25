import { BALANCE } from "./config";
import type { EnemyKind, SpawnGroup, Wave } from "./types";

/** Lightweight builder for a spawn group; hp/bounty muls are filled per-wave. */
interface GroupSpec {
  type: EnemyKind;
  count: number;
  spacing?: number;
  delay?: number;
}

/**
 * Hand-tuned composition arc across 20 waves. Early waves teach single types,
 * mid waves mix fast + armored, later waves add flyers and swarms, and bosses
 * land on 10 / 15 / 20. HP and bounty scale with the wave index.
 */
const SCRIPT: GroupSpec[][] = [
  // 1 — gentle intro
  [{ type: "grub", count: 8, spacing: 0.9 }],
  // 2 — a few faster ones
  [
    { type: "grub", count: 10, spacing: 0.8 },
    { type: "sprinter", count: 4, spacing: 0.7, delay: 4 },
  ],
  // 3 — first taste of armor
  [
    { type: "grub", count: 8, spacing: 0.7 },
    { type: "brute", count: 2, spacing: 1.6, delay: 3 },
  ],
  // 4 — swarm pressure
  [
    { type: "swarmling", count: 16, spacing: 0.28 },
    { type: "grub", count: 6, spacing: 0.7, delay: 6 },
  ],
  // 5 — flyers appear
  [
    { type: "wisp", count: 6, spacing: 0.8 },
    { type: "grub", count: 8, spacing: 0.6, delay: 2 },
  ],
  // 6 — fast + armored squeeze
  [
    { type: "sprinter", count: 10, spacing: 0.45 },
    { type: "brute", count: 3, spacing: 1.4, delay: 2 },
  ],
  // 7 — mixed bag
  [
    { type: "grub", count: 10, spacing: 0.5 },
    { type: "wisp", count: 6, spacing: 0.7, delay: 3 },
    { type: "swarmling", count: 14, spacing: 0.22, delay: 7 },
  ],
  // 8 — armor column
  [
    { type: "brute", count: 6, spacing: 1.1 },
    { type: "sprinter", count: 8, spacing: 0.4, delay: 4 },
  ],
  // 9 — pre-boss flood
  [
    { type: "swarmling", count: 24, spacing: 0.18 },
    { type: "wisp", count: 8, spacing: 0.6, delay: 3 },
    { type: "grub", count: 10, spacing: 0.45, delay: 6 },
  ],
  // 10 — WARDEN mini-boss
  [
    { type: "grub", count: 8, spacing: 0.5 },
    { type: "warden", count: 1, delay: 4 },
    { type: "sprinter", count: 8, spacing: 0.4, delay: 6 },
  ],
  // 11 — flyers + armor
  [
    { type: "wisp", count: 12, spacing: 0.5 },
    { type: "brute", count: 5, spacing: 1.1, delay: 2 },
  ],
  // 12 — relentless swarm
  [
    { type: "swarmling", count: 30, spacing: 0.15 },
    { type: "sprinter", count: 12, spacing: 0.35, delay: 5 },
  ],
  // 13 — heavy mix
  [
    { type: "brute", count: 7, spacing: 0.9 },
    { type: "wisp", count: 10, spacing: 0.5, delay: 3 },
    { type: "grub", count: 12, spacing: 0.4, delay: 5 },
  ],
  // 14 — air raid
  [
    { type: "wisp", count: 18, spacing: 0.4 },
    { type: "swarmling", count: 20, spacing: 0.16, delay: 4 },
  ],
  // 15 — DOUBLE WARDEN
  [
    { type: "warden", count: 2, spacing: 5, delay: 2 },
    { type: "sprinter", count: 14, spacing: 0.3, delay: 4 },
    { type: "wisp", count: 10, spacing: 0.45, delay: 8 },
  ],
  // 16 — armor wall
  [
    { type: "brute", count: 10, spacing: 0.8 },
    { type: "swarmling", count: 24, spacing: 0.15, delay: 4 },
  ],
  // 17 — everything, fast
  [
    { type: "sprinter", count: 16, spacing: 0.3 },
    { type: "wisp", count: 12, spacing: 0.4, delay: 3 },
    { type: "brute", count: 6, spacing: 1.0, delay: 5 },
  ],
  // 18 — swarm + air storm
  [
    { type: "swarmling", count: 40, spacing: 0.12 },
    { type: "wisp", count: 16, spacing: 0.35, delay: 5 },
  ],
  // 19 — last stand before the Titan
  [
    { type: "warden", count: 1, delay: 1 },
    { type: "brute", count: 8, spacing: 0.8, delay: 3 },
    { type: "sprinter", count: 18, spacing: 0.28, delay: 6 },
    { type: "wisp", count: 14, spacing: 0.4, delay: 9 },
  ],
  // 20 — RIFT TITAN finale
  [
    { type: "swarmling", count: 30, spacing: 0.14 },
    { type: "brute", count: 6, spacing: 0.9, delay: 4 },
    { type: "wisp", count: 12, spacing: 0.4, delay: 6 },
    { type: "titan", count: 1, delay: 9 },
  ],
];

const BOSS_KINDS: ReadonlySet<EnemyKind> = new Set(["warden", "titan"]);

export function generateWaves(): Wave[] {
  return SCRIPT.map((specs, i) => {
    const wave = i + 1;
    const hpMul = 1 + (wave - 1) * BALANCE.hpGrowth;
    const bountyMul = 1 + (wave - 1) * BALANCE.bountyGrowth;
    let boss = false;
    const groups: SpawnGroup[] = specs.map((s) => {
      if (BOSS_KINDS.has(s.type)) boss = true;
      return {
        type: s.type,
        count: s.count,
        spacing: s.spacing ?? 0.6,
        delay: s.delay ?? 0,
        hpMul,
        bountyMul,
      };
    });
    return { groups, boss };
  });
}
