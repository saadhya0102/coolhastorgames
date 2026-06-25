/**
 * Hill Climb 2 — procedural terrain.
 * A deterministic, single-valued height function built from layered sinusoids,
 * with a flat launch pad and a difficulty ramp. Also owns the lazy pickup
 * stream and the deterministic decoration scatter.
 */
import { clamp, mulberry32 } from "@/engine";
import { METER, START_X } from "./config";
import type { Decoration, Pickup, StageDef } from "./types";

interface Layer {
  amp: number;
  freq: number;
  phase: number;
}

export class Terrain {
  readonly stage: StageDef;
  readonly seed: number;
  readonly baseY = 220;
  private layers: Layer[] = [];
  private rnd: () => number;

  // pickup stream
  pickups: Pickup[] = [];
  private spawnX: number;

  // decoration scatter
  decorations: Decoration[] = [];
  private decorX: number;

  constructor(stage: StageDef, seed: number) {
    this.stage = stage;
    this.seed = seed;
    this.rnd = mulberry32(seed);
    this.layers = stage.amps.map((amp, i) => ({
      amp,
      freq: (Math.PI * 2) / (stage.waves[i] * (0.85 + this.rnd() * 0.3)),
      phase: this.rnd() * Math.PI * 2,
    }));
    this.spawnX = START_X + 380;
    this.decorX = START_X + 200;
  }

  /** Amplitude envelope: flat launch pad then a ramp to full chaos. */
  private envelope(x: number): number {
    const flat = clamp((x - START_X) / 760, 0, 1);
    const m = Math.max(0, (x - START_X) / METER);
    const ramp = 0.55 + (this.stage.rampMax - 0.55) * clamp(m / this.stage.rampDist, 0, 1);
    return flat * ramp;
  }

  /** Ground height at world x (y grows downward). */
  height(x: number): number {
    let sum = 0;
    const ridge = this.stage.ridge;
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      let s = Math.sin(x * l.freq + l.phase);
      // sharpen the dominant layer into ridges for desert/mountain
      if (i === 0 && ridge > 0) {
        const sign = s < 0 ? -1 : 1;
        s = sign * Math.pow(Math.abs(s), 1 - ridge * 0.5);
      }
      sum += l.amp * s;
    }
    return this.baseY + sum * this.envelope(x);
  }

  /** Numerical slope dy/dx at world x. */
  slope(x: number): number {
    const e = 1.2;
    return (this.height(x + e) - this.height(x - e)) / (2 * e);
  }

  /** Generate pickups lazily up to a world x. */
  ensurePickups(uptoX: number): void {
    while (this.spawnX < uptoX) {
      const isFuel = this.rnd() < this.stage.fuelRate;
      if (!isFuel && this.rnd() < 0.4) {
        // a coin arc tracing a jump over the next stretch
        const count = 3 + Math.floor(this.rnd() * 4);
        const span = 90 + this.rnd() * 90;
        const arc = 36 + this.rnd() * 46;
        const startX = this.spawnX;
        for (let i = 0; i < count; i++) {
          const t = count > 1 ? i / (count - 1) : 0;
          const px = startX + t * span;
          const lift = Math.sin(t * Math.PI) * arc;
          this.pickups.push({
            x: px,
            y: this.height(px) - 30 - lift,
            kind: "coin",
            got: false,
            bob: this.rnd() * 6.28,
          });
        }
        this.spawnX = startX + span + 90 + this.rnd() * 120;
      } else {
        this.pickups.push({
          x: this.spawnX,
          y: this.height(this.spawnX) - 30,
          kind: isFuel ? "fuel" : "coin",
          got: false,
          bob: this.rnd() * 6.28,
        });
        this.spawnX += 120 + this.rnd() * 170;
      }
    }
  }

  /** Generate decorations lazily up to a world x. */
  ensureDecor(uptoX: number): void {
    while (this.decorX < uptoX) {
      this.decorations.push({
        x: this.decorX,
        kind: Math.floor(this.rnd() * 3),
        scale: 0.8 + this.rnd() * 0.6,
      });
      this.decorX += 160 + this.rnd() * 220;
    }
  }

  /** Drop pickups/decor that fell well behind the camera to bound memory. */
  cull(behindX: number): void {
    if (this.pickups.length > 64) {
      this.pickups = this.pickups.filter((p) => p.x > behindX && !p.got);
    }
    if (this.decorations.length > 80) {
      this.decorations = this.decorations.filter((d) => d.x > behindX);
    }
  }
}
