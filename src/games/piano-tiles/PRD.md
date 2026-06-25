# Tap Cascade — Product Requirements Document

> An original rhythm tap game in the **Piano Tiles** tradition, built for the
> CoolHastorGames TypeScript + Vite portal. Everything in this game is original:
> the melodies are composed from scratch, the visuals are 100% procedural canvas
> drawing (no asset files), and the code is self-contained inside
> `src/games/piano-tiles/`.

- **Game id:** `piano-tiles`
- **Display title:** `Tap Cascade`
- **Genre:** Rhythm / reaction / arcade
- **Players:** 1
- **Orientation:** Portrait-friendly, but fully responsive (any aspect, mobile + desktop)
- **Engine entry:** `create(ctx: GameContext): GameInstance`

---

## 1. Vision & Pitch

Four vertical lanes fall toward a glowing hit line at the bottom of the screen.
Black tiles cascade downward in time with an original melody. When a tile reaches
the hit line you tap (or press a key) and the tile's note rings out — building a
melody one tap at a time. Tap the wrong place, or let a tile slip past the line,
and the run ends.

The fantasy is simple and addictive: **you are playing the song with your
fingertips**. Every correct tap is rewarded with a musical note, a flash of
color, a ripple of particles, and a climbing combo counter. The longer you
survive, the faster the tiles fall, so the music accelerates with you.

Design pillars:

1. **Juicy, tactile feedback.** Every interaction has audio + visual response:
   note tone, tile flash, ripple particles, lane glow, combo pop, screen-edge
   pulse. Nothing happens silently.
2. **Readable at a glance.** High-contrast tiles, a bold hit line, crisp lane
   separators. The player should never lose a tile in visual noise.
3. **Fair but escalating.** Generous-but-honest hit window; speed ramps
   predictably so failure always feels earned.
4. **Original music that's actually pleasant.** Short, loopable, hummable tunes
   in friendly keys. No copyrighted material anywhere.
