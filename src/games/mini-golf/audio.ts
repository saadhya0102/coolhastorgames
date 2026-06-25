/**
 * Putt Park — sound design wrappers around the engine AudioManager.
 *
 * Every sound is synthesized (no asset files). Some events (wall thunks) are
 * throttled so a fast multi-bounce sequence doesn't machine-gun the speakers.
 */

import type { AudioManager } from "@/engine";
import { clamp } from "@/engine";

export class Sfx {
  private lastWall = 0;
  private now = 0;

  constructor(private audio: AudioManager) {}

  /** advance the internal clock (used for throttling) */
  tick(dt: number): void {
    this.now += dt;
  }

  /** Putt: rising sweep, louder/brighter with power (0..1). */
  putt(power: number): void {
    const p = clamp(power, 0, 1);
    this.audio.sweep(180 + p * 120, 520 + p * 380, 0.16, "triangle", 0.25 + p * 0.25);
    this.audio.tone(140 + p * 60, 0.05, "sine", 0.2);
  }

  /** Wall thunk; pitch & volume scale with impact speed. Throttled. */
  wall(impact: number): void {
    if (this.now - this.lastWall < 0.04) return;
    this.lastWall = this.now;
    const v = clamp(impact / 900, 0.06, 0.5);
    this.audio.tone(110 + impact * 0.18, 0.07, "sine", v);
    if (impact > 400) this.audio.noise(0.05, v * 0.4);
  }

  bumper(impact: number): void {
    const v = clamp(impact / 700, 0.15, 0.55);
    this.audio.tone(560, 0.09, "square", v);
    setTimeout(() => this.audio.tone(820, 0.07, "square", v * 0.8), 35);
  }

  mover(impact: number): void {
    const v = clamp(impact / 900, 0.1, 0.45);
    this.audio.tone(90, 0.1, "sawtooth", v);
  }

  sand(): void {
    this.audio.noise(0.16, 0.18);
  }

  water(): void {
    this.audio.sweep(420, 90, 0.28, "sine", 0.35);
    this.audio.noise(0.22, 0.25);
  }

  /** The cup drop; bigger fanfare for better results (relative to par). */
  sink(relative: number): void {
    this.audio.tone(740, 0.08, "sine", 0.4);
    setTimeout(() => this.audio.tone(520, 0.12, "sine", 0.4), 90);
    if (relative <= 0) {
      const notes = relative <= -1 ? [659, 784, 988, 1319] : [523, 659, 784];
      notes.forEach((f, i) =>
        setTimeout(() => this.audio.tone(f, 0.14, "triangle", 0.35), 160 + i * 110),
      );
    }
  }

  ui(): void {
    this.audio.tone(660, 0.05, "square", 0.22);
  }

  start(): void {
    [392, 523, 659].forEach((f, i) =>
      setTimeout(() => this.audio.tone(f, 0.12, "triangle", 0.3), i * 90),
    );
  }

  finish(beatPar: boolean): void {
    const notes = beatPar
      ? [523, 659, 784, 1047, 1319]
      : [523, 659, 784, 1047];
    notes.forEach((f, i) =>
      setTimeout(() => this.audio.tone(f, 0.16, "triangle", 0.35), i * 130),
    );
  }
}
