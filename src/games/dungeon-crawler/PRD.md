# Dungeon Crawler — "CRYPT OF THE CINDER KING"

A complete, original, top-down roguelite dungeon shooter for the CoolHastorGames
TypeScript + Vite portal. Inspired by the _twin-stick room-clearing_ genre
(The Binding of Isaac, Enter the Gungeon) but with an entirely original design,
procedurally generated visuals, and 100% custom code. **No external assets** —
every tile, enemy, projectile, particle and UI element is drawn procedurally on
a `<canvas>` using the engine's 2D context.

- **Game id / folder:** `dungeon-crawler` (`src/games/dungeon-crawler/`)
- **Entry:** `index.ts` exporting `create(ctx: GameContext): GameInstance`
- **Score:** `floors * 100 + kills * 10` (reported live; final on death)
- **Persistence:** best depth (deepest floor) + best score via `ctx.storage`

---

## 1. Vision & Pillars

> _Descend through a procedurally generated crypt, clearing locked rooms full of
> monsters, collecting coins and power-ups, and slaying a boss on every floor to
> dig deeper. Each run is short, punchy, and different._

**Design pillars**

1. **Readable chaos.** Tiles, enemies, the player, and bullets must be instantly
   distinguishable at any screen size, including small mobile screens. Strong
   silhouettes, high-contrast palette, and clear "friend vs foe" projectile
   colors.
2. **Juicy feedback.** Every meaningful event (shot, hit, kill, pickup, door
   unlock, floor descent) has audio + visual feedback: hit flashes, damage
   numbers, particles, and screen shake — tuned to feel good, not nauseating.
3. **Fair difficulty curve.** Floor 1 teaches; difficulty scales by enemy count,
   HP, speed, and fire rate per floor. Death is always the player's fault.
4. **Meaningful build variety.** Item upgrades stack and combine (more damage,
   faster fire, multi-shot, piercing, speed) so runs feel distinct.
5. **Runs anywhere.** Desktop keyboard/mouse AND touch (twin virtual sticks +
   d-pad fallback). Resolution-independent; re-reads `ctx.width/height` every
   frame; handles any aspect ratio and live resizes.

---

## 2. Platform & Engine Constraints

- Strict TypeScript, **no `any`**, no React, no third-party libraries.
- Imports only from `@/engine` and files within `src/games/dungeon-crawler/`.
- Canvas-only procedural visuals — **no image/audio asset files**.
- Must NOT modify shared files (`engine/*`, `shell/*`, registry manifest).
- Use the provided context surface:
  - `ctx.ctx` — DPR-scaled 2D context; draw in CSS pixels.
  - `ctx.width` / `ctx.height` — **getters**, re-read every frame.
  - `ctx.input` — `isDown/pressed/released`, `pointer{x,y,down,justDown,justUp}`,
    `pointers` (multi-touch `Map<number,{x,y}>`).
  - `ctx.audio` — procedural synth (`tone/sweep/noise` + convenience sfx).
  - `ctx.storage` — namespaced persistence (`get/set/submitScore`).
  - `ctx.reportScore(n)`, `ctx.gameOver(finalScore?)`, `ctx.setStatus(text)`.
  - `ctx.requestControls([...])` — d-pad + buttons on touch.
- `GameInstance`: `update(dt)`, `render()`, optional `resize?`, `destroy?`,
  `onPause?`, `onResume?`. We repaint the full background every frame.

### Touch input note

The shell only renders `dpad` and `button` touch controls (not `stick`). We
therefore request a **d-pad** (movement fallback) + a **PAUSE button**, and
additionally implement our own **on-canvas twin virtual sticks** by reading
`ctx.input.pointers` directly:

- A touch starting on the **left half** of the canvas → **move stick**.
- A touch starting on the **right half** → **aim + fire stick** (fires while
  held, in the dragged direction).

This gives a true twin-stick feel on touch while keeping the d-pad for players
who prefer it.

---

## 3. Coordinate System & Rendering Model

The game uses a **fixed virtual room** that always fits entirely on screen
(no scrolling camera — the whole room is visible, Isaac-style).

- **Room grid:** `COLS = 15`, `ROWS = 9` tiles. A 1-tile-thick wall border lines
  the room; the playable interior is the inner `13 x 7` region.
