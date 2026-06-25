/**
 * Wave-based spawner + difficulty curve.
 *
 * Fruit is tossed in short clustered *waves* with rest gaps between them so the
 * player gets satisfying multi-fruit combo swipes. Difficulty grows with
 * elapsed time: bigger waves, shorter gaps, faster launches and more bombs.
 *
 * Launch physics: an object starts just below the bottom edge and is given an
 * upward velocity tuned so its apex lands in the upper play area, plus a
 * horizontal velocity that drifts it toward the centre so it stays reachable.
 */
import type { Fruit, FruitDef, FruitKind, Mode, World } from "./types";
import {
  GRAVITY_K,
  FRUIT_R_K,
  GRACE_TIME,
  MAX_OBJECTS,
  rand,
  randInt,
  chance,
  pick,
} from "./types";
import { FRUIT_DEFS, NORMAL_FRUIT } from "./fruits";

export interface SpawnTuning {
  /** 0 (easy) .. 1 (hard) */
  difficulty: number;
  waveMin: number;
  waveMax: number;
  gapMin: number;
  gapMax: number;
  speedScale: number;
  bombChance: number;
  goldenChance: number;
}

/** A queued launch within the current wave's staggered burst. */
interface SpawnSpec {
  kind: FruitKind;
  golden: boolean;
}

export class Spawner {
  private gap = 1.0;
  private burst: SpawnSpec[] = [];
  private burstTimer = 0;
  private frenzyTimer = 0;
  private speedScale = 1;

  constructor(private mode: Mode) {}

  reset(): void {
    this.gap = 1.0;
    this.burst = [];
    this.burstTimer = 0;
    this.frenzyTimer = 0;
    this.speedScale = 1;
  }

  get frenzyActive(): boolean {
    return this.frenzyTimer > 0;
  }

  /** Trigger a temporary "frenzy" of rapid bomb-free waves (Arcade power-up). */
  startFrenzy(seconds: number): void {
    this.frenzyTimer = Math.max(this.frenzyTimer, seconds);
  }

  tuning(elapsed: number): SpawnTuning {
    const d = Math.min(1, elapsed / 75);
    const inGrace = elapsed < GRACE_TIME;
    const arcade = this.mode === "arcade";
    const zen = this.mode === "zen";
    return {
      difficulty: d,
      waveMin: Math.round(1 + d * 1.5) + (arcade ? 1 : 0),
      waveMax: Math.round(2 + d * 3.5) + (arcade ? 1 : 0),
      gapMin: Math.max(0.45, 1.3 - d * 0.85) * (arcade ? 0.7 : 1),
      gapMax: Math.max(0.8, 2.0 - d * 1.2) * (arcade ? 0.7 : 1),
      speedScale: 1 + d * 0.32,
      bombChance: zen || inGrace ? 0 : Math.min(0.16, 0.03 + d * 0.13) * (arcade ? 1.1 : 1),
      goldenChance: 0.03 + d * 0.03,
    };
  }

  /**
   * Advance wave timing and return any fruit to add this frame.
   * `liveCount` is the number of objects already on screen (object cap).
   */
  update(dt: number, world: World, elapsed: number, liveCount: number): Fruit[] {
    const out: Fruit[] = [];
    const tune = this.tuning(elapsed);
    this.speedScale = tune.speedScale;
    if (this.frenzyTimer > 0) this.frenzyTimer -= dt;

    // dispatch any queued launches in the current burst
    if (this.burst.length > 0) {
      this.burstTimer -= dt;
      while (this.burst.length > 0 && this.burstTimer <= 0) {
        const spec = this.burst.shift() as SpawnSpec;
        if (liveCount + out.length < MAX_OBJECTS) {
          out.push(this.launch(world, FRUIT_DEFS[spec.kind], spec.golden));
        }
        this.burstTimer += rand(0.06, 0.16);
      }
      return out;
    }

    // count down to the next wave
    this.gap -= dt;
    if (this.gap > 0) return out;

    // schedule a new wave
    if (liveCount >= MAX_OBJECTS - 1) {
      this.gap = 0.4; // screen busy: wait a touch
      return out;
    }
    const frenzy = this.frenzyTimer > 0;
    const size = frenzy ? randInt(3, 6) : randInt(tune.waveMin, tune.waveMax);
    const specs: SpawnSpec[] = [];
    for (let i = 0; i < size; i++) specs.push(this.chooseSpec(tune, frenzy));
    // optionally turn ONE item into a bomb — never the whole wave, and only
    // when there is at least one real fruit alongside it.
    if (!frenzy && specs.length >= 2 && chance(this.bombWaveChance(tune))) {
      const bombs = randInt(1, Math.max(1, Math.floor(specs.length / 3)));
      const idxs = shuffleIndices(specs.length).slice(0, bombs);
      for (const idx of idxs) {
        if (idxs.length < specs.length) specs[idx] = { kind: "bomb", golden: false };
      }
    }
    // launch the first immediately, stagger the rest
    out.push(this.launch(world, FRUIT_DEFS[specs[0].kind], specs[0].golden));
    for (let i = 1; i < specs.length; i++) this.burst.push(specs[i]);
    this.burstTimer = rand(0.08, 0.18);
    this.gap = rand(tune.gapMin, tune.gapMax);
    return out;
  }

  private bombWaveChance(tune: SpawnTuning): number {
    return Math.min(0.7, tune.bombChance * 5);
  }

  private chooseSpec(tune: SpawnTuning, frenzy: boolean): SpawnSpec {
    if (!frenzy && this.mode === "arcade" && chance(0.05)) {
      return { kind: pick(["freeze", "double", "frenzy"] as FruitKind[]), golden: false };
    }
    const kind = pickWeighted();
    return { kind, golden: chance(tune.goldenChance) };
  }

  private launch(world: World, def: FruitDef, golden: boolean): Fruit {
    const { w, h, min } = world;
    const g = GRAVITY_K * h;
    const radius = FRUIT_R_K * min * def.sizeMul * (golden ? 1.05 : 1);
    const apexY = rand(0.16, 0.34) * h;
    const startY = h + radius;
    const rise = startY - apexY;
    const vy = -Math.sqrt(2 * g * rise) * this.speedScale;
    const timeToApex = -vy / g;
    const x = rand(w * 0.12, w * 0.88);
    const targetX = w * rand(0.3, 0.7);
    let vx = (targetX - x) / Math.max(0.3, timeToApex);
    const vxCap = w * 0.45;
    vx = Math.max(-vxCap, Math.min(vxCap, vx));
    return {
      def,
      x,
      y: startY,
      vx,
      vy,
      radius,
      angle: rand(0, Math.PI * 2),
      spin: rand(-3, 3),
      sliced: false,
      golden: golden && !def.special,
      pastApex: false,
      wobble: rand(0, 10),
      seed: (Math.random() * 1e9) | 0,
    };
  }
}

function shuffleIndices(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Weighted pick among normal fruit by their spawn weights. */
function pickWeighted(): FruitKind {
  let total = 0;
  for (const k of NORMAL_FRUIT) total += FRUIT_DEFS[k].weight;
  let r = Math.random() * total;
  for (const k of NORMAL_FRUIT) {
    r -= FRUIT_DEFS[k].weight;
    if (r <= 0) return k;
  }
  return "apple";
}
