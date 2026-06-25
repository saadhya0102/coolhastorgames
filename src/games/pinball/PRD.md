# NEON NEXUS — Product Requirements Document

> An original, procedurally-rendered portrait **pinball** game for the CoolHastor
> Games portal. All art, geometry, physics and audio are generated at runtime in
> code on a 2D canvas — there are **no asset files** and nothing is copied from any
> real-world table or licensed property. The table, its rules, and its name
> ("Neon Nexus") are original to this project.

- **Game id:** `pinball`
- **Folder:** `src/games/pinball/`
- **Entry:** `index.ts` exporting `create(ctx: GameContext): GameInstance`
- **Orientation:** Portrait (virtual table 560 × 1000 units, aspect ≈ 0.56)
- **Engine:** TypeScript + Vite portal, `@/engine` only, strict TS (no `any`)
- **Author intent:** A "juicy", glowing, arcade-feel single-ball-at-a-time
  pinball cabinet with reliable, tunneling-free physics that runs at any screen
  size and on touch.

---

## 1. Vision & Pillars

Neon Nexus is a compact, fast, readable pinball table. It is designed to feel
*tight and responsive* rather than simulationist: flippers snap, bumpers pop the
ball hard, slingshots fling it sideways, and the whole table pulses with neon
light. The goal is "one more ball" stickiness in 30-second bursts.

Design pillars:

1. **Reliable physics first.** The single most important technical requirement is
   that the ball *never* tunnels through a wall, flipper, or bumper, at any frame
   rate or screen size. Everything else is secondary. We achieve this with a
   fixed-timestep accumulator, adaptive micro-substeps bounded by the ball
   radius, a hard velocity clamp, and closest-point (capsule) collision against
   every collider.

2. **Resolution independence.** All gameplay happens in a fixed *virtual*
   coordinate space (560 × 1000). Each frame we recompute a fit transform from
   the live `ctx.width` / `ctx.height` getters and letterbox the table. Physics
   never sees pixels, so behaviour is identical on a phone and a 4K monitor.

3. **Juice.** Motion-blur ball trail, flipper sweep animation, bumper flash rings,
   particle bursts, score pop-ups, combo/multiplier escalation, screen shake on
   big hits, and synthesized SFX for every interaction.

4. **Readable neon art.** A dark playfield with glowing vector outlines, layered
   additive glows, animated lane inserts, and a clean HUD. No photorealism — pure
   procedural neon.

5. **Approachable rules with depth.** Anyone can flip and score. Underneath:
   combos, a rising multiplier from the drop-target bank, rollover lanes, a
   captive "core" that lights and starts **Multiball**, and an end-of-ball bonus.

---

## 2. Platform & Constraints

- **Language:** TypeScript, `strict` mode. No `any`, no non-null abuse, no
  external libraries, no React.
- **Imports:** only from `@/engine` and files within `src/games/pinball/`.
- **Rendering:** the provided `CanvasRenderingContext2D` (`ctx.ctx`). It is
  already DPR-scaled, so we draw in CSS pixels. We repaint the entire background
  every frame (no partial/stale buffers).
- **No shared file edits.** We do not touch the engine, the manifest, or any
  other game. (Registration in `src/registry/manifest.ts` is a one-line entry the
  maintainer adds; out of scope for this folder.)
- **No build tooling commands.** We do not run npm / tsc / vite / git.
- **Sizing:** `ctx.width` and `ctx.height` are **getters** — read them every
  frame. Support arbitrary aspect ratios and mobile. The table is centered and
  letterboxed inside whatever stage we are given.

### 2.1 Engine API surface used

- `ctx.ctx` — 2D context (CSS px, DPR pre-scaled).
- `ctx.width` / `ctx.height` — live logical size getters.
- `ctx.input` — `isDown(...keys)`, `pressed(...)`, `released(...)`,
  `pointer{x,y,down,justDown,justUp}`, `pointers` (multi-touch map).
- `ctx.audio` — `tone`, `sweep`, `noise`, plus convenience sfx.
- `ctx.storage` — `get/set`, `submitScore`, `bestScore`.
- `ctx.reportScore(n)` — live HUD score.
- `ctx.gameOver(finalScore?)` — end the run.
- `ctx.setStatus(text)` — HUD subtitle text.
- `ctx.requestControls([...])` — on-screen buttons for touch.
- `GameInstance { update(dt), render(), resize?, destroy? }`.

