import type { AudioManager } from "@/engine";

/** Thin game-specific wrappers over the engine's procedural synth.
 *  All calls are best-effort and respect the global mute. */
export class Sfx {
  constructor(private a: AudioManager) {}

  jump() {
    this.a.sweep(360, 760, 0.16, "sine", 0.35);
  }

  coin() {
    this.a.tone(1040, 0.05, "square", 0.3);
    setTimeout(() => this.a.tone(1560, 0.07, "square", 0.3), 45);
  }

  stomp() {
    this.a.sweep(520, 130, 0.14, "square", 0.4);
    this.a.noise(0.08, 0.2);
  }

  bump() {
    this.a.tone(180, 0.07, "square", 0.35);
  }

  brick() {
    this.a.noise(0.16, 0.4);
    this.a.tone(140, 0.08, "square", 0.25);
  }

  powerup() {
    [523, 659, 784, 988, 1319].forEach((f, i) =>
      setTimeout(() => this.a.tone(f, 0.1, "triangle", 0.35), i * 70),
    );
  }

  star() {
    [784, 988, 1319, 988, 1319, 1568].forEach((f, i) =>
      setTimeout(() => this.a.tone(f, 0.09, "square", 0.3), i * 80),
    );
  }

  checkpoint() {
    this.a.tone(660, 0.1, "triangle", 0.4);
    setTimeout(() => this.a.tone(990, 0.16, "triangle", 0.4), 110);
  }

  oneUp() {
    [659, 880, 1047, 1319, 1568].forEach((f, i) =>
      setTimeout(() => this.a.tone(f, 0.11, "triangle", 0.4), i * 90),
    );
  }

  hurt() {
    this.a.sweep(440, 120, 0.3, "sawtooth", 0.4);
    this.a.noise(0.12, 0.3);
  }

  die() {
    this.a.lose();
  }

  clear() {
    this.a.win();
  }

  victory() {
    [523, 659, 784, 1047, 1319, 1047, 1319, 1568].forEach((f, i) =>
      setTimeout(() => this.a.tone(f, 0.16, "triangle", 0.4), i * 130),
    );
  }

  shellKick() {
    this.a.sweep(700, 300, 0.12, "square", 0.35);
  }

  flagSlide() {
    this.a.sweep(300, 900, 0.5, "sine", 0.3);
  }
}
