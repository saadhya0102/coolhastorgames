# Suika-Style Fruit Merge Drop Game - PRD

Working title: **Mergemelon** (id: `suika`)

> An original fruit-merge drop game for the CoolHastorGames portal. All art is
> procedural (canvas 2D only, no asset files), all code is original, and the
> physics is a purpose-built 2D circle solver tuned for "never explode"
> stability. This document is the design + engineering spec the implementation
> follows.

---

## 0. Table of Contents

1. Vision & Pillars
2. Player Experience / Game Loop
3. Controls (mouse + touch)
4. The Fruit Chain (11 tiers)
5. Coordinate Systems & Layout
6. Physics: the circle solver (the heart of the game)
   - 6.1 Bodies & state
   - 6.2 Fixed-timestep substepping
   - 6.3 Integration
   - 6.4 Collision detection (circle/circle, circle/wall)
   - 6.5 Constraint resolution (positional + velocity)
   - 6.6 Restitution & friction math
   - 6.7 Sleeping
   - 6.8 Stability budget ("never explode" rules)
7. Merge rules & merge math
8. Spawning & the "next" queue
9. Scoring
10. Game-over (overflow) logic
11. Rendering & art direction
12. Audio design
13. HUD & game states
14. Persistence
15. Performance budget
16. File / module breakdown
17. Tuning constants (single source of truth)
18. Edge cases & failure modes
19. Test / QA checklist
20. Future / stretch ideas

---

## 1. Vision & Pillars

Mergemelon is a cozy, tactile physics puzzler. You drop fruit into a glass jar;
identical fruit that touch fuse into the next, bigger fruit. The jar slowly
fills, and the tension comes from managing space before the pile crests the top
line. It should feel *juicy*: every merge pops with particles, a satisfying
sound, and a little squash-and-stretch.

Design pillars:

- **Buttery physics.** The single most important quality bar. Fruit must stack
  and settle with zero jitter and must NEVER explode, tunnel, or fling. A player
  should be able to build a tall, leaning stack and trust it.
- **Readable juice.** Clear tiers (distinct color + silhouette), an obvious aim
  guide, and merge feedback that reads instantly.
- **One-thumb play.** Fully playable with a single finger on mobile and a single
  hand (mouse) on desktop. No menus required to play.
- **Original everything.** Our own fruit names, palette, shapes, faces, and
  sounds. No copied assets or trademarked fruit set.

Non-goals: multiplayer, accounts, level editor, monetization.

---

## 2. Player Experience / Game Loop

1. The jar sits centered in the stage. A "current" fruit hovers at the drop line
   at the top, following the player's aim.
2. The player aims horizontally and drops the fruit. It falls under gravity and
   collides with the walls, floor, and other fruit.
3. When two fruit of the same tier touch, they **merge** into one fruit of the
   next tier at their midpoint, scoring points and emitting particles.
4. Merges cascade: a freshly created fruit may immediately touch another of its
   kind and merge again.
5. After a short cooldown the next fruit becomes current; the "next" preview
   updates. The player keeps dropping.
6. If the pile rises above the danger line and *stays* there too long, the game
   ends. The biggest fruit (tier 10, the "Sunmelon") is the aspirational goal;
   merging two of them is a rare jackpot.

The core tension: each drop both *solves* (merges shrink the pile) and *adds*
(a new fruit takes space). Good play sequences merges to reclaim room.

---

## 3. Controls (mouse + touch)

Aiming and dropping use the unified pointer from `ctx.input`.

- **Aim:** the current fruit's x-position tracks `input.pointer.x`, clamped so
  the fruit stays fully inside the jar walls (`[wallLeft + r, wallRight - r]`).
- **Desktop (mouse):** the fruit follows the cursor continuously; **left click
  (`pointer.justDown`) drops**.
- **Touch:** while a finger is down the fruit follows it; **lifting the finger
  (`pointer.justUp`) drops**. This "drag to aim, release to drop" model is the
  most precise one-thumb scheme and avoids accidental drops while scrolling to
  aim. We branch on `ctx.isTouch`.
