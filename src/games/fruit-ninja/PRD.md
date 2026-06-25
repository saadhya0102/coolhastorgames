# Fruit Frenzy — Product Requirements Document

> An original, canvas-only "slice the flying fruit" arcade game for the
> CoolHastorGames TypeScript + Vite portal. This is a from-scratch
> implementation of the *blade-slicing* genre: all art is procedural
> (canvas 2D), all audio is synthesized through the engine `AudioManager`,
> and there are **no asset files** of any kind. It does not copy art, code,
> sounds, or trademarked names from any existing commercial product.

- **Game id / folder:** `fruit-ninja` → `src/games/fruit-ninja/`
- **Working title (in-game):** "Fruit Frenzy"
- **Module contract:** `export function create(ctx: GameContext): GameInstance`
- **Engine import surface:** `@/engine` (types, util, random, audio) and the
  game's own folder only. No React, no third-party libraries.

---

## 1. Vision & Pillars

Fruit Frenzy is about the visceral, tactile joy of dragging a finger (or
mouse) across the screen and feeling fruit *burst* under the blade. Every
swipe should feel powerful and consequential, and every mistake (a sliced
bomb, a dropped fruit) should sting just enough to keep the player leaning in.

### Design pillars

1. **Juicy feedback above all.** A slice must produce: a clean cut line, two
   physically separating halves, a spray of colored juice particles, a
   lingering juice "splat" decal, a number popup, a bloom flash, and a sound.
   The screen should feel *alive* the instant a fruit is hit.
2. **Readable danger.** Bombs are visually unmistakable (dark sphere, lit fuse,
   sparks, menacing glow). The player should never feel cheated when a bomb
   ends a run — it should always have been avoidable.
3. **Flow & rhythm.** Fruit is tossed in *waves* (small clustered volleys) with
   breathing room between them, so the player gets satisfying multi-fruit
   combo swipes rather than a constant unreadable blizzard.
4. **Smooth on anything.** Works at any aspect ratio and size, desktop or
   mobile, with the canvas resized live. All gameplay constants are expressed
   relative to the current `width`/`height` so the feel is consistent.
5. **Original, charming art.** A warm dojo-at-dusk background, hand-shaded
   procedural fruit with highlights and seeds, and a glowing katana-style
   blade trail — distinct from any existing product.

### Non-goals

- No online multiplayer, no accounts, no networked leaderboard logic (the
  portal handles score syncing through `ctx.reportScore` / `ctx.gameOver`).
- No persistent meta-progression beyond a stored best score.
- No asset pipeline, no external fonts beyond what `drawText` already uses.

---

## 2. Engine Contract (how this game plugs in)

The portal calls `create(ctx)` once and receives a `GameInstance`. The host
runs the RAF loop and calls our methods. We must be defensive and stateless
toward the host beyond the documented surface.

### 2.1 `GameContext` we consume

| Field | Use |
| --- | --- |
| `ctx.ctx` | `CanvasRenderingContext2D`, already DPR-scaled. We draw in **CSS pixels**. |
| `ctx.width` / `ctx.height` | **Getters** — read *every frame*. Never cache across frames. |
| `ctx.input` | `pointer{x,y,down,justDown,justUp}` + `pointers: Map<id,{x,y}>` for multitouch. |
| `ctx.audio` | `tone/sweep/noise` + convenience sfx. We layer our own slice/bomb/combo sounds on top. |
| `ctx.storage` | `get/set` + `submitScore`. Persist best score under our own key. |
| `ctx.reportScore(n)` | Live HUD score. Called whenever score changes. |
| `ctx.gameOver(finalScore?)` | End the run; portal shows the game-over screen + submits score. |
| `ctx.setStatus(text)` | One-line HUD text above the canvas (mode, lives hint). |
| `ctx.isTouch` | Tailor copy ("Swipe" vs "Drag") and hint visibility. |
| `ctx.requestControls([])` | We request *no* on-screen buttons — slicing is pure pointer drag. |

### 2.2 `GameInstance` we return

```ts
interface GameInstance {
  update(dt: number): void;   // dt in seconds; advance simulation
  render(): void;             // repaint the FULL background + scene every frame
  resize?(w, h): void;        // recompute layout-derived caches (optional)
  destroy?(): void;           // clear timers / references
  onPause?(): void;           // freeze (engine may call on tab blur)
  onResume?(): void;          // unfreeze
}
```

