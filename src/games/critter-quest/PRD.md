# Duck Life — Product Requirements Document

> An original, canvas-only pet-raising + racing game in the genre of "Duck Life".
> Hatch a duckling, train its Running / Swimming / Flying through three distinct
> animated mini-games, spend coins in a shop, then race AI rivals across
> multi-terrain courses and climb the leagues. Everything is drawn procedurally
> with the Canvas 2D API — no asset files — and all progress persists.

Game id: `critter-quest` (registered title: **Duck Life**, aspect ≈ 1.4, leaderboard
score label "Power"). The module exports `create(ctx: GameContext): GameInstance`.

---

## 1. Vision & Pillars

1. **A duck that feels alive.** The star of the show is the duckling. It must be
   cute and constantly animated: idle bob + breathing, periodic blinking, head
   turns, a real running cycle (legs + body lean), a paddling swim, and a
   flapping flight. It visibly grows and gains plumage detail as it levels up,
   and wears cosmetic hats that persist.
2. **Three genuinely different mini-games.** Running (side-scroll obstacle
   runner), Swimming (vertical dodge-and-collect), Flying (altitude-management
   flappy flight). Each has its own controls, art, hazards, collectibles, and
   feeds a specific stat.
3. **A readable, juicy meta-loop.** Hatch → Hub → Train (spend energy, gain XP) →
   Shop (spend coins) → Race (earn coins, climb leagues) → repeat. Energy
   regenerates over real time. Power (sum of stat levels) is the leaderboard
   score.
4. **Polish everywhere.** Parallax backgrounds, particles, smooth fades between
   screens, screen shake on impact, countdowns, result cards, and consistent
   chunky cartoon UI.

Non-goals: multiplayer, online assets, story/dialogue trees, real-money economy.

---

## 2. Engine Contract (how we use it)

From `@/engine`:

- `ctx.ctx` — a `CanvasRenderingContext2D` already scaled for device pixel
  ratio. **We always draw in CSS pixels.**
- `ctx.width` / `ctx.height` — **getters**. We read them every frame and on
  `resize`; never cache them across frames. Layout is fully proportional so the
  game works at any aspect ratio and on mobile.
- `ctx.input` — `isDown(...keys)`, `pressed(...keys)`, `released(...keys)`, and
  `pointer { x, y, down, justDown, justUp }` in logical coordinates.
- `ctx.audio` — `blip / coin / jump / hit / explosion / win / lose` plus the raw
  `tone / sweep / noise` synth primitives for custom sfx.
- `ctx.storage` — `get<T>(key, fallback)` / `set<T>(key, value)`. Persist ALL
  progress here.
- `ctx.reportScore(n)` — update the live HUD score (we report Power).
- `ctx.gameOver(finalScore?)` — submit a final score to the leaderboard. Used by
  the explicit "Submit Score" action only; the game is open-ended (no death).
- `ctx.setStatus(text)` — HUD subtitle above the canvas.
- `ctx.requestControls(controls)` — request on-screen buttons for mobile.

`GameInstance` returns `{ update(dt), render(), resize?, destroy? }`.

Rules we follow: repaint the full background every frame, strict TypeScript (no
`any`), no React/3rd-party libraries, imports only from `@/engine` and our own
folder, canvas-only visuals, and we never edit shared files or run build tooling.

`dt` is seconds. We clamp `dt` to a max (≈ 1/20 s) inside each screen to avoid
tunneling after tab-switches.

---

## 3. File Layout

```
src/games/critter-quest/
  PRD.md            – this document
  index.ts          – create(ctx): the controller + Hub/Train/Shop/Stats screens
  duck/
    save.ts         – SaveData type, defaults, load/persist, progression + economy math
    theme.ts        – palette, fonts, color helpers (lighten/darken/hex)
    ui.ts           – buttons, panels, chips, stat bars, pointer hit-testing
    fx.ts           – particle system + screen shake + floating text
    backdrop.ts     – reusable parallax backgrounds (sky/hills/water/grass/stars)
    duck.ts         – the animated duck renderer (all poses + hats + growth)
    screen.ts       – Screen interface + shared sub-screen env
    hatch.ts        – egg-cracking intro screen
    train_run.ts    – Running mini-game
    train_swim.ts   – Swimming mini-game
    train_fly.ts    – Flying mini-game
    race.ts         – multi-terrain race vs AI
```

