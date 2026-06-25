# Putt Park — Product Requirements Document

> An original, top-down, drag-to-putt mini-golf game for the CoolHastorGames
> portal. Everything (course design, art, physics, audio) is original and
> generated procedurally in code on a single 2D canvas. No external assets, no
> libraries, no React.

- **Game id / folder:** `src/games/mini-golf/`
- **Module entry:** `index.ts` exporting `create(ctx: GameContext): GameInstance`
- **Scoring:** strokes (LOWER is better). Final score = total strokes across the
  whole course, submitted via `ctx.gameOver(totalStrokes)`.
- **Rendering:** canvas-only, procedural, repainted every frame.
- **Input:** mouse + touch. Drag *back* from the ball (slingshot) to aim & set
  power; release to putt.

---

## 1. Vision & Pillars

Putt Park is a cozy, juicy, hand-crafted mini-golf course you can play in a
minute or obsess over for a perfect round. The feel of a clean putt — the soft
click of the club, the ball curving off a bumper, the satisfying *plonk* as it
drops — is the whole point. Everything else exists to support that loop.

Design pillars:

1. **Tactile putting.** Aiming and power must feel direct and predictable. A
   visible aim line with a *predicted bounce path* removes guesswork on the
   first putt while leaving room for mastery. Physics must be stable and
   deterministic enough that the same putt gives the same result.
2. **Readable courses.** Each hole reads at a glance: where is the cup, what's
   in the way, what's the trick. Hazards are color-coded and animated so intent
   is obvious. Par communicates expected difficulty.
3. **Original, charming art.** Felt-green fairways with mow stripes, wooden
   rails, a waving flag, rippling water, stippled sand, glowing bumpers. All
   drawn with canvas primitives — no sprites.
4. **Juice.** Screen-readable feedback for every event: putt whoosh, wall thunk,
   bumper boing, sand shuffle, water splash, rim lip-out, and a celebratory cup
   drop. Subtle particles and squash/stretch where it helps.
5. **Respect the player's time & device.** Works at any size/aspect, on desktop
   and mobile, with no load time. Picks up where you left off conceptually
   (best round persisted).

Non-goals: multiplayer, level editor UI, real-world course/brand replication,
3D, networked leaderboards beyond the portal's built-in score submission.

---

## 2. Platform & Engine Contract

The portal hands the game a `GameContext` and expects a `GameInstance`.

```ts
export function create(ctx: GameContext): GameInstance;

interface GameInstance {
  update(dt: number): void;   // dt in seconds
  render(): void;             // repaint full background every frame
  resize?(w: number, h: number): void;
  destroy?(): void;
}
```

Key context members the game relies on:

- `ctx.ctx` — `CanvasRenderingContext2D`, already DPR-scaled; we draw in CSS
  pixels.
- `ctx.width` / `ctx.height` — **getters** for the current logical size. They
  are read **every frame** (never cached across frames) so the game adapts to
  any size, aspect ratio, orientation change, or mobile viewport.
- `ctx.input` — `InputManager`: `pointer { x, y, down, justDown, justUp }`,
  `pointers` (multi-touch map), `isDown(...keys)`, `pressed(...keys)`. Pointer
  coordinates are already in logical (CSS px) canvas space.
- `ctx.audio` — `AudioManager`: `tone`, `sweep`, `noise`, plus convenience sfx.
- `ctx.storage` — namespaced persistence (`get`, `set`, `submitScore`).
- `ctx.reportScore(n)` — live HUD score (we feed running total strokes).
- `ctx.gameOver(finalScore?)` — ends the run; we pass total strokes.
- `ctx.setStatus(text)` — small text above the canvas.
- `ctx.requestControls(controls)` — on-screen buttons for mobile.

Engine rules we must honor:

- **Strict TypeScript, no `any`.** All shapes typed.
- Import only from `@/engine` and files inside `src/games/mini-golf/`.
- Do **not** edit shared engine/manifest files.
- No asset files; visuals are 100% procedural.
- The full background is repainted each frame in `render()`.
- Clean up listeners/timeouts in `destroy()`.

---

