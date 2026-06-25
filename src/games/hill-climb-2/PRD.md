# Hill Climb 2 — Product Requirements Document

> An original, "Hill Climb Racing 2"-style side-view physics driving game built
> for the CoolHastorGames TypeScript + Vite portal. 100% procedural art and
> physics — no external assets, no third-party libraries. Canvas-only rendering
> through the shared engine `GameContext`.

---

## 0. Table of Contents

1. Vision & Pillars
2. Engine Contract & Constraints
3. High-Level Architecture (files & responsibilities)
4. Coordinate Systems & Units
5. Core Game Loop & State Machine
6. Physics Model (the heart of the game)
7. Vehicles
8. Stages / Terrains
9. Procedural Terrain Generation
10. Pickups: Coins & Fuel
11. Resources: Fuel & Distance
12. Air Time, Flips & Combos
13. Upgrade Economy
14. Garage UI / Meta Game
15. Camera
16. Particles & Juice
17. Audio Design
18. HUD
19. Controls
20. Persistence / Save Schema
21. Rendering Plan & Procedural Art
22. Tuning Tables
23. Difficulty Curve
24. Edge Cases & Robustness
25. Performance Budget
26. Accessibility & Responsiveness
27. Testing Checklist
28. Future Ideas (non-goals for v1)

---

## 1. Vision & Pillars

Hill Climb 2 is a physics-driven, distance-chasing driving game. The player
controls a two-wheeled sprung vehicle that drives across smooth, procedurally
generated terrain. The fantasy is "lovable janky truck physics": the car
bounces, leans, catches air off ramps, lands on its suspension, and occasionally
flips spectacularly. The loop is short, replayable, and laced with a meta
progression of coins → upgrades → vehicles → stages.

**Design pillars**

- **Believable, never-exploding physics.** The simulation must feel weighty and
  springy but must NEVER blow up (NaN, infinite velocity, tunnelling through the
  ground). Stability is a hard requirement, achieved via fixed-timestep
  substeps and aggressive clamping.
- **Juicy feedback.** Dust kicks off the tyres, exhaust puffs when you gas,
  sparkles when you nail a flip, coins pop and chime, the engine note rises with
  wheel speed, the camera zooms out as you go faster.
- **Meaningful progression.** Every coin counts. Upgrades visibly change the
  car's behaviour. New vehicles and stages give fresh challenges.
- **Instant to play, hard to master.** Two inputs (GAS / BRAKE). The skill
  ceiling comes from throttle control on hills, balancing in the air, and
  managing fuel.
- **Runs anywhere.** Any aspect ratio, mobile or desktop, touch or keyboard,
  scaled by canvas height so the feel is identical on every screen.

**Comparison to the existing `hill-blazer` game.** `hill-blazer` is a single
file (~660 lines): one vehicle, one infinite terrain, 4 upgrades, no stages, no
vehicle selection, minimal particles. Hill Climb 2 is a multi-file project with:
multiple vehicles, multiple distinct stages with unique gravity/art/difficulty,
5 upgrade tracks, a real garage meta-UI with tabs, a richer particle system,
flip/air-time scoring, parallax scenery, and a polished camera. It should feel
like a step up in every dimension.

---

## 2. Engine Contract & Constraints

The game is created via `create(ctx: GameContext): GameInstance`.

`GameContext` provides:

- `ctx.ctx` — a `CanvasRenderingContext2D`, already DPR-scaled. We draw in CSS
  pixels and never touch the transform's device-pixel scaling.
- `ctx.width` / `ctx.height` — **getters**. They can change at any frame (resize,
  rotate, mobile). We read them every frame and never cache them across frames.
- `ctx.input` — `isDown(...keys)`, `pressed(...keys)`, `released(...keys)`,
  `pointer {x, y, down, justDown, justUp}`, `pointers` (multi-touch map).
- `ctx.audio` — `tone`, `sweep`, `noise`, plus convenience `coin/jump/hit/...`.
- `ctx.storage` — namespaced `get<T>(k, fallback)` / `set<T>(k, v)` /
  `submitScore(n, asc)` / `bestScore()`.
- `ctx.reportScore(n)` — live HUD score (distance in metres).
- `ctx.gameOver(finalScore?)` — ends the run, submits the score.
- `ctx.setStatus(text)` — text above the canvas.
- `ctx.requestControls([...])` — on-screen buttons for mobile.

`GameInstance` returns `{ update(dt), render(), resize?, destroy? }`.

**Hard constraints**

- Strict TypeScript, **no `any`**.
- No React, no external libraries. Imports only from `@/engine` and our own
  folder (`./...`).