- **Keyboard (bonus, desktop):** `ArrowLeft`/`ArrowRight` (or `A`/`D`) nudge aim;
  `Space`/`ArrowDown` drops. Purely additive; pointer remains primary.
- After a drop there is a **drop cooldown** (`DROP_COOLDOWN`) during which no new
  drop is accepted; the next fruit animates into the ready position.
- A **drop guide** (vertical dashed line) is drawn from the current fruit to the
  floor so the landing column is obvious.

No on-screen D-pad/buttons are required; we call `requestControls([])` so the
portal does not render stale controls. Tapping the jar is the drop action.

---

## 4. The Fruit Chain (11 tiers)

Eleven original fruits, smallest to largest. Tier index `t` runs `0..10`.
`rWorld` is the radius in world units (world width = 1.0; see §5). Colors are our
own palette. Spawnable tiers are the small ones only (`0..4`).

| t  | name        | rWorld | core color | accent     | spawnable | notes / silhouette |
|----|-------------|--------|------------|------------|-----------|--------------------|
| 0  | Pip         | 0.030  | #ff5d73    | #c8324b    | yes       | tiny cherry-red bead, stem dot |
| 1  | Berry       | 0.042  | #8a5cff    | #5b34c4    | yes       | round violet berry |
| 2  | Grape       | 0.056  | #7bd14f    | #4f9b2e    | yes       | green grape, leaf |
| 3  | Kumquat     | 0.072  | #ffae3b    | #d9821a    | yes       | small amber citrus |
| 4  | Lemon       | 0.090  | #ffe14d    | #d8b62a    | yes       | bright lemon, slight oval cue |
| 5  | Tangerine   | 0.110  | #ff8c34    | #d9631a    | no        | orange, dimpled rind |
| 6  | Apple       | 0.132  | #ff4d57    | #c22b39    | no        | classic red, leaf + stem |
| 7  | Peach       | 0.156  | #ff9aa8    | #e06a86    | no        | blushed pink, cleft cue |
| 8  | Pomelo      | 0.182  | #c7e06a    | #95b23f    | no        | pale green-yellow giant citrus |
| 9  | Melon       | 0.210  | #6fce8f    | #3f9d68    | no        | netted green melon |
| 10 | Sunmelon    | 0.240  | #25b15a    | #d8434f    | no        | the goal: striped watermelon w/ red interior cue |

Radius growth is smooth (~1.12-1.4x per tier) so a merge always produces a
visibly bigger fruit but never a jarring jump that would deeply overlap
neighbors. Color hue + value steps are large enough to be colorblind-friendlier
and instantly distinct.

Each fruit renders as a shaded circle (radial gradient body, rim shadow,
specular highlight) plus tier-specific decorations (leaf, stem, stripes,
dimples, a tiny cute face on a subset) so tiers differ by *shape language* too,
not only hue.

---

## 5. Coordinate Systems & Layout

There are three spaces:

- **CSS pixel space** — what `ctx.ctx` draws in. `ctx.width`/`ctx.height` are
  getters and are re-read **every frame** (the stage can resize / rotate / be any
  aspect, including mobile).
- **World space** — a fixed, resolution-independent space the physics lives in.
  `WORLD_W = 1.0`, `WORLD_H = 1.30` (portrait jar). Because it is fixed, resizing
  the window never perturbs the simulation; only the pixel mapping changes. This
  is key to robust resize behavior.
- **Mapping** — each frame we compute a `Layout`: a uniform `scale` (px per world
  unit) and an `(originX, originY)` offset that letterboxes the jar inside the
  available area, centered, preserving the `WORLD_H/WORLD_W` aspect.

Layout algorithm (recomputed every frame from `ctx.width`/`ctx.height`):

```
padX      = W * 0.04
topUI     = H * 0.13          // space above the jar for HUD + drop preview
padBottom = H * 0.04
availW    = W - padX*2
availH    = H - topUI - padBottom
scale     = min(availW / WORLD_W, availH / WORLD_H)
jarW      = WORLD_W * scale
jarH      = WORLD_H * scale
originX   = (W - jarW) / 2
originY   = topUI + (availH - jarH) / 2
worldToPx(x,y) = (originX + x*scale, originY + y*scale)
```

