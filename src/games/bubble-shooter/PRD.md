# Bubble Pop Saga — Product Requirements Document

> An original, canvas-only **bubble shooter** (Puzzle Bobble / Bust-a-Move
> lineage) for the CoolHastorGames TypeScript + Vite portal. All art, code,
> level generation, audio and tuning are original to this project. No external
> assets, no copied levels, no third-party libraries.

- **Game id / folder:** `bubble-shooter` (`src/games/bubble-shooter/`)
- **Entry point:** `index.ts` exporting `create(ctx: GameContext): GameInstance`
- **Genre:** Single-player arcade puzzle
- **Engine:** CoolHastorGames canvas runtime (`@/engine`)
- **Rendering:** 100% procedural Canvas 2D (no images, no sprites, no fonts beyond the engine default)
- **Target:** Desktop (mouse) + mobile (touch), any aspect ratio, DPR-scaled

---

## 1. Vision & Pillars

Bubble Pop Saga is a cozy-but-snappy bubble shooter. You sit at the bottom of a
glossy candy-colored field, aim a launcher toward your pointer, and fire colored
bubbles up into a hexagonally-packed cluster. Match three or more of the same
color to pop them. Sever a chunk from the ceiling and the whole dangling mass
rains down for big bonus points. The ceiling creeps lower every few shots, so
the board is always tightening — clear it before it crushes you.

### Design pillars

1. **Readable at a glance.** Bright, high-contrast, distinct hues. Each color
   also carries a faint inner glyph so color-blind players can still tell them
   apart. The aim line always shows exactly where the bubble will go, including
   wall bounces.
2. **Juicy feedback.** Every pop throws colored shards; every drop streaks and
   splashes; snaps give a tactile "click" wobble; big combos shake the screen
   and stack a rising chime. Sound is generated through the engine synth.
3. **Fair pressure.** The next color is always drawn from colors that still
   exist on the board, so a match is always *possible*. Pressure comes from the
   descending ceiling and the cost of stray shots, never from impossible RNG.
4. **One-input simplicity.** Move pointer to aim, click/tap to fire. Optional
   keyboard for accessibility. No menus mid-run except pause.
5. **Resolution independence.** The board is defined in abstract grid cells;
   pixel geometry is recomputed every frame from `ctx.width`/`ctx.height`, so
   the game looks correct at any size and survives live resizes / orientation
   changes.

---

## 2. Engine Contract

The game receives a `GameContext` and returns a `GameInstance`.

### Provided by `ctx`

| Member | Use |
| --- | --- |
| `ctx.ctx` | DPR-scaled Canvas 2D context, drawn in CSS pixels |
| `ctx.width` / `ctx.height` | **Getters.** Logical size in CSS px. Read EVERY frame. |
| `ctx.input` | `pointer {x,y,down,justDown,justUp}`, `isDown`, `pressed`, `released` |
| `ctx.audio` | Procedural synth: `tone`, `sweep`, `noise`, `blip`, etc. |
| `ctx.storage` | `get`/`set` namespaced persistence (best score) |
| `ctx.reportScore(n)` | Push the live score to the HUD |
| `ctx.gameOver(finalScore?)` | End the run, submit the final score |
| `ctx.setStatus(text)` | One-line status text above the canvas |
| `ctx.requestControls(...)` | On-screen mobile controls (we request a FIRE button) |
| `ctx.isTouch` | Touch device hint |

### `GameInstance` we return

```ts
interface GameInstance {
  update(dt: number): void;  // dt in seconds
  render(): void;            // repaint the FULL background every frame
  resize?(w, h): void;       // optional; we recompute from getters anyway
  destroy?(): void;          // tear down timers/listeners (none persistent)
}
```

### Hard rules (from the portal)

- Strict TypeScript, **no `any`**.
- No React, no third-party libraries.
- Import only from `@/engine` and our own folder.
- Canvas-only procedural visuals — **no asset files** of any kind.
- Mouse **and** touch. Aim with the pointer.
- Do **not** edit shared files (engine, manifest) or run build tooling.

---

## 3. Coordinate Systems & Geometry

There are two coordinate spaces:

1. **Cell space** — abstract integer `(row, col)`. The board logic lives here and
   is independent of screen size. `row = 0` is the topmost row (attached to the
   ceiling). Survives resizes untouched.