---

## 3. Coordinate System & Transform

The table lives in a **virtual** space:

```
TABLE_W = 560   (x: 0 = left wall ... 560 = right edge / plunger lane)
TABLE_H = 1000  (y: 0 = top arch ... 1000 = bottom drain)
```

`+x` is right, `+y` is **down**. Gravity is `+y`.

Each frame we compute a uniform `scale = min(viewW / TABLE_W, viewH / TABLE_H)`
and center the scaled table inside the canvas (`offsetX`, `offsetY`). We expose:

- `toScreen(p)` — virtual → CSS pixels (for rendering).
- `toTable(px, py)` — CSS pixels → virtual (for pointer hit-testing / tap zones).

Letterbox bars are filled with the cabinet bezel art so the playfield reads as a
framed machine on wide screens.

All distances below (radii, gravity, speeds) are in **virtual units / second**.

---

## 4. Physics Model

### 4.1 Entities

- **Ball** — a moving circle: `pos {x,y}`, `vel {x,y}`, `radius BALL_R = 12`.
  Multiple balls exist during Multiball. Each carries a short position history for
  the motion-blur trail.
- **Wall segment** — an immovable line segment `A→B` with a restitution and an
  optional one-way `passDir`. The playfield boundary, lane guides, ramps, and the
  slingshot faces are all built from segments. A polyline is just a chain of
  segments.
- **Arc / circle collider** — used for rounded corners and the top arch; treated
  as "ball must stay outside circle C with radius R".
- **Bumper** — a circle collider with strong restitution, a fixed outward kick
  impulse, score value, and a flash timer. (Pop bumpers.)
- **Slingshot** — a segment collider (the angled face of a triangle) with high
  restitution + a fixed kick along its face normal, score, and flash.
- **Drop target** — a short segment that, when hit, "drops" (becomes
  non-colliding) and scores. A bank of them; completing the bank raises the
  multiplier and pops back up.
- **Standup target** — a short fixed segment that scores on each hit and lights an
  insert; never drops.
- **Rollover lane** — a *sensor* (no collision) zone at the top; rolling the ball
  through toggles a lane light. Lighting all lanes awards a bonus.
- **Flipper** — a rotating capsule (segment with rounded caps) pivoting about a
  fixed point; see §4.6.
- **Plunger** — a kicker at the bottom of the launch lane (see §4.7).
- **Drain** — the gap between/below the flippers; a sensor line at the very
  bottom. Crossing it loses the ball.

### 4.2 The core loop: fixed timestep + adaptive substeps

`update(dt)` clamps `dt` to a maximum (`0.05 s`) to survive tab-stalls, then
feeds a fixed-step accumulator:

```
FIXED_DT = 1 / 240   // physics tick
accumulator += dt
while (accumulator >= FIXED_DT) {
    physicsTick(FIXED_DT)
    accumulator -= FIXED_DT
}
```

Inside `physicsTick(h)` for **each ball**:

1. Integrate gravity: `vel.y += GRAVITY * h`. Apply a mild linear drag
   (`vel *= (1 - DRAG * h)`) so the ball loses energy realistically and settles.
2. **Clamp speed** to `MAX_SPEED` (3500 u/s) to bound per-tick travel.
3. Compute travel `= |vel| * h`. Choose micro-substep count
   `n = clamp(ceil(travel / (BALL_R * 0.5)), 1, 16)` so each micro-move is at most
   half a ball radius. This is the key anti-tunneling guarantee: a moving circle
   can never skip past a collider it would have overlapped, because we re-test
   collisions at sub-radius spatial resolution.
4. For each micro-step: advance `pos += vel * (h/n)`, then run **collision
   resolution** against every collider (below). Resolution may modify `pos`
   (push-out) and `vel` (reflection + kick).

Because resolution runs at sub-radius granularity, we get *swept-quality*
behaviour without writing a full continuous-collision solver, while staying cheap
(typically `n = 1–3` at normal speeds, up to 16 only during a hard flipper kick).

### 4.3 Circle vs line segment (the workhorse)