Jar interior in world space is `x in [0,1]`, `y in [0, 1.30]`. Walls at `x=0`
and `x=1`, floor at `y=1.30`, open top at `y=0`. The **danger line** sits at
`y = DANGER_Y` (e.g. `0.12`); the drop line (where the current fruit waits) is
slightly above, at `y = DROP_Y` (e.g. `0.06`), partly outside the counted area
so dropping itself never instantly triggers overflow.

---

## 6. Physics: the circle solver

This is the core engineering work. We implement an original, compact, **2D
circle-only** solver tuned specifically for a Suika stack: stable resting
contacts, low bounce, real friction, sleeping, and hard guarantees against
explosions. The approach is a semi-implicit (symplectic) Euler integrator with a
**fixed timestep**, **sub-stepping**, and an **iterative sequential solver** that
combines positional correction (projection with slop) and velocity response
(restitution + Coulomb friction) per contact.

### 6.1 Bodies & state

```
interface Body {
  id: number;        // unique, monotonic
  tier: number;      // 0..10, indexes the fruit chain
  x: number; y: number;     // center, world units
  px: number; py: number;   // previous center (debug / verlet option)
  vx: number; vy: number;   // velocity, world units / second
  r: number;         // radius, world units (= TIERS[tier].rWorld)
  mass: number;      // proportional to r^2 (area)
  invMass: number;   // 1/mass (0 would be static; fruit are dynamic)
  angle: number;     // cosmetic rotation for rolling look
  spin: number;      // cosmetic angular velocity
  sleeping: boolean; // true => skipped by integration
  sleepTimer: number;// seconds spent below the sleep velocity threshold
  age: number;       // seconds since spawn (grace for overflow & merge)
  spawnPop: number;  // 0..1 pop animation timer when created by a merge
  dead: boolean;     // marked for removal (merged away)
}
```

Mass: `mass = r*r` (we drop the constant `pi`; only ratios matter). `invMass =
1/mass`. Bigger fruit are heavier and shove smaller fruit aside convincingly.

### 6.2 Fixed-timestep substepping

Variable frame `dt` (seconds) is accumulated. Physics advances in fixed steps of
`FIXED_DT = 1/120 s`. Each render frame we run `floor(acc / FIXED_DT)` steps,
capped at `MAX_STEPS = 5` to prevent a "spiral of death" after a long stall (tab
backgrounded). Leftover time stays in the accumulator.

```
acc += min(dt, 0.1)            // clamp pathological dt
while (acc >= FIXED_DT && steps < MAX_STEPS) { step(FIXED_DT); acc -= FIXED_DT; steps++ }
if (steps === MAX_STEPS) acc = 0   // drop backlog
```

A fixed, small step is the first pillar of stability: gravity-driven penetration
per step is tiny, restitution is consistent, and tunneling is essentially
impossible for our radius/speed ranges.

### 6.3 Integration (semi-implicit Euler)

Per `step(h)`:

```
for each awake body b:
  b.vy += GRAVITY * h            // GRAVITY ~ 3.2 world/s^2
  b.vx *= LINEAR_DAMP            // ~0.999 per step, gentle air drag
  b.vy *= LINEAR_DAMP
  // clamp speed to avoid any runaway
  s2 = b.vx*b.vx + b.vy*b.vy
  if (s2 > MAX_SPEED^2) { k = MAX_SPEED/sqrt(s2); b.vx*=k; b.vy*=k }
  b.x += b.vx * h
  b.y += b.vy * h
  b.spin *= 0.96; b.angle += b.spin * h
```

Velocity is updated before position (symplectic), which is more stable for
gravity than explicit Euler.

### 6.4 Collision detection

Few bodies (typically < 60), so an `O(n^2)` broadphase is fine; we still skip
pairs where both are sleeping. (A uniform grid is noted as a stretch
optimization but unnecessary at this scale.)