- **World units:** positions are stored in *tile units* (`x ∈ [0, 15]`,
  `y ∈ [0, 9]`), independent of pixels. Sizes (radii, speeds) are in tile units.
- **Screen transform** (recomputed each frame from live `width/height`):
  - Reserve a top **HUD band** (hearts/coins/floor) and account for the bottom
    touch controls naturally (they live outside the canvas).
  - `scale = min(width / COLS, (height - hudH) / ROWS)` then center → letterbox.
  - `toScreen(x,y) = (originX + x*scale, originY + y*scale)`.
- Because the room always fits, the layout adapts to any aspect ratio: tall
  screens get vertical letterbox bars (used for decorative crypt background),
  wide screens get horizontal bars.

Speeds (units/sec, scaled by `scale` at draw time):

| Thing                | Speed (units/s)         |
| -------------------- | ----------------------- |
| Player base          | 6.0 (+ speed upgrades)  |
| Player tear/bullet   | 13.0 (+ small upgrades) |
| Chaser               | 3.0 → scales per floor  |
| Shooter              | 2.0 (strafes)           |
| Splitter (big/small) | 2.6 / 3.6               |
| Enemy bullet         | 5.5 → scales per floor  |

---

## 4. Game Flow / State Machine

```
TITLE ──start──▶ PLAYING ──death──▶ GAME OVER (ctx.gameOver)
   ▲               │  ▲   │
   │            pause │   │ descend (boss dead → trapdoor)
   └──────────────────┘   └────────────▶ next FLOOR (regen rooms)
```

States:

- **TITLE** — animated splash, best depth, controls summary, "Press / Tap to
  start". Audio context unlocks on first input.
- **PLAYING** — normal loop; sub-state is the active room + whether it's locked.
- **PAUSED** — overlay; world frozen; `P`/`Esc`/PAUSE button toggles.
- **DESCENDING** — short transition wipe between floors.
- **GAME OVER** — brief death freeze + flash, then `ctx.gameOver(score)`.

We also keep a **floor-cleared / descend** affordance: after the boss dies a
glowing trapdoor appears in the boss room; stepping on it descends.

---

## 5. Procedural Floor Generation

Each floor is a connected graph of rooms on a sparse grid.

**Algorithm (random-walk + budget):**

1. Use a seeded RNG (`mulberry32(hashString(seed))`) where
   `seed = baseSeed + floor` so each floor is deterministic given the run seed,
   but the run seed itself is random per play.
2. Place `START` at the center of a `9 x 9` room grid.
3. Grow via randomized flood/queue: repeatedly pick an existing room, pick a
   random free orthogonal neighbor, add it; continue until a **room budget** is
   reached. Budget scales with depth: `roomCount = 6 + floor` (clamped 6..16).
4. Connect each new room to the existing neighbor it grew from (bidirectional
   door). Optionally add a few extra connections for loops (small chance).
5. Compute distances (BFS) from START.
6. **Special room assignment:**
   - `BOSS` — the room with the greatest distance from START (a dead-end if
     possible). Its single connecting door is a **boss door** (skull mark).
   - `TREASURE` — a dead-end room (1 door) not adjacent to start when possible;
     contains an item pedestal. Door is gold.
   - `SHOP` — another dead-end if available; sells 1–3 pickups for coins.
   - Remaining rooms are `COMBAT` (or occasionally empty).
   - `START` is always pre-cleared and safe.
7. Each combat/boss room gets a **spawn table** rolled from depth + RNG.

**Room contents:**

- **Obstacles:** 0–6 procedural blocks ("rubble" / "rock") placed symmetrically
  in the interior. Blocks stop the player and destroy non-piercing player
  bullets; enemies path around them with simple steering. Never block doorways.
- **Decoration:** floor tile variation (checkerboard + speckle), torch sconces by
  doors, cracks — all procedural, cosmetic only.

**Room data model:**

```ts
interface RoomDef {
  gx: number; gy: number;            // grid coords
  type: RoomType;                    // start | combat | treasure | shop | boss
  doors: Record<Dir, boolean>;       // N/E/S/W connections
  cleared: boolean;                  // enemies defeated (start/treasure pre-cleared)
  visited: boolean;                  // for minimap
  obstacles: GridCell[];             // blocked interior tiles
  spawns: SpawnSpec[];               // enemies to create on first entry
  pickups: Pickup[];                 // items/coins/hearts dropped or placed
  dist: number;                      // BFS distance from start
}
```

