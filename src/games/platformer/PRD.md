# Mossbloom Run — Product Requirements Document

> An original side-scrolling platformer adventure built for the CoolHastorGames
> portal. 100% original design, procedural canvas art, and hand-authored levels.
> No assets, levels, or characters are copied from any existing game.

- **Game id:** `platformer`
- **Folder:** `src/games/platformer/`
- **Kind:** `canvas` (exports `create(ctx: GameContext): GameInstance`)
- **Author intent:** a tight, "juicy" Super-Mario-style run-and-jump adventure
  with a scrolling camera, tile levels, enemies, coins, power-ups, lives,
  checkpoints, and polished feedback.

---

## 1. Vision & Pillars

**Mossbloom Run** follows **Pip**, a round little forest sprite, as it dashes
through three increasingly tricky biomes to reach the glowing Bloom Gate at the
end of each stage. Pip can run, leap, and bop foes on the head. The world is
made of mossy stone, drifting clouds, bottomless pits, bubbling lava, and
spiky thornbeds.

Design pillars, in priority order:

1. **Movement feels great.** The single most important thing. Acceleration,
   friction, variable jump height, coyote time, and jump buffering must make
   the character feel responsive and forgiving without feeling floaty or
   slippery. If movement isn't fun, nothing else matters.
2. **Readable, juicy feedback.** Every action has a sound and a visual: dust on
   landing, sparkles on coins, a satisfying squash when you stomp a foe,
   screen-shake on big hits, particles everywhere. The player should always
   understand what happened and feel rewarded for it.
3. **Fair, hand-crafted challenge.** Levels are authored by hand as tile maps
   that ramp in difficulty. Hazards are always telegraphed. Checkpoints keep
   frustration low. Death is a setback, not a punishment.
4. **Runs anywhere.** Desktop keyboard and mobile touch are first-class. The
   game adapts to any window size and aspect ratio, every frame.

Non-goals: networked multiplayer, a level editor, persistent meta-progression
beyond best score / furthest level, and externally loaded assets.

---

## 2. Platform, Engine & Constraints

The game is a canvas module inside the portal. It is handed a `GameContext`:

- `ctx.ctx` — a `CanvasRenderingContext2D`, already DPR-scaled. We draw in **CSS
  pixels**; the engine handles device-pixel-ratio scaling.
- `ctx.width` / `ctx.height` — **getters** returning the current logical size in
  CSS pixels. These can change at any time (window resize, orientation change,
  mobile browser chrome). **We must read them every frame** and never cache.
- `ctx.input` — `InputManager` with `isDown(...keys)`, `pressed(...keys)`,
  `released(...keys)`, plus `pointer { x, y, down, justDown, justUp }` and a
  `pointers` map for multi-touch. Pointer coordinates are in logical space.
- `ctx.audio` — `AudioManager` (procedural WebAudio synth): `tone`, `sweep`,
  `noise`, and convenience sfx (`coin`, `jump`, `hit`, `win`, `lose`, ...).
- `ctx.storage` — namespaced `localStorage` wrapper: `get`, `set`, `remove`,
  `submitScore`, `bestScore`.
- `ctx.reportScore(n)` — push the live score to the HUD.
- `ctx.gameOver(finalScore?)` — end the run and (optionally) submit a score.
- `ctx.setStatus(text)` — set the HUD status text above the canvas.
- `ctx.requestControls([...])` — request on-screen touch controls (dpad / button
  / stick).

**Hard constraints (must follow):**

- Strict TypeScript. **No `any`.** No `React`. No third-party libraries.
- Only import from `@/engine` and files within `src/games/platformer/`.
- Canvas-only procedural visuals. **No asset files** (images, audio, fonts).
- Must support both keyboard and touch.
- Must repaint the full background every frame (no stale pixels).
- Do not edit shared engine/registry files from within the game.
- `GameInstance` returns `update(dt)`, `render()`, and optional `resize()` /
  `destroy()`.

**Performance budget:** target 60 fps on a mid laptop and a modern phone.
Per-frame cost is dominated by tile drawing, so we only iterate over the tiles
visible in the camera viewport, not the whole level. Entity counts are modest
(tens, not thousands). Particles are capped.

---

## 3. Coordinate System, Units & Camera

### 3.1 World space