Why split: the duck renderer and backgrounds are shared by every screen, so they
live in their own modules; each mini-game and the race is a self-contained
`Screen` so the controller can swap them with a fade transition.

---

## 4. Save Format & Persistence

Single storage key `"save"` holding one JSON object:

```ts
interface SaveData {
  version: number;          // schema version for migrations
  hatched: boolean;         // false until the egg intro completes

  // stat levels (1-based) and XP accumulated toward the NEXT level
  run: number; swim: number; fly: number;
  runXp: number; swimXp: number; flyXp: number;

  coins: number;            // shop currency
  energy: number;           // 0..MAX_ENERGY (float; regenerates over real time)
  lastEnergyTs: number;     // ms epoch of last regen accounting

  league: number;           // currently selected league (0-based)
  bestLeague: number;       // highest league unlocked (0-based)

  owned: string[];          // owned hat ids
  equipped: string | null;  // equipped hat id

  bestPower: number;        // best Power ever submitted (local mirror)
  races: number;            // lifetime races completed
  wins: number;             // lifetime 1st places
}
```

- **Load**: `{ ...defaultSave(), ...stored }` so older partial saves never crash.
- **Persist**: after every meaningful state change (hatch, XP gain, purchase,
  race result, energy tick that crosses an integer) and defensively on screen
  exit.
- **Energy regen** is timestamp-based so it accrues while the game is closed:
  on load and every frame we compute `gained = floor((now - lastEnergyTs)/REGEN_MS)`,
  add it (capped at MAX), and advance `lastEnergyTs`. When full, `lastEnergyTs`
  tracks `now` so the timer doesn't "bank".

Defaults: `run/swim/fly = 1`, all XP `0`, `coins = 40`, `energy = MAX_ENERGY`,
`league = 0`, `bestLeague = 0`, `owned = []`, `equipped = null`, `hatched = false`.

---

## 5. Progression & Economy Math

### 5.1 Stats & XP

- Three trainable disciplines: **Running**, **Swimming**, **Flying**. A fourth
  resource, **Energy**, gates training.
- XP to go from level `L` to `L+1`: `xpForLevel(L) = round(12 + L*7 + L*L*0.6)`.
  This is gentle early and escalates so later levels feel earned.
- `addXp(disc, amount)` rolls over multiple levels in one session and returns the
  number of levels gained (used for celebratory feedback).
- **Power** = `run + swim + fly` (the leaderboard score, reported live).

### 5.2 Energy

- `MAX_ENERGY = 100`. `TRAIN_COST = 15` energy per training session.
- Regen: 1 energy per `ENERGY_REGEN_SECONDS = 18` real seconds.
- If energy `< TRAIN_COST`, training is blocked with a toast prompting the shop.
- `secondsToNextEnergy()` powers the "+1 in Ns" HUD readout.

### 5.3 XP rewards (per mini-game)

Each mini-game ends with a score; XP is derived so a good run gives roughly one
level early on and proportionally less later:

```
xpEarned = round(baseClears + collectibles*perPickup + distanceBonus)
```

Tuned per game (see §7). A small **coin** reward is also granted:
`coins += round(xpEarned * 1.2)`.

### 5.4 Race payouts

Per finish, by placement (4-racer field):

| Place | Coins (base)              | Notes                              |
|-------|---------------------------|------------------------------------|
| 1st   | `60 + league*40`          | unlocks next league if at frontier |
| 2nd   | `35 + league*22`          |                                    |
| 3rd   | `18 + league*12`          |                                    |
| 4th   | `8  + league*6`           | never zero — no dead ends          |

Winning the **frontier** league (`league === bestLeague`) sets
`bestLeague = league + 1` (capped at `LEAGUE_COUNT - 1`) and shows an "unlocked"
banner. Replaying cleared leagues still pays coins (grinding is allowed).