- Canvas-only procedural visuals. **No asset files** (no images, audio files,
  fonts beyond the engine's web font).
- `dt` is already clamped by the host to `<= 0.05`. We STILL re-clamp and run
  fixed-timestep substeps with clamped velocities so physics never explode.
- Do not edit shared files; do not run npm/tsc/build/git. Registration in the
  manifest is documented but performed outside this game folder.

---

## 3. High-Level Architecture

```
src/games/hill-climb-2/
├── PRD.md          # this document
├── types.ts        # shared interfaces & enums (no logic)
├── config.ts       # data tables: vehicles, stages, upgrades, costs, palettes
├── save.ts         # SaveState load/save/derive (wraps ctx.storage)
├── terrain.ts      # Terrain class: per-stage procedural heightfield + items
├── physics.ts      # Car class: chassis + 2 sprung wheels, substep integrator
├── particles.ts    # ParticleSystem: dust, exhaust, sparkle, debris, coin pop
├── garage.ts       # Garage class: meta UI (tabs) + pointer/keyboard handling
├── render.ts       # Renderer: world draw (sky, parallax, terrain, car, HUD)
└── index.ts        # create(ctx): state machine wiring everything together
```

**Responsibility split**

- `types.ts` — pure types. Imported everywhere. No runtime code.
- `config.ts` — the single source of truth for balance numbers. Designers tweak
  here. Exposes `VEHICLES`, `STAGES`, `UPGRADES`, cost helpers, palette helpers.
- `save.ts` — reads/writes the persistent `SaveState`; provides defaults and
  migration-safe merges; derives owned/unlocked sets.
- `terrain.ts` — given a stage + seed, produces a deterministic, smooth height
  function `height(x)`, a `slope(x)` helper, and a stream of pickups. Also owns
  decorative scatter (rocks, cacti, flags) positions.
- `physics.ts` — owns all mutable simulation state for one run. `step(h, input)`
  advances one substep. Exposes read-only getters for the renderer (chassis
  transform, wheel positions/spin/compression, speed, airborne, crashed).
- `particles.ts` — fixed-capacity pooled particles; spawn helpers; update+draw.
- `garage.ts` — draws three tabs (DRIVE / GEAR / WORLD) and handles buy/select/
  GO interactions, returning intents to `index.ts`.
- `render.ts` — stateless-ish draw helpers that take the world + camera and the
  2D context. Holds cached gradients keyed by size.
- `index.ts` — the orchestrator: owns phase (`garage|countdown|run|crashed|
  results`), the camera, run stats, fuel, coins-this-run, calls physics substeps,
  feeds particles, reports score, triggers game over.

---

## 4. Coordinate Systems & Units

- **World space**: arbitrary "world units" (wu). +x is right (driving forward),
  +y is **down** (screen convention). Gravity pulls +y.
- **Metres**: `METER = 16 wu`. Distance score = `(carX - startX) / METER`, floored.
- **Screen space**: CSS pixels. The renderer maps world→screen each frame using
  the camera position and a zoom factor.
- **View height**: `VIEW_H = 360 wu` is the nominal number of world units shown
  vertically at zoom 1. The base zoom is `H / VIEW_H` so the world looks the
  same height on any screen; speed-based zoom multiplies this.
- The car's "anchor" on screen sits ~32% from the left and ~58% from the top so
  there's road visible ahead and headroom for jumps.

All gameplay constants are expressed in world units and seconds, independent of
screen pixels, so behaviour is identical at any resolution/aspect.

---

## 5. Core Game Loop & State Machine

Phases:

- `garage` — meta UI. No physics. Pointer + keyboard navigate tabs, buy
  upgrades, select vehicle/stage, press GO.
- `countdown` — short 3..2..1 lead-in. Terrain + car shown, camera settles,
  engine idles. Input ignored for driving (prevents accidental launch).
- `run` — the active simulation. Physics substeps, fuel drain, pickups, scoring,
  particles, audio, crash detection.
- `crashed` — brief slow-motion-ish freeze with debris + "WRECKED" banner before
  results.
- `results` — summary overlay: distance, coins earned (breakdown), best, buttons
  RETRY / GARAGE. After this, control returns to garage or restarts.

`update(dt)`:

1. Re-clamp `dt` to `[0, 0.05]`.
2. Dispatch on phase.
3. In `run`: compute substep count `steps` from `dt` (target ~240 Hz, min 4, max
   12), `h = dt/steps`, loop `physics.step(h, input)`, then post-step systems
   (fuel, pickups, scoring, particles, audio, camera, crash checks).
4. `input.endFrame()` is handled by the host; we only read.

`render()`:

- `garage` → garage screen.
- otherwise → sky/parallax → terrain fill → decorations → pickups → particles
  (behind car) → car → particles (front: sparkles) → HUD → phase overlays.

The instance also implements `resize()` (recompute cached gradients, keep car
on-screen in garage) and `destroy()` (no timers to clear beyond any pending
`setTimeout`; we avoid timers and drive everything off `update`).

---

## 6. Physics Model (the heart of the game)

### 6.1 Bodies

- **Chassis**: a rigid body with position `(cx, cy)`, linear velocity
  `(vx, vy)`, orientation `ang`, angular velocity `angVel`, mass `Mc`, moment of
  inertia `Ic`. Drawn as a rounded body + cabin + driver.
- **Two wheels**: each a point mass `Mw` with world position `(x, y)` and
  velocity `(vx, vy)`. Each wheel is connected to a chassis anchor by a
  spring+damper along the chassis "down" axis (suspension). Wheels have a radius
  `Rw` and a visual spin angle.

### 6.2 Suspension (spring + damper)

For each wheel:

- Anchor in world space: `A = chassisToWorld(anchorLocal)`.
- Rest target: `T = A + down * restLen` where `down` is the chassis's local down
  axis rotated to world.
- Spring force toward target: `Fs = k * (T - wheelPos) - c * (wheelVel - anchorVel)`
  where `anchorVel` includes the chassis angular contribution
  `anchorVel = vChassis + angVel × r`.
- Apply `+Fs/Mw` to the wheel; apply the reaction `-Fs` to the chassis as a
  force at the anchor, contributing a torque `r × (-Fs)`.

`k` (stiffness), `c` (damping), and `restLen` come from the vehicle base stats
multiplied by the SUSPENSION upgrade. Higher suspension = more travel and more
damping = smoother landings, fewer bounces.

### 6.3 Wheel–terrain contact

Each substep, after integrating the wheel:

- Sample ground height `gy = terrain.height(wheel.x)` and slope
  `s = terrain.slope(wheel.x)`.
- Penetration `pen = wheel.y + Rw - gy`.
- If `pen > 0` the wheel is grounded:
  - Snap `wheel.y = gy - Rw` (positional correction; prevents sinking/tunnel).
  - Build the surface tangent `(tnx, tny)` and normal `(nx, ny)` from slope.
  - Decompose wheel velocity into normal `vn` and tangential `vt`.
  - **Restitution**: if `vn < 0` (moving into ground), reflect with a small
    bounce factor (`~0.05–0.12`) so landings settle quickly.
  - **Drive**: if GAS held and fuel > 0, `vt += driveAccel * h` (forward). For
    rear-wheel-drive vehicles only the rear wheel gets full drive; front gets a
    fraction. With 4WD upgrade both wheels approach full drive.
  - **Brake/Reverse**: if BRAKE held, `vt -= brakeAccel * h`.
  - **Rolling resistance / grip**: `vt *= (1 - rollResist * h)`; clamp `vt` to a
    vehicle-specific max. Grip upgrade increases how much tangential force can be
    transferred before slipping (we model slip as a soft clamp + extra drag when
    over the limit, which also feeds wheel-spin dust).
  - Recompose `wheel.vel = normal*vn + tangent*vt`.
  - Advance visual `spin += (vt / Rw) * h`.
- If airborne: `spin` decays toward the chassis-implied rotation; small spin from
  air drag so wheels keep turning visually.

The chassis itself is **not** collided against the terrain directly during
normal driving — the wheels hold it up. However, we detect roof/head contact for
crashes (see 6.6).

### 6.4 Integration & gravity

- Gravity `G = stage.gravity` (wu/s²). Moon is ~0.32×, mountains ~1.05×, etc.
- Chassis: `vx += Fx/Mc * h; vy += (Fy/Mc + G) * h;`
  `angVel += torque/Ic * h; angVel *= angularDamp;`
- Wheels get gravity too: `wheel.vy += G * h` (plus spring force).
- Position update: `cx += vx*h; cy += vy*h; ang += angVel*h;`

### 6.5 Air control

When **both** wheels are airborne, GAS rotates the chassis nose-up (or in the
flip direction) and BRAKE rotates nose-down by applying a bounded angular
acceleration `airTorque`. This lets skilled players land flips or correct
attitude. Air control is weaker than ground torque and is clamped so you can't
spin infinitely fast.

### 6.6 Crash detection

A run ends in a crash when the **driver head / roof** touches the ground. We
compute the world position of a point above the cabin (`headLocal`) and a couple
of roof points; if any is at/under the terrain height, it's a crash. We also
treat being inverted (`|ang| > ~2.3 rad`) while the roof contacts ground as a
crash. Wheels-down landings, even hard ones, are NOT crashes (suspension absorbs
them). This matches the genre: you only die by landing on your head or running
out of fuel.

### 6.7 Stability rules (NON-NEGOTIABLE)

- `dt` clamped to `<= 0.05`; substeps target ~240 Hz (`steps = clamp(ceil(dt*240),
  4, 12)`), `h = dt/steps`.
- Clamp every integrated quantity each substep:
  - `vx, vy ∈ [-MAXV, MAXV]` (e.g. ±2200 wu/s).
  - `angVel ∈ [-MAXW, MAXW]` (e.g. ±18 rad/s).
  - per-wheel speed capped (`hypot(vx,vy) <= WHEEL_MAXV`).
  - `vt` (tangential) clamped to `[-brakeMax, driveMax]`.
- Positional correction snaps wheels out of the ground (no tunnelling).
- NaN guard: after each substep, if any of `cx,cy,vx,vy,ang,angVel` is not
  finite, hard-reset velocities/ang to safe values (and end the run gracefully).
- Spring constants chosen so the system is over-damped enough to be stable at
  the chosen substep rate (validated by the tuning table; damping ratio ~0.4–0.7).
- `restLen`, `k`, `c` are bounded by upgrade caps so no upgrade combination can
  destabilise the integrator.

### 6.8 Why springs (not hard constraints)

Spring/damper suspension with substeps is simple, robust, and forgiving of the
variable `dt` a browser game sees. Hard distance constraints (e.g. PBD) can jitter
or explode if `dt` spikes. Springs degrade gracefully: worst case the car bounces
a bit more, never to infinity, thanks to clamps.

---

## 7. Vehicles

Each vehicle has base stats that are multiplied by upgrades. Stats:

- `power` — base drive acceleration.
- `brake` — brake/reverse acceleration.
- `grip` — tangential traction (slip threshold + rolling).
- `mass` — chassis mass (affects momentum, climbing, flip inertia).
- `suspK`, `suspC`, `restLen` — base suspension.
- `wheelR` — wheel radius (bigger climbs obstacles, raises CG).
- `wheelBase` — distance between axles (longer = more stable, harder to flip).
- `cabinH`, `bodyW`, `bodyH` — art + crash geometry.
- `fwd` — drive split: 0 = pure rear, 1 = full 4WD baseline (before upgrade).
- `airControl` — air torque multiplier.
- `fuelUse` — fuel consumption multiplier.
- `color`, `accent` — palette.

**Roster (v1, 5 vehicles):**

| id            | name          | unlock | character |
|---------------|---------------|--------|-----------|
| `jeep`        | Trailblazer   | free   | The all-rounder. Balanced power/grip/mass. The tutorial car. |
| `sports`      | Sprinter      | 2,500  | Fast & light, low grip, twitchy in the air, sips less fuel but flips easily. |
| `truck`       | Bigfoot       | 7,500  | Monster truck. Huge wheels, high grip, heavy, climbs anything, thirsty, slow to spin. |
| `bike`        | Trail Bike    | 15,000 | Tiny, super light, insane air control & flips, almost no stability — expert toy. |
| `rover`       | Moon Rover    | 40,000 | Long wheelbase, very stable, great suspension, modest power; shines on rough/low-g terrain. |

Stat philosophy: no strictly-best car. The truck dominates rough climbs but is
slow and thirsty; the sprinter wins smooth countryside distance but dies on
moguls; the bike is a flip machine for combo coins; the rover is the safe
all-terrain pick once you can afford it.

---

## 8. Stages / Terrains

Each stage defines gravity, terrain generation parameters, palette, parallax
layers, decoration set, fuel-can frequency, and an unlock cost. The score &
coins persist globally, but `best distance` is tracked per stage.

**Stages (v1, 4 stages):**

| id            | name          | unlock | gravity | feel |
|---------------|---------------|--------|---------|------|
| `country`     | Countryside   | free   | 1.00×   | Gentle rolling green hills, blue sky, clouds, trees. Forgiving intro. |
| `desert`      | Dust Bowl     | 4,000  | 1.00×   | Tan dunes, bigger smoother swells + sharp ridges, heat haze, cacti, mesas. |
| `moon`        | Lunar Base    | 12,000 | 0.34×   | Low gravity = huge floaty jumps, big craters, black starfield, earth on horizon. |
| `mountain`    | Alpine Peaks  | 30,000 | 1.06×   | Steep snowy climbs, sharp jagged terrain, pines, the hardest stage. |

Gravity reference: base `G = 1900 wu/s²` × stage multiplier.

Per-stage terrain knobs (amplitudes/wavelengths, ridge sharpness, difficulty
ramp rate) are in §9 and the tuning tables (§22).

---

## 9. Procedural Terrain Generation

Goal: smooth, continuous, deterministic-per-run terrain that ramps in
difficulty with distance and varies by stage. Infinite to the right.

**Method: layered sinusoids (sum of octaves).**

`height(x) = baseY + Σ_i amp_i * sin(x * freq_i + phase_i) * envelope(x)`

- Each stage provides arrays of `amps` and `wavelengths` (4 octaves) plus a phase
  seeded from the run RNG (`mulberry32(seed)`), so every run differs but is
  perfectly smooth and reproducible.
- `freq_i = 2π / (wavelength_i * jitter_i)` where `jitter_i ∈ [0.85, 1.15]`.
- `envelope(x)`:
  - **Launch flat**: ease terrain amplitude from 0→1 over the first ~700 wu so
    the car starts on a flat pad.
  - **Difficulty ramp**: amplitude scales `0.55 → ramp_max` over `0 → rampDist`
    metres (stage-specific). Far out, terrain is at full chaos.
- **Ridge sharpening** (desert/mountain): apply `sign(s)*|s|^p` shaping on a
  layer to create sharper crests for ramps. Kept continuous (C0/C1) to avoid
  physics spikes.
- `slope(x) = (height(x+ε) - height(x-ε)) / (2ε)` with `ε ≈ 1.2 wu`.

This is `O(octaves)` per sample and fully stateless, so the renderer can sample
freely and physics can sample wheels each substep cheaply.

**Determinism & seeding.** On run start we pick `seed = (Date.now() ^ rand) >>>
0`. Stored on the terrain instance. Both physics and render share the same
terrain instance, so they always agree.

**No tunnelling guarantee.** Because the terrain is a single-valued height
function (no overhangs), wheel contact is a simple `y` comparison and positional
snap — physically impossible to fall through.

---

## 10. Pickups: Coins & Fuel

A pickup stream is generated lazily ahead of the car:

- Maintain `spawnX`; while `spawnX < carX + lookahead`, advance `spawnX` by a
  random gap (`110–280 wu`) and emit a pickup at `(spawnX, height(spawnX) -
  hover)`.
- **Coins (~80%)**: sometimes single, sometimes arranged in an **arc** of 3–6
  coins tracing a jump trajectory over a crest (encourages going fast for air
  collection). Each coin = 1 coin.
- **Fuel cans (~20%, stage-tuned)**: refill a chunk of fuel. Rarer on moon
  (long air time) and mountains (harder).
- Collection: circle test between car centre and pickup (radius ~ `2.8*METER`).
  On collect: mark gone, spawn a coin-pop particle + sound, add to run totals.
- Cull pickups behind the camera (`x < camX - margin`).

Coins from pickups + bonus coins (air/flips) accumulate into `runCoins`, added to
the persistent wallet at end of run.

---

## 11. Resources: Fuel & Distance

- **Fuel** starts at `maxFuel = vehicleTank * (1 + 0.18 * fuelUpgrade)` and drains
  continuously: a base idle drain + extra while gassing under load, scaled by the
  vehicle `fuelUse` and reduced slightly by... nothing (engine upgrade adds a tiny
  drain to keep balance honest). Fuel cans refill `+~35%` of a base amount.
- **Out of fuel**: the engine cuts (no drive torque). The car coasts. The run
  ends when fuel is empty AND the car has effectively stopped (`|vx| <
  threshold`) and both wheels grounded — i.e. you get to coast to a halt, then
  it's over. Status text warns "OUT OF FUEL".
- **Distance** = `max(0, (carX - startX) / METER)`, monotonic (never decreases
  even if you reverse). Reported live via `reportScore(floor(metres))`.

---

## 12. Air Time, Flips & Combos

- **Airborne** when both wheels ungrounded for > ~0.12 s. Track `airTime`.
- **Flip tracking**: accumulate chassis rotation while airborne; each full `2π`
  (in either direction) = one flip. On a clean landing (wheels-down, not
  crashed) award bonus coins: `flipBonus = flips * FLIP_COINS` and an air-time
  bonus `floor(airTime / 0.5) * AIRTIME_COINS`, capped per jump.
- A **sparkle particle burst** + ascending chime celebrate a successful flip
  landing; a small "+N" floating text shows the bonus.
- Crashing mid-flip awards nothing (risk/reward).
- Combo multiplier (optional polish): consecutive clean jumps without touching
  brake increment a small multiplier shown in HUD; resets on crash/brake.

---

## 13. Upgrade Economy

Five upgrade tracks, each level `0..MAX_LEVEL (8)`:

| key          | name        | effect |
|--------------|-------------|--------|
| `engine`     | ENGINE      | +drive acceleration (and top wheel speed). |
| `tires`      | TIRES       | +grip (traction, climbing, less slip), small brake boost. |
| `suspension` | SUSPENSION  | +spring travel & damping (smoother landings, fewer bounces/flips on rough ground). |
| `drive`      | 4WD         | shifts drive split toward front wheel → better climbing & launch. |
| `fuel`       | FUEL TANK   | +max fuel capacity. |

- **Per-vehicle upgrades.** Each vehicle stores its own upgrade levels (so your
  maxed jeep doesn't carry to a fresh truck). This deepens the economy and gives
  reasons to keep earning.
- **Cost curve**: `cost(level) = round(baseCost * growth^level)` with
  `baseCost ≈ 220`, `growth ≈ 1.45`, so early upgrades are cheap and maxing is a
  long-term goal. Costs differ slightly per track (4WD pricier).
- **Effect curves** (see §22) are linear-ish but with diminishing perceived
  returns; each level is visibly felt (e.g. engine +12% accel/level).
- Buying deducts coins, persists immediately, and re-derives the live tuning so a
  test drive reflects it instantly.

**Earning coins**: pickups during a run + air/flip bonuses → `runCoins`, banked at
end of run regardless of crash (you keep what you collected). This keeps failure
non-punishing and the loop addictive.

---

## 14. Garage UI / Meta Game

The garage is a full-screen canvas UI shown before each run (and reachable from
results). Three tabs:

1. **DRIVE** (vehicles): horizontally selectable cards showing the vehicle
   preview (drawn with the same car art), name, a radar/stat readout (POWER,
   GRIP, SUSP, MASS), owned/locked state and unlock cost. Buttons: SELECT (owned)
   or BUY (locked, if affordable). A rotating preview of the car idles here.
2. **GEAR** (upgrades): the 5 upgrade rows for the *currently selected* vehicle,
   each with name, blurb, level pips (0..8), and a BUY button showing cost or
   MAX. A live mini stat bar shows the resulting performance.
3. **WORLD** (stages): selectable stage cards with a painted thumbnail (sky +
   terrain silhouette + gravity tag), name, per-stage best distance, owned/locked
   + unlock cost.

Common chrome: coin balance top-right, title top-left, a big **GO!** button
bottom-centre, tab buttons top. Everything is pointer-driven with keyboard
fallbacks (Left/Right to move selection within a tab, Up/Down or Tab to change
tab, Enter to buy/select, Space/Enter on GO to start). All hit-testing uses the
shared `pointInRect` helper and layout is computed from `W/H` each frame so it
adapts to any aspect.

`garage.ts` exposes `draw(c, W, H)`, `handlePointer()`, `handleKeys()`, returning
an optional intent (`{type:'go'}`) consumed by `index.ts`.

---

## 15. Camera

- **Follow**: camera target = car centre, but biased forward by velocity
  (look-ahead) so you see what's coming: `camX = cx + clamp(vx*0.18, -lead, lead)`.
- **Vertical smoothing**: `camY` eases toward `cy` with a critically-damped lerp
  so jumps don't make the view snap; clamped so terrain never leaves a big void.
- **Speed zoom**: base zoom `H/VIEW_H` times a factor that eases from `1.0` at
  rest down to `~0.82` at high speed (zoom OUT when fast) so fast sections feel
  faster and you see more. During big air the camera zooms out a touch more to
  keep the car framed.
- **Crash**: small zoom punch + shake on crash for impact.
- All easing uses `1 - exp(-rate*dt)` style smoothing (framerate-independent).

---

## 16. Particles & Juice

Pooled, fixed-capacity (`~300`) particle array, each: position, velocity, life,
maxLife, size, color, kind, gravityScale, drag, rotation. Kinds:

- **dust** — kicked off grounded driving wheels; rate scales with wheel slip /
  speed; tinted to the stage ground colour; rises and fades.
- **exhaust** — dark puffs from the tailpipe while gassing; drift backward.
- **sparkle** — bright star bursts on a successful flip landing; additive-ish
  bright colour, short life.
- **debris** — on crash: chunks fly from the car; gravity-affected; settle.
- **coinPop** — golden burst + rising "+1" when a coin is collected.
- **landingPuff** — burst of dust on a hard landing (impact-scaled).
- **splash/snow** (stage flavour) — moon dust is grey & floaty (low gravity),
  snow puff white on mountains, sand tan in desert.

Particles update with their own clamped physics (independent of car) and draw
with simple shapes (circles, small rects, 4-point stars). Capacity-bounded:
oldest recycled when full. Drawn in two passes (behind car: dust/exhaust/debris;
front: sparkles/coin text).

Additional juice: speed lines at very high speed, screen shake on crash &
hard landings, slight chassis squash on big compression, tyre deform.

---

## 17. Audio Design

All synth via `ctx.audio` (no files):

- **Engine**: a periodic `tone` (sawtooth) whose frequency tracks wheel angular
  speed / car speed, retriggered every ~0.08–0.12 s while gassing; pitch and a
  subtle volume rise with RPM. Idle gives a low, slow putter; out-of-fuel goes
  silent. We modulate by `clamp(baseHz + speed*scale, ...)`.
- **Coin**: the engine `coin()` chime (two-note).
- **Fuel pickup**: a short rising `sweep` / blip.
- **Flip success**: ascending arpeggio (`win`-like) scaled to flip count.
- **Jump/launch off a crest**: soft `sweep` whoosh when leaving the ground fast.
- **Land**: a soft thud (`noise` low-vol) scaled to impact; bigger = louder.
- **Crash**: `explosion()` noise burst + descending `lose` tones.
- **UI**: `blip()` on tab/select, `coin()` on purchase.

Audio is rate-limited (cooldowns) so we never spam the WebAudio graph. Respects
the engine's global mute.

---

## 18. HUD

Drawn in screen space over the world during `run`/`crashed`:

- **Top-left fuel gauge**: rounded bar, green→amber→red as it empties, "FUEL"
  label, with a subtle low-fuel pulse under ~25%.
- **Top-right distance**: big `### m` with the stage name beneath, and best
  distance ghost.
- **Coins**: current `runCoins` with a coin glyph, near distance.
- **Combo/flip**: transient centre-top "+N FLIP!" / "x2" popups.
- **Speedometer** (optional small arc) bottom-left.
- All sizes scale from `H` and clamp to sensible min/max so they read on phones
  and big screens alike.

---

## 19. Controls

- **GAS / forward**: `ArrowRight`, `Space`, `d`, `ArrowUp`, `w`, and the on-screen
  **GAS** button. In the air, GAS rotates the car (nose up / flip forward).
- **BRAKE / reverse**: `ArrowLeft`, `a`, `ArrowDown`, `s`, and the on-screen
  **BRAKE** button. In the air, BRAKE rotates the car (nose down / flip back).
- **Garage**: pointer/tap to interact; keyboard arrows + Enter as fallback.
- `requestControls`:
  - During a run: `[{button ArrowLeft "BRAKE" id:brake}, {button ArrowRight "GAS"
    id:gas}]`.
  - In garage/results: `[]` (no driving buttons; UI is pointer-based).
- Status line mirrors the controls and current hint ("GAS → / SPACE  •  BRAKE
  ←", "OUT OF FUEL", etc.).

---

## 20. Persistence / Save Schema

Stored via `ctx.storage` (namespaced to the game id). Single JSON blob under key
`save` plus the engine's `__best` for the leaderboard.

```ts
interface SaveState {
  version: number;            // schema version for safe migration
  coins: number;              // global wallet
  selectedVehicle: VehicleId;
  selectedStage: StageId;
  ownedVehicles: VehicleId[]; // jeep always present
  ownedStages: StageId[];     // country always present
  // per-vehicle upgrade levels
  upgrades: Record<VehicleId, UpgradeLevels>;
  // per-stage best distance (metres)
  bestByStage: Partial<Record<StageId, number>>;
  totalDistance: number;      // lifetime metres (vanity)
}
```

- `load()` merges stored data over defaults (missing keys filled), so adding new
  vehicles/stages/upgrades later won't crash old saves.
- Every mutating action (buy upgrade, buy/select vehicle, buy/select stage,
  bank run coins, new best) writes immediately.
- `submitScore(metres)` on game over updates the global best + cloud sink; we
  also store per-stage best.

---

## 21. Rendering Plan & Procedural Art

Everything is canvas vector art. Layered back-to-front during a run:

1. **Sky**: vertical gradient unique per stage (day blue, desert haze, lunar
   black w/ stars, alpine dusk). Optional sun/earth disc.
2. **Far parallax**: distant mountain/dune silhouettes scrolling at ~0.15× car
   x; a second mid layer at ~0.35×. Drawn as filled wavy polygons.
3. **Mid scenery**: clouds (country), heat shimmer (desert), stars (moon),
   aurora (mountain) — cheap and atmospheric.
4. **Terrain body**: the height function sampled every ~6 px into a filled
   polygon down to the bottom of the screen, with a stage gradient (grass green,
   sand tan, lunar grey, snow white) and a bright "surface line" stroke on top.
   A subtle sub-surface stripe (dirt/rock) adds depth.
5. **Decorations**: scattered stage props sitting on the surface (trees/bushes,
   cacti/mesas, craters/flags, pines/rocks), positioned deterministically from x
   so they don't pop.
6. **Pickups**: spinning gold coins (ellipse squash to fake 3D rotation) and red
   fuel cans with an "F".
7. **Particles (back)**: dust, exhaust, debris.
8. **Car**: wheels (tyre + hub + spokes that spin), suspension visualised as the
   gap between axle anchor and wheel, chassis body (rounded, vehicle-coloured),
   cabin/roll-cage, window, driver head + helmet, headlight, exhaust pipe.
   Rotated by `ang`. Each vehicle has distinct proportions/colours via config.
9. **Particles (front)**: sparkles, floating "+N" texts.
10. **HUD + overlays** (see §18, §5).

Cached gradients are rebuilt on resize keyed by `W,H` to avoid per-frame
allocation. Car art is parameterised by the vehicle config so adding a vehicle is
data-only.

---

## 22. Tuning Tables (initial values, world units / seconds)

Global:

```
METER          = 16
VIEW_H         = 360
G_BASE         = 1900
MAXV           = 2200      // chassis linear clamp
MAXW           = 18        // chassis angular clamp (rad/s)
WHEEL_MAXV     = 2400
SUBSTEP_HZ     = 240  (steps = clamp(ceil(dt*240),4,12))
ANG_DAMP       = 0.999 per substep
AIR_THRESHOLD  = 0.12 s
START_X        = 260
LOOKAHEAD      = pickups generated to camX + ~2600
```

Upgrade effect per level L (0..8):

```
engine:     driveAccel *= (1 + 0.12*L)       ; wheelVtMax *= (1 + 0.05*L)
tires:      gripFactor *= (1 + 0.10*L)       ; brakeAccel *= (1 + 0.05*L)
suspension: suspK *= (1 + 0.08*L) ; suspC *= (1 + 0.10*L) ; restLen *= (1 + 0.04*L)
drive:      fwdSplit = clamp(baseFwd + 0.09*L, 0, 1)
fuel:       maxFuel *= (1 + 0.18*L)
```

Upgrade cost: `round(base * 1.45^L)` with bases:
`engine 220, tires 200, suspension 210, drive 300, fuel 180`.

Vehicle base stats (representative; final numbers live in `config.ts`):

```
            power  brake  grip  mass  suspK  suspC  restLen  wheelR  wheelBase  air   fuelUse  tank
jeep        820    640    1.00  4.0   640    34     26       16      66         1.0   1.00     100
sports      1020   560    0.80  3.2   560    30     22       13      72         1.3   0.85     90
truck       760    760    1.25  6.2   760    44     34       24      78         0.7   1.30     120
bike        900    520    0.90  2.2   520    26     24       15      40         1.8   0.80     80
rover       820    680    1.10  4.6   820    48     34       18      96         0.9   1.05     130
```

Stage params:

```
            gravityX  rampDist(m)  ramp_max  amps(4)            wavelengths(4)        ridge  fuelRate
country     1.00      900          1.15      [54,26,13,7]       [560,250,120,62]      0.0    0.22
desert      1.00      750          1.35      [70,34,16,8]       [620,260,130,60]      0.35   0.18
moon        0.34      650          1.50      [96,40,18,9]       [760,300,150,70]      0.10   0.14
mountain    1.06      600          1.70      [86,44,22,12]      [520,210,110,54]      0.45   0.16
```

Fuel:

```
idleDrain  = 3.2 /s
gasDrain   = 8.5 /s (while gassing under load) * vehicle.fuelUse
canRefill  = 36 (absolute fuel units)
outOfFuelStopSpeed = 6 wu/s
```

Scoring / coins:

```
FLIP_COINS      = 25 per full flip (clean landing)
AIRTIME_COINS   = 4 per 0.5s air (clean landing), capped 40/jump
distance score  = floor(metres)
```

These numbers are first-pass; §23 describes how they ramp. Final authored values
in `config.ts` may differ after feel-tuning but must respect the stability caps.

---

## 23. Difficulty Curve

- **Within a run**: terrain amplitude ramps from gentle to chaotic over the
  stage's `rampDist`. Early metres are a confidence-building cruise; later metres
  demand throttle control and air management. Pickup density stays roughly
  constant so reward keeps pace.
- **Across stages**: country (easy) → desert (sharper crests) → moon (timing &
  long air, but soft landings from low-g) → mountain (steep + spiky, expert).
- **Across the meta**: a fresh jeep struggles past a few hundred metres; a few
  upgrade levels open up consistent multi-km runs; unlocking the truck trivialises
  rough climbs but is slow; the bike rewards flip-hunting; the rover is the
  all-terrain endgame pick. Coin sinks (vehicles 2.5k→40k, upgrades) are sized so
  the player always has a next goal.

---

## 24. Edge Cases & Robustness

- **dt spikes / tab refocus**: `dt` clamped; substeps bounded. A single huge frame
  can't launch the car to infinity.
- **NaN / Inf**: post-substep finite check resets the body and ends the run
  cleanly rather than rendering garbage.
- **Resize / rotate mid-run**: width/height read every frame; layout and camera
  recompute; cached gradients rebuilt; world units keep the feel constant.
- **Tiny / huge canvas**: HUD and garage sizes clamp; zoom derives from height.
- **Stuck upside-down but not crashed** (e.g. wedged in a dip on the roof): the
  roof-contact crash check catches it; also a watchdog — if airborne+inverted for
  too long with no progress, treat as crash.
- **Reverse off the start**: distance never goes negative; you simply can't score
  by reversing. Driving back over collected pickups does nothing (already gone).
- **Out of fuel on a slope**: car may roll backward; run ends once it settles
  (speed below threshold, wheels grounded) so it doesn't hang forever — also a
  max "coasting" timer ends it.
- **Buying with exactly enough coins**: allowed; balance can hit 0.
- **Selecting a locked vehicle/stage**: blocked; shows cost; BUY only when
  affordable.
- **Pointer + keyboard simultaneously in garage**: both update the same selection
  state; last input wins; no double-buys (purchases gated on `justDown`/`pressed`).
- **Multiple rapid GO presses**: phase guard prevents re-entering run setup.
- **Audio context suspended** (autoplay policy): engine handles resume on first
  gesture; we never assume audio exists.
- **Long sessions**: pickups and particles are culled/pooled; no unbounded arrays.
- **destroy()**: clears any pending crash→results timeout; nulls references.

## 25. Performance Budget

- Target 60 fps on mid-range mobile. Per frame: terrain sampled ~W/6 times for
  draw (cheap, 4 sin each), physics samples 2 wheels × ≤12 substeps × a couple of
  terrain calls. Particle cap 300. No per-frame allocations in hot paths
  (reuse arrays/objects; gradients cached). Draw calls batched by shape where
  possible.

## 26. Accessibility & Responsiveness

- Two-button control scheme works on keyboard, mouse (hold), and touch.
- High-contrast HUD with outlines; colour-blind-safe fuel gauge also changes
  width/pulse, not just hue.
- Everything scales with canvas size; supports portrait & landscape, any aspect.
- Respects global mute.

## 27. Testing Checklist

- [ ] Car never reaches NaN/Inf under rapid input + resize stress.
- [ ] No tunnelling through terrain at max speed on steep slopes.
- [ ] Hard landings absorbed by suspension (no spurious crashes).
- [ ] Roof landing = crash; wheels landing = safe.
- [ ] Fuel drains, refills, and ends the run when empty + stopped.
- [ ] Coins/fuel collect; runCoins banked on both crash and out-of-fuel.
- [ ] Flips counted and bonus awarded only on clean landing.
- [ ] Distance reported live and final score correct on game over.
- [ ] All upgrades visibly change behaviour; costs deduct & persist.
- [ ] Vehicle/stage buy + select persist across reload.
- [ ] Each stage looks distinct; moon is visibly low-gravity.
- [ ] Garage usable by pointer and keyboard at multiple aspect ratios.
- [ ] Mobile on-screen GAS/BRAKE buttons drive the car.
- [ ] No `any`; strict TS clean; only `@/engine` + local imports.

## 28. Future Ideas (non-goals for v1)

- Daily seeded challenge (engine already has `dailySeed`).
- Ghost replays of your best run.
- Boost/nitro pickup; ramps & loops as discrete props.
- Per-vehicle paint shop; cosmetic trails.
- More stages (volcano, city, underwater) & vehicles (hovercraft, tank).
- Online distance leaderboard board view inside the garage.
```