Given segment `A→B` and ball center `P` with radius `r`:

```
AB = B - A
t  = clamp(dot(P - A, AB) / dot(AB, AB), 0, 1)
C  = A + AB * t            // closest point on segment
d  = P - C
dist = |d|
if (dist < r + half_thickness) {
    n = dist > 1e-6 ? d / dist : segmentNormal   // unit normal away from wall
    penetration = (r + half_thickness) - dist
    P += n * penetration                          // push the ball out
    vn = dot(vel, n)
    if (vn < 0) {                                 // moving into the wall
        vel -= n * ((1 + restitution) * vn)        // reflect with restitution
        vel -= tangent * (vel·tangent) * FRICTION  // a touch of tangential damping
    }
}
```

Walls have `restitution ≈ 0.35`. Segments can carry a `half_thickness` so a wall
can be drawn (and collide) as a fat rounded bar.

**One-way segments** (the plunger-lane exit gate): if `dot(vel, passDir) > 0`
the ball is travelling in the allowed direction → skip collision entirely; the
ball passes through. Otherwise collide normally. This lets the launched ball
escape the lane upward but blocks it from re-entering from the playfield.

### 4.4 Circle vs circle (bumpers, arcs, flipper caps)

```
d = P - C; dist = |d|
if (dist < r + R) {
    n = d / dist (or arbitrary unit if coincident)
    P += n * (r + R - dist)                 // separate
    vn = dot(vel, n)
    if (vn < 0) vel -= n * ((1 + e) * vn)    // reflect
}
```

For **pop bumpers** we additionally add a fixed outward kick:
`vel += n * BUMPER_KICK` (≈ 900 u/s), award points, set a flash timer, spawn
particles, and play an SFX. Restitution for bumpers is high (`e ≈ 0.9`).

For **arcs / rounded corners** the collider is the same circle test but the ball
must stay *outside* the circle (concave) or *inside* it (the top arch acts as a
concave wall — invert the normal so the ball is pushed toward table center).

### 4.5 Slingshots

A slingshot is a triangle whose hypotenuse faces the playfield. We collide
against that face as a segment with `restitution ≈ 0.6`, and on a real impact
(`vn < 0`) add a kick `vel += faceNormal * SLING_KICK` (≈ 700 u/s), award points,
flash the triangle, and burst particles. The two slingshots (above each inlane)
create the characteristic "ping-pong" feel near the flippers.

### 4.6 Flippers (the heart of the table)

Each flipper is defined by:

- `pivot` — fixed pivot point (virtual coords).
- `length` — distance from pivot to tip (≈ 150 u).
- `restAngle` / `activeAngle` — orientation when down vs raised.
- `side` — left or right (mirrors sweep direction).
- runtime `angle`, `prevAngle`, `omega` (angular velocity, rad/s).

**Animation.** When the flipper's key is held, `angle` is driven toward
`activeAngle`; when released, toward `restAngle`. We move it at a fixed maximum
angular speed (`FLIPPER_SWEEP_SPEED ≈ 30 rad/s`) so the sweep is near-instant but
finite. Each tick we set `omega = (angle - prevAngle) / h`. The visual flipper
interpolates the same `angle`, so what you see is exactly what collides.

**Collision.** The flipper body is a capsule: a segment from `pivot` to
`tip = pivot + (cos angle, sin angle) * length`, with rounded radius
`FLIPPER_R ≈ 14`. Ball collision uses the circle-vs-segment test (§4.3) with
`half_thickness = FLIPPER_R`.

**Imparting energy (the kick).** This is what launches the ball. At the contact
point `C` on the flipper, the surface moves with velocity:

```
rVec = C - pivot
surfaceVel = omega * (-rVec.y, rVec.x)   // perpendicular, scaled by angular vel
```

Collision is resolved in the flipper's moving frame:

```
rel = vel - surfaceVel
vn  = dot(rel, n)
if (vn < 0) rel -= n * ((1 + FLIPPER_E) * vn)   // FLIPPER_E ≈ 0.4
vel = surfaceVel + rel                          // add the surface velocity back
push ball out of penetration along n
```

