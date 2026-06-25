/** Original songs + the beatmap compiler + endless generator for Tap Cascade.
 *
 * All melodies below are composed from scratch for this game. None are derived
 * from any existing copyrighted work. They are written in a compact DSL (see
 * PRD §6) and compiled to runtime beatmaps with deterministic lane assignment. */

import { mulberry32 } from "@/engine";
import type { Beatmap, SongDef, TileNote } from "./types";
import { buildScale, midi, midiToFreq } from "./notes";
import { SONG_ACCENTS } from "./theme";

const LANES = 4;

/** Map a MIDI pitch onto a lane 0..3 by position within the song's range. */
function pitchToLane(m: number, minM: number, maxM: number): number {
  if (maxM <= minM) return 0;
  const t = (m - minM) / (maxM - minM);
  const lane = Math.round(t * (LANES - 1));
  return lane < 0 ? 0 : lane > LANES - 1 ? LANES - 1 : lane;
}

/** Find a free lane near `lane`, searching outward, avoiding `used`. */
function resolveCollision(lane: number, used: Set<number>): number {
  if (!used.has(lane)) return lane;
  for (let off = 1; off < LANES; off++) {
    const l = (lane + off) % LANES;
    if (!used.has(l)) return l;
  }
  return lane;
}

/**
 * Compile a SongDef (compact DSL) into a runtime Beatmap.
 * - Walks steps accumulating a beat cursor.
 * - Converts beats to seconds via the BPM.
 * - Assigns each note a lane by pitch, nudging to avoid immediate repeats and
 *   spreading chord notes across distinct lanes.
 */
export function compileSong(def: SongDef): Beatmap {
  interface Ev {
    beat: number;
    names: string[];
    dur: number;
  }

  const evs: Ev[] = [];
  let cursor = 0;
  for (const s of def.steps) {
    if ("rest" in s) {
      cursor += s.d;
      continue;
    }
    const names = Array.isArray(s.n) ? s.n : [s.n];
    evs.push({ beat: cursor, names, dur: s.d });
    cursor += s.d;
  }

  let minM = Infinity;
  let maxM = -Infinity;
  for (const e of evs) {
    for (const nm of e.names) {
      const m = midi(nm);
      if (m < minM) minM = m;
      if (m > maxM) maxM = m;
    }
  }
  if (!isFinite(minM)) {
    minM = 60;
    maxM = 72;
  }

  const spb = 60 / def.bpm;
  const notes: TileNote[] = [];
  let prevLane = -1;

  for (const e of evs) {
    const sorted = [...e.names].sort((a, b) => midi(a) - midi(b));
    const isChord = sorted.length > 1;
    const used = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      const nm = sorted[i];
      const m = midi(nm);
      let lane = pitchToLane(m, minM, maxM);
      if (!isChord && lane === prevLane) {
        lane = (lane + 1) % LANES;
      }
      lane = resolveCollision(lane, used);
      used.add(lane);
      notes.push({
        time: e.beat * spb,
        lane,
        freq: midiToFreq(m),
        dur: e.dur * spb,
      });
      if (!isChord) prevLane = lane;
    }
    if (isChord) prevLane = -1;
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  const length = notes.length ? notes[notes.length - 1].time + 2.5 : 4;

  return {
    id: def.id,
    title: def.title,
    subtitle: def.subtitle,
    notes,
    length,
    bpm: def.bpm,
    accent: def.accent,
    endless: false,
  };
}