5. **Zero dependencies / zero assets.** Pure canvas, pure WebAudio (through the
   engine's `ctx.audio.tone`).

---

## 2. Scope

### In scope (v1)

- 4 vertical lanes, tiles scrolling downward.
- Tap-the-tile-at-the-hit-line core loop.
- 4 original songs + 1 endless mode (procedurally generated, accelerating).
- Song-select menu with per-song best score + best combo persisted locally.
- Countdown ("3 · 2 · 1 · GO") before play.
- Combo counter, live score, accuracy judgments (Perfect / Great / Good).
- Speed ramp over the course of a song; endless mode that keeps accelerating.
- Keyboard (D / F / J / K, also arrow & number fallbacks) and multi-touch input.
- Hit flashes, ripple particles, lane glow, moving/pulsing hit line, floating
  judgment text, combo milestone effects.
- Game-over summary screen with stats and quick restart / back-to-menu.
- Pause (auto on tab blur via engine `onPause` hook).

### Out of scope (v1, but designed to be extensible)

- Hold/slide tiles (data model leaves room for `dur`, but v1 treats all tiles as
  taps; the renderer scales tile height by duration for visual variety).
- Online leaderboards (the portal already syncs `submitScore` opportunistically;
  the game just reports scores).
- User-authored songs / level editor.
- Difficulty selection per song (endless covers the "harder" appetite).

---

## 3. Engine Integration

The game is a canvas module. It exports `create(ctx)` returning a `GameInstance`.

### 3.1 GameContext usage

| Field | Usage |
| --- | --- |
| `ctx.ctx` | 2D context, already DPR-scaled. All drawing in CSS px. |
| `ctx.width` / `ctx.height` | **Getters** — read EVERY frame. Layout is recomputed each frame so resizing / rotating / any aspect ratio just works. |
| `ctx.input` | `pointer`, `pointers` (multi-touch Map), `pressed()`, `isDown()`. |
| `ctx.audio` | `tone(freq, dur, type, vol)` to play piano-ish notes. |
| `ctx.storage` | Persist best score + best combo per song. |
| `ctx.reportScore(n)` | Live HUD score update each time score changes. |
| `ctx.gameOver(finalScore)` | Called once when a run ends, after a short death beat. |
| `ctx.setStatus(text)` | Top-of-canvas status line (mode / hint). |
| `ctx.requestControls([])` | We clear engine touch controls — the whole canvas is the controller. |
| `ctx.isTouch` | Tweak hint copy (Tap vs keys). |

### 3.2 GameInstance contract

```ts
interface GameInstance {
  update(dt: number): void;   // dt in seconds
  render(): void;             // repaint the ENTIRE background each frame
  resize?(w, h): void;        // we recompute layout from getters anyway
  destroy?(): void;           // release any timers
  onPause?(): void;           // pause clock on tab blur
  onResume?(): void;          // resume clock
}
```

Key rule: **the background is fully repainted every frame** (no reliance on
persistence between frames).

### 3.3 Manifest entry (registration)

This game lives in `src/games/piano-tiles/`. To surface it in the portal hub, add
one entry to `src/registry/manifest.ts` (a shared file, so it is left to the
maintainer):

```ts
{
  id: "piano-tiles", title: "Tap Cascade",
  description: "Tap the falling tiles in time to play original melodies.",
  section: "offline", category: "arcade", color: "#19d3ff", icon: "🎹",
  players: "1P", aspect: 0.62, leaderboard: true, scoreLabel: "Score",
  instructions: ["Tap the tile at the line (D F J K)", "Don't miss a tile!"],
  collection: "minigames", kind: "canvas",
  load: () => import("../games/piano-tiles"),
},
```

`aspect: 0.62` gives a tall portrait stage that suits four falling lanes.

---

## 4. Core Gameplay

### 4.1 The play field

```
 ┌───────────────────────────────┐   ← top of stage (tiles spawn above, off-screen)
 │  lane0 │ lane1 │ lane2 │ lane3 │
 │   ▓    │       │   ▓   │       │
 │        │  ▓    │       │       │
 │        │       │       │   ▓   │
 │   ▓    │       │       │       │
 │ ─────────── HIT LINE ───────── │   ← glowing, pulsing line near the bottom
 │  key labels: D    F    J    K  │
 └───────────────────────────────┘
```

- The stage is divided into **4 equal-width vertical lanes**.
- Tiles spawn off the top and travel downward at the current fall speed.
- A **hit line** sits at ~82% of the stage height. It pulses and bobs subtly.
- Below the hit line is a thin "key deck" showing the key labels and lane glow.

### 4.2 The loop

1. A tile's ideal **hit time** is the moment its leading (bottom) edge crosses the
   hit line.
2. The player taps that lane (touch) or presses its key (keyboard) within the
   **hit window** around the hit time.
3. On a correct tap:
   - The tile is consumed (marked `hit`), with a judgment (Perfect/Great/Good)
     based on timing error.
   - The tile's **note plays** via `ctx.audio.tone(freq, …)`.
   - Score increases (base + accuracy bonus + combo bonus).
   - Combo increments; lane flashes; ripple particles emit at the hit point.
4. On a wrong tap (tapping a lane with no catchable tile) → **game over**.
5. If a tile fully passes the hit line without being tapped → **miss → game over**.
6. Speed ramps up as the song progresses (or continuously in endless mode).

### 4.3 Win / lose

- **Songs** have a finite beatmap. Clearing every tile = **song complete**
  (a celebratory summary, full score banked).
- **Endless** never ends on its own — only a wrong tap or a miss stops it.
- **Lose** in any mode: wrong tap or missed tile. A short "death" beat plays,
  the offending tile/lane flashes red, then the game-over screen appears.

---

## 5. Timing Model

This is the heart of a rhythm game, so it is specified precisely.

### 5.1 Clocks

- `songTime` — seconds elapsed since the countdown hit "GO" (the musical t=0).
  Advanced by `dt` each frame while `state === "playing"`.
- All note times are expressed in **seconds** in the compiled beatmap.
- A beatmap authored in **beats** is compiled to seconds using the song BPM:
  `seconds = beat * 60 / bpm`.

### 5.2 Fall speed and spawn

- `fallSpeed` is in **CSS px per second**. It is derived from a base speed scaled
  by the stage height, then multiplied by a per-mode ramp:
  - Songs: ramps from `1.0×` to `~1.6×` linearly across the song length.
  - Endless: ramps continuously, `speed = base * (1 + elapsed / rampPeriod)`,
    capped at a sane maximum.
- A tile must reach the hit line exactly at its `hitTime`. So at any moment its
  bottom-edge Y is:

```
y_bottom(t) = hitLineY - (hitTime - t) * fallSpeed
```

  Because `fallSpeed` may change over time, we integrate position incrementally
  per frame (`y += fallSpeed * dt`) rather than recomputing from `hitTime`. Each
  tile stores its current `y`. New tiles are spawned when their hit time is within
  `leadTime` of now, with their initial `y` back-computed so they arrive on beat.
- `leadTime` (how long a tile is visible before its hit time) is computed from the
  travel distance and current speed: `leadTime = (hitLineY + tileHeight) / fallSpeed`.
  Spawning is therefore **look-ahead based**: each frame we promote any
  beatmap note whose `hitTime - songTime <= leadTime` into a live tile and place
  it at the correct Y for the current speed.

### 5.3 Hit window

Timing error `e = songTime - hitTime` (negative = early, positive = late),
measured at the instant of the tap.

| Judgment | Window (abs error) | Score | Notes |
| --- | --- | --- | --- |
| Perfect | ≤ 0.060 s | 100 | white flash, gold text |
| Great   | ≤ 0.110 s | 70  | cyan text |
| Good    | ≤ 0.170 s | 40  | green text |

A tap only counts against the **nearest catchable tile** in that lane. A tile is
"catchable" when its bottom edge is within the catch band around the hit line:

```
catchable ⇔ (y_bottom >= hitLineY - CATCH_ABOVE) && (y_bottom <= hitLineY + CATCH_BELOW)
```

with `CATCH_ABOVE` / `CATCH_BELOW` sized in px to match the Good window at the
current speed (so the timing table and the spatial band stay consistent).

- Tapping a lane with **no catchable tile** = wrong tap = game over.
- A tile whose bottom edge passes `hitLineY + MISS_PX` without being hit = miss =
  game over. `MISS_PX` is slightly larger than `CATCH_BELOW` so there is a brief
  grace zone (you can still catch a tile a hair late).

### 5.4 Why position-based, not pure-time

Because the speed ramps, a pure `hitTime`-based Y recompute would make tiles
visually "jump" when speed changes. Integrating Y per frame keeps motion smooth.
Spawn placement uses the current speed to back-compute the starting Y so the tile
still lands on the line on beat to within sub-frame accuracy.

---

## 6. Beatmap / Note Format

### 6.1 Authoring DSL (compact)

Melodies are authored in a compact, human-writable form and **compiled** to the
runtime beatmap at load. A song is:

```ts
interface SongDef {
  id: string;
  title: string;
  subtitle: string;     // mood / key blurb
  bpm: number;
  accent: string;       // hex accent color for the song's theme
  key: string;          // human label, e.g. "C major" (display only)
  steps: Step[];        // the melody, in order
}

// A step is one rhythmic slot in the melody.
type Step =
  | { n: string;       d: number }   // a single note ("C4") of duration d beats
  | { n: string[];     d: number }   // a chord (multiple notes, distinct lanes)
  | { rest: true;      d: number };  // a rest (silence) of d beats
```

- `n` uses scientific pitch names: letter `A–G`, optional `#`/`b`, octave digit,
  e.g. `"C4"`, `"F#4"`, `"Bb3"`, `"A5"`.
- `d` is **beats** (1 = quarter note at the song BPM, 0.5 = eighth, etc).
- Steps play sequentially; the running beat cursor advances by each step's `d`.
- A chord step emits multiple simultaneous tiles in distinct lanes.

### 6.2 Compiled runtime format

The compiler walks the steps, accumulating a beat cursor, converting to seconds,
and assigning a lane to each note. The result is a flat list of tiles:

```ts
interface TileNote {
  time: number;   // hit time in seconds (beatCursor * 60 / bpm)
  lane: number;   // 0..3
  freq: number;   // Hz, from the note name via equal temperament
  dur: number;    // seconds (for tile height; v1 plays as a tap)
}

interface Beatmap {
  id: string;
  title: string;
  notes: TileNote[];   // sorted by time
  length: number;      // seconds of the last note + tail
  bpm: number;
  accent: string;
}
```

### 6.3 Lane assignment

Lanes are assigned deterministically so the same song always plays identically:

1. Compute the song's pitch range `[minMidi, maxMidi]` from all notes.
2. For a single note, map its pitch into `0..3`:
   `lane = round((midi - minMidi) / (maxMidi - minMidi) * 3)`.
   (Lower notes → left lanes, higher notes → right lanes — musically intuitive.)
3. If the chosen lane equals the **previous** note's lane, nudge by +1 (wrapping
   0↔3) so consecutive taps don't stack in one lane (better playability + feel).
