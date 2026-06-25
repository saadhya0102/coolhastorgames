/** Neon Dash — beat-synced step sequencer + SFX, all from ctx.audio primitives.
 *
 * The sequencer is driven by `levelTime` (the same clock that scrolls the
 * world), so the music is always locked to the obstacles and restarts cleanly
 * on every retry. There is no scheduling API — we fire one-shot voices as each
 * 16th-note step is crossed inside update(). */
import type { AudioManager } from "@/engine";
import type { SongSpec } from "./types";

const semis = (root: number, n: number): number => root * Math.pow(2, n / 12);

export class MusicEngine {
  private audio: AudioManager;
  private song: SongSpec;
  private lastStep = -1;

  constructor(audio: AudioManager, song: SongSpec) {
    this.audio = audio;
    this.song = song;
  }

  setSong(song: SongSpec): void {
    this.song = song;
    this.lastStep = -1;
  }

  reset(): void {
    this.lastStep = -1;
  }

  /** seconds per 16th note for the current song. */
  stepDur(): number {
    return 60 / this.song.bpm / 4;
  }

  /** Advance the sequencer to `levelTime`, firing any newly-crossed steps. */
  update(levelTime: number): void {
    if (levelTime <= 0) {
      this.lastStep = -1;
      return;
    }
    const step = Math.floor(levelTime / this.stepDur());
    if (step <= this.lastStep) return;
    // catch up but never spam more than a few voices after a hitch
    const from = Math.max(this.lastStep + 1, step - 2);
    for (let s = from; s <= step; s++) this.playStep(s);
    this.lastStep = step;
  }

  private playStep(s: number): void {
    const song = this.song;
    const i = ((s % 16) + 16) % 16;

    if (song.kick[i]) this.audio.sweep(150, 45, 0.12, "sine", 0.55);
    if (song.snare[i]) this.audio.noise(0.16, 0.32);
    if (song.hat[i]) this.audio.noise(0.03, 0.12);

    // bass on every 8th note
    if (s % 2 === 0) {
      const bn = song.bass[(Math.floor(s / 2) % song.bass.length + song.bass.length) % song.bass.length];
      this.audio.tone(semis(song.root, bn), 0.16, song.bassWave, 0.22);
    }
    // lead arpeggio on the off-8ths
    if (s % 2 === 1) {
      const ln = song.lead[((s % song.lead.length) + song.lead.length) % song.lead.length];
      this.audio.tone(semis(song.root, ln), 0.1, song.leadWave, 0.14);
    }
  }

  // ---- SFX ---------------------------------------------------------------
  jump(): void {
    this.audio.sweep(440, 780, 0.12, "sine", 0.22);
  }
  land(): void {
    this.audio.tone(150, 0.05, "sine", 0.14);
  }
  orb(): void {
    this.audio.sweep(520, 1040, 0.14, "triangle", 0.28);
  }
  pad(): void {
    this.audio.sweep(280, 960, 0.2, "square", 0.3);
  }
  portal(): void {
    this.audio.sweep(180, 1300, 0.28, "sawtooth", 0.2);
    this.audio.tone(660, 0.18, "triangle", 0.18);
  }
  death(): void {
    this.audio.noise(0.4, 0.5);
    this.audio.sweep(320, 60, 0.4, "sawtooth", 0.3);
  }
  win(): void {
    this.audio.win();
  }
  checkpoint(): void {
    this.audio.tone(880, 0.07, "triangle", 0.22);
  }
}
