# NEON DASH — Product Requirements Document

> An original, "Geometry Dash"-style rhythm auto-runner built for the
> CoolHastorGames TypeScript + Vite portal. Everything (art, code, music,
> levels) is original and procedural; no assets, levels, or audio are copied
> from the real game. This document is the design contract that the
> implementation in `src/games/geometry-dash/` follows.

---

## 0. Table of Contents

1. Vision & Pillars
2. Engine Integration Contract
3. Coordinate System & World Model
4. Movement Modes (Cube / Ship / Gravity-Flip)
5. Physics & Tuning Constants
6. Obstacle Vocabulary
7. Collision Model (fair & precise)
8. Level Data Format (the DSL)
9. Level Designs (3 hand-tuned levels)
10. Difficulty Curve & Beat Synchronisation
11. Music & Audio Design
12. Visual & Art Direction
13. Particles, Trail & Juice
14. Game State Machine & Screens
15. Controls (desktop + mobile)
16. Progress, Scoring & Persistence
17. Checkpoints & Practice Mode
18. Camera & Rendering Pipeline
19. Resize / Aspect / Mobile Robustness
20. Edge Cases & Failure Modes
21. File Layout & Responsibilities
22. Performance Budget
23. Accessibility & Fairness
24. Testing Checklist
25. Future Work / Non-Goals

---

## 1. Vision & Pillars

**Neon Dash** is a one-button rhythm platformer. A glowing cube auto-scrolls
to the right at a constant, beat-locked speed. The single verb is *jump*
(tap / Space / click). The challenge is timing: every spike, gap and portal is
placed on the musical grid so that a perfect run *feels* like playing the song.

Death is instant and the level restarts from the beginning immediately — the
"one more try" loop is the heart of the genre. Levels are short (30–60 s),
hand-designed, and meant to be memorised and mastered.

### Design Pillars

- **P1 — Fair, readable, precise.** Death must always feel like the player's
  fault. Hitboxes are forgiving (spikes shrink inward), collision is
  sub-stepped so nothing tunnels, and obstacles telegraph clearly.
- **P2 — Musical.** Scroll speed, obstacle spacing, and the synth track all
  derive from one clock. Jumps land on the beat. Visuals pulse on the beat.
- **P3 — Instant retry.** Zero friction between death and the next attempt.
  No modal, no load, no animation longer than a flash.
- **P4 — Juicy & vibrant.** Neon geometric art, parallax that breathes,
  particle bursts, a rotating cube with a trail, screen flash on death.
- **P5 — Self-contained.** Pure canvas, procedural everything, no asset files,
  no third-party libraries, strict TypeScript.

### Non-Goals

- No level editor (mentioned in Future Work).
- No online/competitive multiplayer.
- No copy of any official Geometry Dash level, song, or sprite.

---

## 2. Engine Integration Contract

The game is a **canvas module** exporting `create(ctx: GameContext):
GameInstance` from `index.ts`. It only imports from `@/engine` and from its own
folder. It never edits shared files.

### What we use from `GameContext`

| Member | Use |
| --- | --- |
| `ctx.ctx` | 2D context, already DPR-scaled. We always draw in CSS pixels. |
| `ctx.width` / `ctx.height` | **Getters** — read fresh every frame. Drives the responsive layout. |
| `ctx.input` | `pressed/isDown/released` for keys; `pointer{x,y,down,justDown,justUp}` for mouse/touch. |
| `ctx.audio` | `tone/sweep/noise` — the whole soundtrack is synthesised from these three primitives. |
| `ctx.storage` | Persist best % per level (`best.<levelId>`) and settings; `submitScore` syncs the leaderboard. |
| `ctx.reportScore(n)` | Live HUD number — we feed it the best % achieved so far. |
| `ctx.setStatus(text)` | One-line hint above the canvas. |
| `ctx.requestControls([...])` | On-screen JUMP button for touch devices. |
| `ctx.gameOver(score?)` | See note below. |
| `ctx.isTouch` | Tweak hints for touch. |

### Important: why we do **not** call `ctx.gameOver` on every death

`GameHost` implements `gameOver()` by setting an internal `stopped = true`
flag *permanently* and showing its own "Game Over" overlay; once stopped the
host no longer calls `update()`/`render()`. That is correct for single-life
games (Flappy, Canabalt) but is incompatible with two of our hard
requirements:

