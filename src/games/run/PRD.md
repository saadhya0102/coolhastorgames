# NEON CONDUIT — Product Requirements Document

> An original, highly-polished, pseudo-3D **endless tunnel runner** for the
> CoolHastorGames TypeScript + Vite portal. Inspired by the *feel* of the
> "Run"-genre (running on the inside walls of a tunnel in space) but built
> entirely from original procedural art, original code, and an original
> difficulty/level system. **No assets**: every pixel is drawn on the 2D canvas.

---

## 0. Document map

1. Vision & pillars
2. Player fantasy & core loop
3. Controls (desktop + mobile)
4. Coordinate systems & notation
5. The pseudo-3D projection math (full derivation)
6. The tunnel: regular-polygon prism geometry
7. Wall-running & the roll/gravity model (full derivation)
8. Player physics: auto-run, jump arcs, falling
9. Procedural level generation (rings, holes, fairness guarantees)
10. Difficulty curve & segments
11. Rendering pipeline (draw order, fog, neon, parallax)
12. Particles & juice
13. Audio design
14. HUD, screens & game states (state machine)
15. Scoring & persistence
16. Performance budget & resilience
17. File / module architecture
18. Data structures (TypeScript shapes)
19. Tuning constants (single source of truth)
20. Edge cases & failure handling
21. Accessibility & feel checklist
22. Test plan / acceptance criteria
23. Future / stretch ideas

---

## 1. Vision & pillars

**Neon Conduit** drops the player inside an endless glowing space conduit — a
tunnel whose cross-section is a regular polygon (square, pentagon, hexagon, …).
The runner auto-sprints "forward" (into the screen, toward a vanishing point).
Gravity pulls the runner against whichever inner face is currently "down".

The signature mechanic: the player **runs around the inside of the tunnel**.
Pressing left/right doesn't strafe in a flat plane — it *rolls the entire
tunnel* so an adjacent face rotates down to become the new floor. The world
literally banks under you. Tiles on the faces have **holes**; run over a hole
while grounded and you plummet into the void. Survive by **jumping** short gaps
or **rolling onto a face that still has a tile** there.

### Design pillars

- **P1 — Readable depth.** The perspective must instantly communicate "this
  tile is near / that hole is coming". Fog, scale, and neon edges sell depth.
- **P2 — Tactile rolling.** Switching faces should feel physical: smooth eased
  rotation, a banking camera tilt, a whoosh, dust on landing.
- **P3 — Fair but relentless.** Every obstacle must be *clearable* from the
  player's current position. Death is always "I misread it / mistimed it",
  never "impossible". Difficulty ramps with distance.
- **P4 — Zero assets, full juice.** Procedural starfield, gradient nebula,
  glowing tiles, particle trails, screen shake — all on a single 2D context.
- **P5 — Any screen.** Re-reads `ctx.width`/`ctx.height` every frame; works on
  ultrawide, portrait phones, and everything between.

---

## 2. Player fantasy & core loop

> "I'm a spark of light tearing through a collapsing neon conduit, snapping the
> whole world sideways to find solid ground a split-second before I'd fall."

**Core loop (per ~1–3 seconds):**

1. Read the upcoming rings: where are the holes?
2. Decide: stay, roll left, roll right, or jump.
3. Execute; the tunnel banks / the spark arcs.
4. Land safely → score ticks up → speed nudges up → repeat.
5. Eventually misjudge → fall → game-over screen → instant retry.

The session length grows with skill. Best distance persists.

---

## 3. Controls

The game requests on-screen controls:

```
ctx.requestControls([
  { type: "dpad" },
  { type: "button", key: "Space", label: "JUMP", id: "jump" },
]);
```

### Desktop / keyboard

| Action          | Keys                                  |
| --------------- | ------------------------------------- |
| Roll left       | `ArrowLeft`, `A`                      |
| Roll right      | `ArrowRight`, `D`                     |
| Jump            | `Space`, `ArrowUp`, `W`               |
| Start / Retry   | `Space` / tap / click                 |

### Mobile / touch

- **D-pad** left/right inject `ArrowLeft` / `ArrowRight` virtual keys.
- **JUMP** button injects `Space`.
- **Tap** anywhere on the upper canvas = jump (redundant, forgiving).
- **Swipe** left/right on the canvas = roll left/right (detected from pointer
  delta on `justUp`), as an extra-forgiving alternative to the d-pad.

### Input rules

- Roll inputs are **edge-triggered** (`pressed`), not held — one press = one
  face. Holding does not auto-repeat (prevents accidental spins). A small
  `inputBufferT` lets a press register slightly before landing.
- Jump is edge-triggered and only fires when grounded (with a short coyote
  window — see §8).

---

## 4. Coordinate systems & notation

We use three spaces:

1. **Tunnel space** (3D, right-handed-ish):
   - `x` — horizontal across the cross-section.
   - `y` — vertical across the cross-section (**+y is up** in world terms).
   - `z` — depth down the tunnel axis (**+z is forward**, away from camera).
   - Origin is on the tunnel axis (the center line). The cross-section lives in
     the `x,y` plane at a given `z`.