4. For chord steps, assign each chord note a distinct lane, spreading across the
   four lanes by pitch order; collisions resolve to the next free lane.

This keeps the melody's contour visible in the tile pattern while guaranteeing
playable, non-degenerate lane sequences.

### 6.4 Pitch → frequency

Equal temperament, A4 = 440 Hz:

```
midi(name)   → integer MIDI number (C4 = 60, A4 = 69)
freq(midi)   = 440 * 2 ** ((midi - 69) / 12)
```

### 6.5 Endless generation

Endless mode generates `TileNote`s on the fly from a **pentatonic scale** (so any
random sequence sounds pleasant). Generation rules:

- Fixed authored BPM baseline; the **fall speed** (not the note spacing) is what
  accelerates, so the music stays groovy while the challenge rises.
- Each beat slot picks a scale degree with a gentle random walk (bias toward
  staying near the previous degree → melodic, not jumpy).
- Lane assignment uses the same pitch→lane mapping + no-repeat nudge.
- Occasional chord (two-lane) beats at higher difficulty for spice.
- Notes are generated a few seconds ahead of the play head and trimmed behind it,
  so memory stays bounded over very long runs.

---

## 7. Original Music

Four short, loopable, original melodies. All composed for this game; none derived
from any existing work. Each is in a friendly key and uses stepwise motion +
simple arpeggios so it sounds nice even when the player's timing is loose.