### 2.3 Hard rules

- **Strict TypeScript, no `any`.** Every structure is typed. Helper math is
  local or from `@/engine` (`clamp`, `lerp`, `dist`, `drawText`, `roundRect`).
- **Repaint full background each frame** — never rely on leftover pixels.
- **Coordinate space is CSS px.** Draw using `ctx.width`/`ctx.height`.
- **Do not edit shared files** (engine, manifest). The game is self-contained;
  registering it in the manifest is the portal owner's step.
- **No timers that outlive `destroy()`.** Any `setTimeout` we own is tracked
  and cleared. (We lean on `dt` accumulators instead of timers where possible.)

---

## 3. Core Loop

```
TITLE  ──tap──▶  COUNTDOWN(3..2..1)  ──▶  PLAYING
                                            │
   slice fruit → score/juice/combo          │ miss fruit → lose a life
   slice bomb  → game over                   │ lives==0   → game over
                                            ▼
                                        GAME_OVER ──tap──▶ TITLE
```

1. **TITLE** — animated demo fruit lazily arc across the screen, big title,
   best score, mode chooser (Classic / Zen / Arcade), "tap to start". Slicing
   the idle fruit on the title screen is allowed for fun (juice, no score).
2. **COUNTDOWN** — short 3-2-1 "Ready?" beat so the player can position their
   hand; spawning is paused.
3. **PLAYING** — the active game. Spawner emits waves, physics integrates,
   blade detection runs, HUD updates.
4. **GAME_OVER** — slow-motion freeze of the final frame, big "Game Over"
   (or "Bomb!" / "Out of lives"), final + best score, tap to return to title.

State is a discriminated union `type Phase = "title" | "countdown" | "playing"
| "over"`. Transitions are explicit functions (`startGame`, `endGame`).

---

## 4. Game Modes

The game ships with three modes selectable on the title screen. Default and
primary is **Classic**. All modes share the same physics, art, and scoring;
they differ in failure conditions and pacing.

### 4.1 Classic (default)

- **3 lives.** Missing a fruit (it leaves the bottom of the screen unsliced)
  costs **1 life**. Special/bonus fruit *do not* cost a life if missed.
- **Bombs are lethal.** Slicing any bomb is an instant game over (regardless of
  remaining lives) with explosion + heavy screen shake.
- Difficulty ramps continuously (see §9). Run length is open-ended; the player
  pushes for the highest score until they run out of lives or hit a bomb.
- Lives shown as fruit/heart pips in the HUD; losing one flashes red + "X".

### 4.2 Zen (relaxed, optional)

- **No bombs, no lives.** Fixed **90-second** timer. Pure score chase — slice
  as much fruit as possible, lean into big combos. Great for learning the
  blade feel. Game ends when the timer hits 0 (`gameOver(score)`).
- Spawns are generous and never include bombs; difficulty ramps only mildly.

### 4.3 Arcade (frenetic, optional)

- **60-second** timer, **no lives** (missing fruit is free) but **bombs still
  end the run instantly**. Spawn rate is high from the start; special fruit
  appear more often:
  - **Frenzy banana** (golden) — temporarily multiplies spawn rate.
  - **Freeze fruit** (icy blue) — briefly slows all fruit (slow-mo) so the
    player can rack up combos.
  - **Double points fruit** — 2x scoring for a few seconds.
- Designed for high-score bursts; the most "score per minute".

> Mode is stored so the last-used mode is preselected next session. Best score
> is tracked **per mode** in storage but the single number reported to the
> portal leaderboard is the current run's score (the portal stores the max).

---

## 5. Input & Slicing Model

This is the heart of the game and gets the most careful design.

### 5.1 Pointer trail

We maintain a ring buffer of recent pointer samples for the **primary** pointer
while it is down:

```ts
interface TrailPoint { x: number; y: number; t: number; }  // t = age timestamp
```

- On every `update`, if `pointer.down`, push the current `{x,y}` with the
  current game time. We also synthesize intermediate samples between the last
  and current point when the pointer moves fast, so a quick flick across a
  fruit still registers a crossing (no "tunneling" through small fruit).
- Points older than `TRAIL_LIFETIME` (~120 ms) or beyond `TRAIL_MAX` (~24
  points) are dropped from the head.
- Trail resets cleanly on `justDown` (new swipe) so the visual trail doesn't
  "snap" across the screen from where the last swipe ended.

