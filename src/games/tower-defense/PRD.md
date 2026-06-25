# Iron Vale — Product Requirements Document

> An original, fully procedural Tower Defense game for the CoolHastorGames
> TypeScript + Vite portal. Inspired by the *genre* of Kingdom Rush / Bloons TD,
> but with **100% original design, art and code**. No assets, levels, names,
> sprites, balance tables or sounds are copied from any existing game. Every
> visual is drawn at runtime on a `<canvas>` and every sound is synthesised by
> the shared `AudioManager`.

- **Game id / folder:** `tower-defense` (`src/games/tower-defense/`)
- **Working title:** *Iron Vale*
- **Genre:** Single-player wave-based Tower Defense
- **Platform:** Desktop + mobile web (canvas, mouse + touch)
- **Render budget:** 60 FPS, pure 2D canvas, no external assets
- **Lines of code target:** several thousand across multiple files

---

## 1. Vision & Pillars

Iron Vale is a cozy-but-tense fantasy tower-defense skirmish. Monsters spill out
of a glowing rift and march along a winding road toward your Keep. You spend gold
— earned by slaying them — to build, upgrade and sell defensive towers on the
grass beside the road. Survive every wave to win; let too many monsters leak into
the Keep and you lose.

### Design Pillars

1. **Readable at a glance.** A player should understand the board, threats and
   their economy within two seconds of looking at the screen. Strong silhouettes,
   high-contrast palette, clear HUD, health bars, and range previews.
2. **Juicy feedback.** Every shot, hit, kill, build and upgrade produces sound
   and particle feedback. Numbers pop off enemies. The Keep flashes when hit.
3. **Meaningful choices.** Four distinct tower archetypes with real trade-offs
   (single-target vs splash, physical vs magic, damage vs control). Multiple
   maps with different path shapes reward different layouts.
4. **Escalating tension.** Waves ramp in size and composition, periodically
   broken by telegraphed boss waves. The "call wave early" mechanic lets
   confident players trade safety for extra gold.
5. **Always playable.** Adapts to any screen size / aspect ratio and works with
   mouse or a single tap. Never blocks on assets; loads instantly.

---

## 2. Engine Contract

The game is a **canvas game module** exporting:

```ts
export function create(ctx: GameContext): GameInstance
```

### `GameContext` (provided)

| Field             | Use in Iron Vale                                                        |
| ----------------- | ---------------------------------------------------------------------- |
| `ctx.ctx`         | 2D context, DPR-scaled. We draw everything in **CSS pixels**.          |
| `ctx.width/height`| **Getters** read *every frame*. Layout is recomputed each frame.       |
| `ctx.input`       | `isDown/pressed/released`, `pointer{x,y,down,justDown,justUp}`.        |
| `ctx.audio`       | `blip/coin/hit/explosion/win/lose/tone/sweep/noise` for all SFX.       |
| `ctx.storage`     | Persist best score + last selected map + tutorial-seen flag.           |
| `ctx.isTouch`     | Slightly enlarge hit targets / hint text on touch.                     |
| `ctx.reportScore` | Called live as score changes (kills + wave clears).                    |
| `ctx.gameOver`    | Called once on win or loss with the final score.                       |
| `ctx.setStatus`   | One-line status text above the canvas (wave / phase hint).             |
| `ctx.requestControls` | We are a pointer-first game; we request no on-screen buttons.      |

### `GameInstance` (returned)

- `update(dt)` — advance simulation by `dt` seconds (already frame-scaled).
- `render()` — repaint **the entire background every frame** then the scene.
- `resize?(w,h)` — no persistent pixel state to fix; layout is recomputed each
  frame, so resize is a no-op safety hook.
- `destroy?()` — clear timers / references (none retained globally).

### Hard Constraints

- **Strict TypeScript, no `any`.** All structures are typed.
- Imports only from `@/engine` and files inside `src/games/tower-defense/`.
- **No React, no third-party libraries, no asset files.** All art is procedural.
- Do **not** edit shared files (`engine/*`, `shell/*`, manifest).
- Pointer (mouse + single touch/tap) controls; keyboard shortcuts are optional
  conveniences, never required.

---

## 3. Coordinate System & Layout

The simulation runs in an abstract **grid space** that is independent of the
screen. This makes resizing and arbitrary aspect ratios trivial: only the
*rendering transform* changes, never the simulation.

