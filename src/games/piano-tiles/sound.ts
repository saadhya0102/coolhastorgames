/** Audio playback wrapper for Tap Cascade.
 *
 * Wraps the engine's `ctx.audio.tone` to produce a slightly more "piano-ish"
 * timbre by layering a mellow triangle fundamental with a quiet sine octave, and
 * provides the small set of game SFX (countdown, miss sting, combo flourish,
 * song-complete fanfare). Everything is synthesized; no asset files. */

import type { AudioManager } from "@/engine";

export class Sound {
  constructor(private audio: AudioManager) {}

  /**
   * Play a melodic note. Layers a triangle body + a soft sine octave so rapid
   * passages stay clear without sounding harsh. `strength` (0..1) scales volume
   * so softer judgments are subtly quieter.
   */
  note(freq: number, durBeats = 0.32, strength = 1): void {
    const dur = clamp(durBeats, 0.16, 0.5);
    const v = 0.32 + 0.22 * clamp(strength, 0, 1);
    this.audio.tone(freq, dur, "triangle", v);
    this.audio.tone(freq * 2, dur * 0.7, "sine", v * 0.28);
    // a touch of low body for warmth on lower notes
    if (freq < 330) {
      this.audio.tone(freq * 0.5, dur * 0.9, "sine", v * 0.18);
    }
  }

  /** Countdown beep; `go` makes the final, brighter tone. */
  countdown(go: boolean): void {
    if (go) {
      this.audio.tone(880, 0.18, "triangle", 0.45);
      this.audio.tone(1320, 0.16, "sine", 0.2);
    } else {
      this.audio.tone(523, 0.12, "triangle", 0.4);
    }
  }

  /** A short descending dissonant sting for a wrong tap / miss. */
  miss(): void {
    this.audio.sweep(420, 90, 0.32, "sawtooth", 0.4);
    this.audio.tone(150, 0.3, "square", 0.25);
  }

  /** Quick bright flourish at a combo milestone. */
  comboFlourish(): void {
    const seq = [784, 988, 1175, 1568];
    seq.forEach((f) => {
      this.audio.tone(f, 0.12, "triangle", 0.32);
    });
  }

  /** Ascending major arpeggio when a song is cleared. */
  complete(): void {
    const seq = [523, 659, 784, 1047, 1319];
    seq.forEach((f, i) => {
      window.setTimeout(() => {
        this.audio.tone(f, 0.18, "triangle", 0.4);
        this.audio.tone(f * 2, 0.14, "sine", 0.14);
      }, i * 110);
    });
  }

  /** Soft UI tick for menu navigation. */
  uiTick(): void {
    this.audio.tone(660, 0.05, "triangle", 0.2);
  }
}

const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;