A stationary (resting) flipper just behaves like an angled wall. A flipper
*sweeping upward* adds large `surfaceVel` near the tip → the ball rockets up the
table. This reproduces real flipper behaviour (tip shots are more powerful than
base shots) for free, because `surfaceVel` grows with distance from the pivot.

We clamp the post-kick ball speed to `MAX_SPEED`.

**Inputs that raise a flipper** (see §6): left flipper = `ArrowLeft` / `a` / tap
on the left half of the playfield / the `◀` on-screen button; right flipper =
`ArrowRight` / `d` / right-half tap / `▶` button.

### 4.7 Plunger / launch lane

The launch lane is a narrow vertical channel on the far right. The ball starts
resting on the plunger at the bottom.

- **Charge:** holding `Space` / `ArrowDown` / the `LAUNCH` button compresses the
  plunger; `plungerPower` ramps 0→1 over ~`PLUNGER_CHARGE_TIME` (0.9 s) and the
  plunger visually retracts. While charging, the ball is pinned to the plunger
  top.
- **Release:** on key-up (or auto-fire at full charge after a short hold), the
  ball gets `vel.y = -lerp(MIN_LAUNCH, MAX_LAUNCH, plungerPower)` (≈ 1600–3200
  u/s upward) plus a tiny random nudge. A "spring" SFX plays and the plunger
  snaps forward with a small recoil animation.
- The ball travels up the lane, passes the **one-way gate** (§4.3) at the top,
  rides the curved top arch, and drops into the playfield. It cannot return to
  the lane.
- A new ball after a drain is auto-served to the plunger.

### 4.8 Tuning constants (initial values; tuned by feel)

| Constant | Value | Meaning |
|---|---|---|
| `GRAVITY` | 1400 | downward accel (u/s²) |
| `DRAG` | 0.04 | linear velocity damping /s |
| `BALL_R` | 12 | ball radius |
| `MAX_SPEED` | 3500 | velocity clamp |
| `FIXED_DT` | 1/240 | physics tick |
| `WALL_E` | 0.35 | wall restitution |
| `BUMPER_E` | 0.9 | bumper restitution |
| `BUMPER_KICK` | 900 | bumper outward impulse |
| `SLING_E` | 0.6 | slingshot restitution |
| `SLING_KICK` | 700 | slingshot impulse |
| `FLIPPER_E` | 0.4 | flipper restitution |
| `FLIPPER_R` | 14 | flipper capsule radius |
| `FLIPPER_LEN` | 150 | flipper length |
| `FLIPPER_SWEEP_SPEED` | 30 | rad/s sweep rate |
| `FRICTION` | 0.02 | tangential damping on walls |
| `MIN_LAUNCH` | 1600 | weakest plunger launch |
| `MAX_LAUNCH` | 3200 | full plunger launch |

These are intentionally generous so the table is lively. They are gathered in
`constants.ts` for one-stop tuning.

### 4.9 Stability safeguards (tilt-free clean feel)

- **Speed clamp** every tick prevents runaway energy from stacked kicks.
- **Stuck detection:** if a ball's speed stays below `STUCK_SPEED` for
  `STUCK_TIME` (e.g. lodged in a pocket), apply a tiny nudge toward table center
  so it never permanently stalls.
- **Out-of-bounds rescue:** if a ball somehow escapes the virtual bounds
  (numerical edge case), it is clamped back inside and its velocity halved.
- **No "tilt" mechanic** — the brief is explicitly tilt-free; nudging is purely a
  safety net, never a penalty.

---

## 5. Table Layout (Neon Nexus)

Top → bottom, all original geometry:

1. **Top arch** — a smooth concave arc spanning the playfield top, feeding three
   **rollover lanes** ("N", "E", "X"). Rolling through a lane lights its letter;
   lighting `N-E-X` awards a lane bonus and bumps the bonus multiplier.
2. **Plunger lane** — far-right vertical channel with the plunger at the bottom
   and the one-way gate at the top into the arch.
3. **Pop bumper cluster** — three pop bumpers in a triangle in the upper-middle.
   They are the main "ping" scorers and the most chaotic region.
4. **Drop-target bank** — a row of four drop targets on the upper-left. Completing
   all four raises the multiplier (×2 → ×3 → ×4 → ×5, capped) and re-pops the
   bank for another go.