### 5.5 Shop

- **Food** (instant, consumable — restores energy):
  - Bread Crumbs: +25 energy, 12c
  - Juicy Worm: +55 energy, 26c
  - Royal Feast: +100 energy (full), 55c
- **Hats** (persistent cosmetic + small race boost; tap to buy, tap again to
  equip/unequip):
  - Speed Cap (`run +2`), 70c
  - Dive Goggles (`swim +2`), 70c
  - Aviator Cap (`fly +2`), 70c
  - Sun Visor (all +1), 150c
  - Golden Crown (all +3), 340c
- Equipped hat draws on the duck in **every** screen and affects race speed via
  `effectiveStat(disc) = level + hatBoost`.

---

## 6. Screens & Navigation

State machine in `index.ts`. A `view` enum plus an optional active `Screen`
(`sub`) for full-takeover mini-games/race. All transitions go through a shared
fade (black out → swap → fade in) so nothing pops.

```
            ┌──────── (first run, !hatched) ────────┐
            ▼                                        │
        [HATCH]  ──hatched──▶  [HUB] ◀───────────────┘
                                 │
          ┌──────────┬──────────┼───────────┬─────────────┐
          ▼          ▼          ▼            ▼             ▼
       [TRAIN]    [RACE]     [SHOP]       [STATS]      (Submit Score)
          │          │
   pick discipline   pick league
          │          │
          ▼          ▼
   [RUN/SWIM/FLY]  [RACE run]
   mini-game         │
          └────result┴────▶ back to HUB
```

### 6.1 Hatch (intro)
- Shown only when `!save.hatched`.
- A speckled egg sits on a nest on grass with a dawn-gradient sky. Soft parallax
  clouds. Prompt: "TAP THE EGG!".
- Each tap/Space adds a crack (procedural jagged polylines radiating from random
  points) and a little wobble + `blip`. A progress meter ("hatching…") fills.
- After ~6 taps the egg bursts: shell splits into two halves that fall away,
  a confetti/shell-shard particle burst fires, a sparkle ring expands, and the
  duckling pops up doing a happy bounce with a `win` jingle.
- A "Meet your duckling!" card appears with a CONTINUE button → sets
  `hatched = true`, persists, fades to Hub.
- Edge: if a save already has `hatched`, skip straight to Hub.

### 6.2 Hub (main menu)
- Top bar chips: **Power** (star icon), **Coins** (coin icon), **Energy** (bar
  with "+1 in Ns" / "FULL").
- Title "DUCK LIFE" + current league name subtitle.
- The animated duck idles on a grassy mound in front of a parallax world
  (sky, sun, hills, pond, grass, drifting clouds, occasional butterfly).
- Three compact stat bars (Run/Swim/Fly) with level + XP fill.
- Four big buttons in a 2×2 grid: **TRAIN**, **RACE**, **SHOP**, **STATS**
  (also keyboard 1–4). Hover/press states.
- Idle flavor: the duck occasionally quacks (sfx + speech puff) and looks around.

### 6.3 Train (discipline select)
- Three cards (Running/Swimming/Flying). Each shows the discipline color, a mini
  duck performing that action (looped), current Level, XP bar, and a TRAIN
  button labeled with the energy cost.
- Disabled/greyed if energy `< TRAIN_COST`; tapping shows the "need energy"
  toast.
- Energy bar at the bottom. BACK button (+ Esc/Backspace).
- Selecting a card spends energy, persists, and fades into the mini-game.

### 6.4 Race (league select)
- Card showing the selected league name, a preview of the terrain colors, and the
  rival strength range for that league.
- `<` / `>` arrows (and ←/→) to pick any league from 0..`bestLeague`.
- Shows the player's three effective stats and Power.
- START RACE (Space/Enter) fades into the race.

### 6.5 Shop
- Top bar with coins. Food row (3 cards) and Hats list (rows with swatch, name,
  effect, and BUY/EQUIP/EQUIPPED button).
- Live affordability coloring. Buying plays `coin`; failure plays `lose` + toast.