## 3. Coordinate Systems

Two spaces are used:

1. **World space** — abstract design units used to author holes and run physics.
   Each hole declares its own `bounds = { w, h }` in world units. World units are
   roughly "design pixels": typical hole bounds are ~700–1200 units per side.
   World y increases downward (screen-like).
2. **Screen space** — logical CSS pixels for the current frame, sized
   `ctx.width × ctx.height`.

### 3.1 Fit transform

Every frame we compute a **fit transform** mapping world → screen so the hole's
bounds are centered and fully visible (letterboxed), leaving padding for the HUD:

```
playArea = the screen rect below the top HUD band and above the bottom safe area
scale    = min(playArea.w / bounds.w, playArea.h / bounds.h)
offsetX  = playArea.x + (playArea.w - bounds.w * scale) / 2
offsetY  = playArea.y + (playArea.h - bounds.h * scale) / 2

screen.x = world.x * scale + offsetX
screen.y = world.y * scale + offsetY
```

The inverse transform converts pointer (screen) coordinates to world space for
aiming:

```
world.x = (screen.x - offsetX) / scale
world.y = (screen.y - offsetY) / scale
```

Because `ctx.width/height` are read every frame, rotating a phone or resizing the
window simply recomputes the transform — the game never assumes a fixed size.

### 3.2 Why design in world units

Authoring holes in stable world units (independent of device) means a hole looks
and plays identically everywhere; only `scale` changes. Physics constants are
expressed in world units/second so feel is device-independent.

---

## 4. Data Format: Course & Holes

A **course** is an ordered array of **holes**. A hole is pure data describing
geometry + hazards; the renderer and physics interpret it. This separation keeps
hole design declarative and easy to extend.

### 4.1 Primitive types

```ts
interface Vec { x: number; y: number; }

// A straight collidable wall segment from a → b.
interface Wall {
  a: Vec;
  b: Vec;
  restitution?: number; // 0..1 bounciness (default WALL_RESTITUTION)
  kind?: "rail" | "inner" | "post"; // visual hint only
}

// Region shapes used by hazards / zones.
type Shape =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "circle"; x: number; y: number; r: number }
  | { type: "poly"; points: Vec[] };

// Circular elastic bumper (pinball-style).
interface Bumper {
  x: number; y: number; r: number;
  restitution?: number; // default BUMPER_RESTITUTION (>1 gives a boost)
}

// Directional acceleration zone (ramp / slope). dir is a unit vector;
// strength is acceleration magnitude (world units / s^2).
interface Slope {
  shape: Shape;
  dir: Vec;
  strength: number;
}

// A rectangular block that patrols between waypoints and collides like a
// solid moving body (its velocity is imparted to the ball on contact).
interface Mover {
  w: number; h: number;        // block size (world units)
  path: Vec[];                 // >=2 center waypoints
  speed: number;               // world units / sec along the path
  phase?: number;              // 0..1 starting offset along the loop
  pingpong?: boolean;          // bounce back vs loop (default true)
}

interface Hole {
  id: number;                  // 1-based
  name: string;
  par: number;
  bounds: { w: number; h: number };
  tee: Vec;                    // ball start
  cup: Vec;                    // hole/cup center
  cupRadius?: number;          // default CUP_RADIUS
  // Outline polygon of the playable green (may be concave for L/Z shapes).
  // Boundary walls are auto-generated from this loop, and the felt is filled
  // from it. Authors generally only design this + interior obstacles.
  green: Vec[];
  walls?: Wall[];              // interior walls / dividers / posts
  bumpers?: Bumper[];
  sand?: Shape[];              // sand traps (high rolling friction)
  water?: Shape[];             // water hazards (stroke reset + penalty)
  slopes?: Slope[];            // ramps / hills
  movers?: Mover[];            // moving blocks
  hint?: string;               // one-line strategy tip shown on the intro card
}

type Course = Hole[];
```

### 4.2 Boundary generation

Given `green` (a closed polygon, listed clockwise), the loader produces a `Wall`
for each consecutive edge (and the closing edge). These boundary walls keep the
ball inside the felt and are rendered as a wooden rail. Authors may still add
extra interior `walls` for dividers, dog-legs, and chicanes.