5. **The Core (captive saucer)** — a circular sensor/standup in mid-table. Three
   hits light **MULTIBALL**; collecting it launches two extra balls.
6. **Standup targets** — a small pair on the right mid-field that feed the combo
   meter.
7. **Slingshots** — two angled slingshots forming the classic "V" above the
   inlanes.
8. **Inlanes / outlanes** — guide rails funneling toward the flippers; the
   outlanes lead to side drains (lose the ball), the inlanes feed the flippers.
9. **Flippers** — two flippers at the bottom, angled in a shallow "V".
10. **Drain** — the gap between the flippers; crossing the bottom sensor loses the
    ball.

The layout is built procedurally as data in `table.ts` from the virtual
dimensions, so it scales perfectly and is easy to tweak.

---

## 6. Controls

| Action | Keyboard | Touch |
|---|---|---|
| Left flipper | `←` / `A` | tap/hold left half of playfield, or `◀` button |
| Right flipper | `→` / `D` | tap/hold right half of playfield, or `▶` button |
| Charge / launch plunger | hold then release `Space` / `↓` | hold/release `LAUNCH` button (also tap-hold lower-right when a ball waits) |
| (Nudge — optional, disabled by design) | — | — |

On-screen controls requested via `ctx.requestControls`:

```
[
  { type: "button", key: "ArrowLeft",  label: "◀",      id: "l" },
  { type: "button", key: "Space",      label: "LAUNCH", id: "launch" },
  { type: "button", key: "ArrowRight", label: "▶",      id: "r" },
]
```

Touch on the playfield is split: a `justDown`/`down` in the left half holds the
left flipper, right half holds the right flipper, so the game is fully playable
without the buttons too. Multi-touch is supported (both flippers at once) by
reading `ctx.input.pointers`.

`setStatus` shows contextual hints: "Hold LAUNCH to charge, release to fire",
"Ball 2 of 3", "MULTIBALL!", "Drop bank complete — ×3!", etc.

---

## 7. Scoring & Game Rules

### 7.1 Base values (multiplied by the current `multiplier`)

| Event | Points |
|---|---|
| Pop bumper | 100 |
| Slingshot | 50 |
| Standup target | 250 |
| Drop target | 500 |
| Complete drop bank | 5,000 + raise multiplier |
| Rollover lane | 200 |
| Complete N-E-X lanes | 3,000 + bonus mult |
| Core hit | 750 |
| Light + start Multiball | 10,000 |
| Multiball jackpot (bumper during MB) | 2,500 |
| End-of-ball bonus | combo/lane dependent |

### 7.2 Combos & multiplier

- A **combo counter** increments on each scoring hit and resets if ~1.5 s pass
  with no hit. Rapid hits chain: displayed as `COMBO ×N` and adds a small bonus
  per link.
- The **playfield multiplier** (`×1…×5`) rises by completing the drop-target bank
  and the lane set. It persists for the current ball and resets to `×1` on a new
  ball (classic feel). All base values are multiplied by it.

### 7.3 Balls, drain, game over

- The player starts with `BALLS = 3`.
- A drain between/under the flippers (or down an outlane) removes that ball.
  - During normal play, draining the only ball ends the ball: award end-of-ball
    bonus, decrement balls remaining, serve next ball to the plunger.
  - During **Multiball**, draining a ball just removes it; the ball is *not* lost
    until only one remains and *it* drains (standard convention). Multiball ends
    when the table is back to a single ball.
- When the last ball drains with 0 remaining → **Game Over**: play the lose
  sting, show final score and high score, call `ctx.gameOver(score)`.

### 7.4 Multiball / bonus mode (the required "simple multiball")

- Hit **The Core** three times to light `MULTIBALL`.
- The next time the ball passes the Core while lit (or immediately on the third
  hit, configurable), Multiball starts: two extra balls are spawned from the
  Core, all scoring is doubled for the duration, and pop bumpers pay a **jackpot**.
- Multiball ends when only one ball remains. The doubled scoring ends with it.

### 7.5 High score persistence

- On game over, `ctx.storage.submitScore(score)` records a new local best and
  notifies the cloud sink. We also `ctx.storage.get/set("best", n)` to display
  the high score on the start/attract and game-over overlays.