- A map is a `COLS x ROWS` grid (default `16 x 11`).
- All positions (enemies, towers, projectiles, ranges, speeds) are expressed in
  **grid units** (1 unit = 1 tile).
- Each frame we compute a **viewport**:
  - `topH` = reserved HUD strip at the top (gold / lives / wave / controls).
  - `botH` = reserved shop strip at the bottom (tower buttons / selection panel).
  - `play` = the rectangle between them.
  - `cell = min(play.w / COLS, play.h / ROWS)` — uniform square tiles.
  - `ox, oy` center the grid inside `play` (letterboxed on the off-axis).
- Helpers: `gridToScreen(gx,gy)`, `screenToGrid(sx,sy)`, and `cell` for sizing.

Because everything is recomputed from `ctx.width/ctx.height` each frame, the game
is correct at any size, including mid-game window resizes and mobile rotation.

### HUD regions

- **Top bar:** Gold (coin icon + amount), Lives (heart + count), Wave (n / total),
  Score, Speed toggle (1x / 2x), Pause. Right-aligned mute is handled by the shell.
- **Bottom bar:** When nothing is selected → the **shop**: four tower buttons
  showing icon, name and cost (greyed if unaffordable). When a built tower is
  selected → the **inspector**: stats, Upgrade (cost) and Sell (refund) buttons.
  A persistent **Next Wave** button appears during the build phase.

---

## 4. Game States (FSM)

```
            ┌─────────────┐
            │   MENU       │  title + map select + best score + Play
            └──────┬───────┘
                   │ Play
            ┌──────▼───────┐
            │   PLAYING     │  build phase + combat phase interleaved
            └──┬───────┬────┘
       pause   │       │  lives==0 -> LOSE ; all waves cleared -> WIN
          ┌────▼──┐ ┌──▼─────────┐
          │ PAUSED│ │  GAMEOVER  │  win/lose screen, score, Retry / Menu
          └───────┘ └────────────┘
```

- **MENU** — animated background (drifting monsters, parallax), title, map
  carousel (3 maps with mini path previews), best-score readout, big *Play*.
- **PLAYING** — the core loop. Composed of two interleaving phases:
  - *Build phase*: no enemies pending; player places/upgrades towers; a
    countdown auto-starts the next wave, or the player calls it early for a bonus.
  - *Combat phase*: enemies stream in along the path; towers fire automatically.
- **PAUSED** — dim overlay, Resume / Restart / Menu. Simulation frozen.
- **GAMEOVER** — win or lose banner, final score + best, Retry / Menu buttons.

---

## 5. Maps

Three hand-designed maps, all on the same grid dimensions for consistent tower
sizing, but with distinct path shapes and buildable footprints. Each path is a
list of grid waypoints; the segment between consecutive waypoints is rasterised
into a set of **road tiles** (non-buildable). Everything else is grass and
buildable, except a few scattered **decorations** (rocks/trees) that block
building to create choke points.

| Map           | Theme          | Path shape                         | Difficulty |
| ------------- | -------------- | ---------------------------------- | ---------- |
| Greenway      | Spring meadow  | Single S-curve, generous build land| Easy       |
| Crossfork     | Autumn fields  | Long double switchback             | Medium     |
| Serpent's Run | Volcanic basin | Tight winding spiral, few choke pts| Hard       |

- Enemies enter at the path's first waypoint (off-screen) and exit at the last
  (the **Keep**). Leaking an enemy at the Keep costs lives equal to the enemy's
  *leak* value (1 for most, more for bosses).
- The Keep is drawn at the exit; it pulses and flashes red when damaged.
- The rift/portal is drawn at the entrance; it glows and emits particles when
  spawning.

Maps are selectable from the menu and the last choice is persisted.

---

## 6. Path & Movement Model

- A path = ordered `Vec[]` of waypoints in grid coordinates (tile centers,
  including one off-screen point at each end).
- Precompute cumulative segment lengths → total path length `L` (grid units).
- Each enemy stores `dist` (grid units traveled). Its position is obtained by
  walking the segment list. `progress = dist / L` (used for "leading" target
  selection and for the leak check `dist >= L`).