2. **Camera-relative depth**: `dz = z − camZ`. The camera sits at `z = camZ`
   looking toward `+z`. Only rings with `dz` in `[NEAR, FAR]` are drawn.

3. **Screen space** (CSS pixels, the canvas):
   - `sx` increases right, `sy` increases **down** (standard canvas).
   - The vanishing point is `(cx, cy)` where all depth lines converge.

Notation:
- `N` — number of polygon faces (and thus vertices).
- `Rc` — circumradius (center → vertex).
- `Ap` — apothem / inradius (center → face midpoint) `= Rc·cos(π/N)`.
- `roll` — current tunnel roll angle (radians, continuous, not wrapped).
- `bank` — small extra screen tilt for juice (radians).
- `SEG` — z-length of one ring (one row of tiles along the tunnel).
- `Z_PLAYER` — the fixed `dz` at which the player avatar is drawn.

---

## 5. The pseudo-3D projection math

### 5.1 Perspective scale

We use a classic pinhole-style scale. A point at camera-relative depth `dz`
shrinks by

```
scale(dz) = FOCAL / (FOCAL + dz)
```

- `dz = 0` (right at the camera plane) → `scale = 1`.
- `dz → ∞` → `scale → 0` (converges to the vanishing point).
- `FOCAL` controls the "lens": larger = flatter / longer lens, smaller = wider
  / more dramatic perspective. We tune `FOCAL ≈ 340`.

We clamp `dz` to a small positive minimum `Z_MIN` (e.g. `1`) before computing
scale so geometry just behind the camera plane never divides toward infinity.

### 5.2 World → screen

A cross-section point has world coordinates `(wx, wy)` (in tunnel units). We map
tunnel units → pixels with a single scalar `UNIT` derived from the viewport so
the tunnel fills the screen nicely on any aspect ratio:

```
UNIT = min(W, H) * VIEW_FILL      // VIEW_FILL ≈ 0.92
```

Projection (before bank):

```
s   = scale(dz)
sx0 = cx + wx * UNIT * s
sy0 = cy - wy * UNIT * s          // minus: world +y is up, screen +y is down
```

`cx = W / 2`. `cy = H * VANISH_Y` with `VANISH_Y ≈ 0.46` (slightly above the
middle so the floor face has more room than the ceiling).

### 5.3 Bank (screen tilt for juice)

We add a small whole-screen rotation `bank` around the vanishing point — a
cosmetic camera lean layered on top of the gameplay `roll`. Rather than rotate
every point in code, we apply it once to the canvas transform:

```
ctx.translate(cx, cy);
ctx.rotate(bank);
ctx.translate(-cx, -cy);
// ... draw all tunnel geometry using (sx0, sy0) ...
```

Equivalently, the closed form for a banked point is:

```
dx = sx0 - cx
dy = sy0 - cy
sx = cx + dx*cos(bank) - dy*sin(bank)
sy = cy + dx*sin(bank) + dy*cos(bank)
```

`bank` is driven by roll velocity (§7.4) so the camera leans *into* a roll and
springs back — a motorcycle-cornering feel.

### 5.4 Why this is enough

Because every cross-section is centered on the tunnel axis `(0,0)`, **all rings
share the same vanishing point** `(cx, cy)`. Straight tunnel edges become
straight screen lines converging to `(cx,cy)`; tiles become trapezoids. No
matrix stack, no z-buffer needed — we simply **draw far-to-near (painter's
algorithm)** and overlap handles occlusion.

---

## 6. The tunnel: regular-polygon prism geometry

The tunnel is an infinite prism: a regular `N`-gon cross-section extruded along
`z`. The inner faces are where the runner can stand.

### 6.1 Vertices & faces

In a *flat* (unrolled) cross-section, vertex `k` sits at base angle

```
vertexAngle(k) = (2π / N) * k                // k = 0 .. N-1
vertexPos(k)   = ( Rc*cos(vertexAngle(k)),
                   Rc*sin(vertexAngle(k)) )
```

Face `f` is the flat edge **between vertex `f` and vertex `f+1`** (indices mod
`N`). The face's center direction (from tunnel axis outward to the middle of
the face) is at angle

```
faceAngle(f) = (2π / N) * (f + 0.5)
faceMid(f)   = ( Ap*cos(faceAngle(f)), Ap*sin(faceAngle(f)) )
```

where `Ap = Rc·cos(π/N)` is the apothem (perpendicular distance from axis to a
face). The runner stands on `faceMid(active)`.

### 6.2 Applying roll

The *displayed* angle of any base angle `a` is `a + roll`. So the rolled
position of vertex `k` is:

```
ang = vertexAngle(k) + roll
P(k) = ( Rc*cos(ang), Rc*sin(ang) )
```

A whole ring at depth `z` is the polygon `{ P(0), P(1), …, P(N-1) }` projected
at `dz = z − camZ`.

### 6.3 A tile (one face, one ring)