- **Instant retry** — restarting the level from the beginning with no modal.
- **Level select** — playing multiple levels in one session.

Therefore Neon Dash manages its **own** death, retry, win, and level-select
screens on the canvas and keeps the session running. We still satisfy the
scoring contract:

- `ctx.reportScore(bestPercent)` updates the HUD live.
- `ctx.storage.set("best.<id>", pct)` persists the per-level best.
- `ctx.storage.submitScore(overallBestPercent)` pushes to the leaderboard
  sink **without halting** the game (it does not touch `stopped`).

This is a deliberate, documented deviation in service of the genre's core
feel. The "death/completion reports the progress %" intent is fully honoured —
we just report through `reportScore` + `submitScore` instead of the
session-ending `gameOver`.

### `GameInstance`

- `update(dt)` — fixed-ish step from the host (dt clamped to 50 ms). We
  sub-step physics internally for precision.
- `render()` — repaints the **entire** background every frame (no smearing).
- `resize(w,h)` — world state is stored resolution-independently (cells), so
  resize is essentially free; we just clear cached pixel scratch.
- `destroy()` — null out timers/among references (no external listeners held).

---

## 3. Coordinate System & World Model

Everything in the simulation is expressed in **cells** (grid units), never in
pixels. This makes the game fully resolution- and aspect-independent: on every
frame we compute a single `cellSize` (pixels per cell) from the current canvas
size and project cells → pixels.

```
GRID_ROWS      = 14         // total rows, index 0 (top) .. 13 (bottom)
CEIL_ROWS      = rows 0,1   // solid ceiling (for ship & gravity-flip)
FLOOR_ROWS     = rows 12,13 // solid floor
AIR_ROWS       = rows 2..11 // 10 playable rows
GROUND_TOP_ROW = 12         // top surface of the floor
GROUND_CUBE_ROW= 11         // the row a grounded cube occupies (bottom = 12)
```

The cube is exactly **1×1 cell**. Its world position is:

- `scrollX` — the cube's horizontal world column (a float). It increases at the
  constant scroll speed. The cube is *drawn at a fixed screen X*; the world
  scrolls past it.
- `py` — the cube's top edge, in cell-rows measured from the top of the grid
  (so `py = 11` means grounded). `py` increases downward.

Projection each frame:

```
cellSize  = min(height / GRID_ROWS, width / MIN_VISIBLE_COLS)
playW     = visible columns = width / cellSize
originY   = (height - GRID_ROWS * cellSize) / 2     // vertical letterbox
playerScreenX = width * PLAYER_SCREEN_FRAC          // ~0.30
screenX(col)  = playerScreenX + (col - scrollX) * cellSize
screenY(row)  = originY + row * cellSize
```

`MIN_VISIBLE_COLS` guarantees enough look-ahead on narrow/portrait screens by
shrinking the cells (letterboxing top/bottom) rather than starving the player
of reaction time. The recommended manifest aspect is **1.6** (wide), matching
Canabalt, so the stage is letterboxed to a comfortable widescreen on mobile.

---

## 4. Movement Modes

Neon Dash ships three movement modes; sections of a level switch between them
via portals.

### 4.1 Cube (default)

- Auto-runs right. On the ground (or atop a block) a *jump* applies a fixed
  upward impulse. The arc is fixed (no air control).
- **Hold to keep jumping:** while the jump input is held, the cube re-jumps
  the instant it lands. This is the canonical GD "hold" behaviour and is
  essential for stair/saw rhythm sections.
- Quality-of-life: a short **jump buffer** (press up to ~90 ms before landing
  still jumps) and **coyote time** (jump up to ~80 ms after walking off a
  ledge) so input feels crisp, not robotic.

### 4.2 Ship / Fly

- Entered via a **ship portal** (`S`), exited via a **cube portal** (`C`).
- Gravity is continuous. **Holding** the input applies upward thrust; releasing
  lets gravity pull the cube down. The result is a smooth flappy-glide.
- The cube tilts toward its vertical velocity for readability.
- Ceiling and floor **clamp** the cube (no death on the world bounds) — this is
  the forgiving choice. Death comes only from blocks and spikes inside the
  channel. Fly sections are built as tunnels with safe gaps.