2. **Pixel space** — CSS pixels for rendering & physics. Derived from cell space
   every frame using the current `ctx.width`/`ctx.height`.

### 3.1 Hex / offset grid

We use a **pointy-top, odd-row-offset** hexagonal packing (the classic
bubble-shooter staggered grid):

- `COLS` = number of bubbles in an **even** row (default `11`).
- **Even rows** (`row % 2 === 0`) hold `COLS` bubbles. Centers at
  `x = R + col * 2R`, for `col ∈ [0, COLS-1]`.
- **Odd rows** (`row % 2 === 1`) hold `COLS - 1` bubbles, shifted right by `R`.
  Centers at `x = 2R + col * 2R`, for `col ∈ [0, COLS-2]`.
- Bubble radius `R = playWidth / (COLS * 2)`.
- Row vertical pitch `rowH = R * √3` (≈ `1.7320508 * R`), the height of a row of
  hexagonally-packed circles.

Where `playWidth` is the usable board width (full canvas width, minus thin side
gutters for the wall frame).

This gives an even row whose left/right bubbles kiss the walls, and odd rows
inset by `R` — the familiar zig-zag silhouette.

### 3.2 Cell → pixel

```
function cellCenter(row, col):
  x = (row even) ? R + col*2R : 2R + col*2R
  x += boardLeft                       // left gutter
  y = ceilingY + R + row*rowH - descendAnim
  return (x, y)
```

- `boardLeft` is the left gutter (a few px for the frame).
- `ceilingY` is a fixed pixel just below the HUD band.
- `descendAnim` is a transient render/physics offset used to smoothly animate a
  ceiling drop (see §7).

### 3.3 Pixel → nearest cell (for snapping)

Given a pixel `(px, py)`:

```
row    = round((py - ceilingY - R + descendAnim) / rowH)
xLocal = px - boardLeft - (row even ? R : 2R)
col    = round(xLocal / (2R))
```

Clamp `row ≥ 0`, clamp `col` to the row's valid range. This yields the cell
whose center is nearest; snapping then searches that cell and its empty
neighbors for the best landing spot (see §6.3).

---

## 4. Hex Neighbor Model

Each cell has up to 6 neighbors. Because odd rows are shifted **right** by `R`,
the column offsets differ by row parity (odd-r offset coordinates):

**Even rows** (`row % 2 === 0`):
```
(row,   col-1)  (row,   col+1)         // left, right
(row-1, col-1)  (row-1, col)           // up-left, up-right
(row+1, col-1)  (row+1, col)           // down-left, down-right
```

**Odd rows** (`row % 2 === 1`):
```
(row,   col-1)  (row,   col+1)         // left, right
(row-1, col)    (row-1, col+1)         // up-left, up-right
(row+1, col)    (row+1, col+1)         // down-left, down-right
```

Neighbors are validated against grid bounds and per-row column counts before
use. This single function powers matching, connectivity, and snap adjacency.

---

## 5. Data Model

```ts
type BubbleColor = number;            // index into the palette, 0..N-1

interface Cell {
  color: BubbleColor;                 // which palette color
  // transient visual state
  spawnT: number;                     // 0..1 pop-in animation
  wobble: number;                     // settle wobble after a snap nearby
  hitFlash: number;                   // brief white flash when first placed
}

type Board = (Cell | null)[][];       // board[row][col]; null = empty
```

The board is a jagged array: `board[row].length` is `COLS` for even rows and
`COLS-1` for odd rows.

### Moving bubble (the shot in flight)

```ts
interface Shot {
  x, y: number;      // pixel center
  vx, vy: number;    // pixel velocity per second
  color: BubbleColor;
  r: number;         // cached radius (== R)
}
```

### Falling bubbles (dropped, disconnected from ceiling)

```ts
interface FallingBubble {
  x, y, vx, vy: number;
  color: BubbleColor;
  spin, spinV: number;
  r: number;
}
```

---

## 6. Core Algorithms

### 6.1 Match detection (flood fill by color)

When a shot snaps into cell `S` of color `c`:

```
visited = set()
stack   = [S]
cluster = []
while stack not empty:
  cell = stack.pop()
  if cell in visited: continue
  visited.add(cell)
  if board[cell] is null or board[cell].color != c: continue
  cluster.push(cell)
  for n in neighbors(cell):
    if n not in visited: stack.push(n)
return cluster
```

If `cluster.length >= MATCH_MIN` (3), pop every cell in `cluster`.

