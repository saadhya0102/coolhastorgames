/** Pitch / frequency helpers for Tap Cascade.
 *
 * Everything here is pure math (equal temperament, A4 = 440 Hz). Notes are
 * authored as scientific pitch names ("C4", "F#4", "Bb3") and converted to MIDI
 * numbers and then to frequencies. No external data / no asset files. */

/** Semitone offsets from C for each natural letter. */
const LETTER_SEMITONE: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * Parse a scientific pitch name into a MIDI number.
 * Accepts an optional accidental (`#`, `b`) and a (possibly negative) octave.
 * Examples: `C4` -> 60, `A4` -> 69, `F#4` -> 66, `Bb3` -> 58.
 * Throws on malformed input so authoring bugs surface immediately.
 */
export function midi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) {
    throw new Error(`Invalid note name: "${name}"`);
  }
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const octave = parseInt(m[3], 10);
  let semitone = LETTER_SEMITONE[letter];
  if (accidental === "#") semitone += 1;
  else if (accidental === "b") semitone -= 1;
  // MIDI: C-1 = 0, so C4 = (4 + 1) * 12 = 60.
  return (octave + 1) * 12 + semitone;
}

/** Convert a MIDI number to a frequency in Hz (equal temperament, A4 = 440). */
export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Convert a pitch name directly to a frequency in Hz. */
export function freq(name: string): number {
  return midiToFreq(midi(name));
}

/** Scale interval patterns (semitone offsets within one octave). */
export const SCALES = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

/**
 * Build a list of MIDI numbers spanning `octaves` octaves of a scale, starting
 * from the root note. Useful for the endless generator's random walk.
 */
export function buildScale(root: string, scale: ScaleName, octaves: number): number[] {
  const base = midi(root);
  const pattern = SCALES[scale];
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const step of pattern) {
      out.push(base + o * 12 + step);
    }
  }
  // include the top root so the range closes nicely
  out.push(base + octaves * 12);
  return out;
}

/** Clamp an index into a scale array, wrapping is intentionally NOT done so the
 * melody contour stays bounded; callers reflect off the ends instead. */
export function reflectIndex(i: number, len: number): number {
  if (len <= 1) return 0;
  if (i < 0) return -i % len;
  if (i >= len) return len - 1 - ((i - len) % len);
  return i;
}