### 4.3 Gravity Flip

- A **flip portal** (`F`) inverts gravity direction (`gravDir` toggles
  +1 ⇄ −1). The cube falls *up*, lands on the ceiling, and runs along it.
- Jump impulse, support detection, and landing all respect `gravDir`, so the
  cube can run and jump on the ceiling exactly as on the floor.
- A second flip (or a flip portal placed later) returns it to normal.

Modes compose: e.g. a flipped cube section can contain pads and orbs; a ship
section can be combined with flip for "upside-down ship" segments (used
sparingly in Level 3).

---

## 5. Physics & Tuning Constants

All values are in **cells** and **seconds**. Derived from a target jump arc of
apex ≈ 2.8 cells and air-time ≈ 0.6 s.

| Constant | Value | Meaning |
| --- | --- | --- |
| `GRAVITY` | 62 | cube-mode gravity (cells/s²) |
| `JUMP_VEL` | 18.7 | cube jump impulse (cells/s) |
| `MAX_FALL` | 34 | terminal velocity (cube) |
| `ORB_VEL` | 19.5 | jump-orb boost impulse |
| `PAD_VEL` | 26 | jump-pad boost impulse (higher) |
| `SHIP_THRUST` | 56 | ship upward acceleration while held |
| `SHIP_GRAV` | 40 | ship downward acceleration |
| `SHIP_MAX_V` | 19 | ship vertical speed clamp |
| `PLAYER_SCREEN_FRAC` | 0.30 | cube's fixed screen-x as a fraction of width |
| `MIN_VISIBLE_COLS` | 15 | minimum look-ahead columns |
| `JUMP_BUFFER` | 0.09 s | pre-land input buffer |
| `COYOTE` | 0.08 s | post-ledge grace |
| `SPIKE_HITBOX` | inset 0.28 (x) / 0.30 (y) | forgiving spike hitbox |
| `CUBE_HITBOX` | inset 0.12 | forgiving cube hitbox |

**Scroll speed** is derived from the song so the world is beat-locked:

```
beatsPerSecond = BPM / 60
speed (cells/s) = CELLS_PER_BEAT * beatsPerSecond     // CELLS_PER_BEAT = 2
```

With `CELLS_PER_BEAT = 2`, one cell is an 8th-note; even columns fall on the
beat, odd columns on the off-beat. Designing on the 8th-note grid keeps jumps
musical.

Worked example (Level 1, BPM 130): `speed = 2 * 130/60 ≈ 4.33` cells/s. Jump
horizontal reach ≈ `speed * airtime ≈ 4.33 * 0.6 ≈ 2.6` cells — comfortably
clears a single spike or a 2-wide cluster, which is exactly how the level is
tuned.

### Sub-stepping

To guarantee fair, tunnel-free collisions, each `update(dt)` integrates physics
in N sub-steps such that neither horizontal (`speed`) nor vertical (`|vy|`)
movement exceeds ~0.2 cells per sub-step:

```
maxMove = max(speed, |vy|) * dt
steps   = clamp(ceil(maxMove / 0.2), 1, 8)
subdt   = dt / steps
```

---

## 6. Obstacle Vocabulary

| Symbol | Name | Behaviour |
| --- | --- | --- |
| `#` | Block | Solid. Land on top; touching any other face = death. Renders as a neon rounded square; stacks into platforms/pillars/stairs. |
| `^` | Spike (up) | Deadly. Sits on the floor (or atop a block). Forgiving inner hitbox. Single or clustered (2–3). |
| `v` | Spike (down) | Deadly. Hangs from the ceiling — used in flip/ship sections. |
| `_` | Gap | Floor is removed for N columns. Falling in = death. Cross by jumping or flying. |
| `o` | Jump orb | Pink ring floating in the air. **Tap while overlapping** to get a mid-air jump (re-armable; one activation per tap). Enables long chains. |
| `p` | Jump pad | Yellow pad on a surface. **Auto-activates** on contact, launching the cube higher than a normal jump. |
| `F` | Flip portal | Toggles gravity direction. |
| `S` | Ship portal | Enter ship/fly mode. |
| `C` | Cube portal | Return to cube mode. |
| Stairs | (built from `#`) | Ascending/descending 1×1 steps; with "hold to jump" they form a rhythmic climb. |
| Platform | (built from `#`) | Wide block to land on and run along; sides are lethal. |
| Pillar | (built from `#`) | Tall thin block to jump onto/over. |