The world is a grid of square tiles. `TILE` is the world-space size of one tile
in pixels (a constant, e.g. `32`). All level geometry derives from the grid:
tile `(col, row)` occupies the world rectangle
`(col*TILE, row*TILE, TILE, TILE)`.

Entity positions, velocities, and physics are all expressed in **world pixels**
and **world pixels per second**. Physics is therefore independent of screen
resolution — we simulate in world space and only scale when drawing.

### 3.2 Screen space & the scale factor

To keep gameplay consistent across wildly different window sizes and aspect
ratios, the camera fixes the number of tile **rows** visible vertically
(`VIEW_ROWS`, ~14–15). Each frame:

```
scale       = canvasHeightCSS / (VIEW_ROWS * TILE)
viewWorldW  = canvasWidthCSS  / scale     // how much world fits horizontally
viewWorldH  = canvasHeightCSS / scale     // == VIEW_ROWS * TILE
```

A wide landscape window therefore shows more of the level horizontally; a tall
portrait phone shows the same number of rows but a narrower slice. Because the
*vertical* view is fixed, jump arcs and hazard spacing always read the same.

Drawing maps world → screen with:

```
screenX = (worldX - camX) * scale
screenY = (worldY - camY) * scale
```

We `ctx.save()`, `ctx.translate(-camX*scale, -camY*scale)`, `ctx.scale(scale,
scale)`, draw everything in world units, then `ctx.restore()`. HUD and overlays
draw afterward in raw screen pixels.

### 3.3 Camera behavior

- **Follow:** the camera target is the player's center, with horizontal
  **look-ahead** in the direction of travel so the player can see what's coming.
- **Smoothing:** the camera lerps toward its target (exponential smoothing with
  a frame-rate-independent factor) for a soft, non-jittery feel.
- **Clamping:** the camera is clamped so it never shows outside the level bounds
  horizontally; vertically it is clamped to the level but allowed to follow the
  player upward for tall sections.
- **Screen shake:** a decaying random offset added to the camera for impacts
  (stomp, damage, power-up, brick break). Shake never affects physics.

---

## 4. Core Loop & Game States

The game is a small state machine. `update(dt)` and `render()` switch on the
current state.

```
TITLE  ──start──▶ INTRO ──▶ PLAYING ──reach goal──▶ LEVEL_CLEAR ──▶ INTRO(next)
   ▲                          │  │                                      │
   │                      die │  │ lose last life                       │ last level
   │                          ▼  ▼                                      ▼
   └──────────────────── (respawn)  GAME_OVER                         VICTORY
```

- **TITLE** — animated splash with the game name, best score / furthest level,
  and "Press Space / Tap to start". A demo of the parallax background plays
  behind it.
- **INTRO** — a brief "Level N — <biome name>" card that fades, then hands off
  to PLAYING. Resets the level clock display but not the run.
- **PLAYING** — normal gameplay; physics, enemies, collisions, HUD all live.
- **DYING** — short freeze + death animation (player pops up and falls) before
  respawn or game-over. Implemented as a sub-state / timer of PLAYING.
- **LEVEL_CLEAR** — flag/goal reached: tally coins + time bonus, play the win
  jingle, show the results card, then advance.
- **GAME_OVER** — all lives spent: show final score, best, "Tap to retry", call
  `ctx.gameOver(score)`.
- **VICTORY** — final level cleared: celebratory screen, grand total, confetti,
  call `ctx.gameOver(score)`.

Transitions are time-gated (short delays) so jingles and animations can play.

### 4.1 The update step

1. Read `ctx.width` / `ctx.height`.
2. Clamp `dt` to avoid spiral-of-death on tab refocus (e.g. cap at ~1/30 s).
3. Poll input → build an intent struct `{ left, right, jumpHeld, jumpPressed,
   jumpReleased, run }` from keyboard + touch.
4. Step the active state. In PLAYING: update player, enemies, moving platforms,
   coins, power-ups, particles, camera; resolve collisions; check win/lose.
5. `ctx.input.endFrame()` is handled by the host; we just read.

---

## 5. Player Character ("Pip")

### 5.1 Physics constants (world px, seconds)

Tunable constants live in `constants.ts`. Initial values (subject to feel
tuning):