This is the core authoring convenience: **the visible green shape and its
colliders are the same data**, so they can never drift apart.

### 4.3 Hazard semantics

- **Sand (`sand`)** — while the ball's center is inside a sand shape, apply a
  much larger rolling friction (`SAND_FRICTION`). Sand also dampens speed on
  entry slightly. Visually: tan stippled blob. The ball can still roll through
  and out; sand never resets a stroke.
- **Water (`water`)** — if the ball's center enters a water shape, the shot is
  ruled into the hazard: play a splash, **add a +1 penalty stroke**, and return
  the ball to the position it rested at *before the current stroke* (the
  pre-shot spot). Ball velocity is zeroed and control returns to the player.
- **Slopes (`slopes`)** — while inside the shape, add `dir * strength * dt` to
  velocity each step. Used for ramps that push the ball uphill/sideways and for
  funnels toward/away from the cup. Rendered with directional chevrons.
- **Bumpers (`bumpers`)** — circular elastic colliders. On contact, the ball is
  pushed out and its velocity reflected about the contact normal with
  `BUMPER_RESTITUTION` (slightly > 1 for a satisfying boost), capped to a max
  speed. Flash + boing on hit.
- **Movers (`movers`)** — rectangular blocks whose center is a function of time
  along `path`. Each frame the block's 4 edges act as walls; on contact the
  block's instantaneous velocity is added to the reflected ball velocity so a
  block can knock a resting ball or block a lane.

### 4.4 Course composition (≥ 9 holes)

The shipped course has **12 holes**, escalating in difficulty and each teaching
or combining a mechanic:

| # | Name           | Par | Featured mechanic                         |
|---|----------------|-----|-------------------------------------------|
| 1 | Warm-Up        | 2   | Straight shot, gentle intro               |
| 2 | The Bend       | 3   | Dog-leg / wall bank                       |
| 3 | Sandy Straits  | 3   | Sand traps flanking the lane              |
| 4 | Bumper Alley   | 3   | Elastic bumpers / banking                 |
| 5 | The Moat       | 3   | Water hazard crossing                     |
| 6 | Pinwheel       | 4   | Moving block gate                         |
| 7 | Switchbacks    | 4   | Z-shaped concave green, dividers          |
| 8 | Rampart        | 3   | Slope you must climb / use                |
| 9 | Island Green   | 4   | Water-surrounded landing + narrow bridge  |
|10 | The Gauntlet   | 4   | Bumpers + sand + moving block combo       |
|11 | Spiral         | 4   | Tight spiral walls into a central cup     |
|12 | Grand Finale   | 5   | Everything: water, sand, slope, movers    |

Total par = sum of the above (designed around ~42). The exact geometry lives in
`courses.ts`; each hole is hand-placed, original, and tuned to be completable in
≤ par + a couple strokes by a careful player.

---

## 5. Ball Physics

The simulation is a single circle (the ball) of radius `BALL_R` moving over the
plane, colliding with walls/bumpers/movers, modulated by hazards.

### 5.1 State

```ts
ball = {
  x, y,        // world position (center)
  vx, vy,      // world velocity (units/sec)
  moving,      // boolean
  spin,        // visual roll angle (for the dimple), not physical
};
```

### 5.2 Integration & substepping

To keep collisions stable at high speed we:

1. **Cap `dt`** to `MAX_DT` (e.g. 1/30 s) so a tab regaining focus can't teleport
   the ball through a wall.
2. **Substep**: split the (capped) frame into `n` equal substeps such that the
   ball moves at most `MAX_STEP_DIST` (≈ a fraction of `BALL_R`) per substep:
   `n = clamp(ceil(speed * dt / MAX_STEP_DIST), 1, MAX_SUBSTEPS)`.
3. Each substep: apply zone forces (slopes), apply friction, integrate position,
   then resolve collisions (walls, bumpers, movers), then check hazards & cup.

This guarantees the per-step displacement is small relative to the ball radius
and the cup radius, so closest-point collision resolution and cup capture are
reliable without a full continuous-collision solver.