- **Circle/circle:** overlap when `dist(a,b) < a.r + b.r`. Normal `n = (b-a)/d`.
  Penetration `pen = (a.r+b.r) - d`. If `d == 0` (coincident, e.g. a merged fruit
  born on top of a neighbor) pick a deterministic fallback normal `(0,-1)` and a
  small penetration so they separate upward without NaN.
- **Circle/wall:** four half-planes from the jar interior:
  - left:  `x - r < 0`            -> pen `= r - x`,        n `= (+1, 0)`
  - right: `x + r > WORLD_W`       -> pen `= (x+r) - WORLD_W`, n `= (-1, 0)`
  - floor: `y + r > WORLD_H`       -> pen `= (y+r) - WORLD_H`, n `= (0,-1)`
  - (top is open; no ceiling.)

### 6.5 Constraint resolution

After integration we run `SOLVER_ITERS` (~6) relaxation iterations. Each
iteration resolves every wall contact and every circle/circle contact. Resolving
a contact does two things:

**(a) Positional correction (projection).** Push the bodies apart along the
normal to remove penetration, leaving a tiny `SLOP` so resting contacts don't
fight forever:

```
corr = max(pen - SLOP, 0) * CORRECT_PERCENT      // CORRECT_PERCENT ~ 0.4
corr = min(corr, MAX_CORRECTION)                 // clamp => never a huge shove
invSum = a.invMass + b.invMass                   // wall: invMass_wall = 0
a.x -= n.x * corr * (a.invMass/invSum)
a.y -= n.y * corr * (a.invMass/invSum)
b.x += n.x * corr * (b.invMass/invSum)
b.y += n.y * corr * (b.invMass/invSum)
```

Clamping `corr` to `MAX_CORRECTION` is the second stability pillar: when a merge
spawns a large fruit overlapping its neighbors, the overlap is resolved over
several iterations/steps as a gentle expansion instead of a single explosive
impulse.

**(b) Velocity response.** Compute relative velocity along the normal and apply
an impulse so bodies stop approaching, with restitution and friction (see §6.6).
Only applied when bodies are approaching (`velN < 0`).

For a wall, the wall has zero velocity and infinite mass (`invMass = 0`).

### 6.6 Restitution & friction math

Relative velocity `rv = b.v - a.v`. Normal component `velN = rv . n`.

Restitution (bounciness) is low and **velocity-thresholded** to kill resting
jitter: if `|velN| < REST_THRESHOLD` we use `e = 0`, else `e = RESTITUTION`
(~0.12). Normal impulse scalar:

```
j = -(1 + e) * velN / invSum
impulse = n * j
a.v -= impulse * a.invMass
b.v += impulse * b.invMass
```

Coulomb friction along the tangent `tdir` (the normalized tangential part of
`rv`):

```
vt   = rv . tdir
jt   = -vt / invSum
jtMax= FRICTION * j           // |friction| <= mu * |normal impulse|
jt   = clamp(jt, -jtMax, jtMax)
fimp = tdir * jt
a.v -= fimp * a.invMass
b.v += fimp * b.invMass
```

`FRICTION` (~0.4) lets stacks lean and grip rather than sliding into a flat
puddle. We also impart a small cosmetic `spin` from the tangential velocity so
fruit visually roll (purely visual; not fed back into the solver, keeping the
solver decoupled and stable).

### 6.7 Sleeping

To eliminate micro-jitter in big resting piles and save CPU:

- Each step, for an awake body, if `speed < SLEEP_LINEAR` for a continuous
  `SLEEP_TIME` (~0.5s) it goes to sleep: `sleeping = true`, `vx=vy=spin=0`.
- Sleeping bodies skip gravity + integration entirely.
- A sleeping body is **woken** the moment a contact would move it more than a
  hair (`pen > SLOP * WAKE_FACTOR`) or it receives a meaningful impulse from an
  awake neighbor (something landed on the pile). Waking cascades naturally
  because the newly awake body then wakes those it pushes.
- Sleeping/sleeping pairs are skipped (assumed already resolved), which is what
  removes the residual jitter.

### 6.8 Stability budget ("never explode" rules)

A consolidated checklist of every guardrail, because "never explode" is a hard
requirement:

1. **Fixed small timestep** (`1/120`) with capped substeps.
2. **Speed clamp** `MAX_SPEED` every step.
3. **Penetration correction clamp** `MAX_CORRECTION` per contact per iteration.
4. **Positional `SLOP`** so resting contacts don't oscillate.
5. **Restitution threshold** so slow contacts have zero bounce.
6. **Linear damping** bleeds off numerical energy.
7. **Coincident-body fallback normal** prevents division-by-zero / NaN.
8. **NaN guard**: at the end of each step any body with non-finite position is
   snapped back inside the jar with zeroed velocity (defensive; should never
   fire).
9. **Sleeping** prevents resting jitter from accumulating into motion.
10. **Spawn overlap is expansion, not impulse** — merges set velocity to a
    blended value and rely on clamped positional correction to make room.

---

## 7. Merge rules & merge math

After the physics steps for the frame, we run merge detection on the settled
bodies.

**Eligibility.** A pair `(a, b)` merges when:

- `a.tier === b.tier` and the tier is not the max (`tier < 10`), and
- they are touching: `dist(a,b) <= a.r + b.r + MERGE_TOL` (a small tolerance,
  `MERGE_TOL ~ 0.004` world, so they merge just before/at contact), and
- neither has been consumed by another merge this frame.

**Resolution.** For each eligible pair (iterate ids ascending; a body merges at
most once per frame — mark both `dead`):

```
newTier = a.tier + 1
mx = (a.x + b.x) / 2
my = (a.y + b.y) / 2
// momentum-weighted velocity blend (mass-weighted average)
vx = (a.vx*a.mass + b.vx*b.mass) / (a.mass + b.mass)
vy = (a.vy*a.mass + b.vy*b.mass) / (a.mass + b.mass)
spawn Body(newTier) at (mx,my) with (vx*MERGE_VEL_KEEP, vy*MERGE_VEL_KEEP)
// small upward "pop" so the new fruit feels alive
vy -= MERGE_POP_UP
spawnPop = 1     // drives a squash/scale animation in render
```

`MERGE_VEL_KEEP` (~0.6) damps the inherited velocity so chains don't accelerate;
`MERGE_POP_UP` is a tiny upward nudge. The new fruit is larger than either parent
(radius grows ~1.12-1.4x), so it is born slightly overlapping neighbors; the
clamped positional correction (§6.5a) eases it into place over the next steps —
this is exactly why the correction clamp matters.

**Cascades.** Because the new fruit is a normal body, if it now touches another
fruit of its (new) tier, the *next* frame's merge pass fuses them, producing a
satisfying chain. No special cascade code is needed.

**Why mass isn't strictly conserved.** Two tier-`t` fruit have combined area
`2*r_t^2`, while the tier-`t+1` fruit has area `r_{t+1}^2`. Our radii are chosen
so `r_{t+1}^2 ~ 1.3..2.0 * r_t^2` — visually "a bit bigger than one, smaller than
two," which both looks right and keeps the jar from filling too slowly or too
fast. This is a deliberate gameplay choice, not a physics bug.

**Max tier (jackpot).** Two tier-10 **Sunmelons** that touch both pop and are
removed (no tier 11): big score, big particle burst, a screen flash, and a
celebratory sound. This rewards reaching the top of the chain and reclaims a lot
of space.

**Merge feedback (per merge):** particle burst tinted to the new fruit, a pop
SFX whose pitch rises with tier, a brief ring shockwave, and the new fruit's
`spawnPop` squash-stretch.

---

## 8. Spawning & the "next" queue

- Only tiers `0..4` (`SPAWN_MAX_TIER`) ever spawn as droppables, weighted toward
  smaller fruit so the chain has to be built up: weights `[0.30, 0.26, 0.20,
  0.14, 0.10]` for tiers `0..4`.
- We keep a **current** fruit (ready to drop) and a **next** fruit (preview).
  When a drop happens, `next` becomes `current` and a fresh `next` is rolled.
- The current fruit hovers at `DROP_Y`, x following the clamped aim. It is purely
  a UI object until dropped (not in the physics world), so it cannot be merged or
  pushed while waiting.