### 6.6 Stats
- Panel with the duck and a table: Power, Run/Swim/Fly levels, Coins, Races,
  Wins, Best League. League progress dots.
- **SUBMIT SCORE** button → `reportScore(power)` then `gameOver(power)`. This is
  the only call to `gameOver`. Open-ended otherwise.

---

## 7. Training Mini-Games (detailed)

Shared structure for all three (each implemented as a `Screen`):
- A 3-2-1 **countdown** (with rising tones), then `RUN_TIME ≈ 30 s` of play.
- A live HUD: time remaining bar, current pickups, and "XP so far" estimate.
- On time-up (or all-clear): freeze, then a **result card** ("Nice run!", XP and
  coins earned, level-up banner if any) with a CONTINUE button that calls the
  completion callback `onDone(xpEarned)` and returns to the Hub.
- Pause input mid-transition; clamp `dt`.
- The shared duck renderer draws the star with the discipline-appropriate pose so
  growth/hats carry through.

### 7.1 Running — `train_run.ts`
- **Camera**: side view. Duck fixed at ~28% width on the ground; world scrolls
  left. Parallax: sky + hills + tree line + a textured scrolling ground strip.
- **Duck**: real running cycle — alternating legs, body bob, slight forward lean,
  flapping-for-balance wings on jump. Dust puffs kick from the feet.
- **Controls**: Space / Up / W / tap = jump. Variable height: holding extends the
  rise a little. Coyote-time-free, simple but responsive. A double "flutter" is
  allowed at the apex once (cute, optional).
- **Hazards**: rocks and hurdles spawn on the ground; some are tall (must jump),
  spacing scales with speed. Collision = stumble (lose a bit of speed + small
  time penalty + `hit` + screen shake), not death.
- **Collectibles**: floating seed clusters arcing across; grabbing chains a combo
  multiplier (resets on stumble).
- **Difficulty**: world speed ramps over the 30 s; spawn cadence tightens.
- **Scoring**: `seeds` collected + `distance` traveled.
  `xp = round(distance*0.012 + seeds*1.0)` (≈ enough for ~1 level early).
- **Energy/feel**: speed lines at high velocity; combo popups.

### 7.2 Swimming — `train_swim.ts`
- **Camera**: side view underwater/at-surface. Duck fixed near left; water
  scrolls left. Layers: sky sliver + waterline with animated wavelets + mid
  water gradient + drifting seaweed/light shafts + bubbles rising.
- **Duck**: swimming pose — body slightly nose-up, webbed feet paddling in
  alternation, head above a rippling waterline, V-wake + splash particles behind.
- **Controls**: Up/Down or W/S move vertically; **drag** (pointer) also steers —
  the duck eases toward the pointer's Y. Movement has gentle inertia (buoyancy).
- **Hazards**: rocks/pylons jutting from top and bottom, plus swirling **eddies**
  (rotating warning rings) that nudge the duck if touched. Collision = slow +
  `hit` + shake (no death).
- **Collectibles**: rising **bubbles** in lanes; popping them gives points +
  `blip`/`coin` and a satisfying pop particle.
- **Difficulty**: scroll speed + gap tightness ramp.
- **Scoring**: `bubbles` + `distance`.
  `xp = round(distance*0.011 + bubbles*1.1)`.

### 7.3 Flying — `train_fly.ts`
- **Goal**: a real flight feel, *not* a static lane. The duck constantly loses
  altitude to gravity; you **flap** to gain height and thread obstacles while the
  world scrolls and the camera drifts so you sense forward + slight downward
  travel across a tall sky.
- **Camera**: the world scrolls left; a soft vertical camera follows the duck so
  there's headroom above and below (big sky). Parallax cloud layers at different
  depths; distant mountains along the bottom.
- **Duck**: flying pose — wings sweep through a full flap arc (up-stroke vs
  down-stroke), body pitches with vertical velocity (nose up when rising, down
  when diving), tail fans. A burst of feather particles on each strong flap.