### 5.2 Blade activity & speed gating

- The blade only "cuts" when it is **moving fast enough**. We compute segment
  speed = distance between consecutive samples / dt. A fruit is only sliced if
  the crossing segment's speed exceeds `MIN_SLICE_SPEED` (relative to screen
  size). This prevents "resting the finger on a fruit" from slicing, and makes
  deliberate fast swipes feel intentional.
- A "slice session" begins on pointer-down and ends on pointer-up. **Combo**
  counting (see §7) is scoped to a single slice session: all fruit cut between
  one down and the matching up are part of the same combo.

### 5.3 Crossing detection (the actual cut test)

For each fruit and each new blade segment `A→B` added this frame:

1. Broad phase: skip if the segment's bounding box doesn't overlap the fruit's
   bounding circle (fast reject).
2. Narrow phase: compute the **distance from the fruit center to the segment
   `A→B`** (point-to-segment distance, clamped to the segment). If that
   distance ≤ fruit radius, the blade passes through the fruit → **cut**.
3. Speed gate: only count it if the segment speed ≥ `MIN_SLICE_SPEED`.
4. A fruit can only be cut once (guard flag `sliced`).

We test against **all** segments added since the previous frame (not just the
latest), so high-speed swipes that add several synthesized sub-segments in one
frame all get a chance to cut. The **cut angle** is taken from the slicing
segment direction and is used to orient the two halves and the cut face.

### 5.4 Multitouch

- The engine reports a single canonical `pointer` plus a `pointers` Map. We
  primarily track the canonical primary pointer for the blade trail and combo
  scope (the requirement: "handle the primary pointer well at minimum").
- As a polish bonus, we *also* run crossing detection for every additional
  active pointer in the `pointers` Map using a lightweight per-pointer last
  position cache, so two fingers can slice simultaneously. Each extra pointer
  draws a thinner secondary trail. If multitouch proves noisy on a device it
  degrades gracefully (extra pointers simply add more potential cuts).

### 5.5 Tap vs swipe

- On TITLE / GAME_OVER, a `pointer.justDown` (tap) advances state. A quick tap
  that doesn't move won't accidentally start a slice combo because slicing only
  matters in PLAYING and requires the speed gate.

---

## 6. Entities & Physics

All positions/velocities are in CSS px and px/second. Gravity and launch
speeds scale with `height` so the *arc shape and air-time* are consistent
across screen sizes.

### 6.1 Fruit

```ts
interface Fruit {
  kind: FruitKind;        // visual + scoring definition
  x: number; y: number;   // center
  vx: number; vy: number; // velocity (px/s)
  radius: number;         // collision + draw size
  angle: number;          // current rotation (rad)
  spin: number;           // angular velocity (rad/s)
  sliced: boolean;        // guard so it cuts once
  bonus: boolean;         // golden/special flag
  wobble: number;         // phase for subtle squash animation
  seed: number;           // per-fruit RNG seed → deterministic seed pattern
}
```

- **Spawn:** launched from below the bottom edge at `y = H + radius`, with an
  upward `vy` chosen so the apex lands in the upper-middle play area (≈ 18–32%
  of `H` from the top), and an `vx` aimed to drift toward the horizontal center
  (fruit launched from the left drift right and vice-versa) so almost all fruit
  stay reachable. Spin is random within a comfortable range.
- **Integration (per frame):**
  - `vy += GRAVITY * dt`
  - `x += vx * dt; y += vy * dt`
  - `angle += spin * dt`
  - `wobble += dt`
- **Miss:** a fruit is "missed" once it has passed its apex *and* its top edge
  drops below `H` (fully off the bottom). In Classic, an un-sliced **regular**
  fruit that is missed costs a life and plays a soft "whiff". Special/bonus and
  bombs never cost a life when missed (a missed bomb is *good*).
- **Cull:** removed when fully below the screen or fully off the sides far
  enough that it can't return.

### 6.2 Bomb

A bomb reuses the projectile model but has `kind === "bomb"`:

- Same launch physics so it mixes naturally into waves.
- Visual: dark metal sphere, specular highlight, a short fuse with an animated
  spark and tiny ember particles, faint red danger glow that pulses.
- Slicing a bomb → **immediate game over** in Classic & Arcade: spawn an
  explosion (expanding shockwave ring + ember burst + flash), big screen shake,
  `audio.explosion()` + low boom tone, then a short delay → `gameOver(score)`.