1. **Morning Dew** — C major, ~96 BPM. Calm, gentle, the tutorial-friendly tune.
   Mostly stepwise quarters and eighths, resolves home.
2. **Neon Skies** — A minor / A-minor-pentatonic, ~120 BPM. Upbeat, driving,
   syncopated eighths. The "anthem".
3. **Crystal Cascade** — G major, ~108 BPM. Flowing broken-chord arpeggios that
   sweep across the lanes like water.
4. **Midnight Drive** — D minor, ~132 BPM. Moody, faster, more chords and
   off-beats — the hardest authored song.

Plus **Endless** — D-major pentatonic random walk that never resolves and
accelerates forever.

### 7.1 Note synthesis

Notes are played through `ctx.audio.tone(freq, dur, type, vol)`. To make it sound
more "piano-ish" than a raw square wave, each note is layered:

- A `triangle` fundamental (mellow body),
- a quieter `sine` one octave up (shimmer),
- with a short duration and low volume so rapid passages don't muddy.

A subtle metronome/percussion tick can underline the beat at higher combos
(optional polish). Volume is kept conservative to respect the engine's master
gain and avoid clipping during chords.

---

## 8. Controls

| Action | Keyboard | Touch / Mouse |
| --- | --- | --- |
| Hit lane 0 | `D` (also `A`, `1`, `ArrowLeft`) | Tap anywhere in lane 0 column |
| Hit lane 1 | `F` (also `S`, `2`) | Tap in lane 1 column |
| Hit lane 2 | `J` (also `K`… no) `J` (also `2`?) → `J`, `3`, `ArrowDown` | Tap in lane 2 column |
| Hit lane 3 | `K` (also `L`, `4`, `ArrowRight`) | Tap in lane 3 column |
| Start / confirm | `Space` / `Enter` | Tap button |
| Menu navigation | `Up`/`Down` or `Left`/`Right` | Tap a song card |
| Back to menu | `Escape` | Tap "Menu" |
| Restart (game over) | `Space` / `Enter` / `R` | Tap "Retry" |

### 8.1 Multi-touch handling

Because two tiles can require simultaneous taps (chords) the game tracks pointer
**ids**:

- Each frame, compare `ctx.input.pointers` (a Map keyed by pointerId) against the
  set of ids seen last frame.