---

## 6. Rooms, Doors & Locking

- The player enters a room through a door; the camera shows the whole room.
- **Locking:** entering an uncleared combat/boss room spawns its enemies and
  **slams all doors shut** (visual bars + thud sfx). Doors stay locked until all
  enemies are dead, then **unlock** with a chime + small shake.
- Cleared rooms stay cleared on return (enemies don't respawn that floor).
- **Transitions:** walking into an open doorway moves the player to the adjacent
  room; the player re-appears at the opposite door of the new room with a brief
  ease-in slide. The active room reference switches; minimap updates `visited`.
- Treasure/shop/start rooms are never locked.
- **Boss room:** locked; on clear, spawns a trapdoor to descend + an item drop.

---

## 7. The Player

- **Shape:** an original hooded "spelunker" — a rounded body with a glowing
  lantern, a directional facing, and a little bob animation. Flashes white when
  hit, blinks during invulnerability.
- **Movement:** 8-directional, WASD/Arrows/d-pad/left stick; acceleration with
  light friction for responsiveness. Collides with walls & obstacles (circle vs
  tile AABB resolution, axis-separated).
- **Shooting:**
  - **Desktop:** Arrow keys fire in 4 directions (classic), OR hold the mouse and
    fire toward the pointer. Mouse aim takes priority when the pointer is down.
  - **Touch:** right virtual stick aims & fires continuously.
  - Fire is **cooldown-gated** (fire rate stat). Each shot spawns `shotCount`
    projectiles in a small spread.
- **Projectiles ("sparks"):** travel a max **range**, then fizzle (shrink/fade).
  Carry `damage`, `piercing`, `knockback`. Player bullets are cyan/white; enemy
  bullets are warm red/orange — never ambiguous.

### Player stats (upgradeable)

| Stat         | Base   | Effect                                        |
| ------------ | ------ | --------------------------------------------- |
| `maxHp`      | 6 (½s) | Heart containers; shown as ♥ (½-heart steps)  |
| `damage`     | 3      | Per-projectile damage                         |
| `fireDelay`  | 0.42 s | Time between shots (lower = faster)           |
| `moveSpeed`  | 6.0    | Units/sec                                     |
| `shotCount`  | 1      | Projectiles per shot (spread)                 |
| `piercing`   | 0      | Extra enemies a shot pierces                  |
| `shotSpeed`  | 13.0   | Projectile speed                              |
| `range`      | 2.4 s  | Projectile lifetime                           |
| `luck`       | 0      | Slightly better drops                         |

- **Health:** measured in **half-hearts**. Contact with an enemy or enemy bullet
  costs **1 half-heart** and grants ~1.0 s invulnerability (blinking). At 0 →
  death.
- **Coins:** currency for shops; also count toward flavor, not score.

---

## 8. Enemies & AI

All enemies share: position (units), radius, HP, contact damage, hit flash,
knockback, death burst. Behaviors are intentionally simple but distinct.

1. **Crawler (Chaser)** — walks straight toward the player at a steady pace;
   pure contact threat. Cheap, spawned in numbers. Color: sickly green.
2. **Spitter (Shooter)** — keeps a preferred distance (strafes to maintain it)
   and fires aimed projectiles on a timer; flees if the player closes in.
   Color: violet with a glowing eye.
3. **Blob (Splitter)** — bouncy, semi-random drift toward the player; on death a
   **big** blob splits into two **small** blobs (small ones don't split).
   Contact threat. Color: amber/orange.
4. **Floater (bonus type, deeper floors)** — drifts in a sine path, ignores
   obstacles, occasionally fires a slow radial 3-shot. Color: pale blue ghost.

**Boss — "The Cinder King" (one per floor, escalating):**

- Large multi-phase enemy with a visible HP bar.
- **Phase A (>50% HP):** slow pursuit + periodic **radial bullet ring** (8–12
  bullets) and aimed 3-shot bursts.
- **Phase B (≤50% HP):** faster; adds a **charge dash** toward the player
  (telegraphed by a wind-up flash) and a **spiral** bullet pattern.
- On low HP, spawns 1–2 Crawler "minions" occasionally.
- Death: big explosion, screen shake, slow-mo flash, guaranteed item drop +
  trapdoor.
- Stats scale with floor (HP, bullet count, speed).

**Difficulty scaling (per floor `f`, 1-indexed):**

- Enemy HP ×`(1 + 0.18*(f-1))`, contact damage stays 1 half-heart.
- Enemy speed ×`(1 + 0.05*(f-1))` (capped).
- Enemy bullet speed +`0.25*(f-1)`.
- Spawn count per combat room: `2 + floor/2` (rolled, capped).
- Spitter fire rate increases slightly with depth.

**Steering / collision:** enemies use direct seek/strafe vectors with simple
obstacle avoidance (push out of blocked tiles + small perpendicular nudge).
Enemy–enemy soft separation prevents stacking. No expensive pathfinding.

---

## 9. Items, Pickups & Upgrades

**Floor pickups (drop or placed):**

- **Heart** (♥) — heals 1 full heart (2 half). Small chance from kills/rooms.
- **Half-heart** — heals 1 half.
- **Coin** — +1 coin (shops). Common drop.
- **Bomb-flash / nova** _(optional flavor pickup)_ — clears nearby bullets (kept
  minimal; may be cut if it harms clarity).

**Item upgrades (pedestals in treasure rooms / boss drops / shops):** picking one
applies a permanent stat change for the run and shows a name + flavor toast.

| Item                | Effect                                              |
| ------------------- | --------------------------------------------------- |
| **Ember Shard**     | +1 damage                                           |
| **Quick Fuse**      | −0.07 s fire delay (faster fire)                    |
| **Swift Boots**     | +0.9 move speed                                     |
| **Split Lens**      | +1 shot count (extra projectile, wider spread)      |
| **Piercing Bolt**   | +1 piercing                                         |
| **Long Wick**       | +0.6 s range, +1.5 shot speed                       |
| **Heart Locket**    | +1 heart container (and full heal)                  |
| **Lucky Coin**      | +1 luck (better drops) + a few coins                |
| **Twin Sparks**     | +1 shot count, −0.03 fire delay (rare/boss)         |
| **Glass Cannon**    | +3 damage, −1 heart container (risky, rare)         |

- **Treasure room:** one random pedestal item (free to take).
- **Boss drop:** one random (weighted toward stronger) item + heart.
- **Shop:** 1–3 items/pickups with coin costs shown; walk over while holding
  enough coins to buy (auto-deducts), or a buy prompt.

Items never duplicate within a single pickup choice where avoidable; stacking the
same item across the run is allowed and intended.

---

## 10. Scoring & Persistence

- **Live score:** `floors_completed * 100 + kills * 10`, pushed via
  `ctx.reportScore` whenever it changes.
- **Floor bonus:** descending increments `floorsCompleted`.
- **On death:** `ctx.gameOver(score)`.
- **Persistence (`ctx.storage`):**
  - `best.depth` — deepest floor reached.
  - `best.score` — via `storage.submitScore(score)` (also notifies leaderboard
    sink).
  - `best.kills` — optional flavor stat.
- Best depth/score shown on the TITLE screen and the pause overlay.

---

## 11. HUD & UI

Drawn each frame on canvas (CSS pixels), scaled to screen size:

- **Hearts** (top-left): row of ♥ rendered as full/half/empty containers.
- **Coins** (top-left, under hearts): coin icon + count.
- **Floor** (top-center): `FLOOR n` + small depth pips.
- **Score** (top-right): live score with `scoreLabel`.
- **Minimap** (top-right corner / under score): compact grid of discovered rooms;
  current room pulses; cleared vs uncleared shading; icons for boss (skull),
  treasure (star/gem), shop (coin). Only visited + adjacent rooms shown.
- **Active item toast:** transient banner naming the last item taken.
- **Damage numbers:** floating, color-coded (white for player hits, red when the
  player is hurt), rise + fade.
- **Pause overlay:** dim, title, stats, "Resume / Restart" hints.
- **Title & death screens:** procedural crypt backdrop + animated logo.

All UI sizes derive from `min(width,height)` so they read well on phones.

---

## 12. Audio (procedural via `ctx.audio`)

- **Shoot:** short square `tone` (pitch varies slightly per shot).
- **Enemy shoot:** lower sawtooth blip.
- **Hit enemy:** soft noise tick + pitch.
- **Player hurt:** descending sweep + noise; distinct and noticeable.
- **Kill / split:** small explosion noise.
- **Pickup coin/heart:** the engine `coin()` / bright tones.
- **Item taken:** rising arpeggio (`win()`-like).
- **Door lock:** low thud; **unlock:** bright chime.
- **Boss intro:** ominous sweep; **boss death:** big explosion + arpeggio.
- **Descend:** whoosh sweep.
- Respect global mute (handled by `AudioManager`); never spam (cooldown gates on
  repetitive sfx).

---

## 13. Feel / "Juice"

- **Screen shake:** magnitude pooled & decaying; triggered by player hurt, boss
  hits, explosions, big kills, door slams. Capped so it never obscures play.
- **Hit flash:** entities tint white briefly when damaged.
- **Particles:** muzzle sparks, bullet impacts, blood/goo bursts, coin sparkles,
  dust on dash/descent, torch embers.
- **Damage numbers:** see HUD.
- **Bullet trails / glow:** subtle additive glow on projectiles.
- **Slight slow-mo** on boss death (a few frames of reduced `dt`).
- **Door/descend transitions:** quick wipe.

---

## 14. Performance

- Target 60 fps on mid-range mobile.
- Single canvas; no per-frame allocations in hot loops where avoidable
  (reuse arrays, filter in place, avoid closures in inner loops).
- Particle/bullet caps (hard limits with oldest-culling) to bound work.
- Only the **current room** is simulated; other rooms are static data.
- Avoid shadowBlur in the hottest loops (use cheap radial gradients sparingly).
- `dt` clamped (e.g. ≤ 0.05 s) to avoid tunneling after tab stalls.

---

## 15. Controls Summary

**Desktop**

- Move: `WASD` / Arrow keys (when arrows are used to *shoot*, WASD moves).
- Shoot: Arrow keys (4-way) **or** hold left mouse to fire toward cursor.
- Pause: `P` / `Esc`. Start / confirm: `Space` / `Enter` / click.

**Touch**

- Move: left half drag (virtual stick) or on-screen d-pad.
- Shoot: right half drag (virtual stick) — fires while held in that direction.
- Pause: PAUSE button.

We default to: arrows shoot + WASD move on desktop, and twin virtual sticks on
touch. Mouse-aim works any time the pointer is held on the play area (desktop).

---

## 16. File Structure

```
src/games/dungeon-crawler/
  PRD.md          – this document
  config.ts       – constants, palette, tunables, helpers
  types.ts        – shared interfaces / enums
  items.ts        – item definitions + roll tables
  floor.ts        – procedural floor/room generation
  draw.ts         – procedural sprite & UI drawing helpers
  game.ts         – Game class: state, update, render (the bulk)
  index.ts        – create(ctx): GameInstance wrapper + input/controls
```

---

## 17. Acceptance Criteria

- [ ] `create(ctx)` returns a valid `GameInstance`; no crashes on load.
- [ ] Strict TS, no `any`, only `@/engine` + local imports, no asset files.
- [ ] Full background repainted every frame; reads `width/height` live; works on
      any aspect ratio and on live resize (room re-fits, no distortion).
- [ ] Desktop: WASD/arrows move, arrows/mouse shoot; Touch: twin sticks + d-pad.
- [ ] Procedural floor of connected rooms with a working minimap.
- [ ] Rooms lock on entry until cleared; doors visibly open/close; transitions
      between adjacent rooms work in all 4 directions.
- [ ] At least 3 enemy types (chaser, shooter, splitter) with distinct behavior,
      plus a multi-phase boss room per floor.
- [ ] Player hearts/HP; contact + enemy bullets damage; death → `gameOver`.
- [ ] Pickups: hearts, coins, and item upgrades (damage, fire rate, speed, shot
      count, piercing, …) in treasure rooms / after bosses / shops.
- [ ] Descend to deeper, harder floors via trapdoor after boss.
- [ ] Score = floors + kills, reported live; final via `ctx.gameOver`.
- [ ] Best depth persisted across sessions.
- [ ] Polish present: hit flashes, damage numbers, particles, screen shake, full
      HUD (hearts, coins, minimap, floor), pause, juicy sfx.
- [ ] Performant: bounded entities/particles, single-room simulation.

---

## 18. Detailed Tuning Tables

These are the concrete starting values used by the implementation. They are
centralised so balancing is a one-line change.

### 18.1 Player defaults

| Field       | Value  | Notes                                           |
| ----------- | ------ | ----------------------------------------------- |
| `maxHp`     | 6      | 3 hearts (half-heart granularity)               |
| `hp`        | 6      | start full                                      |
| `damage`    | 3      | per projectile                                  |
| `fireDelay` | 0.42 s | min clamp 0.10 s                                |
| `moveSpeed` | 6.0    | tiles/sec (cap on velocity magnitude)           |
| `shotCount` | 1      | spread 0.16 rad between adjacent shots          |
| `piercing`  | 0      | enemies pierced before fizzle                   |
| `shotSpeed` | 13.0   | tiles/sec                                       |
| `range`     | 2.4 s  | projectile lifetime; fades last 0.25 s          |
| `luck`      | 0      | + drop chances                                  |
| `coins`     | 0      | currency                                        |
| radius      | 0.40   | tiles (collision circle)                        |
| invuln      | 1.0 s  | after taking damage (blinks)                    |

### 18.2 Enemy base stats (before per-floor scaling)

| Kind        | HP            | Radius | Contact dmg | Speed (t/s) | Special                          |
| ----------- | ------------- | ------ | ----------- | ----------- | -------------------------------- |
| crawler     | 3             | 0.42   | 1 (½)       | 3.0         | pure seek                        |
| spitter     | 4             | 0.46   | 1 (½)       | 2.4         | strafe @ ~4.2 tiles, aimed shot  |
| blob (big)  | 6             | 0.52   | 1 (½)       | 2.6         | splits into 2 small on death     |
| blob (small)| 3             | 0.34   | 1 (½)       | 3.6         | no split                         |
| floater     | 4             | 0.42   | 1 (½)       | 1.8         | sine path, ignores walls, 3-shot |
| boss        | 58 + 14·floor | 1.30   | 1 (½)       | 1.7 / 2.6   | phases A/B, ring/spiral/dash     |

Per-floor scaling: `HP × (1 + 0.18·(floor-1))` (non-boss), speed
`× min(1.5, 1 + 0.05·(floor-1))`, enemy bullet speed `5.5 + 0.25·(floor-1)`.

### 18.3 Drop / reward chances

| Source                | Result                                                     |
| --------------------- | --------------------------------------------------------- |
| Non-boss kill         | `18% + luck·3%`: 70% coin / 30% half-heart                |
| Combat room cleared   | `45% + luck·5%`: 55% coin / 30% half-heart / 15% heart    |
| Boss defeated         | 1 weighted item + 1 heart + trapdoor (guaranteed)         |
| Treasure room         | 1 free pedestal item                                      |
| Shop                  | 2–3 stalls: items (cost `8+2·floor`), hearts (5), coins   |

---

## 19. Algorithms (reference pseudocode)

### 19.1 Circle-vs-tile collision (player & enemies)

```
resolveCellOverlap(p, r, cell):
  closeX = clamp(p.x, cell.x, cell.x+1)
  closeY = clamp(p.y, cell.y, cell.y+1)
  dx, dy = p - close
  if |d|^2 >= r^2: return p                 # no overlap
  if |d| > 0: push p out along d by (r-|d|) # nearest-edge push
  else:                                      # centre inside cell
    pick smallest of (left,right,top,bottom) penetration, push that axis
```

Walls use axis clamps to the interior `[1, COLS-1]×[1, ROWS-1]`, *except* the
door gap (centre ± 0.9 tiles) on any side whose door is open, which lets the
player slip through and trigger a transition once past the threshold (≤0.55).

### 19.2 Enemy AI (per frame)

```
dir = normalize(player - enemy)
crawler : v = dir · speed
blob    : v = dir · speed + perp(dir) · sin(t·4)·0.6
spitter : keep distance 4.2 (approach / retreat / strafe); timer → aimed shot
floater : v = dir · speed + perp(dir) · sin(t·2.5)·1.4; timer → 3-shot fan
boss    : phase by HP; A = slow seek + radial ring + aimed triple
          B = faster seek + spiral + telegraphed dash (windup 0.55s, dash v=16)
          + minion spawns under 33% HP
post    : integrate, resolve obstacles (except floater), clamp to interior,
          soft-separate from other non-boss enemies, contact-damage check
```

### 19.3 Firing

```
on fire(aim):
  a0 = atan2(aim); face = a0
  for i in 0..shotCount-1:
    a = a0 - spread/2 + step·i
    push bullet at player + dir(a)·r, vel = dir(a)·shotSpeed,
      dmg, pierce, lifetime=range
  spawn muzzle particles + blip sfx; fireT = fireDelay
```

### 19.4 Room lifecycle

```
enter room:
  if cleared: open doors, no spawns
  else if not triggered: trigger; if no spawns → cleared else spawn + lock doors
each frame in combat room:
  if triggered and not cleared and enemies empty → cleared, unlock chime,
    drop reward (boss: slow-mo + item + heart + trapdoor)
walk into open doorway (past threshold) → switch active room, reposition at the
  opposite door, clear transient entities, run enter logic
step on open trapdoor → descend transition → generate floor+1
```

---

## 20. Edge Cases & Robustness

- **Tiny / huge canvas:** all sizes derive from `min(width,height)`; room always
  fits via `scale = min(W/COLS,(H-hud)/ROWS)`. Zero-size canvas → scale 0, draws
  nothing, never throws.
- **Live resize / rotation:** view recomputed every frame from getters; no cached
  pixel state survives a resize.
- **Tab stalls:** `dt` clamped to 0.05 s (also clamped by the shell) → no
  tunnelling.
- **Entity explosions:** bullets/particles hard-capped (`MAX_BULLETS` 600,
  `MAX_PARTICLES` 320) with oldest-culling.
- **Double game-over:** death timer set to a sentinel after firing `gameOver`.
- **Multi-touch loss:** sticks drop pointers that disappear from the map; new
  touches reassign by screen half.
- **Generation degeneracy:** room budget guarantees ≥6 rooms; BFS guarantees the
  boss/treasure/shop are reachable; doorways are always kept clear of obstacles.
- **Pickup over obstacle:** pickups are placed on clear tiles (room centre / drop
  location); shops/treasure rooms have no obstacles.

---

## 21. QA / Manual Test Matrix

| Area            | Check                                                            |
| --------------- | --------------------------------------------------------------- |
| Boot            | Loads to title; "press any key"; best stats shown               |
| Movement        | WASD + arrows (touch) + left stick; collides with walls/rocks   |
| Shooting        | Arrows 4-way; mouse-aim; right stick; spread w/ multi-shot      |
| Locking         | Combat room locks on entry, unlocks on clear (bars + sfx)       |
| Transitions     | All 4 directions; correct re-entry position                     |
| Enemies         | Each type behaves distinctly; splitter splits; spitter aims     |
| Boss            | HP bar; phase change at 50%; dash telegraph; minions; trapdoor  |
| Damage          | Contact + bullets cost ½ heart; invuln blink; death → gameOver  |
| Pickups         | Coin/heart/half-heart heal/credit; item toast + stat change     |
| Shop            | Costs deducted; blocked when broke                              |
| Descend         | Trapdoor → wipe → deeper, harder floor; floorsCompleted++       |
| Score           | `floors·100 + kills·10` live; final on death                    |
| Persistence     | Best depth/score survive reload                                 |
| HUD             | Hearts, coins, floor, score, minimap, toast all legible         |
| Pause           | P/Esc/button freezes + overlay; resumes cleanly                 |
| Resize          | Resize/rotate mid-run keeps room centred + undistorted          |
| Performance     | Stable with many enemies + bullets (caps hold)                  |

---

## 22. Stretch / Optional (only if cheap)

- Bomb/nova clear-screen pickup.
- Curse rooms (spawn enemies but guarantee a reward).
- Per-floor color theming (crypt → caverns → magma).
- Combo/multiplier flair on fast clears.

(These are nice-to-haves; the acceptance criteria above are the contract.)