- A missed bomb is harmless and simply culled.

### 6.3 Fruit halves (post-slice)

When a fruit is sliced we remove the whole fruit and spawn two `Half` objects:

```ts
interface Half {
  kind: FruitKind;
  x: number; y: number;
  vx: number; vy: number;
  angle: number; spin: number;
  side: -1 | 1;           // left/right of the cut
  cutAngle: number;       // orientation of the flat cut face
  life: number;           // for fade if needed
}
```

- The two halves inherit the fruit's velocity plus an **impulse perpendicular
  to the cut direction**, pushing them apart (one each way). They also get a
  little extra spin and a small random scatter so no two cuts look identical.
- Halves obey gravity and fall off-screen, then are culled. They render as the
  fruit shape **clipped to one side of the cut line**, with a pale "inner
  flesh" cut face drawn along the cut so you see the fruit's insides.

### 6.4 Particles (juice)

```ts
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  gravity: number;
  kind: "juice" | "spark" | "ring" | "smoke";
}
```

- **Juice droplets:** burst of 14–24 droplets in the fruit's juice color along
  the cut, with gravity, shrinking over life. Some are elongated "streaks".
- **Sparks/embers:** for bombs (orange/white), fast and short-lived.
- **Shockwave ring:** a single expanding stroked ring for the bomb explosion.
- **Smoke:** soft dark puffs for the bomb explosion afterglow.

### 6.5 Juice splats (lingering decals)

When fruit is sliced we also drop 1–3 **splat** decals onto a persistent
"splat layer" near the cut point. These are soft translucent blobs in the
juice color that **accumulate** and slowly fade over several seconds, so the
play area builds up a satisfying mess during a good run. The splat layer is
capped (oldest splats fade/cull first) to bound cost. Splats are drawn *behind*
the active fruit but *in front of* the background.

---

## 7. Scoring & Combos

### 7.1 Base scoring

- Slicing a **regular fruit:** `+1` per fruit (configurable per kind; most are
  worth 1, a couple worth more for being smaller/harder).
- **Bonus / golden fruit:** worth more (e.g. `+5`) and never cost a life. They
  appear rarely and shimmer.
- **Double-points window** (Arcade freeze/double fruit): all points ×2 while
  active; HUD shows a "2X" badge with a timer bar.

### 7.2 Combos (multi-slice in one swipe)

- A **combo** = number of fruit sliced within a **single slice session** (one
  pointer-down→up) OR within a tight rolling time window (`COMBO_WINDOW` ≈
  450 ms) so a continuous fast multi-fruit drag counts even across the same
  hold. We use the slice-session scope as primary and the time window as a
  fallback for held continuous slicing.
- **Combo bonus:** when a session/window ends with `n ≥ 2` fruit, award a bonus
  of `(n - 1) * COMBO_BONUS` (e.g. `n` fruit → roughly `n` base + escalating
  bonus). Concretely: 2 fruit = small bonus, scaling up so big combos feel
  great (e.g. `bonus = floor(n * (n-1) / 2) * combo_unit`).
- **Combo banner:** a centered popup "Triple! +6", "Mega Combo x6! +30", etc.,
  with a scale-pop animation and color tied to combo size. Distinct tiers:
  - 2 = "Double"
  - 3 = "Triple"
  - 4 = "Quad"
  - 5 = "Penta"
  - 6+ = "MEGA COMBO x{n}"
- A rising **combo pitch** sound: each additional fruit in the same swipe plays
  a tone one semitone higher (classic combo "ladder" feel).

### 7.3 Floating score popups

Every cut spawns a small floating "+1" (or "+5", "+12") number at the cut point
that rises and fades. Combo banners are separate and centered.

### 7.4 Reporting

- `ctx.reportScore(score)` is called whenever `score` changes (cut, combo
  bonus) so the HUD stays live.
- On game over, `ctx.gameOver(score)` is called once (guarded) after the death
  animation beat. We also `storage.submitScore(score)` / persist best.

---

## 8. Art Plan (all procedural, canvas 2D)

Everything below is drawn with paths, gradients, and shadows — no images.

### 8.1 Background

A warm "dojo at dusk" scene, fully repainted each frame:

- **Sky gradient:** deep indigo at top → warm plum/orange near the horizon.
- **Sun/moon disc:** a soft glowing circle low in the sky with a radial bloom.
- **Distant hills / bamboo silhouettes:** a few layered dark shapes (parallax
  drift is subtle, mostly static) for depth.