- **Physics**: `vy += GRAVITY*dt`; flap sets `vy = -FLAP_IMPULSE` (with a tiny
  cooldown to prevent machine-gun flaps) + `jump` sfx + feather puff. Soft
  ceiling and a "ground" cloud floor — touching either is a bonk (slow + shake),
  not death.
- **Controls**: Space / Up / W / tap = flap.
- **Hazards**: **rival birds** flying in from the right at varied heights
  (gentle sine bobbing); avoid them. Touch = stumble.
- **Collectibles**: floating **rings** (and golden rings worth more) placed at
  varying heights; fly through the center for points + a ring-collect spark.
  Occasional cloud puffs are just scenery.
- **Difficulty**: bird frequency + ring placement variance ramp.
- **Scoring**: `rings` (golden = ×3) + `distance`.
  `xp = round(distance*0.010 + rings*1.4)`.

---

## 8. Race System (detailed) — `race.ts`

### 8.1 Course
- One race = a single long track split into **three equal segments** by distance:
  **RUN → SWIM → FLY**. Total length `COURSE_M` meters (e.g. 900 m, scales a
  little with league).
- Side-view, camera follows the **player** horizontally. The background and
  ground morph by segment: grassy field (run), a pond/river band (swim), open sky
  with clouds (fly). Smooth visual cross-fade in a short blend zone at each
  boundary. A finish banner stands at `COURSE_M`.
- A top **mini-map / progress bar** shows all racers' positions and segment
  boundaries with icons.

### 8.2 Racers
- Field of **4**: the player + 3 AI. Each racer has:
  `{ name, color, progress (m), speed (m/s), isPlayer, lane }`.
- Drawn as ducks (AI in distinct feather colors, no hats) using the shared
  renderer; **gait switches with the segment** they're currently in (run cycle /
  paddle / flap). Slight vertical lane offset so they don't overlap; the duck in
  the swim segment rides the waterline; in fly it gains altitude.

### 8.3 Speed model
For a racer in segment `s` (run/swim/fly):

```
baseSpeed   = SEG_BASE_SPEED                         // m/s, tuned per segment
statFactor  = 0.6 + statForSegment / STAT_NORM       // higher stat → faster
noise       = 1 + sin(t*freq + phasePerRacer)*0.06   // lively jitter
speed       = baseSpeed * statFactor * noise * leagueScale
progress   += speed * dt
```

- **Player** uses `effectiveStat(disc)` (level + equipped hat boost) for the
  active segment.
- **AI** stats are generated per race from the league:
  `aiStat = leagueBase + rand(-spread..+spread)`, where `leagueBase` grows each
  league so rivals scale in difficulty. Each AI also gets a small personality
  (slightly faster on one segment).
- Result: a duck strong at Running pulls ahead in the first third, etc. — the
  player feels their training choices.

### 8.4 Flow
1. **Line-up + countdown** (3-2-1-GO with tones); racers idle at the start.
2. **Race**: update progress; camera tracks player; segment-appropriate parallax
   + duck gaits; dust/splash/feather particles; positions update on the mini-map.
   A live "P1/P4" placement indicator and distance-to-finish.