| Constant         | Meaning                                   | Value (approx) |
| ---------------- | ----------------------------------------- | -------------- |
| `GRAVITY`        | downward accel                            | 2300           |
| `MAX_FALL`       | terminal fall speed                       | 1150           |
| `WALK_ACCEL`     | ground accel toward target speed          | 1700           |
| `AIR_ACCEL`      | air accel                                 | 1100           |
| `MAX_WALK`       | top speed (no run)                        | 300            |
| `MAX_RUN`        | top speed (holding run)                   | 470            |
| `GROUND_FRICTION`| decel when no input on ground             | 2000           |
| `AIR_FRICTION`   | decel when no input in air                | 250            |
| `JUMP_V`         | initial jump velocity (up = negative)     | 830            |
| `JUMP_CUT`       | velocity multiplier on early release      | 0.45           |
| `COYOTE_TIME`    | grace after leaving ground                | 0.09 s         |
| `JUMP_BUFFER`    | grace before landing                      | 0.12 s         |
| `BOUNCE_V`       | upward velocity after stomping an enemy   | 560            |
| `HURT_INVULN`    | i-frames after taking damage              | 1.4 s          |

### 5.2 Movement model

- **Horizontal:** input sets a target speed (`±MAX_WALK` or `±MAX_RUN`). Velocity
  accelerates toward the target by `WALK_ACCEL`/`AIR_ACCEL * dt`. With no input,
  velocity decays toward zero by friction. This gives weighty-but-snappy control
  with a little skid, not ice-skating.
- **Jump:** allowed when grounded OR within `COYOTE_TIME` of leaving the ground.
  A jump press is buffered for `JUMP_BUFFER` so a slightly-early press still
  fires on landing. On jump: `vy = -JUMP_V`, play jump sfx, spawn a dust puff.
- **Variable height:** if the jump key is released while still rising
  (`vy < 0`), `vy *= JUMP_CUT`. Tapping = short hop; holding = full leap.
- **Gravity:** applied each frame; clamped to `MAX_FALL`. Slightly higher
  gravity while falling than rising ("fast-fall") can be added for snappier
  arcs.

### 5.3 Collision

Axis-separated swept AABB against solid tiles:

1. Apply X velocity, move the player box, resolve overlaps with solid tiles on
   the X axis (push out, zero `vx` on contact).
2. Apply Y velocity, move, resolve on the Y axis (push out; on landing set
   `grounded = true`, `vy = 0`, fire landing dust if falling fast; on hitting a
   ceiling zero `vy` and, if a breakable brick is above, break it).
3. **One-way platforms:** solid only from above. The player passes up through
   them and lands on top; pressing **down** while standing drops through.
4. **Moving platforms:** when the player stands on one, inherit its delta so the
   player rides along.

### 5.4 States & animation

Procedurally drawn (no sprites). Animation states:

- **Idle** — gentle breathing bob; occasional blink.
- **Run** — leg/arm swing cycle whose speed scales with horizontal speed; body
  lean into motion; small bob.
- **Jump / Fall** — tucked legs rising, reaching pose falling.
- **Hurt** — flashing (alternating visibility) during i-frames.
- **Power states** affect size/color: **Small** (base), **Big** (after
  mushroom — taller, can take one extra hit and break bricks), **Star** (rainbow
  flashing, invincible, slightly faster) for the star's duration.

Pip faces the last horizontal direction. Eyes/expression react (squint on run,
wide on fall).

### 5.5 Damage, death, lives

- Touching a hazard (spikes/lava) or being hit by an enemy from the side causes
  **damage**. If **Star** active → no damage. If **Big** → downgrade to Small,
  brief i-frames, knockback. If **Small** → **die**.
- Falling into a pit (below the level) → instant death (ignores Big/Star).
- Lava → instant death.
- Death: lose a life, play death animation + lose sfx, then respawn at the last
  checkpoint (or level start) if lives remain, else GAME_OVER.
- Start with **3 lives**. Extra lives can be earned (every 100 coins, and from a
  rare 1-Up pickup).

---

## 6. Tiles & Level Format

### 6.1 Tile legend