- **Vignette:** radial darkening at the edges to focus attention center.
- **Floating dust motes:** a handful of slow drifting specks for life.
- **Wood floor strip** (optional, bottom): a darker band suggesting a dojo
  floor. Kept subtle so fruit reads clearly against it.

The palette is deliberately distinct from any existing product (no wooden
"cutting board" texture lift; ours is an atmospheric sky scene).

### 8.2 Fruit catalogue

Each kind is a small draw routine taking `(ctx, radius, angle, seed)` and a
matching **half** draw routine (whole shape clipped to one side + flesh face).
Colors are defined per kind: `skin`, `skinDark` (shading), `flesh`, `juice`.

| Kind | Shape & detail | Skin | Flesh / juice |
| --- | --- | --- | --- |
| **Watermelon** | Big green sphere with darker green stripes; cut face shows red flesh, white rind ring, scattered black seeds. | green / dark-green stripes | red / red juice |
| **Apple** | Round red body, slight top dimple, a small brown stem + green leaf; cut shows pale yellow flesh + tiny seeds. | red | cream / pink juice |
| **Orange** | Textured orange sphere with dimpled pore shading + small leaf; cut shows segmented citrus pattern. | orange | light-orange / orange juice |
| **Lemon/Lime** | Smaller ovoid, bright yellow/green, glossy; tart citrus segments inside. | yellow/green | pale / yellow juice |
| **Banana** | Curved crescent body with ridges + brown tips; cut shows pale flesh. | yellow | cream / pale juice |
| **Pineapple** | Ovoid with cross-hatched diamond skin + spiky green crown; cut shows yellow flesh. | golden-brown | yellow / yellow juice |
| **Strawberry** | Heart/teardrop red body dotted with seeds + green calyx; juicy red inside. | red | pink / red juice |
| **Kiwi** | Brown fuzzy ovoid; cut shows iconic green flesh with white center + black seed ring. | brown | green / green juice |
| **Plum/Grape** | Small deep-purple sphere with sheen; magenta juice. | purple | magenta / purple juice |
| **Golden bonus** | Glowing golden version of any fruit with sparkle ring; worth bonus points. | gold | gold sparkle |

(We ship a curated subset — at least watermelon, apple, orange, banana,
pineapple, strawberry, kiwi, plus the golden bonus — and the architecture makes
adding more trivial.)

**Shading approach:** each fruit gets a radial gradient (light from upper-left),
a specular highlight blob, an ambient-occlusion darkening on the lower-right,
and kind-specific overlays (stripes, pores, seeds, leaves). Rotation is applied
via `ctx.translate/rotate` so spin looks natural.

### 8.3 Blade trail

- A smooth, glowing ribbon following the recent pointer samples.
- Built as a tapered polygon: width is largest near the newest point and
  narrows toward the oldest, so it reads as a *swoosh*. Implemented by
  offsetting each trail point perpendicular to the local direction by a
  width that fades with age.
- Rendered in two passes: a soft wide **glow** (additive-ish, low alpha, blur
  via shadowBlur) under a bright thin **core** (near-white).
- A subtle motion-blur feel comes from the trail length and per-point fade.
- Secondary pointers (multitouch) draw thinner, dimmer trails.

### 8.4 HUD

- **Score:** large, top center (or top-left), with a soft shadow for contrast.
- **Best:** smaller, near the score.
- **Lives (Classic):** 3 pips top-right drawn as little stylized fruit/hearts;
  lost pips dim/desaturate with a quick shake.
- **Timer (Zen/Arcade):** a slim bar or "M:SS" readout.
- **Combo banner:** transient centered popup.
- **Power-up badges (Arcade):** "2X", "SLOW" with countdown bars.
- HUD uses `drawText` (Baloo 2 / system font) and is drawn last (on top).

### 8.5 Screen states overlays

- **Title:** dim the scene slightly, big stylized "FRUIT FRENZY" wordmark
  (two-tone fill + outline), best score, three mode buttons (rounded rects,
  the active one highlighted), and "tap / swipe to slice!" hint with an
  animated demo blade.
- **Countdown:** big translucent "3 / 2 / 1 / SLICE!" numbers that scale-pop.
- **Game over:** darken, "GAME OVER" or "BOOM!" headline, final score, best,
  and "tap to play again". A few sad fruit halves rain down behind it.