### Composition rules (designer guarantees)

- A spike cluster wider than the single-jump reach is always preceded by a pad
  or paired with an orb.
- Every gap is jumpable from its left lip given the current speed (gap width ≤
  reach − 0.4 cells), or a pad/orb is provided.
- Ship tunnels keep a navigable channel ≥ 3 cells tall at all times.
- After a portal there is ≥ 2 cells of safe runway so the mode switch is
  readable before the first obstacle.

---

## 7. Collision Model

Goal: **precise and fair**. The cube cannot be pushed back (it must keep
moving), so any genuine horizontal penetration of a solid is death, while
approaching a surface from the gravity side is a landing.

Per sub-step, after integrating motion:

1. **Compute cube AABB** in cells, inset by `CUBE_HITBOX` for fairness.
2. **Landing pass (gravity-aware).** Among solids horizontally overlapping the
   cube, find the support surface on the gravity side:
   - `gravDir = +1`: support = the highest cell **top** the cube was at/above
     last sub-step (`prevBottom ≤ top + EPS`). If the cube has reached it and
     `vy ≥ 0`, snap `py = top − 1`, `vy = 0`, `grounded = true`.
   - `gravDir = −1`: mirror using cell **bottoms** and the cube's top.
   The world floor (rows 12–13, where present) and ceiling (rows 0–1) are
   included as solids.