Levels are authored as arrays of equal-length strings (one char per tile). The
parser converts characters into a tile-type grid plus a list of spawned
entities (so dynamic things aren't baked into the static grid).

| Char | Tile / Spawn            | Notes                                            |
| ---- | ----------------------- | ------------------------------------------------ |
| ` `  | Empty / air             |                                                  |
| `#`  | Ground (solid)          | mossy stone block, full collision                |
| `D`  | Dirt/under-ground       | solid, visual variant below ground               |
| `B`  | Brick (breakable)       | solid; Big Pip breaks it from below/side stomp   |
| `?`  | Question block          | solid; bump from below to release a coin/power-up |
| `=`  | One-way platform        | solid only from above; drop-through with Down     |
| `^`  | Spikes (hazard)         | damage on contact                                 |
| `~`  | Lava (hazard)           | instant death                                     |
| `o`  | Coin                    | collectible spawn                                 |
| `P`  | Player start            | spawn point                                       |
| `C`  | Checkpoint flag         | activates on touch                                |
| `G`  | Goal / Bloom Gate       | level exit                                        |
| `g`  | Walker enemy ("Grumbug")| patrols, reverses at edges/walls, stompable      |
| `f`  | Flyer enemy ("Flutter") | sine-wave flight, stompable                       |
| `s`  | Shelled enemy ("Snapper")| stomp → shell; kick shell to clear foes         |
| `m`  | Mushroom spawn marker   | placed inside `?` usually; or free pickup        |
| `*`  | Star spawn marker       | rare power-up                                     |
| `M`  | Moving platform anchor  | defines a platform that oscillates               |

The block grid stores only static collision tiles (`# D B ? = ^ ~ C G`).
Collectibles, power-ups, enemies, and moving platforms are extracted into
entity lists at parse time and removed from the grid (the cell becomes empty or,
for `?`, a question block that remembers its contents).

### 6.2 Moving platforms

A moving platform is defined by an `M` anchor plus metadata in the level's
config (axis: horizontal/vertical, range in tiles, speed, phase). It oscillates
with a sine/triangle wave between two endpoints. The player and enemies ride it.
Platforms carry a per-frame delta used to move riders.

### 6.3 Level metadata

Each level provides:

- `name` — biome label shown on the intro card (e.g. "Mossy Meadow").
- `rows` — the tile-map string array.
- `palette` — color set for tiles & parallax (per biome theme).
- `timeLimit` — seconds for the time bonus / soft timer (optional, generous).
- `movers` — moving-platform definitions.
- `music` — a simple procedural background motif descriptor (tempo/scale) —
  optional ambient bleeps, kept subtle and mute-respecting.

### 6.4 The three levels (difficulty ramp)

1. **Level 1 — "Mossy Meadow" (tutorial-easy).** Gentle hills, lots of coins,
   a few Grumbugs, one short pit, one `?` block with a mushroom, a single
   moving platform, one checkpoint. Teaches run, jump, stomp, coins, power-up.
2. **Level 2 — "Bramble Hollow" (medium).** Spike thornbeds, longer pits,
   Flutters in the air, more Grumbugs and a Snapper, two moving platforms (one
   vertical), a star tucked off the main path, two checkpoints. Demands
   precision jumps and timing.
3. **Level 3 — "Emberdeep Caverns" (hard).** Lava lakes, narrow platforms over
   instant-death pits, fast moving platforms, a mix of all enemy types, tight
   brick mazes, a star to reward a risky route, two checkpoints, and a climactic
   run to the Bloom Gate. The toughest jumps and the least margin for error.

Levels are designed to be **completable** and fair: every jump is reachable,
every hazard telegraphed, and a checkpoint precedes each truly hard stretch.

---

## 7. Enemies

All enemies are drawn procedurally and animate. Common behavior: they walk/fly,
respect solid tiles, fall with gravity (walkers), reverse at ledges and walls,
and are removed when far off-screen behind the camera. The player can defeat
most by stomping (landing on top while falling); side contact hurts the player.

- **Grumbug (`g`)** — a beetle-like walker. Patrols a platform, turns around at
  walls and ledges. Stomp → squashed poof + score. Side touch → damage. Moves
  ~110 px/s.
- **Flutter (`f`)** — a winged seed that flies in a horizontal sine wave at a
  set altitude. Stomp → poof; side touch → damage. Cannot be walked on.
- **Snapper (`s`)** — a turtle-ish foe. Stomp once → retreats into a sliding
  shell that is harmless when still but, when kicked (touched from the side),
  rockets along the ground destroying other enemies; it can also ricochet back
  and hit Pip, so shells are risky. Stomp the moving shell to stop it.

Enemies award score on defeat (e.g. 100), with a small chain bonus for
defeating several without touching the ground (combo via shell or repeated air
stomps).

---

## 8. Collectibles & Power-ups

- **Coins (`o`)** — the core collectible. Spin/shimmer animation. +1 coin,
  small score, sparkle particles, `coin` sfx. Coins are the main score driver.
  Every 100 coins → +1 life.
- **Question blocks (`?`)** — bump from below to pop the contents: usually a
  coin, sometimes a **mushroom** (`m`) or, rarely, a **star** (`*`). Spent
  blocks become inert.
- **Mushroom (Bloomcap)** — slowly walks like a Grumbug after spawning;
  collecting it makes Pip **Big** (taller, survives one extra hit, can smash
  bricks). Collecting while already Big → bonus coins.
- **Star (Gleamstar)** — bounces around; collecting grants **invincibility +
  slight speed boost** for ~8 s with a rainbow flashing effect and an upbeat
  音 motif. Touching enemies while starred defeats them.
- **1-Up (rare)** — directly grants +1 life with a distinct jingle.

---

## 9. Scoring & Persistence

- **Score sources:** coins (+10 each), enemy defeats (+100, combo-scaled),
  power-up pickups (+50), and a **completion bonus** per level = remaining time
  bonus (e.g. `floor(timeLeft) * 5`) plus a flat clear bonus (e.g. 500).
- **Live reporting:** `ctx.reportScore(score)` is called whenever the score
  changes during play so the HUD stays current.
- **End of run:** `ctx.gameOver(score)` is called on GAME_OVER and on VICTORY
  with the final total. The engine submits it to the leaderboard.
- **Persistence (`ctx.storage`):**
  - `best` — best total score ever (via `submitScore`, also mirrored locally).
  - `furthest` — highest level index reached, shown on the title screen.
  - These let the title screen show "Best: N — Furthest: Level K".

Checkpoints and lives are **run-scoped** (not persisted) — each new run starts
fresh at Level 1 with 3 lives. (Persisting mid-run progress is a non-goal.)

---

## 10. Controls

### 10.1 Keyboard

| Action      | Keys                                   |
| ----------- | -------------------------------------- |
| Move left   | `ArrowLeft`, `A`                       |
| Move right  | `ArrowRight`, `D`                      |
| Jump        | `Space`, `ArrowUp`, `W`, `Z`           |
| Run / sprint| `Shift`                                |
| Drop-through| `ArrowDown`, `S` (on one-way platform) |
| Start/confirm | `Space` / click on menus             |
| Pause (soft)| `Escape` / `P` (optional)              |

Variable jump: hold for height, release early for a short hop.

### 10.2 Touch

Requested via `ctx.requestControls`:

- A **d-pad** for left/right (and down to drop through).
- A **JUMP** button (`Space`).
- A **RUN** button (`Shift`) so mobile players can sprint.

On menus/overlays, a tap anywhere starts/confirms. Pointer coordinates feed the
title/menu hit-testing. Multi-touch is supported so players can hold a direction
and tap jump simultaneously.

---

## 11. HUD & Screens

### 11.1 In-game HUD (screen-space overlay)

Top bar, drawn after the world, scaled to screen size:

- **Coins** — coin icon + count.
- **Lives** — heart/Pip icon + count.
- **Level** — "1-3" style label or biome name.
- **Time** — elapsed or remaining level time.
- **Score** — current total (also shown live by the host HUD via `reportScore`).

The HUD is compact and uses semi-transparent panels for legibility over any
background. Sizes derive from screen height so it scales on mobile.

### 11.2 Overlays

- **Title** — name, tagline, best/furthest, animated background, start prompt.
- **Level intro** — biome name + level number card, brief fade.
- **Level clear** — "Stage Clear!", coins collected, time bonus, running total,
  auto-advance after a moment or on tap.
- **Game over** — "Game Over", final score, best, retry prompt.
- **Victory** — "You reached the Bloom!", grand total, confetti, retry/continue.
- **Pause** (optional) — dim + "Paused".

All overlays are drawn procedurally with rounded panels (`roundRect`), the
shared `drawText` helper, and gentle animation.

---

## 12. Audio

Using `ctx.audio` (procedural synth, respects global mute):

- **Jump** — `audio.jump()` sweep.
- **Coin** — `audio.coin()` two-tone blip.
- **Stomp** — short downward `tone`/`sweep`.
- **Power-up** — ascending arpeggio (`tone` sequence).
- **Damage / die** — `audio.hit()` noise + `audio.lose()` motif.
- **Brick break** — noise burst.
- **Checkpoint** — pleasant two-note chime.
- **Level clear / victory** — `audio.win()` jingle (extended for victory).
- **Optional ambient music** — a sparse, slow procedural motif per biome, low
  volume, that never competes with sfx and stops on pause/mute. Kept minimal to
  avoid annoyance; can be disabled.

Audio is always best-effort: if the context can't start (autoplay policy), the
game still plays silently.

---

## 13. Visual Style & Procedural Art

A soft, storybook palette per biome. Everything is canvas paths/gradients:

- **Parallax background (back→front):** vertical sky gradient; a far layer of
  rolling hills/mountains; a mid layer of hills or cavern walls; drifting clouds
  or floating spores; an optional near foreground silhouette. Each layer scrolls
  at a fraction of the camera speed for depth. Layers are biome-themed.
- **Tiles:** mossy stone blocks with a lighter top "grass/moss" cap and subtle
  shading; dirt variant underground; bricks with mortar lines; glowing question
  blocks with a bobbing "?"; metallic-ish one-way platforms; jagged spikes;
  animated lava with a wavy emissive surface; a shimmering Bloom Gate.
- **Characters:** Pip is a rounded body with big expressive eyes, little limbs,
  and a leaf sprout; enemies have clear silhouettes and telegraphing colors
  (warm/orange = dangerous). Animations are math-driven (sine bobs, swing
  cycles, squash-and-stretch).
- **Particles:** dust (land/run), coin sparkles, enemy poof, brick debris,
  power-up sparkles, star trail, victory confetti. A capped pool keeps perf
  steady.
- **Screen shake & flashes** for impact, plus a brief white/red full-screen
  flash on power-up / damage.

---

## 14. Architecture & Files

```
src/games/platformer/
  PRD.md         — this document
  index.ts       — create(): orchestrates state machine + main loop + I/O glue
  constants.ts   — all tunable constants (physics, sizes, colors, timing)
  types.ts       — shared types/enums (no any)
  levels.ts      — hand-authored level maps + metadata + parser
  camera.ts      — Camera (follow, smoothing, clamp, shake, world↔screen)
  particles.ts   — ParticleSystem (pooled), particle emitters
  sfx.ts         — thin wrappers over ctx.audio for game sounds
  physics.ts     — axis-separated swept-AABB tile collision (TileQuery/Body)
  player.ts      — Player class (physics, collision, power states, animation)
  enemies.ts     — enemy types + behavior + drawing
  world.ts       — World runtime: tile grid + parser, collision queries,
                   entities, coins/power-ups/movers, win/lose checks
  render.ts      — background/parallax + tile + entity drawing in world space
  hud.ts         — HUD + all overlay screens in screen space
```

Separation of concerns:

- **Simulation** (`player`, `enemies`, `world`, `particles`, `camera`) is pure
  world-space logic, unaware of screen size beyond the viewport rect handed to
  it.
- **Rendering** (`render`, `hud`) reads simulation state and draws.
- **Orchestration** (`index`) owns the state machine, reads input, advances the
  active level, and bridges to the host (`reportScore`, `gameOver`, `setStatus`,
  `requestControls`).

### 14.1 Key types (illustrative)

```ts
type TileType = "empty" | "ground" | "dirt" | "brick" | "question"
              | "oneway" | "spike" | "lava" | "checkpoint" | "goal";

interface Vec { x: number; y: number; }
interface Box { x: number; y: number; w: number; h: number; }

interface Intent {
  left: boolean; right: boolean; down: boolean;
  jumpPressed: boolean; jumpHeld: boolean; jumpReleased: boolean;
  run: boolean;
}

type PowerState = "small" | "big" | "star";
type GameState = "title" | "intro" | "playing" | "levelclear"
               | "gameover" | "victory";
```

---

## 15. Detailed Collision Algorithm

For an entity box moving by `(vx*dt, vy*dt)` against the tile grid:

1. **Horizontal pass.** Add `vx*dt` to `x`. Compute the range of tile columns &
   rows the box now overlaps. For each solid tile, if it intersects: if moving
   right, set `x = tileLeft - w`; if moving left, set `x = tileRight`; then
   `vx = 0`. One-way and hazard tiles are skipped here (no horizontal blocking
   for one-way; hazards are detected separately as triggers).
2. **Vertical pass.** Add `vy*dt` to `y`. Recompute overlap. For each solid
   tile: if moving down, set `y = tileTop - h`, `vy = 0`, `grounded = true`; if
   moving up, set `y = tileBottom`, `vy = 0` (and trigger brick/question bump).
   One-way platforms only block when moving down **and** the entity's previous
   bottom was at/above the platform top (so you can jump up through them); they
   are ignored while `down` is held (drop-through).
3. **Triggers (non-blocking):** after movement, test the box against hazard
   tiles (spike/lava) and entity collectibles (coins, power-ups) and the goal.
   These don't push the entity; they fire effects.

Grounded is recomputed each frame; coyote timer resets when grounded and counts
down otherwise. Standing on a moving platform is detected by a 1px probe below
the feet against mover boxes; if found, inherit its delta before the player's
own movement.

To avoid tunneling at high speed, movement can be sub-stepped if `|v*dt|`
exceeds a fraction of `TILE` (clamp dt + optional sub-steps).

---

## 16. Edge Cases & Robustness

- **Resize / orientation change mid-play:** read `width`/`height` every frame;
  recompute `scale` and viewport; camera re-clamps; no world state depends on
  screen size, so play continues seamlessly. `resize()` is also implemented.
- **Huge `dt` (tab unfocus):** clamp `dt` (e.g. ≤ 1/30 s) so physics never
  tunnels or explodes.
- **Tiny / extreme aspect ratios:** fixed vertical rows guarantee jumps stay
  consistent; horizontal view simply widens/narrows. HUD scales to height.
- **Mute:** all audio goes through `ctx.audio`, which respects the global mute;
  no special handling needed.
- **Pointer vs key parity:** touch controls inject virtual keys, so gameplay
  code only ever reads `input.isDown/pressed/released` and treats both equally.
- **Falling out of the world:** if the player's top exceeds level bottom +
  margin → death (pit).
- **Cleanup:** `destroy()` stops any timers/ambient audio and clears references;
  no listeners are added directly (input is via the shared manager).
- **No assets:** all art/audio is generated at runtime; first frame is instant.

---

## 17. Tuning & Playtest Checklist

Movement feel (most important):

- [ ] Jump feels responsive; buffered jump fires on landing.
- [ ] Coyote time lets you jump just after leaving a ledge.
- [ ] Variable height: tap = small hop, hold = full jump.
- [ ] Run accel/skid feels weighty but not slippery; turn-around is quick.
- [ ] Landing has dust + (optional) tiny squash; no jitter against walls/floors.

Systems:

- [ ] Stomp kills enemies; side contact damages; Big downgrades; Star ignores.
- [ ] Coins, `?` blocks, mushroom (grow + brick break), star (invincible) work.
- [ ] Moving platforms carry the player and enemies correctly.
- [ ] One-way platforms: land on top, jump up through, drop through with Down.
- [ ] Checkpoints respawn correctly; lives decrement; 100 coins = +1 life.
- [ ] Each level is completable; goal triggers level clear; last level → victory.
- [ ] Score = coins + enemies + power-ups + completion bonus; `reportScore`
      live; `gameOver(score)` on end; best/furthest persisted.

Presentation:

- [ ] Parallax depth reads well; background repainted each frame.
- [ ] Particles, screen shake, flashes fire on the right events and are capped.
- [ ] HUD legible on small/large screens; overlays animate and are tappable.
- [ ] Runs at 60 fps with only visible tiles drawn.

Robustness:

- [ ] Resize/orientation changes are seamless.
- [ ] Strict TS passes; no `any`; only `@/engine` + local imports; no assets.
- [ ] Keyboard and touch both fully playable.

---

## 18. Future Ideas (out of scope for v1)

- More biomes & enemy variety; mid-level mini-bosses.
- A second power-up tier (e.g. a glide leaf, a ground-pound).
- Time-attack mode and per-level best times.
- Hidden bonus rooms and secret exits.
- A simple in-repo level editor exporting the string format.

---

*End of PRD.*