- Any **new** id is a fresh press → resolve its lane from its X position and fire
  a tap for that lane.
- Ids that disappear are forgotten.

This unifies mouse clicks (one reusable id, removed on pointerup) and multi-finger
touch (independent ids) under one "new press → tap" rule, so simultaneous
two-finger chord taps register as two independent lane hits in the same frame.

Keyboard taps fire on `input.pressed(...)` (the just-pressed edge), so holding a
key does not auto-repeat.

---

## 9. Screens / State Machine

States:

- `menu` — song select. A scrollable column of song cards + an Endless card.
  Shows per-song best score & best combo. Tap or arrow-select then Space.
- `countdown` — "3 · 2 · 1 · GO" with the chosen song's accent theme; tiles for
  the opening bars are already visible falling in, frozen until GO.
- `playing` — the core loop.
- `dying` — brief (~0.5 s) freeze with red flash + lose sting before game over.
- `complete` — song cleared celebration (win sting, confetti particles).
- `gameover` — summary: final score, max combo, accuracy %, best-score badge if
  beaten. Buttons: Retry / Menu.

Transitions:

```
menu --select--> countdown --GO--> playing
playing --wrong tap / miss--> dying --> gameover
playing --last tile hit--> complete --> gameover (with "Cleared!" banner)
gameover --retry--> countdown
gameover --menu--> menu
any --Escape--> menu
```

The engine's `gameOver(finalScore)` is invoked when leaving `dying`/`complete`
into the summary, so the portal records the score. The in-game `gameover` screen
is our own richer summary; tapping Retry/Menu restarts the instance's internal
state without recreating the module.

---

## 10. Scoring

- **Base per tile:** Perfect 100 / Great 70 / Good 40 (see §5.3).
- **Combo bonus:** `+ floor(combo / 10) * 5` per tile (rewards long streaks).
- **Combo** increments on every hit, resets only on game over (a run ends on the
  first mistake, so combo == tiles hit until the end).
- **Accuracy %:** `weightedHits / tilesHit` where Perfect=1, Great=0.8, Good=0.55,
  shown on the summary.
- **Reported score:** the running total, pushed to `ctx.reportScore` on every hit.
- **Persisted (per song):** best score (`best.<songId>`) and best combo
  (`bestcombo.<songId>`), via `ctx.storage`. The engine's `submitScore` is also
  fired through `gameOver`.

---

## 11. Visual Design

Procedural, high-contrast, neon-on-dark with a per-song accent color.

### 11.1 Palette

- Background: vertical gradient from near-black `#0a0e1a` to `#10162a`, with a
  faint animated starfield / drifting dust for depth.
- Lanes: alternating subtly different dark panels with thin separators; the
  active/last-hit lane gets an accent glow that fades over ~0.3 s.
- Tiles: deep charcoal `#15151c` body with a soft accent-tinted top edge and a
  subtle inner gradient + rounded corners, so they read as glossy black keys.
- Hit line: a bright accent bar with a glow, a moving sheen, and a gentle vertical
  bob; brighter pulse on every beat.
- Key deck: below the hit line, four key labels (D F J K) on accent-tinted pads
  that light up when their lane is hit.

### 11.2 Feedback effects

- **Hit flash:** a bright accent rectangle over the tapped lane, alpha-fading.
- **Ripple particles:** 8–14 small accent sparks burst from the hit point with
  gravity + drag; a ring ripple expands and fades.
- **Judgment text:** "PERFECT/GREAT/GOOD" floats up and fades at the hit point,
  colored by judgment.
- **Combo counter:** centered large number; pops (scale punch) on increment;
  milestone combos (every 25) trigger an extra burst + brief screen-edge glow.
- **Lane glow:** the hit lane's column briefly glows with the accent color.
- **Miss/wrong:** the offending lane flashes red and the screen edges flash red;
  tiles freeze.
- **Beat pulse:** the whole hit line and key pads pulse on the beat for groove.

### 11.3 Responsiveness

- Layout (lane width, hit line Y, font sizes, tile height, particle scale) is
  derived from `ctx.width`/`ctx.height` **every frame**, so any size, aspect
  ratio, orientation, or mid-game resize is handled gracefully.