// ===========================================================================
// ORIGINAL SONG #1 — "Morning Dew" (C major, calm, onboarding)
// ===========================================================================
const morningDew: SongDef = {
  id: "morning-dew",
  title: "Morning Dew",
  subtitle: "C major · calm · easy",
  bpm: 96,
  accent: SONG_ACCENTS.morningDew,
  key: "C major",
  steps: [
    // Phrase A — a gentle rise and settle
    { n: "E4", d: 1 }, { n: "G4", d: 1 }, { n: "A4", d: 1 }, { n: "G4", d: 1 },
    { n: "E4", d: 1 }, { n: "D4", d: 1 }, { n: "C4", d: 2 },
    { n: "D4", d: 1 }, { n: "E4", d: 1 }, { n: "G4", d: 1 }, { n: "E4", d: 1 },
    { n: "D4", d: 2 }, { rest: true, d: 1 }, { n: "G4", d: 1 },
    // Phrase B — reaches up to the octave
    { n: "A4", d: 1 }, { n: "G4", d: 1 }, { n: "E4", d: 1 }, { n: "G4", d: 1 },
    { n: "C5", d: 1 }, { n: "B4", d: 1 }, { n: "A4", d: 1 }, { n: "G4", d: 1 },
    { n: "E4", d: 1 }, { n: "D4", d: 1 }, { n: "E4", d: 1 }, { n: "G4", d: 1 },
    { n: ["C4", "E4"], d: 2 }, { rest: true, d: 1 }, { n: "G4", d: 1 },
    // Phrase C — brighter, hovering near the top
    { n: "G4", d: 1 }, { n: "A4", d: 1 }, { n: "C5", d: 1 }, { n: "A4", d: 1 },
    { n: "G4", d: 1 }, { n: "E4", d: 1 }, { n: "G4", d: 2 },
    { n: "A4", d: 1 }, { n: "G4", d: 1 }, { n: "E4", d: 1 }, { n: "D4", d: 1 },
    { n: "C4", d: 1 }, { n: "D4", d: 1 }, { n: "E4", d: 2 },
    // Phrase D — final ascent and resolution home
    { n: "G4", d: 1 }, { n: "C5", d: 1 }, { n: "B4", d: 1 }, { n: "A4", d: 1 },
    { n: "G4", d: 1 }, { n: "A4", d: 1 }, { n: "G4", d: 1 }, { n: "E4", d: 1 },
    { n: "D4", d: 1 }, { n: "E4", d: 1 }, { n: "G4", d: 1 }, { n: "A4", d: 1 },
    { n: ["C4", "E4", "G4"], d: 4 },
  ],
};