### 6.2 Connectivity / drop detection (flood fill from ceiling)

After a pop (or any board change that removed bubbles), determine which bubbles
are still anchored to the ceiling. Anything not anchored is "floating" and must
drop:

```
anchored = set()
stack    = all occupied cells in row 0
while stack not empty:
  cell = stack.pop()
  if cell in anchored: continue
  if board[cell] is null: continue
  anchored.add(cell)
  for n in neighbors(cell):
    if board[n] != null and n not in anchored: stack.push(n)

floating = all occupied cells NOT in anchored
```

Every floating cell becomes a `FallingBubble` (removed from the board) and
awards escalating bonus points (§8).

### 6.3 Snapping a shot to the grid

A shot stops when it (a) touches any placed bubble (center distance `< 2R`), or
(b) its center reaches the ceiling line (`y <= ceilingY + R`).

To choose the landing cell:

1. Compute the nearest cell `C0` from the shot's pixel center (§3.3).
2. Build candidate set = `{C0} ∪ neighbors(C0)` filtered to **empty, in-bounds**
   cells.
3. Among candidates, also require the cell be **supported** — adjacent to an
   existing bubble or in row 0 (so bubbles can't float on placement). If no
   supported candidate exists (rare edge case at extreme angles), fall back to
   the nearest empty candidate.
4. Pick the candidate whose pixel center is **closest** to the shot center.
5. Place the bubble there with a fresh `Cell` (spawn/hit-flash animation).

If the chosen row would exceed the current board depth, the board grows a new
empty row to accommodate it.

### 6.4 Wall bouncing

The shot's center is constrained to `[boardLeft + R, boardRight - R]`. On
crossing either bound, clamp the position back inside and negate `vx` (with a
tiny energy retention of `~1.0`, i.e. perfectly elastic). The aim preview uses
the same reflection math to draw the predicted path.

The **ceiling** is a hard stop (snap), not a bounce. The shot never bounces off
the bottom — if it somehow exits the bottom (impossible under normal aim limits)
it is recycled.

---

## 7. Ceiling Descent (Pressure)

The board descends to ramp difficulty:

- A **shot counter** increments each fired bubble. Every `SHOTS_PER_DESCENT`
  (starts at 6, decreases slowly with level) the ceiling drops one row.
- **Descend operation:**
  1. Generate one fresh row of bubbles (colors drawn from the active palette
     subset) and `unshift` it onto `board` (it becomes the new row 0).
  2. Every existing row's index increases by 1, so each existing bubble moves
     down exactly `rowH` pixels — pressure increases naturally without moving
     the fixed `ceilingY`.
  3. Set `descendAnim = rowH` and ease it to `0` over ~0.35s. Because rendered
     `y = ceilingY + R + row*rowH - descendAnim`, existing bubbles start at
     their *old* pixel positions and smoothly slide down; the new top row slides
     in from above the ceiling. The offset is applied to physics too for
     consistency during the brief animation.
- A subtle ceiling "ratchet" sound and a 1-row grid flash accompany a descend.

### Death line / lose condition

A horizontal **death line** sits just above the launcher. If, after a snap or a
descend settles, **any** bubble's center crosses the death line → **game over**.

### Win condition

If the board becomes completely empty (every bubble cleared) → **win**. A win
awards a clear bonus and advances to the next level (fresh, denser board) so the
run can continue and rack up score; the best score persists across runs.

---

## 8. Scoring

Live score is reported via `ctx.reportScore` whenever it changes. Final score
is submitted on `ctx.gameOver`. Best score persists in `ctx.storage`.

| Event | Points |
| --- | --- |
| Pop (per bubble in a matched cluster) | `10` each |
| Cluster size bonus | `+5 × (clusterSize − 3)` for clusters above the minimum |
| Drop (disconnected bubbles) | escalating: the *k*-th dropped bubble in one shot is worth `20 × k` (so dropping 5 ≈ 20+40+60+80+100) |
| Combo chain | a multiplier that grows while consecutive shots each pop something; resets on a "dud" shot. Applied to pop points. |
| Level clear | `+1000 × level` |
| No-miss streak | small running bonus for accuracy (optional polish) |

**Combo multiplier:** starts at ×1. Each shot that pops ≥1 bubble bumps it
(`×1 → ×1.5 → ×2 → ×3 …` capped). A shot that pops nothing resets it to ×1. The
HUD shows the current combo when above ×1.

---

## 9. Bubble Color Selection

- The palette has `PALETTE.length` candy colors (default 6). A given board uses
  a **subset** sized by level (`COLORS_BY_LEVEL`, e.g. 4 → 5 → 6).
- **Current** and **next** bubble colors are precomputed and displayed.
- The next color is biased toward colors that **still exist on the board** so a
  useful shot is always available. If the board is somehow monochrome or empty,
  fall back to any palette color in range.
- When the active set shrinks (a color fully cleared), the launcher will stop
  loading that color, preventing unwinnable leftovers.

---

## 10. Game States

```
LOADING → AIMING → FIRING → RESOLVING → (AIMING | DESCENDING) → ...
                                      ↘ WIN → next level → AIMING
                                      ↘ LOSE → gameOver()
PAUSED can overlay AIMING.
```

- **AIMING:** launcher tracks the pointer; aim guide drawn; click/tap fires.
- **FIRING:** shot in flight; walls bounce; collision → snap.
- **RESOLVING:** run match flood-fill, pop, run connectivity flood-fill, drop;
  spawn particles; update score & combo; check win/lose; maybe trigger descend.
- **DESCENDING:** brief animation of a new row sliding in.
- **WIN / LOSE:** full-screen result panel; LOSE calls `ctx.gameOver(score)`.

A single state enum drives `update()`; rendering layers are always painted in a
fixed back-to-front order regardless of state.

---

## 11. Controls

| Input | Action |
| --- | --- |
| Move mouse / drag finger | Aim the launcher (clamped to a safe upward arc) |
| Click / tap | Fire the loaded bubble |
| `Space` / `Enter` / Up | Fire (keyboard accessibility) |
| `Left` / `Right` (`A`/`D`) | Nudge aim angle (keyboard) |
| `S` / Swap button / right-click | Swap current ↔ next bubble |
| `P` / `Esc` | Pause / resume |
| Tap result panel / `Space` | Restart after game over (engine handles via gameOver) |

Aim angle is clamped so you can't fire sideways/down (e.g. within ±78° of
straight up). On touch, a FIRE button is also requested via `requestControls`,
and tapping anywhere in the play field fires too.