- On drop: create a real `Body` at `(aimX, DROP_Y)` with a tiny initial downward
  velocity (`DROP_VY`) and start the `DROP_COOLDOWN`. During cooldown the current
  fruit is hidden / animating in.

Randomness uses `Math.random` via the engine's `rng` helper; no determinism is
required for this game.

---

## 9. Scoring

Points are awarded on merge based on the **tier produced**. We use triangular
numbers so later merges are worth dramatically more:

```
score(producedTier t) = t * (t + 1) / 2      // t is the new fruit's tier
```

Producing tiers `1..10` yields `1, 3, 6, 10, 15, 21, 28, 36, 45, 55`. The
tier-10 jackpot (two Sunmelons) awards a flat `JACKPOT_SCORE` (e.g. `100`) on top.

- `ctx.reportScore(score)` is called live whenever the score changes.
- The running total is shown in the HUD.
- On game over, `ctx.gameOver(score)` submits the final score; best is persisted
  (§14) and also pushed to the leaderboard sink by the engine.

---

## 10. Game-over (overflow) logic

A fruit "overflows" when it has settled above the danger line. Precisely, on each
frame we look for any body with:

- `b.age > OVERFLOW_GRACE` (so a fruit mid-drop or just-spawned isn't counted),
  and
- `b.y - b.r < DANGER_Y` is **not** the test (that would count a tall stack's top
  fruit too eagerly). Instead we use the **center**: `b.y < DANGER_Y` means the
  fruit's center has risen above the line — the pile is genuinely cresting.

If any such body exists, accumulate `overflowTimer += dt`; otherwise decay it
toward zero (`overflowTimer = max(0, overflowTimer - dt*2)`), so brief blips from
an active drop don't doom the player. When `overflowTimer >= OVERFLOW_LIMIT`
(~2.5s) the game enters the `dying` state:

1. freeze drops, play the lose sting, flash the danger line red,
2. after `GAMEOVER_DELAY` (~1.1s) call `ctx.gameOver(score)`.

The danger line pulses/reddens proportionally to `overflowTimer/OVERFLOW_LIMIT`
as a clear warning.

---

## 11. Rendering & art direction

Everything is canvas 2D, procedural, repainted fully every frame (no asset
files). Order back-to-front:

1. **Background:** a soft vertical gradient (warm cream to peach), plus a couple
   of large, faint blurred "bokeh" circles for depth. Calm, kitchen-counter
   vibe.
2. **Jar:** a rounded-rect glass container with a subtle inner shadow, a glossy
   vertical highlight band on the left, a thicker base, and a faint rim. Drawn
   with translucency so the background shows through (glass feel). A wood-tone
   shelf line under the base.
3. **Danger line:** a dashed line across the jar at `DANGER_Y`, normally a calm
   teal, lerping to alarm-red as `overflowTimer` grows; a small "!" tag when
   warning.
4. **Fruit:** each body drawn at `worldToPx`. A fruit is:
   - a radial-gradient body (light top-left -> saturated -> slightly darker rim),
   - a soft contact/ambient shadow ellipse beneath,
   - a specular highlight blob (top-left),
   - tier-specific decoration: leaf+stem (Grape/Apple/Sunmelon), rind dimples
     (Tangerine/Pomelo), stripes (Sunmelon), net texture (Melon), a subtle oval
     cue (Lemon), and a tiny cute face (two eyes + optional cheeks) on a curated
     subset for charm,
   - `spawnPop` squash/stretch and a gentle bob; cosmetic `angle` rotates
     decorations so rolling reads.
5. **Drop guide:** a dashed vertical line under the current fruit to the floor +
   a faint landing footprint ellipse.
6. **Current fruit:** drawn at the drop line following aim (with a soft drop
   shadow), animating in after cooldown.
7. **Particles:** additive-ish little circles for merge bursts and the jackpot.
8. **HUD overlays:** score, best, next-fruit preview, and the chain progress
   "ladder" on the side; intro hint; game-over veil.

Color, gradients, and decorations are all defined in `fruits.ts`/`render.ts`. We
use the shared `roundRect` and `drawText` helpers and the "Baloo 2" font already
used across the portal for a consistent cute look.

Resolution independence: all sizes derive from `scale`, so the art is crisp and
correctly proportioned at any DPR / aspect / orientation.

---

## 12. Audio design

Procedural via `ctx.audio` (WebAudio synth; no files):

- **Drop:** a short soft `sweep` downward (a gentle "thup").
- **Wall/floor tap:** optional tiny low `tone` on hard impacts (throttled).
- **Merge:** a two-note `tone` blip whose pitch rises with the produced tier
  (maps tier `1..10` to a pleasant ascending scale), plus a soft body thump. The
  bigger the fruit, the warmer/lower the fundamental but the brighter the
  sparkle — tuned per tier.
- **Jackpot (two Sunmelons):** an arpeggio (`audio.win`-style) + noise sparkle.
- **Warning:** a soft pulsing tick while overflowing (throttled, subtle).
- **Game over:** a descending `lose` sting.

All SFX are throttled so cascades don't machine-gun. A thin wrapper module
(`sfx.ts`) centralizes pitch tables and throttling and respects the global mute
(handled inside `AudioManager`).

---

## 13. HUD & game states

State machine:

- `intro` — board empty, a "Drop to start" hint; first interaction begins play.
  (We can also start immediately in `playing`; intro just shows the hint until
  the first drop.)
- `playing` — normal loop.
- `dying` — overflow tripped; physics still simulates so the pile settles
  dramatically, drops disabled, red flash; transitions to game over after the
  delay.

HUD (drawn in CSS px, independent of jar scale but positioned relative to it):

- **Score** (large, top-left of the top UI band).
- **Best** (smaller, near score).
- **Next** preview (top-right): a small framed circle showing the upcoming fruit.
- **Chain ladder** (optional, right edge): the 11 tiers as small dots, the
  highest-reached one highlighted, to telegraph the goal.
- `ctx.setStatus(...)` shows a one-line hint ("Drop fruit • merge matching pairs
  • reach the Sunmelon!") and updates with best score.

Game-over presentation: a translucent veil over the jar, the final score, best,
and the largest fruit reached, then control returns to the portal via
`ctx.gameOver(score)` which renders the portal's own retry UI.

---

## 14. Persistence

- Best score stored via `ctx.storage` using `submitScore(score)` on game over,
  which updates the local best and notifies the cloud sink. We read it back with
  `storage.bestScore()` (fallback `0`) to display "Best" in the HUD/intro.
- Optionally persist the highest tier ever reached under a custom key
  (`storage.get/set("bestTier", 0)`) to show a persistent "personal best fruit".

No other persistence; the board itself is not saved between sessions.

---

## 15. Performance budget

- Bodies: typically 10-50, hard cap not required but merges keep it bounded.
- Physics: `O(n^2)` pairs * `SOLVER_ITERS` * substeps. At `n=60`, ~1.8k pairs *
  6 iters * 2 substeps ~= 21k cheap float ops/frame — trivial.
- Rendering: each fruit is a handful of canvas ops; particles capped
  (`MAX_PARTICLES`, recycled). Target 60fps on mid mobile.
- Allocation discipline: reuse arrays, avoid per-frame object churn in the hot
  loop (no closures allocated per contact).

---

## 16. File / module breakdown

```
src/games/suika/
  PRD.md        — this document
  types.ts      — Body, Particle, FruitTier, Layout, GameState types
  fruits.ts     — TIERS table (radii, colors, decoration flags), spawn weights,
                  helpers (radiusOf, scoreForTier, mergePitch)
  physics.ts    — World class: bodies[], addBody, step(h) with integrate +
                  resolve (wall + circle), sleeping, NaN guard; pure world units
  particles.ts  — ParticleSystem: spawnBurst/spawnRing, update, draw; pooled
  sfx.ts        — Sfx wrapper around ctx.audio: drop/merge/jackpot/warn/over,
                  throttling + pitch tables
  render.ts     — drawBackground, drawJar, drawDangerLine, drawFruit, drawGuide,
                  drawCurrent, drawHud, drawOverlay; all take a Layout
  game.ts       — SuikaGame implements GameInstance: layout(), input handling,
                  drop logic, merge detection + scoring, overflow/game-over,
                  orchestrates world + particles + sfx + render
  index.ts      — export function create(ctx): GameInstance { return new SuikaGame(ctx) }
```

Strict TypeScript: no `any`, no external libraries, only `@/engine` + this
folder. `index.ts` exposes `create(ctx: GameContext): GameInstance`.

---

## 17. Tuning constants (single source of truth)

Defined in `types.ts`/`fruits.ts` (`CONFIG`). Initial values:

```
WORLD_W = 1.0
WORLD_H = 1.30
GRAVITY = 3.2          // world/s^2
LINEAR_DAMP = 0.999
MAX_SPEED = 6.0        // world/s
FIXED_DT = 1/120
MAX_STEPS = 5
SOLVER_ITERS = 6
SLOP = 0.0006
CORRECT_PERCENT = 0.4
MAX_CORRECTION = 0.05
RESTITUTION = 0.12
REST_THRESHOLD = 0.25  // world/s
FRICTION = 0.4
SLEEP_LINEAR = 0.06    // world/s
SLEEP_TIME = 0.5       // s
WAKE_FACTOR = 6

DROP_Y = 0.06
DANGER_Y = 0.14
DROP_VY = 0.2
DROP_COOLDOWN = 0.36   // s
MERGE_TOL = 0.004
MERGE_VEL_KEEP = 0.6
MERGE_POP_UP = 0.25

OVERFLOW_GRACE = 1.0   // s before a fruit counts toward overflow
OVERFLOW_LIMIT = 2.5   // s above the line => game over
GAMEOVER_DELAY = 1.1   // s of "dying" before ctx.gameOver
JACKPOT_SCORE = 100
SPAWN_MAX_TIER = 4
MAX_PARTICLES = 400
```

These are the knobs to tweak during feel-tuning; they live in one place so the
game is easy to rebalance.

---

## 18. Edge cases & failure modes

- **Resize / rotate mid-play:** layout recomputed each frame from getters; world
  state untouched, so the jar just rescales. No fruit teleport.
- **Coincident centers after a merge:** fallback normal `(0,-1)` + small pen.
- **Huge `dt` after tab switch:** `dt` clamped, substeps capped, backlog dropped.
- **Tiny jar (very small viewport):** sizes derive from `scale`; still playable;
  fonts have minimums.
- **Drop spam:** gated by `DROP_COOLDOWN`.
- **Pile crest during an active drop:** overflow uses center test + grace +
  decaying timer so it isn't falsely triggered.
- **Two simultaneous merge candidates touching the same fruit:** the consumed
  flag ensures each fruit merges at most once per frame; the leftover merges next
  frame.
- **NaN/Inf:** end-of-step guard resets offending bodies inside the jar.

---

## 19. Test / QA checklist

- [ ] Stack 30+ fruit; verify no jitter at rest (sleeping engages) and no drift.
- [ ] Drop a big fruit onto a tight cluster; verify gentle expansion, no fling.
- [ ] Rapid drops; cooldown respected, no double-drop.
- [ ] Force-merge chains (line up same tier); cascades score and pop correctly.
- [ ] Reach tier 10 twice; jackpot triggers, both removed, big FX + score.
- [ ] Overflow: hold pile above line; warning ramps, game over after limit.
- [ ] Resize window / rotate device mid-game; jar rescales, sim continues.
- [ ] Mute toggle (engine) silences all SFX.
- [ ] Touch: drag to aim, release to drop. Mouse: move + click to drop.
- [ ] Best score persists across reloads.

---

## 20. Future / stretch ideas

- Uniform-grid broadphase if body counts ever grow.
- Power-ups (a "shuffle" or "bomb" fruit) and combo multipliers.
- Daily seeded challenge using `dailySeed`.
- Soft body squash on heavy impacts; subtle fruit deformation at contacts.
- Haptics on mobile for merges.

---

*End of PRD.*