// ===========================================================================
// ORIGINAL SONG #2 — "Neon Skies" (A minor, upbeat, syncopated)
// ===========================================================================
const neonSkies: SongDef = {
  id: "neon-skies",
  title: "Neon Skies",
  subtitle: "A minor · upbeat · medium",
  bpm: 120,
  accent: SONG_ACCENTS.neonSkies,
  key: "A minor",
  steps: [
    // Driving pentatonic riff
    { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 },
    { n: "C5", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 1 },
    { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "G5", d: 0.5 },
    { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "C5", d: 1 },
    { n: "G4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "A4", d: 0.5 },
    { n: "G4", d: 0.5 }, { n: "E4", d: 0.5 }, { n: "A4", d: 1 },
    { n: "E4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 },
    { n: "D5", d: 1 }, { rest: true, d: 0.5 }, { n: "E5", d: 0.5 },
    // Lift to the chorus — higher, brighter
    { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "D5", d: 0.5 },
    { n: "E5", d: 0.5 }, { n: "G5", d: 0.5 }, { n: "A5", d: 1 },
    { n: "G5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "C5", d: 0.5 },
    { n: "D5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "D5", d: 1 },
    { n: "C5", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "D5", d: 0.5 },
    { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "C5", d: 1 },
    { n: "A4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 },
    { n: ["A4", "E5"], d: 1 }, { rest: true, d: 0.5 }, { n: "A4", d: 0.5 },
    // Outro riff back to the tonic
    { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "C5", d: 0.5 },
    { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "G5", d: 0.5 },
    { n: "A5", d: 0.5 }, { n: "G5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 },
    { n: "C5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "C5", d: 0.5 },
    { n: ["A3", "A4", "E5"], d: 2 },
  ],
};

// ===========================================================================
// ORIGINAL SONG #3 — "Crystal Cascade" (G major, flowing arpeggios)
// ===========================================================================
const crystalCascade: SongDef = {
  id: "crystal-cascade",
  title: "Crystal Cascade",
  subtitle: "G major · flowing · medium",
  bpm: 108,
  accent: SONG_ACCENTS.crystalCascade,
  key: "G major",
  steps: [
    // G major broken chord up and down
    { n: "G4", d: 0.5 }, { n: "B4", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "G5", d: 0.5 },
    { n: "D5", d: 0.5 }, { n: "B4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "B4", d: 0.5 },
    // C major arpeggio
    { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "G5", d: 0.5 }, { n: "E5", d: 0.5 },
    { n: "C5", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 },
    // D major arpeggio
    { n: "D5", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "F#5", d: 0.5 },
    { n: "A5", d: 0.5 }, { n: "F#5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "A4", d: 0.5 },
    // back to G, settle
    { n: "G4", d: 0.5 }, { n: "B4", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "B4", d: 0.5 },
    { n: "G4", d: 1 }, { rest: true, d: 1 },
    // Higher cascade section
    { n: "B4", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "G5", d: 0.5 }, { n: "B5", d: 0.5 },
    { n: "G5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "B4", d: 0.5 }, { n: "D5", d: 0.5 },
    { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "A5", d: 0.5 }, { n: "E5", d: 0.5 },
    { n: "C5", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "E5", d: 0.5 },
    { n: "D5", d: 0.5 }, { n: "F#5", d: 0.5 }, { n: "A5", d: 0.5 }, { n: "D6", d: 0.5 },
    { n: "A5", d: 0.5 }, { n: "F#5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "A4", d: 0.5 },
    { n: "G4", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "G5", d: 0.5 }, { n: "D5", d: 0.5 },
    { n: ["G4", "B4", "D5"], d: 2 }, { rest: true, d: 1 },
    // Final shimmering run home
    { n: "G5", d: 0.5 }, { n: "F#5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 },
    { n: "C5", d: 0.5 }, { n: "B4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "G4", d: 0.5 },
    { n: ["G3", "G4", "B4", "D5"], d: 2 },
  ],
};

// ===========================================================================
// ORIGINAL SONG #4 — "Midnight Drive" (D minor, moody, fast, hardest)
// ===========================================================================
const midnightDrive: SongDef = {
  id: "midnight-drive",
  title: "Midnight Drive",
  subtitle: "D minor · moody · hard",
  bpm: 132,
  accent: SONG_ACCENTS.midnightDrive,
  key: "D minor",
  steps: [
    // Pulsing low-end riff
    { n: "D4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "F4", d: 0.5 }, { n: "A4", d: 0.5 },
    { n: "D4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "A4", d: 0.5 },
    { n: "Bb4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "F4", d: 0.5 },
    { n: "E4", d: 0.5 }, { n: "F4", d: 0.5 }, { n: "A4", d: 1 },
    { n: "D5", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "Bb4", d: 0.5 }, { n: "A4", d: 0.5 },
    { n: "G4", d: 0.5 }, { n: "F4", d: 0.5 }, { n: "E4", d: 0.5 }, { n: "D4", d: 0.5 },
    { n: ["D4", "F4"], d: 1 }, { n: ["E4", "A4"], d: 1 },
    // Tension build with chromatic-ish moves
    { n: "F4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "C5", d: 0.5 },
    { n: "D5", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "G4", d: 0.5 },
    { n: "F5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "D5", d: 0.5 }, { n: "C5", d: 0.5 },
    { n: "Bb4", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "F4", d: 0.5 },
    // Drop — chord stabs + fast runs
    { n: ["D4", "A4", "D5"], d: 1 }, { n: "C5", d: 0.5 }, { n: "Bb4", d: 0.5 },
    { n: "A4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "F4", d: 0.5 }, { n: "E4", d: 0.5 },
    { n: ["Bb3", "F4", "Bb4"], d: 1 }, { n: "A4", d: 0.5 }, { n: "G4", d: 0.5 },
    { n: "F4", d: 0.5 }, { n: "E4", d: 0.5 }, { n: "D4", d: 0.5 }, { n: "A4", d: 0.5 },
    { n: "D5", d: 0.5 }, { n: "E5", d: 0.5 }, { n: "F5", d: 0.5 }, { n: "E5", d: 0.5 },
    { n: "D5", d: 0.5 }, { n: "C5", d: 0.5 }, { n: "A4", d: 0.5 }, { n: "F4", d: 0.5 },
    { n: "E4", d: 0.5 }, { n: "G4", d: 0.5 }, { n: "Bb4", d: 0.5 }, { n: "A4", d: 0.5 },
    { n: ["D3", "D4", "A4", "D5"], d: 2 },
  ],
};

/** All authored songs, in menu order. */
export const SONG_DEFS: SongDef[] = [
  morningDew,
  neonSkies,
  crystalCascade,
  midnightDrive,
];

/** Compile every authored song once (cached at module load). */
export const SONGS: Beatmap[] = SONG_DEFS.map(compileSong);

/** A shell beatmap describing endless mode (notes are generated at runtime). */
export function makeEndlessBeatmap(): Beatmap {
  return {
    id: "endless",
    title: "Endless",
    subtitle: "Pentatonic · accelerates forever",
    notes: [],
    length: Infinity,
    bpm: 126,
    accent: SONG_ACCENTS.endless,
    endless: true,
  };
}

/**
 * Procedural note generator for endless mode. Produces a pleasant random walk on
 * a major-pentatonic scale so any sequence sounds musical, advancing a beat
 * cursor. The *fall speed* (not the note spacing) is what accelerates, handled by
 * the game; this just supplies a steady stream of well-formed notes ahead of the
 * play head.
 */
export class EndlessGen {
  private readonly scale: number[];
  private readonly minM: number;
  private readonly maxM: number;
  private readonly rand: () => number;
  readonly spb: number;
  private degree: number;
  private beat = 0;
  private prevLane = -1;
  private count = 0;

  constructor(bpm = 126) {
    this.spb = 60 / bpm;
    this.scale = buildScale("D3", "majorPentatonic", 3);
    this.minM = this.scale[0];
    this.maxM = this.scale[this.scale.length - 1];
    this.degree = Math.floor(this.scale.length / 2);
    const seed = (Date.now() >>> 0) ^ 0x9e3779b9;
    this.rand = mulberry32(seed);
  }

  /** Beat time (seconds) of the next note that will be produced. */
  get nextTime(): number {
    return this.beat * this.spb;
  }

  /**
   * Produce the next group of notes (usually one; occasionally a two-note chord
   * once the run gets going). `difficulty` (0..1+) increases chord chance and
   * rhythmic density.
   */
  next(difficulty: number): TileNote[] {
    // Random walk: bias toward small steps for a melodic contour.
    const stepRoll = this.rand();
    let delta: number;
    if (stepRoll < 0.18) delta = -2;
    else if (stepRoll < 0.45) delta = -1;
    else if (stepRoll < 0.55) delta = 0;
    else if (stepRoll < 0.82) delta = 1;
    else delta = 2;
    this.degree += delta;
    if (this.degree < 0) this.degree = -this.degree;
    if (this.degree >= this.scale.length) {
      this.degree = this.scale.length - 1 - (this.degree - this.scale.length);
    }
    if (this.degree < 0) this.degree = 0;

    const m = this.scale[this.degree];
    let lane = pitchToLane(m, this.minM, this.maxM);
    if (lane === this.prevLane) lane = (lane + 1) % LANES;
    this.prevLane = lane;

    // Rhythm: mostly quarter notes; some eighth pairs as difficulty climbs.
    const eighthChance = Math.min(0.45, 0.12 + difficulty * 0.25);
    const dur = this.rand() < eighthChance ? 0.5 : 1;

    const time = this.beat * this.spb;
    const out: TileNote[] = [
      { time, lane, freq: midiToFreq(m), dur: dur * this.spb },
    ];

    // Occasional chord once warmed up.
    const chordChance = Math.min(0.22, Math.max(0, difficulty - 0.25) * 0.4);
    if (this.count > 8 && this.rand() < chordChance) {
      const used = new Set<number>([lane]);
      const m2 = this.scale[Math.min(this.scale.length - 1, this.degree + 2)];
      const lane2 = resolveCollision(pitchToLane(m2, this.minM, this.maxM), used);
      out.push({ time, lane: lane2, freq: midiToFreq(m2), dur: dur * this.spb });
      this.prevLane = -1;
    }

    this.beat += dur;
    this.count++;
    return out;
  }
}