3. **Death pass.** Re-scan solids; any remaining real overlap (both axes >
   `EPS`) that is *not* the surface just landed on = death (you hit a wall, an
   underside, or a pillar's flank).
4. **Spike pass.** For each spike whose forgiving hitbox overlaps the cube's
   forgiving hitbox = death.
5. **Pit pass.** If the cube leaves the playfield on the gravity side
   (`py > GRID_ROWS + 1` when normal, `py < −2` when flipped) = death (fell in
   a gap).
6. **Trigger pass (non-lethal).** Pads auto-fire on contact; orbs arm on
   contact and fire on a fresh press; portals switch mode/gravity on contact.

`EPS = 0.02` cells. Spike and cube insets make the visible "near miss" actually
a miss, which is what makes the game feel fair.

---

## 8. Level Data Format (the DSL)

Levels are stored as **data** — typed arrays of segment objects (plus a small
ASCII escape hatch for bespoke fly tunnels). A compiler turns segments into a
`CompiledLevel`:

```ts
interface CompiledLevel {
  cols: number;                 // total length in columns
  floor: boolean[];             // per-column floor presence
  cells: Uint8Array;            // [col * GRID_ROWS + row] -> CellType
  meta: LevelMeta;              // name, bpm, theme colors, difficulty, etc.
}
```

### Segment kinds

| Segment | Fields | Emits |
| --- | --- | --- |
| `flat` | `n` | N columns of empty runway (floor present). |
| `gap` | `n` | N columns with the floor removed. |
| `spikes` | `n` | An N-wide ground spike cluster (preceded by runway in the design). |
| `platform` | `h, n` | A block H tall, N wide; land on top. |
| `spikedPlatform` | `h, n` | Platform with spikes on its top surface. |
| `pillar` | `h, n` | A tall thin block (jump on/over). |
| `stairs` | `h, dir` | H ascending (`dir=+1`) or descending (`dir=−1`) 1×1 steps. |
| `pad` | `h` | A jump pad at height H (0 = on the floor, or atop a block). |
| `orb` | `row` | A jump orb at a given row. |
| `flip` | – | A gravity-flip portal column. |
| `ship` | – | A ship portal column (enter fly). |
| `cube` | – | A cube portal column (exit fly). |
| `ceilSpikes` | `n` | N ceiling spikes (down) — flip/ship hazards. |
| `raw` | `rows[]` | ASCII block, one char per cell, for bespoke tunnels. |

### ASCII legend (for `raw`)

```
space . = empty      # = block          ^ = spike up      v = spike down
o = orb              p = pad            F = flip portal
S = ship portal      C = cube portal
```

Ragged rows are padded with spaces; unknown characters are treated as empty.
The compiler advances the cursor by the longest row in the block.

---

## 9. Level Designs

Three complete, hand-tuned levels of escalating difficulty. Lengths are in
columns; at the listed BPM/speed they translate to the listed durations.

### Level 1 — "STEREO STEPS"  (Easy · ★☆☆)

- **Theme:** cyan → violet, calm 130 BPM four-on-the-floor groove.
- **Length:** ~150 cols (~35 s). **Teaches:** single jumps, clusters, blocks,
  one short gap, the jump pad, and the jump orb — no mode switches.
- **Beat plan:** every taught obstacle lands on a downbeat; the lead melody
  outlines the safe rhythm of the jumps.
- **Flow:**
  1. 8-col runway (lead-in, music establishes the groove).
  2. Single spike → 2 beats → single spike (learn the basic jump).
  3. Double-spike cluster (learn the wider jump).
  4. Small 1-high platform to land on, run, drop off.
  5. A 2-wide gap (learn gaps).
  6. Stair climb of 3 up, plateau, 3 down (hold-to-jump rhythm).
  7. A jump pad over a 3-spike field (learn the pad).
  8. A jump orb chain across a gap (learn the orb).
  9. Triumphant flat run to the finish line.

### Level 2 — "NEON PULSE"  (Medium · ★★☆)

- **Theme:** magenta → orange, driving 140 BPM with a bassline.
- **Length:** ~210 cols (~45 s). **Adds:** the **ship** section and a
  **gravity-flip** section, tighter clusters, pad+orb combos.
- **Flow:**
  1. Warm-up clusters + a platform-hop sequence.
  2. **Ship section (~36 cols):** a flowing cave with floor pylons and ceiling
     stalactites forming a sine-like channel; one tight pinch on the beat.
  3. Back to cube: pad → orb → pad "bounce lane".
  4. **Gravity-flip section (~28 cols):** flip up, run the ceiling past down-
     spikes and ceiling blocks, flip back down to land on a platform.
  5. A staircase finale with a double-gap and a final pad launch to the line.

### Level 3 — "HYPERDRIVE"  (Hard · ★★★)

- **Theme:** electric blue → hot pink, frantic 160 BPM with arpeggios.
- **Length:** ~260 cols (~50 s). **Adds:** dense triplets of obstacles, fast
  mode-switching, an **upside-down ship** pinch, orb→orb air chains, and
  minimal runway. Demands memorisation.
- **Flow:**
  1. Immediate spike triplets at speed (no easy warm-up).
  2. Pillar parkour: jump pillar → platform → pillar with spikes between.
  3. **Ship pinch:** narrow channel with alternating pylons on the beat.
  4. **Double flip:** flip up over a spike field, flip down onto a moving-looking
     stair, all within ~4 beats.
  5. Orb air-chain across a long gap (orb → orb → pad landing).
  6. A brutal final 8 beats of cluster→gap→cluster, then the finish.

Each level ends with a **finish gate** — reaching `scrollX ≥ cols` triggers the
win state (100%).

---

## 10. Difficulty Curve & Beat Synchronisation

- **Speed scales with BPM**, so later levels are literally faster *and* denser.
- **Reaction window** shrinks from ~0.9 s of look-ahead (L1) toward ~0.6 s
  (L3) as obstacle spacing tightens.
- **New mechanic per level**, always introduced in isolation first (a "teach"
  beat) before being combined.
- **On-beat placement:** the compiler keeps obstacle leading edges on the
  8th-note grid. Because `scrollX(t) = speed * t` and the music clock shares
  `t`, the cube reaches column `C` at beat `C / CELLS_PER_BEAT` — so a spike on
  an even column is always cleared by a jump initiated on the beat.

---

## 11. Music & Audio Design

The soundtrack is generated live from `ctx.audio.tone/sweep/noise`. There is no
scheduling API, so we run a **step sequencer** inside `update()` driven by the
same `levelTime` that drives the scroll — guaranteeing perfect sync and a clean
restart on every retry.

```
stepsPerBeat = 4                    // 16th-note resolution
stepDur      = (60 / BPM) / 4
stepIndex    = floor(levelTime / stepDur)
```

On each new step we read the level's pattern bank and fire voices:

| Voice | Synthesis |
| --- | --- |
| Kick | `sweep(150 → 45, 0.12, "sine")` on quarter notes. |
| Snare/Clap | `noise(0.16)` on beats 2 & 4. |
| Hi-hat | short `noise(0.03, low vol)` on 8ths/16ths per pattern. |
| Bass | `tone(freq, 0.14, "sawtooth"/"square")` following a per-level note list. |
| Lead/Arp | `tone(freq, 0.10, "triangle")` arpeggio, busier in later levels. |

- Each level defines `bpm`, a 16-step `drums` mask, a `bass[]` note ring, and a
  `lead[]` note ring (in semitone offsets from the level's root).
- A separate set of **SFX** (jump, land, orb, pad, portal, death, win) layers
  on top of the music, also via the synth primitives.
- Master volume is the engine's (0.25) × the global mute flag. We keep per-voice
  volumes low (0.1–0.35) so the mix doesn't clip.
- **Beat pulse:** a `pulse` value is set to 1 on each quarter-note and decays;
  the whole visual layer breathes on it.

If the user has muted (engine flag), `ctx.audio` no-ops and the game runs
silently but identically (the visual beat pulse still works from `levelTime`).

---

## 12. Visual & Art Direction

Vibrant neon-geometric, dark background, glowing foreground.

- **Background:** vertical gradient per level theme. Behind it:
  - slow parallax band of large rotating outlined triangles/squares,
  - a faster mid band of small diamonds,
  - a perspective "grid floor" of receding lines,
  - all gently scaling/brightening on the beat pulse.
- **Floor & ceiling:** solid neon bars with a bright top edge and a subtle
  scrolling grid; flash on the beat. Gaps render as voids with a glow lip.
- **Obstacles:** rounded neon squares with inner gradient + outer glow; spikes
  are filled triangles with a bright rim; orbs pulse; pads have an animated arc;
  portals are layered vertical ovals with rotating rings.
- **Cube:** a rounded square with a gradient body, bright outline, a small inner
  face, and **rotation** while airborne (a quarter turn per jump arc). In ship
  mode it tilts to its velocity and grows a small thruster flame.
- **Trail:** the cube leaves a fading stream of shrinking squares in its color.
- **Color:** each level carries `c1`/`c2` (gradient) and an `accent` used for
  the cube, glow, and HUD.

---

## 13. Particles, Trail & Juice

- **Jump:** a small downward puff of shards.
- **Land:** a horizontal dust burst.
- **Orb/Pad:** an expanding ring + sparkles in the orb/pad color.
- **Death:** the cube shatters into ~24 fragments with gravity + a screen
  **flash** and a short camera **shake**; then (after ~0.35 s) instant retry.
- **Portal:** a brief ring + color shift.
- **Beat:** floor edge flash + background brighten.
- Particle pools are capped (~300) and old particles are culled.

---

## 14. Game State Machine & Screens

```
            ┌──────────┐  pick level   ┌──────────┐
            │  SELECT  │ ───────────▶  │ COUNTDOWN│
            └──────────┘               └────┬─────┘
                 ▲                           │ 3..2..1
   back/menu     │                           ▼
            ┌────┴─────┐   die (instant) ┌──────────┐
            │ COMPLETE │ ◀────win─────── │ PLAYING  │
            └──────────┘                 └────┬─────┘
                                              │ die
                                              ▼
                                        ┌──────────┐
                                        │  DEATH   │ (≈0.35s flash)
                                        └────┬─────┘
                                             │ auto
                                             ▼  retry from start
                                         PLAYING
```

- **SELECT** — the level-select screen: a title, three level cards (name,
  difficulty stars, theme swatch, best %), a Practice toggle, and a hint line.
  Navigate with ← →, confirm with Space/Enter, or tap a card. Mute is the
  engine's top-bar button.
- **COUNTDOWN** — a brief "3·2·1" so the player isn't surprised; the music
  starts on "GO" and `levelTime` begins.
- **PLAYING** — the run. HUD: progress bar + %, attempt counter, best %.
- **DEATH** — flash + shake + shatter, then auto-restart (Practice respawns at
  the last checkpoint instead).
- **COMPLETE** — "LEVEL COMPLETE", 100%, best, and buttons: **Next**, **Retry**,
  **Menu**.

All screens are drawn on the canvas; buttons are rectangles hit-tested against
`ctx.input.pointer` and mirrored to keyboard.

---

## 15. Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Jump / Thrust (hold) | Space / ↑ / W / left-click | tap anywhere / JUMP button |
| Activate orb | same as jump (a tap while overlapping) | same |
| Navigate select | ← → / A D | tap card |
| Confirm | Space / Enter / click | tap |
| Pause | Esc / P | (tap pause icon — future) |
| Toggle practice (on select) | P | tap toggle |
| Restart current run | R | (Retry button on death is automatic) |

We register one on-screen control: `{type:"button", key:"Space", label:"JUMP",
id:"jump"}`. Tapping anywhere on the stage also jumps (pointer), so mobile play
needs no precise button.

The jump input is the union of: `Space`, `ArrowUp`, `w`, and
`pointer.down/justDown`. "Held" uses `isDown`/`pointer.down`; "pressed" uses
`pressed`/`pointer.justDown`.

---

## 16. Progress, Scoring & Persistence

- **Progress %** = `clamp(scrollX / cols, 0, 1) * 100`, shown as a top bar and a
  number.
- **Per-level best** stored at `best.<levelId>` (integer %). Updated on death
  and on completion if improved.
- **Overall best** (max over levels) is what we feed to
  `ctx.reportScore(...)` (HUD shows "Best %") and `ctx.storage.submitScore(...)`
  for the leaderboard.
- **Completion** sets that level to 100%.
- **Attempts** per level persisted at `attempts.<id>` (flavour stat).
- Storage is wrapped in try/catch by the engine; we tolerate quota/private-mode
  failures silently.

---

## 17. Checkpoints & Practice Mode

- **Normal mode:** no checkpoints. Death = restart from 0% (the genre's core
  loop, "instant retry").
- **Practice mode** (toggle on the select screen): green checkpoint diamonds are
  dropped automatically at safe intervals (every ~3.5 s of survival, only while
  grounded/stable). On death the cube respawns at the **last checkpoint** with a
  short flash instead of restarting. Practice runs do **not** submit a best %
  (so leaderboard integrity is preserved) but still let players learn a level.
- A checkpoint snapshot captures: `scrollX, py, vy, gravDir, mode, levelTime`
  (so the music resumes in sync) and the particle/visual state is reset.

---

## 18. Camera & Rendering Pipeline

- The cube is pinned at `playerScreenX`; the world scrolls. Vertically the grid
  is fixed (ground stays put) for readability — no vertical camera chasing,
  which keeps obstacles predictable.
- **Death shake:** a decaying random translate applied to the whole scene.
- Render order each frame (all CSS-px):
  1. Background gradient.
  2. Parallax layers (beat-reactive).
  3. Perspective grid floor.
  4. Floor & ceiling bars (with gaps).
  5. Obstacles (blocks, spikes, pads, orbs, portals) within the visible column
     range only.
  6. Cube trail → cube → thruster.
  7. Particles.
  8. Screen flash overlay.
  9. HUD (progress bar, %, attempts, best) and any active screen.

Only the visible column range `[scrollX − playerScreenX/cellSize − 1, scrollX +
(width−playerScreenX)/cellSize + 1]` is iterated for obstacles, so render cost
is independent of level length.

---

## 19. Resize / Aspect / Mobile Robustness

- All simulation is in cells; `cellSize`, `originY`, `playerScreenX` are
  recomputed every frame from the live `ctx.width/height` getters.
- `resize(w,h)` only resets cached scratch (none needed) — no world rescale.
- `MIN_VISIBLE_COLS` keeps look-ahead sane on tall screens by letterboxing.
- Touch: tap-anywhere-to-jump + a JUMP button; all screen buttons are large
  (≥ 44px) and hit-tested in logical pixels.
- The recommended manifest entry uses `aspect: 1.6` so the stage is a
  comfortable widescreen on any device; the game still renders correctly at any
  aspect if that changes.

---

## 20. Edge Cases & Failure Modes

| Case | Handling |
| --- | --- |
| Huge `dt` (tab switch) | Host clamps to 50 ms; we sub-step so physics stay stable; music step loop catches up but caps the number of triggers per frame. |
| Resize mid-run | World unaffected (cell units); next frame re-projects. |
| Mute toggled mid-run | Audio no-ops; beat pulse still from `levelTime`. |
| Pointer + key same frame | Jump de-duped (a single jump per landing). |
| Holding jump through a landing | Re-jumps once per landing (intended). |
| Orb spam | One activation per fresh press (cooldown), re-armable on re-entry. |
| Pad + spike same column | Pad fires before the spike pass would matter; tuned so the launch clears it. |
| Flip while airborne | Allowed; gravity direction changes immediately, support re-evaluated. |
| Ship hitting world bounds | Clamp, no death (forgiving); blocks/spikes still kill. |
| Fell in a gap | Pit pass kills once off the playfield. |
| Level shorter than screen | Still valid; finish triggers on `scrollX ≥ cols`. |
| Storage throws | Swallowed; game continues with in-memory state. |
| Zero-size canvas (pre-layout) | Guard: skip update/render if `width`/`height` ≤ 0. |
| Practice on, then off | Best % submission resumes for fresh runs. |

---

## 21. File Layout & Responsibilities

```
src/games/geometry-dash/
  PRD.md          – this document
  constants.ts    – grid, physics, tuning numbers, cell-type enum
  types.ts        – Segment union, Level/CompiledLevel, particle, state types
  levels.ts       – the 3 hand-designed levels (segment data + metadata)
  level.ts        – compileLevel(): segments/ASCII → CompiledLevel + cell queries
  music.ts        – MusicEngine: beat-synced step sequencer + SFX
  particles.ts    – Particles: pooled bursts, rings, shatter, trail helpers
  render.ts       – Renderer: background, world, cube, HUD, all screens
  game.ts         – NeonDash: state machine, physics, collision, modes
  index.ts        – create(ctx): GameInstance — thin wiring layer
```

Each module is strictly typed (no `any`) and imports only from `@/engine` and
this folder.

---

## 22. Performance Budget

- Target 60 fps on a mid-range laptop and modern phone.
- Per frame: O(visible columns) obstacle draws (~25), O(particles ≤ 300),
  a handful of gradients. No per-frame allocations in hot loops beyond small
  particle objects (pooled where practical).
- No off-screen canvases required; everything draws directly. Gradients for the
  background are recreated per frame (cheap at this size) for beat reactivity.

---

## 23. Accessibility & Fairness

- Forgiving hitboxes (spikes inset ~0.28, cube inset ~0.12).
- Jump buffer + coyote time so timing feels human.
- Practice mode for learning.
- High-contrast neon on dark; the cube and lethal spikes use distinct, saturated
  colors. Death is always telegraphed by a clearly lethal shape.
- Screen flash on death is brief and not strobing; beat pulses are gentle.

---

## 24. Testing Checklist

- [ ] Each level is completable by a skilled player (designer guarantees on gap
      width and cluster width hold at the level's speed).
- [ ] No false-positive deaths when running flat or landing on platforms.
- [ ] No tunneling through spikes at max speed (sub-stepping).
- [ ] Hold-to-jump produces a steady bounce on flat ground.
- [ ] Orbs require a tap; pads auto-fire; both feel responsive.
- [ ] Ship channel is always ≥ 3 cells navigable.
- [ ] Flip sections land cleanly back on the floor.
- [ ] Music restarts in sync on every retry; obstacles feel on-beat.
- [ ] Progress %, best %, and attempts update correctly and persist.
- [ ] Works at 4:3, 16:9, ultra-wide, and portrait (letterboxed) sizes.
- [ ] Touch: tap-to-jump and the JUMP button both work; screen buttons hit.
- [ ] Mute silences audio without affecting gameplay or the beat pulse.

---

## 25. Future Work / Non-Goals

- Level editor + shareable codes.
- More modes (ball, wave, UFO, robot, spider) — the architecture supports
  adding modes as small state additions.
- Per-level leaderboards (currently one overall best %).
- Difficulty-scaled "auto" demo / attract mode.
- Online play (out of scope for an offline arcade entry).

---

*End of PRD.*