Tile `(f, r)` spans face `f` between ring boundary depths `zNear = r·SEG` and
`zFar = (r+1)·SEG`. Its four corners in tunnel space are the two face-edge
vertices at the two depths:

```
A = vertex f   @ zNear     C = vertex f+1 @ zFar
B = vertex f+1 @ zNear     D = vertex f   @ zFar
```

Projected (`a→a'`, etc.) they form a screen trapezoid `A'B'C'D'`. We fill it
with a depth-fogged neon color and stroke its edges with a brighter neon line.
A small inset toward the face center leaves a dark "grout" gap between tiles for
extra readability (and a grid look).

### 6.4 Keeping the active face "down"

We want the active face centered at the **bottom** of the screen. The bottom
world direction is `−y` (since screen +y is down and we negate `y`), i.e. world
angle `−π/2`. So we choose `roll` so that

```
faceAngle(active) + roll ≡ −π/2   (mod 2π)
⇒  rollTarget = −π/2 − faceAngle(active)
             = −π/2 − (2π/N)*(active + 0.5)
```

We keep `active` as a **continuous integer counter** (it may grow unbounded or
go negative) and keep `roll` as a **continuous** value that eases toward
`rollTarget`. Because each face-switch changes `active` by exactly ±1,
`rollTarget` changes by exactly `∓(2π/N)`, and the eased `roll` sweeps the
shortest, correct direction automatically — no angle-wrapping headaches.

For indexing the level data we use the wrapped face id:

```
faceId(active) = ((active % N) + N) % N
```

---

## 7. Wall-running & the roll/gravity model

This is the heart of the game.

### 7.1 Conceptual model

"Gravity" always points from the tunnel axis toward the active face (outward,
toward `faceMid(active)`). Because we *roll the world* so the active face is at
the bottom, gravity in **screen space is always straight down**. This is the
key simplification: we never rotate the player; we rotate the tunnel. The
player's jump is a simple vertical arc in screen-aligned tunnel space, while the
*tunnel* rotates around them.

### 7.2 Switching faces

- Press **Right** → `active += 1`. The face to the player's right rotates down.
- Press **Left**  → `active -= 1`. The face to the player's left rotates down.

(The visual sense — does the world spin clockwise or counter-clockwise — is a
tuning sign; we pick the one that reads as "the wall I moved toward becomes the
floor". With `rollTarget = −π/2 − faceAngle(active)`, incrementing `active`
rotates the tunnel one way; we flip the increment sign if playtesting says it
feels inverted.)

A switch is only *committed* if the destination is sane (always true for a
prism — every face exists). We also gate switching during a switch animation by
allowing **input buffering**: a press during a roll is queued and applied when
the roll settles within `ROLL_SETTLE` of its target.

### 7.3 Roll easing

`roll` chases `rollTarget` with a critically-damped-ish spring or an
exponential ease. We use a stable, framerate-independent exponential approach:

```
k    = 1 - exp(-ROLL_SNAP * dt)          // ROLL_SNAP ≈ 11 (1/sec)
roll = roll + (rollTarget - roll) * k
```

Exponential easing is unconditionally stable for any `dt` (unlike a raw spring),
which matters on slow frames. `rollVel` is derived as `(roll_new − roll_old)/dt`
for the bank effect.

### 7.4 Camera bank (lean)

```
bankTarget = clamp(rollVel * BANK_GAIN, -BANK_MAX, BANK_MAX)
bank      += (bankTarget - bank) * (1 - exp(-BANK_SNAP*dt))
```

So while the tunnel is actively rolling, the camera leans; when it settles,
bank returns to 0. `BANK_GAIN` small (e.g. `0.02`), `BANK_MAX ≈ 0.18 rad`.

### 7.5 Which tile is under me?

At any moment the player occupies:

- ring index `rUnder = floor((camZ + Z_PLAYER) / SEG)`
- face id `faceId(active)`

The tile is **solid** iff `level.solidAt(rUnder, faceId)` is true. When the
player is **grounded** and that tile is **not** solid → the player falls.

Crucially, while **airborne** (jumping) the under-tile check is skipped — you
sail over holes. On the way down, you only "land" if the tile you're descending
onto is solid; otherwise you keep falling into the void → death.

### 7.6 Rolling to safety vs. jumping

Two ways to clear a hole on your current face at ring `r`:

1. **Jump** the gap if it's short enough in `z` (≤ `MAX_JUMP_RINGS` rings).
2. **Roll** to an adjacent face that *is* solid at ring `r` (and at the rings
   between now and `r`, so you don't fall en route). The generator guarantees
   such an escape exists (see §9.4).

---

## 8. Player physics

### 8.1 Auto-run (forward motion)

```
speed = clamp(BASE_SPEED + camZ * SPEED_RAMP, BASE_SPEED, MAX_SPEED)
camZ += speed * dt
```

`speed` is in tunnel-z units/second. Score is derived from `camZ` (§15).

### 8.2 Jump arc

Jump is a vertical motion in "height above the face" `h` (tunnel units),
screen-aligned (because the tunnel is rolled to put the floor down). Classic
projectile:

```
on jump:  h = 0; vy = JUMP_VY; grounded = false
each dt:  vy -= GRAVITY * dt
          h  += vy * dt
landing:  when vy < 0 and h <= 0 → attempt land
```

We solve `JUMP_VY` and `GRAVITY` from two designer-facing numbers:

- `JUMP_AIR_TIME` — seconds aloft for a full jump (e.g. `0.62 s`).
- `JUMP_PEAK` — peak height in tunnel units.

From projectile kinematics:

```
GRAVITY = 8 * JUMP_PEAK / (JUMP_AIR_TIME^2)
JUMP_VY = GRAVITY * JUMP_AIR_TIME / 2
```

This guarantees the jump rises to `JUMP_PEAK` and returns to the floor after
exactly `JUMP_AIR_TIME` seconds, independent of other tuning.

`MAX_JUMP_RINGS` (how many ring-gaps a jump clears) follows from air time and
speed; the generator never makes a *forced* full-ring gap longer than the gap
clearable at the current speed, with margin.

### 8.3 Coyote time & jump buffer

- **Coyote**: you may still jump for `COYOTE_T` (≈ `0.09 s`) after stepping off
  solid ground — forgiving edges.
- **Buffer**: a jump pressed up to `JUMP_BUFFER_T` (≈ `0.12 s`) before landing
  fires immediately on landing.

### 8.4 Landing

On the descending frame where `h` crosses `0`:

```
faceSolidHere = level.solidAt(rUnder, faceId(active))
if faceSolidHere:  h = 0; vy = 0; grounded = true; spawn landing dust; thud sfx
else:              enter FALLING state (death)
```

### 8.5 Falling / death

When grounded over a hole, or landing onto a hole:

- Switch to state `DYING`.
- The avatar accelerates downward off-screen (`h` goes strongly negative,
  scaled visually) while the tunnel keeps gently scrolling — a dramatic plunge.
- After `DEATH_DELAY` (≈ `0.7 s`) call `ctx.gameOver(distance)`.

---

## 9. Procedural level generation

The level is an endless stream of **rings**. Ring `r` stores `solid: boolean[N]`
— one bool per face. `true` = tile present, `false` = hole. We generate rings
lazily ahead of the camera and discard rings behind it.

### 9.1 Lazy ring buffer

```
ensureRings():
  while topReachZ(lastRing) - camZ < FAR + SEG*2:  generate next ring
  drop rings with (r*SEG - camZ) < -SEG*3
```

Rings are produced by a **feature generator**: rather than rolling per-tile
dice (which can create unfair walls), we emit *features* — coherent multi-ring
obstacles separated by guaranteed-safe breathing room.

### 9.2 The generator state machine

State variables: `cursor` (next ring index to fill), `safeFaces` (the set of
faces guaranteed solid through the current safe stretch — used to keep an
escape route continuous), and `cooldown` (safe rings remaining before the next
feature is allowed).

Loop:

```
if cooldown > 0:        emit a fully-solid ring; cooldown--
else:                   pick & emit a feature; set cooldown = SAFE_GAP(diff)
```

`SAFE_GAP` shrinks with difficulty (more frequent obstacles), but never below a
floor that keeps the game readable (`MIN_SAFE_GAP`).

### 9.3 Feature catalogue

Each feature writes some rings and **must declare/guarantee a solvable path**.

1. **`fullGap(len)`** — every face is a hole for `len` consecutive rings,
   `len ≤ MAX_JUMP_RINGS`. Must be jumped. Surrounded by solid landing rings.

2. **`holeOnPath(width)`** — knock holes in a contiguous arc of `width` faces
   *including the current `safeFaces`*, for a few rings, but **leave at least
   one face solid**. Forces a roll to the solid side. The solid face becomes the
   new `safeFaces` so the next feature stays reachable.

3. **`spiral(steps)`** — the hole arc advances by one face per ring, sweeping
   around the tunnel; the safe face also advances by one per ring, so the player
   must roll once per ring to keep up. Length and direction tuned by difficulty.
   Guaranteed solvable: each ring's safe face is adjacent to the previous.

4. **`checker(len)`** — alternate solid/hole faces; the player must hop between
   two stable faces. Only enabled at higher difficulty. Adjacent solid faces
   guarantee single-step reachability.

5. **`pinch(len)`** — a long stretch where only a 1–2 face-wide lane is solid;
   tests sustained wall-running. The safe lane may slowly drift (≤1 face/ring).

6. **`combo`** — at high difficulty, a `holeOnPath` immediately followed by a
   short `fullGap` (roll *then* jump). Spacing tuned so both are clearable.

### 9.4 Fairness guarantees (invariants)

The generator enforces these **invariants** so the run is always survivable:

- **I1 — Reachability.** For consecutive non-jump rings, the set of solid faces
  in ring `r+1` always contains a face within **1 step** of some solid face in
  ring `r`. (A face is reachable if `|Δ active| ≤ 1` per ring at current speed;
  at very high speed where you can't roll every ring, the generator widens safe
  lanes — see I3.)
- **I2 — Jumpable gaps.** Any *forced* full-ring gap has `len ≤
  maxJumpRingsAt(speed)` with a safety margin, and has solid landing rings on
  both sides.
- **I3 — Roll budget.** The generator estimates how many rings pass per second
  (`speed/SEG`) vs. how fast the player can roll (`ROLL_SNAP`-limited). It never
  requires more rolls-per-second than achievable; spirals slow their step rate
  as speed rises.
- **I4 — Lead-in.** Every feature is preceded by ≥1 fully-solid ring so the
  hazard is visible before it's lethal (no blind walls right at the camera).
- **I5 — Start grace.** The first `START_SAFE_RINGS` rings are fully solid so
  the player can orient before the first hazard.

### 9.5 Determinism

Generation uses the engine's `mulberry32` RNG seeded from a per-run seed
(`Date.now()` xor a counter). This keeps generation cheap and lets us
optionally support seeded daily runs later (stretch). RNG state lives in the
level module, not global.

---

## 10. Difficulty curve & segments

`diff = clamp(camZ / DIFF_FULL_Z, 0, 1)` where `DIFF_FULL_Z` is the distance at
which difficulty saturates (e.g. ~14000 units).

`diff` drives:

- **Speed** via `SPEED_RAMP` (continuous, not from `diff` directly but from
  `camZ`; the two are consistent).
- **`SAFE_GAP`** — `lerp(MAX_SAFE_GAP, MIN_SAFE_GAP, diff)`.
- **Feature mix** — weighted pick; harder features unlock as `diff` rises:
  - `diff < 0.15`: only `fullGap(1)` and `holeOnPath(1)`.
  - `0.15–0.4`: add `spiral`, wider `holeOnPath`.
  - `0.4–0.7`: add `pinch`, longer spirals.
  - `> 0.7`: add `checker` and `combo`.

**Visual segments / biomes**: every `BIOME_LEN` distance the palette shifts
(hue rotation of the neon + nebula) and optionally `N` (face count) changes at a
safe boundary for variety. Changing `N` only happens during a long fully-solid
lead-in so the cross-section morph isn't lethal; we animate `Rc`/face count by
crossfading colors and snapping geometry on a fully-solid ring. (MVP may keep
`N` fixed and only shift palette; the architecture supports per-biome `N`.)

---

## 11. Rendering pipeline

Every frame repaints the **entire** background (no smearing). Draw order:

1. **Space background** — vertical gradient (deep indigo → near-black).
2. **Starfield** — parallax star layers; subtle twinkle; slow drift that speeds
   up with run speed to reinforce motion (§12.1).
3. **Nebula glow** — soft radial/linear glow near the vanishing point, tinted by
   the current biome palette; gives the "light at the end of the tunnel" pull.
4. **Tunnel geometry** (inside a `save()` with the `bank` transform):
   - For each visible ring, **far → near**:
     - Optionally draw the **back faces / non-floor faces** as dim tiles (the
       ceiling/sides of the prism) so the tube reads as enclosed.
     - Draw **floor-ish faces** brighter.
     - Tiles fog toward the vanishing point: alpha & brightness scale with
       `fog(dz)` (§11.2). Holes are simply *not drawn* (the black bg shows
       through = the void).
   - Edge strokes are brighter neon; near tiles get an extra inner glow line.
5. **Player avatar** + **shadow** + **landing dust** (drawn after tunnel so it
   sits on top of the floor; uses the same bank transform so it stays aligned to
   the rolled floor — actually the player is drawn in *screen* space at bottom
   center because the floor is rolled to bottom; bank still applies for lean).
6. **Particles** — trail sparks, ambient motes, impact bursts.
7. **Foreground vignette** + scanline/CRT-ish subtle overlay (optional, cheap).
8. **HUD** — score, best, combo flash; **screens** when not playing.

### 11.1 Painter's algorithm

We never need depth testing: drawing strictly far→near means nearer tiles
overwrite farther ones where they overlap. Within one ring, the floor faces are
drawn after side/ceiling faces so the floor reads cleanly.

### 11.2 Fog / depth shading

```
fog(dz) = clamp(1 - dz / FOG_FAR, FOG_MIN, 1)
```

Tile fill alpha = `baseAlpha * fog`, and tile RGB are multiplied toward the fog
color so distant tiles desaturate into the nebula. Near tiles are vivid and
fully opaque. `FOG_FAR ≈ FAR * 0.85`.

### 11.3 Per-face shading

Faces get a brightness factor by their *displayed* angle (so the "floor" and
faces catching the imaginary key light are brighter, the "ceiling" dimmer). E.g.

```
litFactor(f) = 0.55 + 0.45 * max(0, cos(displayedFaceAngle(f) - LIGHT_DIR))
```

This gives the tube volume and makes the rolled floor pop.

### 11.4 Neon look

- Tile fill: semi-transparent biome color over black.
- Tile edges: `ctx.strokeStyle` bright biome color; on the **nearest few rings**
  set `shadowBlur` + `shadowColor` for a real glow (kept to near tiles only for
  performance).
- A scrolling pulse of brightness travels down the tunnel (a moving band where
  `fog` is boosted) for a "data flowing" vibe.

### 11.5 Resize handling

`render()` and `update()` both re-derive `cx, cy, UNIT` from the live
`ctx.width/ctx.height` at the top of the frame. No cached pixel sizes survive a
resize. `resize?()` just re-derives immediately (and re-seeds star positions if
needed). Works for any aspect, including portrait.

---

## 12. Particles & juice

### 12.1 Starfield

- 3 parallax layers, ~`STAR_COUNT` stars total, each with normalized `(x,y)` and
  depth `z∈[0,1]`. Size & brightness scale with `z`. They drift toward the edges
  (radially from the vanishing point, optionally) to amplify the warp feeling;
  drift speed scales with run speed. Wrap when off-screen.

### 12.2 Run dust / contrails

- A steady emitter behind the player produces small fading sparks while running,
  giving a speed streak. Emission rate scales with speed.

### 12.3 Landing dust

- On landing, spawn a burst of short-lived puffs at the floor contact point,
  spreading sideways along the floor.

### 12.4 Roll whoosh particles

- During a face switch, emit a brief arc of motes following the roll direction.

### 12.5 Screen shake & flashes

- Tiny shake on landing big jumps; bigger shake on death.
- Brief white/biome flash on death; combo milestone flashes on the HUD.

### 12.6 Time-based, frame-independent

All particle/anim updates use `dt`. We clamp `dt` (§16) so a tab-switch hiccup
doesn't teleport everything.

---

## 13. Audio design (procedural, via `ctx.audio`)

Using the engine's synth (`tone`, `sweep`, `noise`, and convenience sfx):

| Event            | Sound                                                            |
| ---------------- | --------------------------------------------------------------- |
| Roll left/right  | short `sweep` (pitch up for right, down for left) + tiny blip   |
| Jump             | `audio.jump()` (rising sweep)                                   |
| Land             | soft `tone` thud (low square, very short) + noise tick          |
| Near-miss        | optional high blip when you clear a gap by a hair               |
| Milestone        | `audio.coin()`-style двойной blip every `MILESTONE` distance    |
| Death            | `audio.lose()` descending tones + `noise` burst                 |
| Start            | gentle ascending arpeggio                                       |
| Ambient pulse    | optional soft periodic low tone synced to the brightness pulse  |

All audio is best-effort: if muted/unavailable the calls no-op (engine handles
it). Never block gameplay on audio.

---

## 14. HUD, screens & game states

### 14.1 State machine

```
READY  →(start input)→ PLAYING →(fall)→ DYING →(delay)→ GAMEOVER
GAMEOVER →(retry input)→ resets → READY/PLAYING
```

- **READY**: tunnel scrolls slowly in an attract style; title + "press to run";
  controls visible. The first input both starts forward motion and (if it was a
  jump key) performs the first jump.
- **PLAYING**: full simulation; score live via `ctx.reportScore`.
- **DYING**: input ignored (except it won't break); plunge animation; after
  delay → `ctx.gameOver(distance)`. The shell shows its own game-over UI, but we
  also render an in-canvas death flourish during the delay.
- We keep the instance alive after `gameOver` in case the shell calls
  `update/render` again; a `destroy()` cleans arrays/listeners.

> Note: the host shell drives retries by creating a fresh instance, but we also
> implement an internal `reset()` and respond to start/retry inputs defensively
> so the game feels right even if re-invoked.

### 14.2 HUD (PLAYING)

- **Distance** big, top-center (the score). Animated tick.
- **Best** small beneath it.
- **Speed/▮ combo** subtle indicator (optional bars) — purely cosmetic.
- A faint **mini hazard hint**: a thin arc indicator that flashes the side a
  forced roll is coming from (accessibility aid; can be toggled off by design —
  off by default to keep it pure, but architecture allows it).

### 14.3 READY screen

- Title "NEON CONDUIT", subtitle controls line ("◀ ▶ roll · SPACE jump"),
  pulsing "TAP / SPACE TO RUN", best score.

### 14.4 GAMEOVER flourish (in-canvas, during delay)

- Dim the tunnel, show "FELL!" / distance, then hand off to `ctx.gameOver`.

---

## 15. Scoring & persistence

- **Distance** = `floor(camZ / DIST_UNIT)` where `DIST_UNIT` converts z-units to
  a friendly "meters" number (e.g. `DIST_UNIT = SEG` → 1 point per ring, or a
  divisor tuned so numbers feel good — target hundreds-to-thousands per run).
- `ctx.reportScore(distance)` is called **every frame while PLAYING** (cheap;
  the HUD reads it live).
- On death: `ctx.gameOver(distance)`.
- **Best**: read at create via `ctx.storage.get<number>("best", 0)`; on death,
  `best = max(best, distance)` and `ctx.storage.set("best", best)`. We also call
  `ctx.storage.submitScore?.(distance)` if present (best-effort) — but primary
  is the explicit `set`.

---

## 16. Performance budget & resilience

- Target 60fps; degrade gracefully on slow devices.
- **dt clamp**: `dt = min(rawDt, DT_MAX)` with `DT_MAX ≈ 1/20` so a stall can't
  fling the player through a wall.
- **Visible-ring cap**: only iterate rings with `dz ∈ [NEAR, FAR]`; `FAR` chosen
  so that's ~`FAR/SEG` rings (tens, not hundreds).
- **Glow budget**: `shadowBlur` only on the nearest `GLOW_RINGS` rings + the
  player; everything else uses flat strokes.
- **Allocation discipline**: reuse arrays; particles in a pooled array with an
  active count; avoid per-frame object churn in hot loops where reasonable.
- **No external state**: everything in closure; `destroy()` clears arrays.
- Defensive `try`/guards around audio.

---

## 17. File / module architecture

All under `src/games/run/`. Strict TS, no `any`, only imports from `@/engine`
and this folder. Canvas-only.

```
run/
  PRD.md          ← this document
  index.ts        ← create(ctx): GameInstance — wiring, loop, state machine
  config.ts       ← all tuning constants + palettes + small helpers
  types.ts        ← shared interfaces (Ring, Particle, Palette, etc.)
  camera.ts       ← Camera: cx/cy/UNIT, scale, project, roll, bank, fog
  tunnel.ts       ← polygon geometry + tile/wall rendering (uses Camera + Level)
  level.ts        ← Level: ring buffer, feature generator, fairness, difficulty
  player.ts       ← Player: movement, roll target, jump physics, animation draw
  particles.ts    ← Particles: pooled system (dust, sparks, bursts)
  starfield.ts    ← Starfield: parallax background stars + nebula
  hud.ts          ← screens + HUD drawing helpers
```

Dependencies flow: `index` orchestrates `camera`, `level`, `player`, `tunnel`,
`particles`, `starfield`, `hud`. Lower modules don't import `index`.

---

## 18. Data structures (TypeScript shapes)

```ts
// types.ts
export interface Ring {
  r: number;            // ring index (z = r*SEG)
  solid: boolean[];     // length N; true = tile present
  biome: number;        // palette index at generation time
}

export interface Palette {
  bgTop: string; bgBottom: string;
  nebula: string;       // glow color near vanishing point
  tile: [number, number, number];   // base neon RGB for floor tiles
  tileDim: [number, number, number]; // ceiling/side tiles
  edge: string;         // bright neon edge stroke
  player: string;       // avatar core color
  playerGlow: string;
}

export interface Particle {
  active: boolean;
  x: number; y: number;     // screen space (CSS px)
  vx: number; vy: number;
  life: number; max: number;
  size: number;
  color: string;
  kind: number;             // 0 dust, 1 spark, 2 burst, …
}

export interface Star {
  x: number; y: number;     // normalized 0..1
  z: number;                // depth 0..1 (parallax)
}

export type GameState = "ready" | "playing" | "dying" | "gameover";
```

```ts
// camera.ts (sketch)
class Camera {
  cx = 0; cy = 0; unit = 0; W = 0; H = 0;
  roll = 0; rollTarget = 0; rollVel = 0; bank = 0;
  recompute(W: number, H: number): void;        // cx, cy, unit
  scale(dz: number): number;                     // FOCAL/(FOCAL+dz)
  project(wx: number, wy: number, dz: number): { sx: number; sy: number; s: number };
  fog(dz: number): number;
  update(dt: number): void;                      // ease roll, derive bank
}
```

```ts
// player.ts (sketch)
class Player {
  active = 0;        // continuous face counter
  h = 0; vy = 0;     // height above floor + vertical vel
  grounded = true;
  coyote = 0; jumpBuffer = 0;
  runPhase = 0;      // animation cycle
  rollLeft(): void; rollRight(): void; jump(): void;
  update(dt, speed): void;
  draw(c, camera, ...): void;  // avatar, shadow, limbs anim
}
```

---

## 19. Tuning constants (single source of truth — `config.ts`)

(Initial values; all subject to playtest. **Names are normative.**)

```
// Tunnel
N_DEFAULT      = 6           // hexagon
Rc             = 1.0         // circumradius (tunnel units)
SEG            = 1.0         // ring z-length (tunnel units)

// Projection
FOCAL          = 3.2         // in tunnel units (since UNIT scales to px)
NEAR           = 0.02
FAR            = 26          // visible depth (~26 rings)
Z_MIN          = 0.02
VIEW_FILL      = 0.92
VANISH_Y       = 0.46
Z_PLAYER       = 2.2         // player drawn this far in front of camera

// Motion
BASE_SPEED     = 6.0         // rings/sec at start
MAX_SPEED      = 17.0
SPEED_RAMP     = (per camZ)  // tuned so MAX reached ~DIFF_FULL_Z
DT_MAX         = 0.05

// Roll
ROLL_SNAP      = 12          // 1/sec exponential
ROLL_SETTLE    = 0.12        // rad; allow buffered input within this
BANK_GAIN      = 0.018
BANK_MAX       = 0.18
BANK_SNAP      = 8

// Jump
JUMP_AIR_TIME  = 0.62        // s
JUMP_PEAK      = 0.9         // tunnel units above floor
COYOTE_T       = 0.09
JUMP_BUFFER_T  = 0.12
MAX_JUMP_RINGS = 2

// Generation
START_SAFE_RINGS = 10
MIN_SAFE_GAP   = 2
MAX_SAFE_GAP   = 7
DIFF_FULL_Z    = 14000       // in distance points
BIOME_LEN      = 2200        // distance per palette shift

// Fog / visuals
FOG_FAR        = 22
FOG_MIN        = 0.06
GLOW_RINGS     = 6
STAR_COUNT     = 120
LIGHT_DIR      = -π/2        // key light from "below" (the floor)

// Scoring
DIST_UNIT      = SEG         // 1 point per ring advanced
MILESTONE      = 250
DEATH_DELAY    = 0.7
```

> Note on units: because `UNIT` already maps tunnel units → pixels, the
> projection constants (`FOCAL`, `FAR`, `Z_PLAYER`, `SEG`, `Rc`) are all in the
> same small tunnel-unit scale. `FOCAL` and `Rc` are chosen so the hexagon
> comfortably fills the frame at the player's depth.

---

## 20. Edge cases & failure handling

- **Tiny / huge viewports**: everything derives from `min(W,H)` and ratios; text
  sizes use `H` fractions. Portrait phones get a taller tube (still centered).
- **Extreme aspect (ultrawide)**: `UNIT` from `min(W,H)` keeps the tube from
  ballooning; side margins fill with starfield + bg.
- **Pause / tab switch**: huge `dt` clamped by `DT_MAX`; if the engine pauses
  via `onPause/onResume`, we just stop advancing (we read `dt` from the host so
  a paused host won't call update).
- **Resize mid-jump**: jump is in tunnel units, projection re-derived from live
  size → consistent.
- **Audio context not ready**: engine no-ops; we never await.
- **Roll spam**: buffered to one queued input; can't desync because `active` is
  integer and `roll` eases to a deterministic target.
- **Generation can't find escape** (shouldn't happen): generator falls back to a
  fully-solid ring (`fail-safe` — never produce an unwinnable ring).
- **NaN guard**: clamp `dz` and scale; guard divisions.
- **Death during roll**: allowed; plunge uses current screen position.

---

## 21. Accessibility & feel checklist

- High-contrast neon on near-black; holes are *true black* = unambiguous void.
- Forgiving timing (coyote + buffer + input buffer + tap/swipe alternatives).
- No reliance on color alone for "hole vs tile" — holes are *absence* of a tile
  (geometry), not just a color change.
- Motion is smooth & eased; bank is subtle (≤ ~10°) to avoid nausea; can be set
  to 0 via a constant.
- Audio optional; game fully playable muted.

---

## 22. Test plan / acceptance criteria

**Functional**

- [ ] `create(ctx)` returns a valid `GameInstance`; no throws on mount.
- [ ] Tunnel renders, scrolls, and converges to a single vanishing point.
- [ ] Left/Right roll the tunnel so the chosen face becomes the floor; player
      stays bottom-center; motion is smooth & correctly-signed.
- [ ] Holes render as true gaps; running over one while grounded → fall → game
      over after the death flourish; `gameOver(distance)` is called once.
- [ ] Jump arcs over a `fullGap` of length ≤ `MAX_JUMP_RINGS`.
- [ ] Rolling onto a solid face avoids a hole on the current face.
- [ ] Every generated obstacle is clearable (no impossible deaths in a long
      auto/play test) — invariants I1–I5 hold.
- [ ] Score increases with distance; best persists across reloads.
- [ ] Speed & hole frequency ramp with distance.

**Robustness**

- [ ] Resizes (including portrait↔landscape) never break layout or crash.
- [ ] Big `dt` (tab switch) doesn't teleport the player into a hole.
- [ ] Muted audio: no errors, full playability.
- [ ] `destroy()` clears state; no leaked listeners (we add none beyond engine).

**Quality (strict TS)**

- [ ] No `any`. No imports outside `@/engine` + `./`. No asset files. No edits to
      shared engine/shell/manifest files.

**Feel**

- [ ] Rolling feels physical (ease + bank + whoosh).
- [ ] Jumps feel weighty (dust, thud, shadow read).
- [ ] Death is dramatic but quick to retry.
- [ ] Reads great at a glance: "where's the next hole, which way do I go?"

---

## 23. Future / stretch ideas

- Per-biome `N` morphs (square ↔ hexagon ↔ octagon) at safe boundaries.
- Collectible light orbs along the safe path for a score multiplier.
- Daily seeded run (use `dailySeed`).
- Branching forks (two safe lanes diverge; pick a side).
- Speed-pad tiles, slow-mo "phase" tiles.
- Boss "iris" gates that close around a single safe face.

---

*End of PRD. Implementation lives alongside this file in `src/games/run/`.*