- Speed is in grid-units/second, modified by slow effects.
- Flying enemies follow the same waypoints but are drawn with a hover bob and a
  shadow; they ignore decorations visually (still on the road for simplicity).

---

## 7. Enemies

All enemies share a base shape language (rounded bodies, eyes, simple limbs)
recolored and resized per type, drawn 100% procedurally.

| Type       | Role           | HP*  | Speed | Armor | Flying | Leak | Bounty | Notes                              |
| ---------- | -------------- | ---- | ----- | ----- | ------ | ---- | ------ | ---------------------------------- |
| Grub       | basic          | 60   | 1.6   | 0     | no     | 1    | 6      | The bread-and-butter chaff.        |
| Sprinter   | fast           | 40   | 3.1   | 0     | no     | 1    | 5      | Rushes; punishes gaps in coverage. |
| Brute      | armored        | 240  | 1.0   | 45%   | no     | 1    | 14     | Shrugs off physical damage.        |
| Wisp       | flying         | 75   | 2.3   | 0     | yes    | 1    | 8      | Cannons cannot hit it.             |
| Swarmling  | swarm          | 18   | 2.4   | 0     | no     | 1    | 2      | Spawned in big clusters.           |
| Warden     | mini-boss      | 1400 | 0.9   | 30%   | no     | 4    | 70     | Wave 15 centerpiece.               |
| Rift Titan | boss           | 4200 | 0.8   | 35%   | no     | 8    | 150    | Final boss, wave 20.               |

\* Base HP at wave 1; scaled up each wave by a growth multiplier (see Balance).

### Status effects

- **Slow** — multiplies speed by `(1 - slowPct)` for a duration. Re-applying
  refreshes duration and keeps the strongest slow. Visualised by a frosty tint
  and slower limb animation.
- **Armor** — flat percentage reduction applied to **physical** damage only.
  Magic damage ignores armor entirely; this is the strategic counter to Brutes.

### Death & leak

- On death: bounty added to gold, kill particles, coin sound, score += kill value.
- On leak: lives -= leak value, Keep flash + low sound, enemy removed.

---

## 8. Towers

Four archetypes, each with **three levels** (build + two upgrades). Towers are
placed on buildable grass tiles by tapping a valid spot after choosing a tower in
the shop (or tapping the spot first → contextual build menu — see UX). A tile can
hold one tower. Built towers can be selected to upgrade or sell.

| Tower    | Icon | Role                 | Dmg type | Hits flying | Special                       |
| -------- | ---- | -------------------- | -------- | ----------- | ----------------------------- |
| Archer   | ➶    | fast single target   | Physical | yes         | Lvl3 fires a double volley    |
| Cannon   | ◎    | slow splash          | Physical | **no**      | AoE splash damage on impact   |
| Frost    | ❄    | control              | Physical | yes         | Slows; Lvl3 brief AoE chill   |
| Arcane   | ✦    | anti-armor / flying  | Magic    | yes         | Ignores armor; Lvl3 chains    |

### Per-level stats (base)

**Archer** — cheap, high rate of fire, low per-hit damage.
- L1: cost 70, range 3.0, dmg 13, fireRate 1.7/s
- L2: +60, range 3.4, dmg 24, fireRate 2.1/s
- L3: +110, range 3.8, dmg 40, fireRate 2.5/s, **double shot**

**Cannon** — slow, heavy, splash; cannot target flyers.
- L1: cost 120, range 2.7, dmg 42, fireRate 0.55/s, splash 1.1
- L2: +110, range 2.9, dmg 70, fireRate 0.6/s, splash 1.3
- L3: +180, range 3.1, dmg 115, fireRate 0.7/s, splash 1.6

**Frost** — control tower; modest damage, strong slow.
- L1: cost 90, range 2.6, dmg 6, fireRate 1.0/s, slow 40% / 1.4s
- L2: +80, range 2.8, dmg 10, fireRate 1.2/s, slow 50% / 1.6s
- L3: +150, range 3.0, dmg 16, fireRate 1.3/s, slow 60% / 1.8s, **AoE chill**

**Arcane** — magic damage ignores armor, hits everything.
- L1: cost 140, range 3.0, dmg 30, fireRate 0.9/s
- L2: +130, range 3.2, dmg 52, fireRate 1.0/s
- L3: +210, range 3.4, dmg 84, fireRate 1.1/s, **chains to 2 extra targets**