- `ctx.reportScore(score)` is called whenever the score changes for the live HUD.

---

## 8. Game States

A small state machine drives the instance:

- `ATTRACT` — title overlay ("NEON NEXUS"), pulsing demo lights, high score,
  "Press LAUNCH / tap to play". Ball parked on plunger.
- `READY` — ball on plunger awaiting launch (also entered between balls).
- `PLAYING` — ball(s) in play; full physics + scoring.
- `BALL_DRAIN` — brief pause: tally end-of-ball bonus, then serve next ball or go
  to `GAME_OVER`.
- `MULTIBALL` — a flavour of `PLAYING` with the doubled scoring + extra balls
  (tracked by a flag rather than a separate physics path).
- `GAME_OVER` — final overlay with score + high score; tap/LAUNCH to restart →
  `ATTRACT`/new game.

Transitions are explicit and time-boxed (e.g. `BALL_DRAIN` lasts ~1.2 s to show
the bonus tally), and never block input parsing.

---

## 9. Rendering & Visual Design

Everything drawn with the 2D context, repainting fully each frame:

- **Cabinet / bezel:** dark gradient fill of the whole canvas; the letterbox area
  outside the table draws a subtle brushed-metal cabinet with the title silk-
  screened on the side.
- **Playfield:** near-black with a faint radial vignette and an animated grid /
  scanline shimmer for depth.
- **Neon vectors:** walls, lanes, slingshots and the arch are drawn as glowing
  strokes using layered passes (wide low-alpha blur pass + crisp bright core) via
  `shadowBlur` and additive `globalCompositeOperation = "lighter"`.
- **Bumpers:** concentric glowing rings that flash bright and scale-pulse on hit;
  a bright core dot.
- **Drop targets:** lit bars that dim/recede when dropped.
- **Inserts / lane lights:** rounded rects that animate between off (dim) and on
  (saturated glow + pulse).
- **Ball:** a radial-gradient sphere with a specular highlight, plus a **motion
  trail** drawn from the position history as fading, shrinking circles (additive)
  → reads as motion blur.
- **Flippers:** rounded capsules with a neon edge and a gradient body; they
  visibly rotate with the physics `angle`.
- **Particles:** short-lived additive sparks on bumper/sling/target hits and on
  launch; gravity-affected, fading.
- **Screen shake:** a small camera offset on big events (bumper combo, multiball
  start, drain) that decays quickly.
- **HUD (drawn on canvas, above table):** large current score, ball count "● ● ○",
  multiplier `×N`, combo meter, active mode banner ("MULTIBALL!"), and contextual
  status. The portal also shows score via `reportScore`, but we render an in-game
  HUD for polish.
- **Overlays:** attract title, "BALL 2", "MULTIBALL!", and game-over panels are
  semi-transparent neon cards centered on the table.

Color palette (original): deep indigo/black background, with neon **cyan**,
**magenta**, **lime**, and **amber** accents used consistently per feature
(bumpers cyan, slings magenta, drops lime, core amber).

---

## 10. Audio (procedural via `ctx.audio`)

- **Flipper:** short low `tone` (~180 Hz) click on activation.
- **Bumper:** bright `tone`/`sweep` ping (~660→990 Hz), pitch rises with combo.
- **Slingshot:** quick `blip`.
- **Target / drop:** `coin`-style two-note.
- **Bank complete / lane complete:** ascending arpeggio.
- **Plunger launch:** `sweep` up.
- **Multiball start:** `win` fanfare.
- **Drain:** descending `lose`-style notes (soft, no harsh punishment).
- **Game over:** `lose` sting.

All respect the engine's global mute flag automatically (handled in
`AudioManager`).

---

## 11. File Structure

```
src/games/pinball/
  PRD.md          — this document
  constants.ts    — virtual dims + all tuning constants + palette
  vec.ts          — Vec2 type + pure vector helpers
  geometry.ts     — collision primitives (segment/circle), Collider types
  table.ts        — procedural TableLayout builder (data only)
  flipper.ts      — Flipper class (animation + capsule + kick)
  ball.ts         — Ball class (integration helpers + trail history)
  particles.ts    — ParticleSystem (sparks)
  physics.ts      — PhysicsWorld: substep stepping + resolution + events
  effects.ts      — screen shake + score popups + light pulses helpers
  render.ts       — Renderer: all canvas drawing (table, ball, HUD, overlays)
  game.ts         — PinballGame: GameInstance impl, states, scoring, input
  index.ts        — create(ctx) → PinballGame
```