---

## 12. Rendering Layers (back → front)

1. **Background:** vertical candy gradient + soft drifting bokeh blobs + a subtle
   vignette. Repainted fully every frame.
2. **Board frame:** rounded side rails / ceiling bar, faint hex guide dots in
   empty cells near the active mass.
3. **Placed bubbles:** glossy spheres — radial body gradient, soft drop shadow,
   crescent rim light, bright specular highlight, faint inner color glyph.
   Spawn-in scale pop + settle wobble.
4. **Falling bubbles:** spinning glossy spheres with motion streaks.
5. **Aim guide:** dashed/dotted poly-line with wall-bounce reflections and a
   translucent ghost bubble at the predicted landing cell.
6. **Launcher:** a rounded cannon/base at the bottom center that rotates to the
   aim angle, with the loaded bubble seated in the muzzle and the next bubble
   waiting on a little tray.
7. **Particles:** pop shards, sparkles, drop splashes, combo pings.
8. **HUD:** score, best, level, combo, shots-until-descend meter, mute-agnostic.
9. **Overlays:** pause, win, lose panels with procedural buttons.

All text uses `drawText` from `@/engine` (Baloo 2 fallback). All sizes are
fractions of `min(width, height)` so the UI scales.

---

## 13. Audio (procedural, via engine synth)

| Event | Sound |
| --- | --- |
| Aim move | (none — avoid spam) |
| Fire | short rising `sweep` (whoosh) |
| Wall bounce | tiny `tone` blip, pitch by speed |
| Snap (no match) | soft wooden `tone` |
| Pop | `tone` cluster, pitch rises with combo; layered `noise` for fizz |
| Drop | descending `sweep` per chunk + soft `noise` splash |
| Combo up | ascending arpeggio step |
| Descend | low ratchet `tone` |
| Win | `audio.win()` fanfare |
| Lose | `audio.lose()` |

Pitch is derived from combo and cluster size for satisfying escalation. All
respect the engine's global mute.

---

## 14. Tunable Constants (`config.ts`)