### Targeting

Each tower acquires the **enemy furthest along the path** within range ("first"),
a strong default for protecting the Keep. Cannons exclude flyers. Frost prefers
the furthest *unslowed* enemy when possible. Towers fire when their cooldown is
ready and a valid target exists, spawning a projectile (or instant bolt for
Arcane chains).

### Economy of towers

- **Build cost** as above.
- **Upgrade cost** as above (added to invested total).
- **Sell** refunds `round(0.7 * totalInvested)`.
- Range preview ring shows while placing or when a tower is selected.

---

## 9. Projectiles & Combat Resolution

- **Arrow** (Archer): fast small bolt homing to the target's current position;
  on arrival deals single-target physical damage. Hit spark particles.
- **Shell** (Cannon): arcs to the target's ground position; on impact deals
  splash physical damage to all ground enemies within `splash` radius, plus an
  explosion particle burst and screen shake.
- **Shard** (Frost): light projectile; on hit deals small physical damage and
  applies slow to the target (L3 also chills nearby enemies).
- **Bolt** (Arcane): quick magical orb; on hit deals magic damage ignoring armor.
  At L3 it chains to up to two additional nearby enemies for reduced damage,
  drawn as crackling links.

Damage application: `final = isMagic ? raw : raw * (1 - armor)`. Floating damage
numbers rise and fade. Killing blows trigger a bounty coin popup.

---

## 10. Waves

- A run is **20 waves**. Clearing wave 20 = **victory**.
- A `Wave` is a list of **spawn groups**: `{ type, count, spacing, delay }`.
  Groups can overlap (different `delay`) to create mixed pushes.
- HP/bounty scale per wave via a growth multiplier so late waves stay threatening
  without redesigning each enemy.
- **Boss cadence:** Wave 10 introduces a Warden alongside support; Wave 15 a
  tougher Warden pair; Wave 20 the Rift Titan finale. (Tunable in `waves.ts`.)
- Composition arc: early waves teach single types; mid waves mix fast + armored;
  later waves add flyers (forcing anti-air) and swarms (forcing splash).
- The wave is **complete** when all groups have finished spawning and no enemies
  remain on the field. Then the build phase resumes with a short countdown.

### Call Wave Early

During the build-phase countdown a **Next Wave** button lets the player launch
the next wave immediately, granting a small **gold bonus** that scales with the
remaining countdown — rewarding aggressive, efficient play.

---

## 11. Economy & Scoring

- **Starting gold:** 200 (tunable per map difficulty).
- **Starting lives:** 20.
- **Income:** enemy bounties on kill; small wave-clear bonus; early-call bonus.
- **Spending:** building, upgrading. Selling refunds 70% of invested gold.
- **Score** (reported live): `wavesCleared * 100 + kills * 2 + livesRemaining * 5`
  at end; during play we report `wavesCleared * 100 + kills * 2`.
- **Best score** persisted via `ctx.storage`; shown on menu + game over.
- `ctx.gameOver(finalScore)` is called exactly once on win or loss.

---

## 12. Controls & UX

**Primary (pointer / touch):**
- Tap a **shop tower** to enter *placement mode*; valid tiles highlight green,
  invalid red; tap a valid tile to build; tap elsewhere / the tower again to
  cancel. Range preview follows the cursor.
- Tap a **built tower** to select it → inspector with Upgrade / Sell.
- Tap empty grass with nothing selected → deselect.
- Tap HUD buttons: Speed (1x/2x), Pause, Next Wave.
- Menu & game-over screens are fully tap-navigable.

**Keyboard (optional accelerators):**
- `1..4` select tower types, `U` upgrade, `S` sell, `Space` start/next wave,
  `P` pause, `Esc` cancel/deselect. None are required to play.

**Touch niceties:** larger hit padding on touch; concise status hints; no reliance
on hover.

---

## 13. Visual Design (procedural)

- **Palette:** per-map grass/road/accent colors + shared UI palette (warm gold,
  parchment panels, deep ink text). High contrast for readability.
- **Tiles:** subtle checker on grass, dirt road with edge banding and a dashed
  center guide showing travel direction; decorations as rocks/trees.