Each module is single-responsibility; `game.ts` orchestrates. The physics
emits typed **events** (e.g. `{type:"bumper", id, point}`) that `game.ts`
consumes for scoring, audio, particles, and shake — keeping physics pure and
testable.

---

## 12. Technical Design Details

### 12.1 PhysicsWorld API (sketch)

```ts
interface HitEvent {
  type: "wall" | "bumper" | "sling" | "drop" | "standup" | "core"
      | "lane" | "drain" | "launchGate";
  id?: string;
  point: Vec2;      // contact point (virtual coords)
  speed: number;    // impact speed for scaling juice
}

class PhysicsWorld {
  balls: Ball[];
  step(h: number): HitEvent[];     // one fixed tick across all balls
  // colliders pulled from TableLayout + live flipper capsules
}
```

`game.ts` runs the accumulator, calls `step` per tick, and folds the returned
events into game logic. De-duplication: a collider can only emit one scoring
event per ~80 ms per ball (a `lastHitTime` guard) so a single contact doesn't
spam points.

### 12.2 Flipper update order

Per fixed tick: update flipper `angle`/`omega` from input **first**, then step
balls, so the ball sees the flipper's current motion (correct surface velocity).

### 12.3 Multi-ball stepping

`step` iterates all balls; ball-vs-ball collisions are resolved with the
circle-vs-circle test (equal mass, swapped normal velocity components + small
restitution) so Multiball balls bounce off each other believably. This is cheap
(≤3 balls).

### 12.4 Resize handling

We don't cache pixel geometry; every `render()` recomputes the transform from the
live getters, and `resize?(w,h)` is a no-op beyond clearing any cached gradients.
This makes orientation changes and window resizes seamless.

### 12.5 Determinism & RNG

Minor randomness (launch nudge, particle spread) uses the engine `rng`. No
gameplay-critical determinism is required, but physics is frame-rate independent
via the fixed timestep.

---

## 13. Edge Cases & QA Checklist

- [ ] Ball never tunnels through any wall/flipper/bumper at 30, 60, 144 Hz, or
      after a long stall (clamped `dt`).
- [ ] Ball cannot get permanently stuck (stuck-nudge safety net).
- [ ] Ball cannot leave the virtual bounds (rescue clamp).
- [ ] Launch always delivers the ball to the playfield; one-way gate prevents
      re-entry.
- [ ] Draining exactly one ball during single-ball play loses a ball; draining
      during Multiball does not (until single ball remains).
- [ ] Multiplier resets per ball; combo resets on timeout.
- [ ] Game over fires once, submits score once, shows correct high score.
- [ ] Works at extreme aspect ratios (very wide and very tall) via letterbox.
- [ ] Fully playable on touch with no keyboard (flippers via half-screen taps +
      buttons; plunger via LAUNCH button).
- [ ] Mute flag respected (no audio when muted).
- [ ] No `any`, passes strict TS; imports only `@/engine` + local folder.

---

## 14. Stretch / Non-Goals

**Stretch (nice-to-have, may be partially included):** spinner with spin-down
scoring, a ramp with a "skill shot" award on first launch, animated background
parallax, attract-mode auto-demo.

**Non-goals:** networked play, leaderboards UI beyond the engine hook, a level
editor, realistic ball spin/english, nudge/tilt mechanics, asset files of any
kind.

---

## 15. Success Criteria

The game is "done" when:

1. It loads and plays at a smooth frame rate at any size, on desktop and mobile.
2. Physics is demonstrably tunnel-free and never stuck.
3. Flippers feel snappy and can clearly aim shots (tip vs base power).
4. Bumpers, slingshots, targets, lanes all score with juice and SFX.
5. Multiball can be lit and started; scoring doubles; it ends correctly.
6. 3-ball games end cleanly with correct, persisted high score.
7. The table looks like a cohesive, glowing neon machine — clearly original.