---

## 9. Difficulty & Spawning

### 9.1 Wave-based spawner

Rather than a constant stream, fruit comes in **waves**:

- A wave spawns `k` items over a short burst (a fraction of a second of
  staggered launches), then there is a **rest gap** before the next wave.
- As difficulty rises: waves get bigger (`k`), gaps get shorter, fruit move a
  bit faster (higher launch speed / gravity), and bomb probability increases.

### 9.2 Difficulty curve

A single `difficulty` value grows with elapsed play time (and/or score),
clamped to a max. It drives:

| Parameter | Easy (start) | Hard (cap) |
| --- | --- | --- |
| Wave size `k` | 1–2 | 3–6 |
| Rest gap between waves | ~1.6 s | ~0.5 s |
| Launch speed scalar | 1.0 | ~1.35 |
| Bomb chance per item | 0% (first few s grace) | ~14% (Classic) |
| Bonus-fruit chance | ~3% | ~6% |

- **Grace period:** the first ~5 seconds spawn only easy single fruit and **no
  bombs**, so the player warms up.
- **Bomb pacing:** bombs are never spawned such that a wave is *all* bombs;
  there's always at least one fruit per wave, and we avoid spawning a bomb
  directly overlapping a fruit's path so it stays sliceable-around.
- **Anti-frustration:** clamp simultaneous on-screen objects to a sane max so
  the screen never becomes unreadable; if at cap, delay the next wave.

### 9.3 Power-ups (Arcade and rare in Classic)

- **Freeze (slow-mo):** slicing it scales global `dt` for fruit by ~0.45 for a
  few seconds (blade unaffected) with a blue vignette tint.
- **Double points:** ×2 scoring window with a "2X" badge.
- **Frenzy:** a short window of rapid easy fruit waves (no bombs) for a combo
  rush.

These are implemented as special `FruitKind`s so they spawn, fly, and get
sliced through the same pipeline; their *effect* triggers on slice.

---

## 10. Audio Plan (synth via `ctx.audio`)

All sound is generated; layered for richness:

- **Whoosh (swipe):** a quick `sweep` when a fast blade segment is detected
  (throttled so continuous motion doesn't spam). Adds physicality to slicing.
- **Slice hit:** a short bright `tone` + a tiny `noise` "splat" burst; pitch
  varies slightly per fruit so it's not monotonous.
- **Combo ladder:** each additional fruit in a swipe raises pitch by a semitone
  (`baseFreq * 2^(i/12)`), giving the rising "combo" feel; a sparkle `tone`
  caps big combos.
- **Bonus fruit:** a bright two-note `coin`-like flourish.
- **Bomb:** `explosion()` noise + a low boom `tone` + a descending `sweep`.
- **Life lost / miss:** a soft low `tone` / `lose`-style cue.
- **Power-up:** an ascending arpeggio.
- **Game over:** the engine `lose()` motif; **new best:** `win()` motif.

Audio respects the global mute (handled inside `AudioManager`). We never assume
audio is available — all calls are fire-and-forget and safe if muted.

---

## 11. Screen Shake & Camera

- A lightweight `shake` value (decays each frame) offsets the whole scene via
  `ctx.translate(randOffset)` at the top of `render`. Triggered strongly by
  bomb explosions and mildly by big combos for extra punch.
- A brief **slow-motion** on bomb death (scale the death animation's time)
  makes the explosion read before the game-over screen appears.
- A subtle **bloom flash** (full-screen white at low alpha, decaying) on
  explosions and mega-combos.

---

## 12. Layout & Responsiveness

- Read `ctx.width`/`ctx.height` every frame. Derive all sizes from them:
  - Fruit radius ≈ `min(W,H) * 0.055–0.08` (capped range).
  - Gravity ≈ `H * 1.4`; launch speed ≈ `H * 1.35` upward (tuned for nice arc).
  - Blade width, HUD font sizes, splat sizes all scale with `min(W,H)`.
- `resize(w,h)` recomputes any cached layout (e.g. background gradient stops,
  HUD positions). Active fruit keep their world positions; nothing teleports.
- Works for tall (portrait phone), wide (desktop), and square aspect ratios.
  Spawn launch angles fan out based on aspect so fruit reach the play area on
  very wide or very tall screens.

---

## 13. Edge Cases & Robustness

| Case | Handling |
| --- | --- |
| Pointer leaves canvas mid-swipe | `pointerup` fires on window; trail ends, combo resolves. No stuck blade. |
| Very fast flick (tunneling) | Synthesize sub-segments between samples so small fruit are still crossed. |
| Resting finger on fruit | Speed gate prevents a stationary/slow blade from cutting. |
| Tab blur / pause | `onPause` freezes update; `onResume` resumes; we ignore the huge `dt` of the first frame after resume (clamp `dt`). |
| Huge `dt` spikes | Clamp `dt` to a max (e.g. 1/20 s) so physics never explodes. |
| Resize to tiny / huge | All sizes relative; clamp fruit count; gradients rebuilt. |
| Multiple pointers up/down | Per-pointer caches keyed by id; cleared on up; primary always tracked. |
| Game over re-entry | `gameOver` guarded with a flag so it fires exactly once. |
| Storage unavailable | `try/catch` already in `GameStorage`; best score simply not persisted. |
| Muted audio | All audio calls are no-ops when muted; no crashes. |
| Destroy mid-run | Clear any owned timeout, drop references, stop spawning. |
| Title-screen slicing | Allowed for delight; awards no score, costs no life. |
| Combo while held continuously | Time-window fallback keeps the combo alive across a long drag. |
| All-bomb wave | Prevented by spawner invariant (≥1 fruit per wave). |

---

## 14. File Architecture

```
src/games/fruit-ninja/
  PRD.md          ← this document
  index.ts        ← create(): state machine, loop, HUD, glue
  types.ts        ← shared interfaces + small math helpers + constants
  fruits.ts       ← FruitKind catalogue + procedural whole/half draw routines
  blade.ts        ← pointer trail, slice detection, blade rendering
  particles.ts    ← Particle + Splat + FloatingText systems
  background.ts   ← dusk-dojo background renderer (cached gradients)
  spawner.ts      ← wave logic, difficulty curve, launch math
```

Each module is independently testable and typed. `index.ts` owns the canonical
game state and orchestrates the others, passing the live `GameContext` and
per-frame world bounds.

---

## 15. Tuning Constants (initial values, all relative)

| Name | Value | Meaning |
| --- | --- | --- |
| `MAX_DT` | `1/20` s | dt clamp |
| `TRAIL_LIFETIME` | `0.12` s | blade point age |
| `TRAIL_MAX` | `24` | blade point count |
| `MIN_SLICE_SPEED` | `~0.55 * minDim` px/s | speed gate for cutting |
| `GRAVITY_K` | `1.45` | gravity = K * H |
| `LAUNCH_K` | `1.28` | upward launch ≈ K * H |
| `FRUIT_R_K` | `0.066` | radius ≈ K * minDim |
| `COMBO_WINDOW` | `0.45` s | rolling combo window |
| `GRACE_TIME` | `5` s | no-bomb warmup |
| `MAX_OBJECTS` | `~14` | on-screen object cap |
| `LIVES` | `3` | Classic lives |
| `ZEN_TIME` | `90` s | Zen duration |
| `ARCADE_TIME` | `60` s | Arcade duration |
| `SHAKE_DECAY` | `~6 / s` | screen-shake falloff |

All are defined in `types.ts` and tuned during playtest; they're expressed
relative to screen size where it affects feel.

---

## 16. Acceptance Criteria

The game is "done" when:

1. `create(ctx)` returns a valid `GameInstance`; no `any`, strict TS clean.
2. Slicing feels great: fast drags cut fruit, halves fly apart, juice sprays,
   splats linger, combos pop, sounds play. Slow/resting blade does not cut.
3. Bombs are obvious, lethal in Classic/Arcade, and explode with shake+flash.
4. Classic: 3 lives, missed regular fruit costs a life, 0 lives → game over;
   bomb → instant game over. Zen/Arcade timers work.
5. Difficulty ramps over time; spawning uses waves with rests; grace period at
   start; object cap respected; never an all-bomb wave.
6. At least ~7 visually distinct procedural fruit + a golden bonus + bomb.
7. Score reported live; best persisted; `gameOver` fired exactly once.
8. Title / countdown / playing / game-over states all present and polished.
9. Renders correctly and stays performant at any size/aspect, desktop + mobile,
   with live resize and full background repaint each frame.
10. Self-contained: only `@/engine` + this folder; no shared-file edits, no
    asset files, no libraries.
```
```