- **Towers:** distinct silhouettes — Archer (slim turret + bow arc), Cannon
  (squat barrel), Frost (crystal spire), Arcane (floating rune orb). Level shown
  via size, color richness, and small pip indicators. Firing animations
  (recoil / glow pulse).
- **Enemies:** rounded bodies with eyes and animated legs/wings; armored types
  show plating; bosses are large with a segmented health bar.
- **Health bars:** thin bar above each damaged enemy; bosses get a big top bar.
- **FX:** muzzle flashes, hit sparks, explosion rings, frost shatter, coin pops,
  floating damage numbers, Keep damage flash, rift spawn glow, screen shake on
  big impacts.
- **HUD:** rounded panels, coin/heart icons drawn procedurally, affordability
  greying, selection glow, countdown ring on Next Wave.

---

## 14. Audio (procedural via AudioManager)

| Event              | Sound                                  |
| ------------------ | -------------------------------------- |
| Place tower        | `coin`-ish confirm (`tone` chord)      |
| Upgrade            | rising `sweep`                         |
| Sell               | descending `tone`                      |
| Archer shot        | short high `tone`                      |
| Cannon shot/impact | `tone` + `explosion`/`noise`           |
| Frost shot         | airy `sweep`                           |
| Arcane shot        | bell-ish `tone`                        |
| Enemy hit          | soft `tone`/`noise` (rate-limited)     |
| Enemy death        | `coin` (bounty)                        |
| Leak / Keep hit    | low `tone` + `noise`                   |
| Wave start         | `blip` fanfare                         |
| Boss spawn         | descending `sweep`                     |
| Win                | `win`                                  |
| Lose               | `lose`                                 |

SFX are **rate-limited** (e.g. cap hit sounds per frame) to avoid audio spam when
many enemies are on screen.

---

## 15. Performance

- Target 60 FPS with ~120 enemies + ~80 projectiles + particles.
- Flat arrays, index loops in hot paths; objects pooled where cheap (particles
  filtered by life). No per-frame allocations in tight loops beyond necessities.
- Spatial queries are linear scans (counts are modest); range checks use squared
  distances. Capped particle count.
- Single full-canvas repaint per frame; gradients/shapes only (no shadowblur in
  hot loops; used sparingly for glows).

---

## 16. Persistence

`ctx.storage` keys:
- `best` — best score (number).
- `lastMap` — last selected map index.
- `seenTutorial` — whether the first-time hint was shown.

---

## 17. File Structure

```
src/games/tower-defense/
  PRD.md         this document
  index.ts       create(): orchestration, FSM, HUD, input, screens, loop
  types.ts       shared interfaces & enums (no logic)
  config.ts      theme/palette + tower & enemy definitions + balance constants
  maps.ts        3 map definitions + path rasterisation helpers
  waves.ts       wave generation (groups, scaling, boss cadence)
  particles.ts   particle + floating-text system
  render.ts      procedural drawing helpers (towers, enemies, fx, icons, panels)
```

Splitting keeps each file focused; `index.ts` wires them together via a single
`Game` controller object holding all mutable state.

---

## 18. Acceptance Criteria

1. `create(ctx)` returns a working `GameInstance`; no crashes on resize.
2. Menu lets the player pick from **3 maps** and start.
3. At least **4 distinct tower types** with different damage/range/rate/effects,
   each **upgradeable** (2 levels) and **sellable** with refund.
4. **Gold economy** from kills; affordability enforced; sell refunds.
5. **Escalating waves** with multiple enemy types incl. **fast, armored, flying,
   swarm** and **boss** waves; win on clearing all waves.
6. **Lives** drop on leaks; **lose** at 0 lives.
7. Clear **HUD** (gold, lives, wave, score), **range previews**, **projectiles**,
   **hit particles**, **health bars**, **juicy SFX**.
8. **Start** and **game-over** screens; **best score persisted**.
9. Live `reportScore`; single `gameOver(score)`.
10. Works with **mouse and touch (tap)**; adapts to any size / aspect.
11. Strict TS, no `any`, no external assets, only `@/engine` + own folder.

---

## 19. Stretch / Future (not required)

- Difficulty modifiers (endless mode after wave 20).
- Tower targeting modes (first/last/strongest/closest) toggle.
- More maps and enemy abilities (healers, shielded, splitters).
- Combo / streak scoring multipliers.

---

*End of PRD.*