| Name | Default | Notes |
| --- | --- | --- |
| `COLS` | 11 | bubbles per even row |
| `MATCH_MIN` | 3 | min cluster to pop |
| `INITIAL_ROWS` | 5 | filled rows at level start |
| `SHOTS_PER_DESCENT` | 6 | shots between ceiling drops (min 3) |
| `DESCEND_ANIM` | 0.35 s | slide-in duration |
| `SHOT_SPEED` | ~1.9 × height/s | flight speed (scales with board) |
| `AIM_CLAMP` | 78° | max deviation from vertical |
| `PALETTE` | 6 colors | candy hues + glyphs |
| `COLORS_BY_LEVEL` | [4,4,5,5,6] | active color count ramp |
| `DEATH_ROWS_FROM_BOTTOM` | ~2 rows above launcher | lose line |
| `COMBO_STEPS` | [1,1.5,2,3,4] | multiplier ladder |

All physical speeds are expressed relative to the current canvas size so play
feel is consistent across devices.

---

## 15. Procedural Level Generation

- A level seed is derived from `level` + a per-run salt using the engine
  `mulberry32` RNG, so a single run is deterministic per level but varies run to
  run.
- `INITIAL_ROWS` rows are filled. Top rows are 100% filled; lower rows have an
  increasing chance of gaps to create interesting overhangs.
- Colors are chosen from the level's active subset with light clustering bias
  (a new cell has a chance to copy a neighbor's color) so there are satisfying
  pre-made groups but no trivial giant blobs.
- Each cleared level increases density, color count (up to the cap), and descent
  rate, while the score multiplier from `level` grows the reward.

---

## 16. Resize & Lifecycle

- `update`/`render` read `ctx.width`/`ctx.height` every frame and recompute
  `R`, `rowH`, `ceilingY`, `boardLeft`, launcher position, death line, and HUD
  metrics. No cached pixel geometry survives between frames.
- Cell space is unaffected by resize, so a mid-air shot and the whole board
  remain valid; only the in-flight shot's pixel velocity is rescaled if the
  board width changed materially.
- `destroy()` clears any internal state; the game holds no global listeners or
  timers beyond what the engine manages.

---

## 17. Accessibility & Fairness

- Distinct hues **plus** a faint inner glyph per color (circle, ring, star,
  diamond, triangle, hex) for color-blind support.
- The next color is guaranteed to exist on the board → always solvable shots.
- Aim guide with bounce preview removes guesswork.
- Large touch targets; tap-anywhere-to-fire; on-screen FIRE button.
- Generous snap tolerance so near-misses still feel intentional.

---

## 18. File Layout

```
src/games/bubble-shooter/
  PRD.md          ← this document
  config.ts       ← constants, palette, color glyphs, tuning
  types.ts        ← shared interfaces / enums
  grid.ts         ← HexGrid: storage, neighbors, match, connectivity, snap
  levelgen.ts     ← procedural board generation
  particles.ts    ← particle systems (pops, drops, sparkles, text pings)
  render.ts       ← drawing helpers (glossy bubble, background, aim, HUD)
  game.ts         ← BubbleShooter: state machine, physics, scoring
  index.ts        ← create(ctx): GameInstance
```

---

## 19. Acceptance Checklist

- [ ] Builds under strict TS with no `any` and no external imports.
- [ ] Renders correctly and repaints full background each frame at any aspect.
- [ ] Aim follows pointer; aim line bounces off walls and previews landing.
- [ ] Click/tap fires; shot travels, bounces, snaps to a supported cell.
- [ ] 3+ same-color connected → pop; disconnected mass drops with bonus.
- [ ] Current + next colors shown; next always solvable.
- [ ] Ceiling descends on a shot cadence; death line ends the run.
- [ ] Clearing the board wins → next, denser level.
- [ ] Score from pops + drops + combos; live `reportScore`; `gameOver(score)`.
- [ ] Best score persists across sessions.
- [ ] Pop & fall particles, snap wobble, screen shake, glossy bubbles.
- [ ] Win / lose / pause overlays; mouse + touch both fully playable.

---

## 20. Stretch / Polish (time-permitting)

- Special bubbles: bomb (clears a hex ring), rainbow (matches any color),
  stone (unpoppable, only drops). *(Hooks left in the data model.)*
- Trajectory "ghost" pulse that brightens as you settle on a good shot.
- Aim assist snap to clean angles on slow devices.
- Subtle parallax of the background relative to board descent.