3. **Finish**: when the player crosses `COURSE_M`, compute final placement (other
   racers' finishing handled by continuing their sim a moment or by projecting).
   Confetti for a win; `win`/`lose` jingle.
4. **Result card**: placement, coins earned, "League Unlocked!" if applicable,
   and CONTINUE → callback applies coins/league, persists, returns to Hub.

### 8.5 Leagues (worlds)
`LEAGUE_COUNT = 4`:
1. **Pond Cup** — gentle, soft greens/blues.
2. **River Rapids** — faster, cooler palette, more rival variance.
3. **Mountain Lake** — high-altitude, crisp light, stronger rivals.
4. **Sky Marathon** — sunset palette, elite rivals.

Higher leagues = higher `leagueBase` rival stats and `leagueScale`, plus nicer/
moodier backgrounds (palette + extra scenery like birds, lily pads, snow caps,
sunset clouds).

---

## 9. The Duck Renderer & Animation — `duck.ts`

A single `drawDuck(c, x, y, scale, look, opts)` used everywhere, where `opts`
selects a **pose** and supplies animation phase. Built from layered canvas
primitives (ellipses, arcs, rounded shapes, bezier wing strokes) so it reads as a
chubby cartoon duckling.

### 9.1 DuckLook (appearance, derived from save)
```ts
interface DuckLook {
  body: string;      // main feather color (warm yellow)
  bodyShade: string; // darker tone for shading
  belly: string;     // lighter underside
  beak: string;      // orange
  beakShade: string;
  feet: string;      // orange
  cheek: string;     // soft blush
  hat: HatKind;      // none | cap | goggles | aviator | visor | crown
  hatColor: string;
  stage: number;     // 0..4 growth stage from Power
}
```
- **Growth**: `stage` increases with Power thresholds. Higher stages → slightly
  larger head-to-body ratio shrinks (less baby-ish), a small **crest feather**
  appears, wings get a defined feather edge, and color saturates subtly. Base
  `scale` also nudges up so the duck literally grows.

### 9.2 Poses (`opts.pose`)
- `idle` — gentle vertical bob (sin), slow breathing scale, periodic blink,
  occasional head tilt; feet tucked. Optional `quack` opens beak briefly.
- `run` — `opts.phase` drives a 2-leg cycle (thighs + shins as segments, feet
  planting), body bobs up on the push, slight forward lean, arms/wings tucked or
  pumping; ground contact aligns to the running surface.
- `swim` — body nose-up on a waterline (the renderer can clip the lower body
  under a passed `waterY`), webbed feet paddling in alternating circles below the
  surface, head bob, tail flick.
- `fly` — wings sweep through a flap arc from `opts.flap` (0..1), body pitch from
  `opts.pitch` (vertical velocity), tail fanned, legs tucked back.
- `cheer` — used on results/hatch: little hop with both wings up.

### 9.3 Shared details
- **Eyes**: white sclera + dark pupil with a highlight; `blink` squashes them to
  a line. Pupils can glance toward a `lookAt`.
- **Beak**: two-part (upper/lower) that can open by `opts.beakOpen`.
- **Wings**: drawn as filled bezier shapes; in fly pose they rotate about the
  shoulder through the flap arc with a feather-tip highlight.
- **Hats**: each `HatKind` drawn relative to head size; positioned to sit on top,
  scaling with the duck. Goggles sit over the eyes; crown/cap/visor on the crown;
  aviator adds straps.
- **Shadow**: a soft ellipse under the duck (skipped/thin when swimming/flying).

### 9.4 Cohesion
All animation derives from a single time accumulator per screen plus pose phase,
so the same duck object reads consistently across Hub, training, and race.

---

## 10. Visual System

### 10.1 Backgrounds — `backdrop.ts`
Reusable parallax helpers, each repainting full-frame:
- `sky(top, bottom)` gradient; optional `sun(x,y)` glow.
- `clouds(t, speed, density)` — soft layered ellipse clouds scrolling.
- `hills(t, colors[])` — overlapping rounded hill bands at parallax depths.
- `water(t, y, palette)` — gradient water with animated sine wavelets + light
  shafts + rising bubbles.
- `grass(t, y, palette)` — ground band with blade tufts + scrolling texture.
- `stars(t)` / `sunsetClouds(t)` for higher leagues.
Each takes `(W, H)` from the caller so it adapts to any size.

### 10.2 Particles & juice — `fx.ts`
- `Particles` pool: `{x,y,vx,vy,life,max,size,color,gravity,spin,shape}`. Helpers
  to `burst(...)`, `splash(...)`, `dust(...)`, `confetti(...)`, `ring(...)`.
- `Shake` helper: decaying screen-shake offset applied via `ctx.translate`.
- `FloatingText` for "+5", "COMBO ×3", "LEVEL UP!" that rise and fade.

### 10.3 UI — `ui.ts` / `theme.ts`
- Chunky rounded buttons with drop shadow, gradient fill, hover lighten, pressed
  offset, disabled alpha.
- Panels/cards with soft shadow; chips for stats; labeled stat/progress bars.
- A consistent cartoon palette in `theme.ts` + `lighten/darken/hexToRgb` helpers.
- Pointer helpers `clicked(input, rect)` / `hovering(input, rect)`.
- Fonts use the engine's `drawText` (Baloo 2 / system fallback).

### 10.4 Transitions
Controller-level fade (black overlay alpha 0→1→0). Mini-games/race add their own
countdown and result-card slide/scale. Toasts slide from the top and auto-expire.

---

## 11. Controls Summary

| Context   | Keyboard                          | Pointer / Touch                  |
|-----------|-----------------------------------|----------------------------------|
| Menus     | 1–4 (hub), ←/→ (league), Esc back | tap buttons                      |
| Hatch     | Space/tap                         | tap egg                          |
| Running   | Space / ↑ / W = jump              | tap = jump                       |
| Swimming  | ↑↓ / W S = move                   | drag to steer (eases to pointer) |
| Flying    | Space / ↑ / W = flap              | tap = flap                       |
| Race      | (auto-sim; Esc to bail to result) | —                                |

Mobile on-screen controls are requested via `ctx.requestControls`:
- Running/Flying: a single big action button ("JUMP" / "FLAP").
- Swimming: a d-pad (up/down used).
- Menus/Hatch: rely on direct taps (no extra buttons).

`destroy()` clears requested controls and persists; `resize()` recomputes any
cached layout anchors (most layout is computed per-frame from W/H so resize is
cheap and safe).

---

## 12. Tuning Constants (initial)

```
MAX_ENERGY            = 100
TRAIN_COST            = 15
ENERGY_REGEN_SECONDS  = 18
LEAGUE_COUNT          = 4
RUN_TIME (each game)  ≈ 30 s
COURSE_M              = 900 (+ league*120)
xpForLevel(L)         = round(12 + L*7 + L*L*0.6)
coinsFromXp           = round(xp * 1.2)
DT_CLAMP              = 1/20 s
```

All are centralized in `save.ts` (economy/progression) or the relevant screen so
balancing is a one-line change.

---

## 13. Edge Cases & Robustness

- **Any aspect / mobile**: every layout value is a fraction of W/H read each
  frame; `min(W,H)` used for duck scale and font sizing so nothing overflows on
  very wide or very tall stages.
- **Tab-switch / lag**: `dt` clamped; energy regen is timestamp-based and
  catches up correctly across long absences (and across full app restarts).
- **Corrupt/partial save**: merged over defaults; unknown hat ids ignored;
  `equipped` validated against `owned`.
- **Energy/coin underflow**: purchases and training re-check affordability at the
  moment of action; values clamped (`energy` 0..MAX, `coins ≥ 0`).
- **Pointer + key both firing**: actions are idempotent per frame (guard with
  transition state so a single tap can't double-trigger).
- **Mid-transition input**: ignored while a fade is in progress.
- **Race determinism**: AI uses per-race randomized stats but bounded so a
  well-trained player reliably places well; no race is unwinnable or unloseable
  by luck alone.
- **No dead ends**: every race pays coins; energy always regenerates; the game
  never ends except via the explicit Submit Score.
- **Audio off**: all sfx are best-effort; the engine no-ops when muted.
- **Destroy**: remove on-screen controls, persist save, drop references.

---

## 14. Definition of Done

- `index.ts` exports `create(ctx): GameInstance`; strict TS, no `any`, no lint
  errors, imports only `@/engine` + this folder.
- Egg hatch intro plays on first run and is skipped thereafter.
- Hub shows the animated duck, coins, regenerating energy, level/league, and four
  working buttons.
- All three mini-games are fully playable, animated, and grant the correct XP.
- Race runs across run→swim→fly vs 3 AI with league-scaled difficulty, pays
  coins, and unlocks leagues.
- Shop sells food + hats; hats render on the duck and persist.
- Power is reported live; Submit Score calls `gameOver(power)`.
- Everything persists across reloads; visuals are polished (parallax, particles,
  transitions) and readable at any size.
