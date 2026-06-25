/**
 * Sound wrapper around the engine AudioManager. Centralizes pitch tables and
 * throttling so merge cascades stay pleasant instead of machine-gunning.
 * Respects the global mute (handled inside AudioManager).
 */
import type { AudioManager } from "@/engine";
import { mergePitch } from "./fruits";

export class Sfx {
  private lastMerge = 0;
  private lastTap = 0;
  private lastWarn = 0;
  private clock = 0;

  constructor(private audio: AudioManager) {}

  tick(dt: number): void {
    this.clock += dt;
  }

  drop(): void {
    this.audio.sweep(420, 180, 0.16, "sine", 0.32);
  }

  merge(producedTier: number): void {
    // throttle bursts so cascades don't stack into noise
    if (this.clock - this.lastMerge < 0.04) return;
    this.lastMerge = this.clock;
    const f = mergePitch(producedTier);
    this.audio.tone(f, 0.1, "triangle", 0.34);
    this.audio.tone(f * 1.5, 0.12, "sine", 0.22);
    // warm body thump that deepens with tier
    this.audio.tone(110 + (10 - producedTier) * 6, 0.09, "sine", 0.16);
  }

  tap(strength: number): void {
    if (this.clock - this.lastTap < 0.06) return;
    this.lastTap = this.clock;
    this.audio.tone(90 + strength * 40, 0.05, "sine", Math.min(0.18, 0.05 + strength * 0.1));
  }

  jackpot(): void {
    [523, 659, 784, 1047, 1319].forEach((freq, i) =>
      setTimeout(() => this.audio.tone(freq, 0.16, "triangle", 0.4), i * 90),
    );
    this.audio.noise(0.4, 0.25);
  }

  warn(): void {
    if (this.clock - this.lastWarn < 0.5) return;
    this.lastWarn = this.clock;
    this.audio.tone(220, 0.08, "square", 0.18);
  }

  gameOver(): void {
    this.audio.lose();
  }
}