- On very wide screens the play field is centered with a capped width so lanes
  stay tappable; side gutters get a darker vignette.

---

## 12. Audio Design

- Note tones: layered triangle + sine (see §7.1), short and low-volume.
- Countdown beeps: rising tones on 3/2/1, a brighter tone on GO.
- Wrong/miss: a short descending dissonant sting.
- Combo milestone: a quick bright arpeggio flourish.
- Song complete: an ascending major arpeggio.
- All sound is generated; respects the engine global mute.

---

## 13. Difficulty & Pacing

- **Morning Dew:** slow speed, sparse notes — onboarding.
- **Neon Skies / Crystal Cascade:** medium speed & density.
- **Midnight Drive:** fast, dense, chords — for skilled players.
- **Endless:** starts gentle, accelerates without bound (capped), the ultimate
  test; the main driver of "one more run".
- Speed ramp keeps each authored song getting harder toward its end, so even a
  short tune has an arc.

---

## 14. Technical Architecture

Files under `src/games/piano-tiles/`:

| File | Responsibility |
| --- | --- |
| `PRD.md` | This document. |
| `index.ts` | Engine entry: `create(ctx)`; constructs and returns the game. |
| `game.ts` | The main `PianoTiles` class: state machine, update/render, input. |
| `types.ts` | Shared interfaces (Tile, TileNote, Beatmap, particles, state). |
| `notes.ts` | Pitch-name → MIDI → frequency; scale helpers. |
| `songs.ts` | Original `SongDef`s, the compiler (DSL→Beatmap), endless generator. |
| `sound.ts` | Note/SFX playback wrapper over `ctx.audio`. |
| `particles.ts` | Particle + ripple + floating-text systems. |
| `theme.ts` | Palette, color utilities (hex parse, alpha, lighten). |

Design notes:

- **No `any`.** Strict TS throughout; explicit interfaces for every structure.
- **No libraries / no React.** Only `@/engine` + this folder.
- **No asset files.** All visuals drawn procedurally; all audio synthesized.
- **Pure functions where possible** (compiler, note math, color utils) for
  testability and clarity.
- **Object pooling** for particles to avoid GC churn during dense passages.
- **Layout recomputed per frame** from `ctx.width/height` getters.

### 14.1 Update/render split

- `update(dt)`: advance clocks, spawn tiles from look-ahead, integrate tile Y,
  process input (keyboard edges + new-pointer taps), resolve hits/misses, update
  particles, handle state transitions & timers.
- `render()`: repaint background → lanes → tiles → hit line → key deck →
  particles → HUD/overlays for the current state.

### 14.2 Failure handling

- Audio may be muted or unavailable — all `ctx.audio` calls are fire-and-forget
  and the engine no-ops when muted; gameplay never depends on audio succeeding.
- `gameOver` is guarded so it fires exactly once per run.
- All timers created in `setTimeout` are tracked and cleared in `destroy()`.

---

## 15. Acceptance Criteria

1. Builds under strict TS with no `any`, only importing from `@/engine` and the
   game folder. No asset files.
2. `create(ctx)` returns a working `GameInstance` with `update`, `render`,
   `resize`, `destroy`, `onPause`, `onResume`.
3. Four lanes; black tiles scroll downward and must be tapped at the hit line.
4. Correct tap plays the tile's note via `ctx.audio.tone` and scores; wrong tap or
   a missed (passed) tile ends the run.
5. Keyboard (D/F/J/K) and multi-touch lane taps both work, including simultaneous
   chord taps.
6. 4 original songs + endless mode, selectable from a menu; speed ramps up.
7. Live `reportScore`; `gameOver(finalScore)` fires once; best score & combo
   persisted per song.
8. Visuals are polished: crisp tiles, hit flashes, ripple particles, combo
   counter, lane glow, moving/pulsing hit line, countdown, juicy feedback.
9. Fully responsive across sizes / aspect ratios / mobile, reading the size
   getters every frame.

---

## 16. Future Extensions

- True hold/slide tiles (data model already carries `dur`).
- Per-song difficulty variants (Easy/Hard beatmaps).
- A simple in-game song editor exporting the DSL.
- Visual themes / unlockables tied to high scores.
- Haptics on supported devices for tap feedback.