### 5.3 Friction / rolling resistance

Rolling resistance combines a constant (Coulomb-like) deceleration with a tiny
viscous term, plus a hard stop threshold so the ball actually settles:

```
speed = hypot(vx, vy)
if speed > 0:
  decel = (inSand ? SAND_FRICTION : GREEN_FRICTION)
  newSpeed = speed - decel * dt          // Coulomb term
  newSpeed *= (1 - VISCOUS * dt)         // gentle viscous term
  if newSpeed < STOP_SPEED: vx = vy = 0; moving = false
  else: scale (vx, vy) by newSpeed / speed
```

`STOP_SPEED` is small (a few units/s). When the ball stops, we snap `moving` to
false and hand control back to the player (state → AIM).

Tuning targets:

- A full-power putt travels far enough to cross the longest lane with a bounce or
  two and comes to rest in ~2–3 seconds.
- Sand reduces range dramatically (≈ 3–4× friction) so crossing a trap is risky.

### 5.4 Wall reflection (line-segment collision)

For each wall segment `a→b` and ball center `p` with radius `r`:

1. Compute the closest point `q` on the segment to `p` (clamped projection).
2. Let `d = p − q`, `dist = |d|`. If `dist < r` we have a collision.
3. Normal `n = d / dist` (if `dist == 0`, use the segment's perpendicular).
4. **Positional correction**: move the ball out so it just touches:
   `p += n * (r − dist + EPSILON)`.
5. **Velocity reflection** about the normal with restitution `e`:
   `v' = v − (1 + e) * (v · n) * n`  (only if `v · n < 0`, i.e. moving in).
6. Apply a tiny tangential friction on impact so grazing bounces lose a little
   energy (feels less robotic).

We iterate wall resolution a few times per substep (`RESOLVE_ITERS`) so corners
(two walls at once) resolve without the ball sticking or tunneling.

`v · n < 0` guard prevents double-bounce jitter when already separating.

### 5.5 Bumper collision (circle vs circle)

For bumper center `c`, radius `R`, ball center `p`, radius `r`:

```
d = p − c; dist = |d|; if dist < R + r:
  n = d / dist
  p = c + n * (R + r + EPSILON)          // push out
  vn = v · n
  if vn < 0:
    v = v − (1 + e) * vn * n             // e = BUMPER_RESTITUTION (>1)
    clamp |v| to MAX_BALL_SPEED
  flash bumper, play boing
```

The `>1` restitution gives bumpers their pinball "kick"; the speed clamp keeps
the sim bounded.

### 5.6 Mover collision (moving rectangle)

Each frame, a mover's center is sampled from its `path`/`speed`/`phase`. Its
velocity `vBlock` is the finite difference of consecutive samples. Collision
treats the rectangle as four wall segments (or closest-point to the rect): on
contact we resolve position out of the rect and reflect the **relative** velocity
`v − vBlock`, then add `vBlock` back:

```
vRel = v − vBlock
vRel' = reflect(vRel, n, e)
v = vRel' + vBlock
```

This lets a moving block bat a resting ball forward, or shove the ball aside as
it patrols.

### 5.7 Cup capture & lip-out

The cup is a circle of radius `cupRadius` at `cup`. Each substep, with
`dd = distance(ball, cup)`:

- **Attraction (gravity well):** if `dd < cupRadius * CUP_PULL_RANGE`, add a
  small acceleration toward the cup center scaled by `(1 − dd / range)`. This
  makes near-misses curl toward the hole and rim-rolls feel real.
- **Capture:** if `dd < cupRadius` **and** `speed ≤ CUP_CAPTURE_SPEED`, the putt
  is holed: snap to a sinking animation (ball slides to center, shrinks), play
  the cup-drop sound, mark the hole complete.
- **Lip-out:** if `dd < cupRadius` but `speed > CUP_CAPTURE_SPEED`, the ball is
  going too fast to drop. We let it pass but bleed some speed and apply the
  attraction, so a slightly-too-hard putt does a satisfying horseshoe / lip-out
  instead of ignoring the cup.

Because substep displacement < `cupRadius`, the ball can't skip over the cup
region between steps.

### 5.8 Safety / out-of-bounds

Boundary walls fully enclose the green, so the ball cannot legally leave.
Defensive checks: if the ball ends a frame outside `bounds` (numerical blow-up),
it is returned to the pre-shot spot with no extra penalty.

---

## 6. Controls & Aiming UX

### 6.1 The slingshot

While a hole is in the AIM state (ball at rest):

1. **Press** anywhere on the play area to begin aiming (a press starting on or
   near the ball feels most natural but anywhere works for accessibility).
2. **Drag back** away from the intended target. The aim direction is the vector
   **from the current pointer to the ball** (you pull back behind the ball like a
   slingshot / pool cue). Power is proportional to drag distance, clamped to
   `MAX_DRAG` (world units) → power `0..1`.
3. **Release** to putt: launch speed = `power * MAX_BALL_SPEED` (with a small
   floor so a tiny flick still moves). State → ROLLING.
4. Releasing with near-zero power cancels (no stroke spent).

Both mouse and touch use the same pointer events. Multi-touch is ignored beyond
the primary pointer for aiming.

### 6.2 Aim feedback

- **Aim line**: a dashed line from the ball in the shot direction, length scaled
  by power.
- **Predicted path**: a faint poly-line simulating the first few wall bounces of
  the current putt (a lightweight, friction-less ray reflected off boundary
  walls for N segments). Helps newcomers; pros can ignore it. Length grows with
  power.
- **Power meter**: a curved/linear meter near the ball or in the HUD, filling
  green→yellow→red as power increases, plus a numeric-free tick.
- **Aim cursor**: a small target reticle at the pointer while dragging.

### 6.3 On-screen controls (mobile)

The primary interaction is dragging on the canvas, which works natively on touch.
We additionally `requestControls` a small set of buttons:

- **Reset Putt** (re-place ball at pre-shot spot before a shot is taken — a mulli-
  free re-aim; does not undo a taken stroke).
- **Mute** is handled globally by the portal; not duplicated.

`ctx.setStatus` shows a short contextual hint ("Drag back to aim • release to
putt", "Sink it!", etc.).

### 6.4 Keyboard (desktop convenience)

- `Space` / `Enter` — advance through title / hole-complete / scorecard screens.
- `R` — reset the current aim/ball to pre-shot spot.
- These are conveniences; the game is fully playable with pointer only.

---

## 7. Game States & Flow

A single finite-state machine drives the round:

```
TITLE → (start) → INTRO(hole) → AIM ⇄ ROLLING
                                   ROLLING → (sunk) → HOLE_COMPLETE
                                   ROLLING → (water) → AIM (+penalty)
HOLE_COMPLETE → (next) → INTRO(nextHole)   // if more holes
HOLE_COMPLETE → (last) → SCORECARD → (finish) → gameOver(total)
```

State descriptions:

- **TITLE** — course name, total par, your best round (if any), and a "Tap to
  start" prompt over a stylized preview. Starts audio on first interaction.
- **INTRO(hole)** — a brief banner: "Hole N — Par P", the hole name, and `hint`.
  The camera/board is already showing the hole. Auto-dismisses after a moment or
  on tap; transitions into AIM. A short wipe/zoom transition between holes.
- **AIM** — ball at rest; slingshot active; aim feedback drawn.
- **ROLLING** — physics runs; input ignored except Reset (disabled while moving).
  Ends when ball stops (→ AIM) or is holed (→ sink anim → HOLE_COMPLETE) or
  enters water (→ AIM with penalty).
- **HOLE_COMPLETE** — result card: strokes for the hole vs par with a label
  (Hole-in-one! / Eagle / Birdie / Par / Bogey / Double / +N), running total,
  and a "Next" prompt. Celebratory sfx scaled to result.
- **SCORECARD** — full table of holes (par, strokes, +/-), totals, and best
  round; "Finish" submits the score.

### 7.1 Transitions

Hole-to-hole uses a quick circular/linear wipe plus the new hole's INTRO banner.
The sink uses a 2-phase animation: (1) ball curves to cup center & shrinks into
the hole, (2) flag wiggle + ring particle burst.

---

## 8. Scoring

- `strokesThisHole` increments on each putt taken (release with non-trivial
  power). Water adds an extra **penalty** stroke.
- `par` per hole is fixed data; `totalPar` = sum.
- `totalStrokes` = sum of strokes (incl. penalties) across completed holes.
- **Live HUD**: `ctx.reportScore(totalStrokes)` is called whenever the total
  changes so the portal HUD reflects the running score.
- **Relative score** shown as `E` (even), `+N`, or `−N` versus par played so far.
- **Result labels** per hole based on `strokes − par`:
  `−2→ "Eagle"`, `−1→ "Birdie"`, `0→ "Par"`, `+1→ "Bogey"`,
  `+2→ "Double Bogey"`, `≥+3→ "+N"`, and `strokes==1 → "Hole in One!"`.
- **End of course**: `ctx.gameOver(totalStrokes)`. Lower is better; the manifest
  marks the score ascending. We also `ctx.storage.submitScore(totalStrokes,
  true)` and persist `bestTotal` locally to show "Best round" on the title and
  scorecard.

### 8.1 Persistence keys (namespaced via `ctx.storage`)

- `bestTotal: number` — lowest completed total strokes.
- `bestRelative: number` — corresponding score vs par (for display).
- (Optional) `lastTotal` — most recent completed round.

---

## 9. Audio Design

All sound is synthesized via `ctx.audio` (WebAudio). Events → sounds:

- **Putt** — short rising `sweep`, volume scaled by power (soft tap vs hard
  crack).
- **Wall thunk** — low `tone`/`noise` blip, pitch by impact speed.
- **Bumper boing** — bright `tone` with quick pitch wobble.
- **Sand** — soft filtered `noise` shuffle on entry.
- **Water splash** — descending `noise`/`sweep`.
- **Cup rattle/drop** — two-note "plonk" (a `tone` pair), bigger fanfare for
  birdie/eagle/ace using the `win` motif.
- **UI** — subtle blips on screen advance.

Volumes are modest; everything respects the global mute handled by the engine.
Sounds are throttled (e.g. wall thunks rate-limited) to avoid spam during fast
multi-bounce sequences.

---

## 10. Rendering Spec

Draw order each frame (everything procedural):

1. **Backdrop** — soft outdoor gradient (sky-ish to park-grass) filling the whole
   canvas; subtle vignette. This is the area *outside* the board.
2. **Board shadow** — drop shadow under the green's bounds for depth.
3. **Felt green** — fill the `green` polygon with a green radial/linear gradient;
   clip to the polygon and overlay alternating **mow stripes** (diagonal bands),
   a faint speckle/noise, and an inner vignette for that manicured look.
4. **Hazards** (under the ball):
   - Sand: tan blobs with stipple dots and a soft rim.
   - Water: blue gradient with animated sine wave lines and a lighter shoreline;
     ripple rings when the ball splashes.
   - Slopes: translucent shading + repeating directional chevrons.
5. **Cup** — dark recessed circle with inner shadow; a flag: pole + triangular
   flag that waves via `sin(time)`; small highlight.
6. **Walls/rails** — boundary as a wooden rail (outer dark, inner light bevel);
   interior walls as rounded bars; posts as circles.
7. **Bumpers** — colored discs with a glossy highlight and a flash ring when hit.
8. **Movers** — solid blocks with a drop shadow and subtle top bevel.
9. **Ball** — soft contact shadow offset from the ball; white ball with a radial
   shade (light top-left), a rotating dimple/spot to convey roll, slight squash
   on hard impacts.
10. **Aim UI** (AIM state) — predicted path, dashed aim line, power meter,
    reticle.
11. **Particles** — splash droplets, sand puffs, sink burst, confetti on great
    results.
12. **HUD** — top band: hole number/name, par, strokes, total & relative score.
13. **Overlays** — INTRO banner, HOLE_COMPLETE card, SCORECARD, TITLE — drawn
    last with semi-transparent panels (`roundRect`) and `drawText` from
    `@/engine`.

Everything scales from `ctx.width/height` and the fit transform, so it stays
crisp and correctly laid out at any size. Text sizes are expressed as fractions
of the screen min-dimension.

---

## 11. Performance & Stability

- Single canvas, no offscreen allocations per frame beyond tiny arrays; particle
  pool reused.
- Physics substeps bounded by `MAX_SUBSTEPS`; wall resolution bounded by
  `RESOLVE_ITERS`.
- `dt` capped; large gaps (tab switch) don't explode the sim.
- All randomness for static decor (felt speckle positions) derived from a seeded
  RNG (`mulberry32` keyed by hole id) so the board doesn't shimmer frame to
  frame.
- No per-frame string/object churn in hot loops where avoidable.

---

## 12. File Structure

```
src/games/mini-golf/
  PRD.md        — this document
  types.ts      — Vec, Wall, Shape, Bumper, Slope, Mover, Hole, Course, enums
  geometry.ts   — vector math, closest-point-on-segment, point-in-shape, etc.
  courses.ts    — the hand-designed 12-hole course (pure data)
  physics.ts    — ball stepping, collisions, hazards, cup capture
  render.ts     — all drawing (board, hazards, ball, HUD, overlays, particles)
  audio.ts      — sfx helpers wrapping ctx.audio (throttling, mappings)
  index.ts      — create(): state machine, input, glue, transitions
```

`index.ts` exports `create(ctx)`. Other modules are imported by it. This keeps
each concern isolated and testable-by-reading.

---

## 13. Tuning Constants (initial)

Expressed in world units & seconds (subject to play-test tuning):

```
BALL_R              = 12
CUP_RADIUS          = 18
WALL_RESTITUTION    = 0.72
BUMPER_RESTITUTION  = 1.12
GREEN_FRICTION      = 520     // units/s^2 Coulomb decel
SAND_FRICTION       = 1900
VISCOUS             = 0.25    // per-second viscous factor
STOP_SPEED          = 7
MAX_BALL_SPEED      = 1650
MAX_DRAG            = 360     // world units for full power
MIN_PUTT_SPEED      = 120     // floor so tiny flicks still move
CUP_CAPTURE_SPEED   = 560
CUP_PULL_RANGE      = 2.6     // × cupRadius
CUP_PULL_ACCEL      = 2600
MAX_DT              = 1/30
MAX_STEP_DIST       = 5       // < BALL_R, ensures fine substeps
MAX_SUBSTEPS        = 16
RESOLVE_ITERS       = 3
EPSILON             = 0.01
```

---

## 14. Acceptance Criteria

1. Game loads instantly with no assets; `create(ctx)` returns a valid
   `GameInstance`.
2. Plays at any canvas size/aspect and on touch + mouse without layout breakage
   (re-reads `ctx.width/height` every frame).
3. Drag-back aiming with visible aim line, predicted bounce path, and power meter;
   release putts the ball.
4. Ball physics: velocity + friction, reflects off line-segment walls with
   restitution, comes to a stable rest, no tunneling at full power.
5. Cup capture works (slow near cup sinks; too-fast lips out); ball cannot skip
   the cup.
6. ≥ 9 distinct, hand-designed holes (ship 12) stored as data, including sand,
   water (stroke reset + penalty), bumpers, slopes, and moving blocks.
7. Strokes tracked per hole vs par; running total reported; scorecard at the end;
   `gameOver(totalStrokes)` called (lower better); best total persisted.
8. Polished visuals (felt + stripes, rail, flag, shadows, hazard effects) and
   juicy sfx for putt/wall/bumper/sand/water/sink.
9. Stable loop: dt capped + substepped; no `any`; imports only `@/engine` + local
   files; no edits to shared files.
10. `destroy()` cleans up any timers/listeners.

---

## 15. Future Extensions (not in scope now)

- Multiple courses / themes (night, desert, ice) selectable from the title.
- Daily seeded course using `dailySeed`.
- Replay ghost of your best putt per hole.
- Wind, elevation contours, and putting greens with read-the-break gradients.
- A simple in-game hole editor exporting the `Hole` data format.
```
