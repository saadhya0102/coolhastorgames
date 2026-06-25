# Tank Battle — Product Requirements Document

> An original, top‑down tank skirmish game in the spirit of "couch tank" classics,
> built from scratch for the CoolHastorGames TypeScript + Vite portal.
> All art is procedural (canvas only), all code is original. No external assets,
> no third‑party libraries, no copied content from any real game.

- **Game id:** `tank-battle`
- **Folder:** `src/games/tank-battle/`
- **Entry:** `index.ts` → `export function create(ctx: GameContext): GameInstance`
- **Engine:** `@/engine` only (types, util, random, Input, Audio, Storage)
- **Rendering:** single 2D canvas, repainted in full every frame
- **Author intent:** a tight, juicy, beatable‑but‑challenging arcade brawler

---

## 1. Vision & Pillars

Tank Battle drops the player into a series of small, walled arenas packed with
enemy tanks. The player drives a nimble tank, aims a turret, and fires shells
that **ricochet** off walls. A single hit destroys any tank — including the
player — so positioning, bank shots, and patience matter more than reflexes
alone. Clearing every enemy advances to the next, harder arena.

### Design pillars

1. **One shot, one kill.** Every tank (player included) dies to a single shell or
   mine blast. This makes the whole game about *geometry and threat management*
   rather than health bars. It keeps tension high and rounds short.
2. **Ricochet is the core verb.** Shells bounce a limited number of times. Great
   players line up bank shots around corners; reckless players get killed by
   their own rebounding shell. Walls are a weapon and a hazard.
3. **Readable threats.** Enemy archetypes are color‑coded and behave
   consistently. The player should always be able to look at the board and
   understand who is dangerous and why.
4. **Fair but beatable AI.** Enemies aim with deliberate imperfection, telegraph
   shots, respect cooldowns, and never "wallhack." The player can always out‑think
   them. Difficulty comes from *numbers and composition*, not from cheating.
5. **Juice.** Screen shake, sparks on ricochet, smoke trails, chunky explosions,
   tread marks, muzzle flash, and punchy synth SFX make every action feel good.
6. **Plays everywhere.** Any aspect ratio, any size, desktop + mobile. The arena
   is letterboxed and centered; controls adapt (mouse‑aim on desktop, dpad +
   buttons + auto‑aim on touch).

---

## 2. Platform, Constraints & Engine Contract

### 2.1 Hard constraints

- **Strict TypeScript**, no `any`. All entity shapes are typed interfaces.
- **No React, no external libraries.** Pure DOM `CanvasRenderingContext2D`.
- Import only from `@/engine` and files inside `src/games/tank-battle/`.
- **No asset files.** Tanks, walls, particles, UI — all drawn with canvas paths,
  gradients, and shapes.
- Do **not** edit shared engine files or the games manifest.
- Repaint the full background every frame (no incremental damage to the canvas).

### 2.2 GameContext usage

| Context member        | Usage in Tank Battle                                                |
| --------------------- | ------------------------------------------------------------------- |
| `ctx.ctx`             | The DPR‑scaled 2D context. All drawing in CSS pixels.               |
| `ctx.width/height`    | **Getters** — read at the top of every `update`/`render`. Layout is recomputed each frame so resize/rotate "just works." |
| `ctx.input`           | `isDown`, `pressed`, `released`, and `pointer` (x,y,down,justDown,justUp). |
| `ctx.audio`           | Procedural SFX (tone/sweep/noise + helpers).                        |
| `ctx.storage`         | Persist best score + total kills.                                   |
| `ctx.isTouch`         | Switch turret aiming model + show/hide hints.                       |
| `ctx.reportScore(n)`  | Called live whenever score changes.                                 |
| `ctx.gameOver(n)`     | Called once when the player runs out of lives (final score).        |
| `ctx.setStatus(text)` | Lightweight HUD line above the canvas (controls hint / level).      |
| `ctx.requestControls` | Request a `dpad` + a `FIRE` button + a `MINE` button on touch.      |

### 2.3 Coordinate systems

Two spaces are used, with a clean transform between them:

- **World space (grid units / "tiles").** All gameplay simulation lives here.
  A tile is `1.0` unit wide. Positions, velocities, radii, and speeds are all
  expressed in tile units (e.g. tank speed ≈ `3.2 tiles/sec`). This makes the
  simulation completely **independent of screen resolution and aspect ratio**.
- **Screen space (CSS pixels).** Computed every frame from `ctx.width/height`:

  ```text
  tile  = min((W - pad) / cols, (H - hud - pad) / rows)   // pixels per tile
  ox    = (W - cols*tile) / 2                              // arena left edge
  oy    = hudTop + ( (H - hud) - rows*tile ) / 2           // arena top edge
  sx    = ox + worldX * tile
  sy    = oy + worldY * tile
  ```

  Because the arena is always centered and letterboxed, it never distorts and
  always fits. Pointer input (already in logical/CSS px) is converted *back* to
  world space for turret aim: `worldX = (pointerX - ox) / tile`.

---

## 3. Game World

### 3.1 The arena grid

Each level is a rectangular grid of tiles (`cols × rows`, typically `19 × 13`
to `25 × 17`). Every cell holds one tile type:

| Tile        | Symbol | Solid? | Destructible? | Notes                                            |
| ----------- | :----: | :----: | :-----------: | ------------------------------------------------ |
| `EMPTY`     | `.`    |   no   |      —        | Open floor. Tanks drive, shells fly.             |
| `WALL`      | `#`    |  yes   |      no       | Indestructible steel. Shells ricochet off it.    |
| `BREAKABLE` | `B`    |  yes   |     yes       | Wooden crate. A shell or blast destroys it.      |
| `HOLE`      | `O`    |   no*  |      —        | Pit. Tanks **cannot** drive over it, but shells fly across. (*solid to tanks, transparent to shells.) |

The arena is always bordered by an implicit ring of indestructible `WALL` so
nothing can leave the playfield. Border ricochets are guaranteed.

### 3.2 Tile collision rules

- **Tanks** collide with `WALL`, `BREAKABLE`, and `HOLE` as solid AABBs.
  Movement is resolved axis‑separately (move X, push out of overlapped solids;
  move Y, push out) so tanks slide along walls instead of sticking.
- **Shells** ricochet off `WALL` and `BREAKABLE` (destroying the latter), and
  **pass over** `HOLE`. Ricochet is handled per axis: reflect `vx` when the cell
  ahead horizontally is solid, reflect `vy` when the cell ahead vertically is
  solid; corner hits reflect both. Each reflection consumes one bounce.
- **Mines / explosions** destroy `BREAKABLE` tiles within blast radius.

### 3.3 Level layout philosophy

- Levels 1–N₀ are **hand‑authored** ASCII layouts (see `levels.ts`) with curated
  cover, choke points, and spawn placement that escalate in complexity.
- Beyond the authored set, levels are **procedurally generated** with a seeded
  RNG (`mulberry32`) so they are deterministic per level index and reproducible.
  The generator scatters symmetric wall clusters + breakable cover, guarantees
  connectivity (flood fill from the player spawn reaches every enemy spawn), and
  scales wall density / enemy count / enemy tier with difficulty.

---

## 4. Entities

### 4.1 Tank (shared model for player + enemies)

A tank has a **body** (drives + collides) and a **turret** (rotates freely,
fires shells). Common fields:

```
Tank {
  x, y            // world position (tile units), center
  bodyAngle       // direction the hull faces (radians); eases toward move dir
  turretAngle     // direction the barrel points (radians)
  vx, vy          // current velocity (tiles/sec)
  radius          // collision + draw radius (≈ 0.36 tiles)
  alive           // false once destroyed
  isPlayer        // distinguishes player from enemies
  archetype       // enemy behavior preset (null for player)
  color palette   // hull / turret / accent colors
  fireCooldown    // seconds until next shot allowed
  activeShells    // count of this tank's shells currently in flight
  mineCooldown    // seconds until next mine allowed
  // AI scratch:
  aiState, aiTimer, targetAngle, wanderDir, lastSeenPlayer ...
}
```

- **Body vs turret.** The hull eases its facing toward the movement vector for
  natural motion; the turret snaps/eases toward its aim target independently.
- **Treads.** Tanks leave fading tread marks on the floor as they drive (visual
  only) for a sense of speed and history.

### 4.2 Player tank

- Drives with **WASD / arrows / dpad**. Movement is 8‑directional analog‑ish:
  the hull accelerates toward the input vector and decelerates with friction.
- **Turret aim:**
  - **Desktop:** turret eases toward the mouse pointer (converted to world space).
  - **Touch:** turret auto‑aims at the nearest threatening enemy (with a subtle
    lead), or follows the movement direction when no enemy is in a firing lane.
    A right‑stick is intentionally avoided to keep the mobile UI simple.
- **Fire:** `Space` / left‑click / tap the FIRE button. Limited number of the
  player's shells may be in flight at once (default **5**). Short cooldown
  between shots prevents spam.
- **Mines:** `E` / `Shift` / MINE button lays a mine at the tank's position
  (limited active count, e.g. **2**, with cooldown).
- **Death:** one hit kills the player → lose a life. Brief death pause, then
  respawn at the level's player spawn if lives remain; otherwise game over.

### 4.3 Shell

```
Shell {
  x, y            // world position
  vx, vy          // velocity (tiles/sec), constant speed
  bounces         // remaining ricochets
  owner           // the tank that fired it
  ownerGrace      // seconds during which it can't hit its owner
  trail[]         // recent positions for the streak effect
  alive
}
```

- Travels in a straight line until it hits a solid tile, then **ricochets**,
  decrementing `bounces`. When `bounces` runs out and it hits another wall, it
  is destroyed with a small puff.
- **Lethal to any tank** it touches (circle‑circle), including its owner once
  `ownerGrace` elapses (so careless bank shots can kill you — true to the genre).
- **Shell vs shell:** two shells that collide annihilate each other with sparks
  (prevents bullet‑hell stalemates and rewards aggressive counter‑fire).
- Visual: bright core + glowing trail; ricochets emit a **spark burst** and a
  tiny "tink" SFX.

### 4.4 Mine

```
Mine { x, y, owner, fuse, armTimer, alive }
```

- Laid flat on the floor. **Arms** after a short delay (can't instantly chain on
  the layer). Detonates when its fuse expires, when any tank gets close, or when
  a shell/another explosion reaches it.
- Explosion: radial blast that destroys **all** tanks (friend or foe) and
  `BREAKABLE` tiles within radius. Chain‑reacts neighboring mines.
- Visual: blinking light that quickens as the fuse nears zero.

### 4.5 Particles & effects

A single particle pool drives: explosion debris, ricochet sparks, muzzle smoke,
shell trail puffs, mine blast rings, and respawn shimmer. Each particle has
position, velocity, life, size, color, and a kind (spark / smoke / debris /
ring). Treads and scorch marks are a separate fading decal list.

---

## 5. Enemy AI

### 5.1 Archetypes

Each enemy is one archetype, color‑coded, with tuned parameters. Names are
original; behaviors are inspired by the genre but implemented from scratch.

| Archetype     | Color        | Move        | Fire rate | Bounces | Mines | Behavior summary                                                        |
| ------------- | ------------ | ----------- | --------- | :-----: | :---: | ---------------------------------------------------------------------- |
| **Turret**    | Slate brown  | none        | slow      |   1     |  no   | Stationary sniper. Rotates turret to track player, fires careful shots. Cannot move, so it's about angles. |
| **Roamer**    | Ash grey     | slow        | slow      |   1     |  no   | Wanders randomly, pauses, fires when it has a clean line. Filler threat. |
| **Rusher**    | Crimson      | fast        | medium    |   0     |  no   | Charges toward the player, fires direct shots. Aggressive, exposes itself. |
| **Sapper**    | Amber yellow | medium      | low       |   1     |  yes  | Lays mines around the arena and near the player, plus occasional shots. |
| **Phantom**   | Pale white   | very fast   | medium    |   2     |  no   | Erratic, evasive, fires multi‑bounce trick shots. Hard to pin down.    |
| **Warden**    | Teal/green   | medium      | medium    |   2     |  no   | Smart bank‑shooter; prefers ricochet kills, keeps distance, strafes.   |

(Player tank uses a distinct friendly palette — bright blue hull, cream accents
— so it never reads as an enemy.)

### 5.2 AI state machine

Each moving enemy runs a small FSM updated every frame:

- **IDLE / WANDER:** pick a wander direction, drive for a while, avoid walls
  (steer away when a wall is detected ahead via a short raycast), re‑pick on
  timeout or collision.
- **ENGAGE:** when the player is within awareness range, steer according to the
  archetype's `aggression` (rushers close in, wardens maintain a preferred range
  and strafe, sappers reposition while dropping mines).
- **EVADE:** if a shell is heading roughly toward the tank (dot‑product / closing
  test), strafe perpendicular to dodge. Phantoms evade aggressively.

Turret aim runs independently of movement: it eases `turretAngle` toward the aim
solution and only fires when conditions are met.

### 5.3 Aiming — "fair but beatable"

The crux of the difficulty curve. Enemy fire is governed by:

1. **Line of sight.** A grid raycast from turret to player; **direct shots** are
   only attempted when LOS is clear (no solid tile between). This prevents
   enemies from shooting through walls.
2. **Bank‑shot solver (for bouncing archetypes).** Wardens/Phantoms occasionally
   compute a one‑bounce reflection off a nearby wall (mirror the player across a
   candidate wall plane, check LOS to the mirrored point) and fire a ricochet.
   It's intentionally only a *one*‑bounce solver — clever, not omniscient.
3. **Aim error.** A random angular jitter (`aimError`, larger for weaker
   archetypes, smaller for wardens) is added so shots aren't pixel‑perfect.
4. **Lead.** Stronger archetypes lead the player's velocity slightly; weaker ones
   aim at the current position (so circling beats them).
5. **Cooldowns + telegraph.** Every shot respects `fireInterval`. The barrel
   visibly "charges"/flashes just before firing, giving the player a beat to
   move. Enemies also cap their active shells (won't carpet the arena).
6. **Reaction delay.** Enemies take a short time to acquire a newly visible
   target before firing, so peeking a corner doesn't mean instant death.

The net effect: a stationary player gets punished, but a moving player can dodge,
bait shots, and exploit cooldowns. Difficulty scales by **adding more and tougher
tanks**, not by making any single tank unfair.

### 5.4 Difficulty scaling

- Early levels: 1–3 weak enemies (Turret/Roamer), generous cover.
- Mid levels: introduce Rushers and Sappers; tighter mazes.
- Late levels: Wardens + Phantoms in numbers; enemy `fireInterval` shrinks and
  `aimError` tightens slightly per level (bounded so it never becomes unfair).
- Enemy count and composition table lives in `levels.ts` / the generator.

---

## 6. Game Rules & Loop

### 6.1 Objective

Destroy **all** enemy tanks in the arena to clear the level and advance. Survive
with limited lives. The run ends when lives reach zero.

### 6.2 Lives & scoring

- Start with **3 lives** (configurable). Earn a bonus life every few levels
  (e.g. every 5th level cleared), capped.
- **Score** is driven by destroyed tanks and level progress:
  - +points per enemy destroyed, weighted by archetype toughness
    (Turret/Roamer cheap, Warden/Phantom worth more).
  - + level‑clear bonus that grows with depth.
  - Killing yourself with your own ricochet or a mine still costs a life and
    awards no points.
- `ctx.reportScore(score)` is called immediately on every change.
- `ctx.gameOver(score)` is called once when the final life is lost.
- **Best score** + **lifetime kills** persisted via `ctx.storage`.

### 6.3 State machine

```
BOOT ──▶ TITLE ──▶ LEVEL_INTRO ──▶ PLAYING ──┬─▶ LEVEL_CLEAR ──▶ LEVEL_INTRO (next)
                      ▲                       │
                      │                       └─▶ PLAYER_DEAD ─┬─(lives>0)─▶ respawn ▶ PLAYING
                      │                                        └─(lives=0)─▶ GAME_OVER
                      └──────────────── (restart) ◀────────────────────────────┘
```

- **TITLE:** animated demo backdrop, title, best score, "Press Space / Tap to
  start," brief controls legend.
- **LEVEL_INTRO:** short overlay — "LEVEL n", enemy count, a 1.2s countdown, then
  auto‑starts. The arena renders behind it so the player can pre‑plan.
- **PLAYING:** full simulation.
- **LEVEL_CLEAR:** "AREA CLEARED" flourish, brief pause, score bonus tally, then
  next level.
- **PLAYER_DEAD:** dramatic explosion + slowed time, then respawn or game over.
- **GAME_OVER:** final score, best score, total kills, "Play again."

### 6.4 Pause / lifecycle

- `onPause`/`onResume` (if invoked by the host) freeze the simulation cleanly.
- `destroy()` removes any timers and clears state; the engine handles input
  teardown. No global listeners are added by the game.

---

## 7. Controls

### 7.1 Desktop

| Action          | Keys                                  |
| --------------- | ------------------------------------- |
| Move            | `W A S D` or Arrow keys               |
| Aim turret      | Mouse position (turret eases to it)   |
| Fire shell      | `Space` or **Left‑click**             |
| Lay mine        | `E` or `Shift` or **Right‑click**     |
| Start / Restart | `Space` / click on title & game‑over  |
| Mute            | handled globally by the portal        |

### 7.2 Touch / mobile

- `requestControls([{ type: 'dpad' }, { type:'button', key:'Space', label:'FIRE', id:'fire' }, { type:'button', key:'e', label:'MINE', id:'mine' }])`.
- **dpad** drives the hull (8‑way).
- Turret **auto‑aims** at the nearest enemy with a clear line (with light lead),
  falling back to the movement direction. Tapping FIRE shoots along the current
  turret angle.
- Tapping anywhere on the arena also fires toward that point (secondary aim aid),
  while the dpad keeps driving — chosen for thumb‑friendly play.

### 7.3 Aim feel

Turret angle is eased (not snapped) with an angular lerp that takes the shortest
path around the circle, giving a weighty "servo" feel without lag that hurts
responsiveness.

---

## 8. Rendering & Art Direction

Everything is procedural. Target a clean, slightly chunky, modern‑retro look.

### 8.1 Layered frame (drawn in order, every frame)

1. **Background:** full‑canvas dark vignette gradient (so letterbox bars look
   intentional).
2. **Arena floor:** rounded panel with a subtle checkerboard / grid texture and
   a soft inner shadow.
3. **Decals:** fading tread marks + scorch marks under everything.
4. **Tiles:** steel walls (beveled metal with rivets), wooden breakable crates
   (plank texture + grain), and holes (dark recessed pits with rim shadow).
5. **Mines:** floor discs with a blinking indicator.
6. **Shells & trails:** glowing trails then bright shell cores.
7. **Tanks:** hull (rounded body + tread strips that animate while moving) then
   rotating turret (barrel + dome), with a drop shadow. Player has a small
   directional indicator/flag.
8. **Particles:** sparks, smoke, debris, blast rings, muzzle flash.
9. **HUD:** top bar — LEVEL, LIVES (tank pips), ENEMIES LEFT, SCORE, BEST.
10. **Overlays:** title / intro / clear / game‑over panels with translucent
    scrims and animated accents.

### 8.2 Tank drawing detail

- Hull: `roundRect` body with two tread strips along the sides; tread segments
  scroll based on speed for a rolling effect.
- Turret: a circular dome + a rectangular barrel drawn from the tank center at
  `turretAngle`; a muzzle flash quad appears for a few frames after firing.
- Each archetype has a 3‑color palette (hull / tread / trim). The player is
  unmistakably blue.
- A soft elliptical shadow is offset beneath each tank.

### 8.3 Juice checklist

- **Screen shake** on firing (tiny), explosions (big), and player death (huge),
  implemented as a decaying offset applied to the whole world transform.
- **Ricochet sparks** + "tink" at every bounce.
- **Muzzle flash** + recoil nudge on the firing tank.
- **Explosions:** expanding ring + debris + smoke + flash + shake.
- **Hitstop:** a few‑ms freeze on big kills for impact (kept subtle).
- **Smoke** drifts up from wrecks and lingers briefly.
- **Color‑coded floating "+pts"** on kills.

### 8.4 Responsiveness

- Layout recomputed each frame from `ctx.width/height`; arena centered &
  letterboxed; HUD scales with canvas size; text sizes derived from tile size.
- On extreme aspect ratios the arena simply shrinks to fit — never clipped.

---

## 9. Audio

Procedural via `ctx.audio`:

| Event             | Sound design                                              |
| ----------------- | --------------------------------------------------------- |
| Fire shell        | short descending square "pew" (`sweep`)                   |
| Ricochet          | high, very short "tink" (`tone`)                          |
| Shell vs shell    | dual blip                                                 |
| Explosion (tank)  | noise burst + low boom (`noise` + low `tone`)             |
| Mine lay          | soft low blip                                             |
| Mine arm/tick     | faint periodic tick as fuse nears                         |
| Mine detonate     | big noise + sub boom                                      |
| Player death      | `lose`‑style descending triad                             |
| Level clear       | `win`‑style ascending arpeggio                            |
| Enemy destroyed   | satisfying mid "pop" + small noise                        |
| Menu select       | blip                                                      |

Audio always checks the muted state via the engine's AudioManager (handled
internally). SFX are rate‑limited so massed events don't clip.

---

## 10. File Structure

```
src/games/tank-battle/
├── PRD.md        # this document
├── types.ts      # enums + entity/level interfaces (no logic)
├── levels.ts     # tile constants, archetype presets, authored layouts, generator
└── index.ts      # create(): simulation, physics, AI, rendering, state machine
```

- `types.ts` and `levels.ts` are import‑only‑data / pure helpers to keep
  `index.ts` focused and avoid circular dependencies.
- `index.ts` owns the live game state and all mutation.

---

## 11. Data Model (selected interfaces)

```ts
enum Tile { EMPTY, WALL, BREAKABLE, HOLE }

interface ArchetypeDef {
  id: string;
  name: string;
  hull: string; tread: string; trim: string;   // palette
  speed: number;            // tiles/sec (0 = stationary)
  fireInterval: number;     // seconds between shots
  reaction: number;         // acquire delay before first shot
  bounces: number;          // ricochets on its shells
  maxShells: number;        // active shell cap
  aimError: number;         // radians of jitter
  lead: number;             // 0..1 velocity lead factor
  aggression: number;       // 0..1 desire to close distance
  laysMines: boolean;
  awareness: number;        // engage range (tiles)
  score: number;            // points awarded on kill
}

interface LevelDef {
  cols: number; rows: number;
  layout: string[];         // ASCII rows using . # B O P E markers
  enemies: string[];        // archetype ids, OR derived from spawn markers
}

interface Tank { /* see §4.1 */ }
interface Shell { /* see §4.3 */ }
interface Mine  { /* see §4.4 */ }
interface Particle { /* see §4.5 */ }
interface Decal { x:number; y:number; angle:number; life:number; max:number; kind:'tread'|'scorch'; }
```

ASCII layout markers: `.`=empty, `#`=wall, `B`=breakable, `O`=hole, `P`=player
spawn, and digits/letters map to enemy archetypes (e.g. `t`=Turret, `r`=Roamer,
`u`=Rusher, `s`=Sapper, `p`=Phantom, `w`=Warden).

---

## 12. Simulation Order (per `update(dt)`) 

`dt` is clamped (e.g. ≤ 1/30 s) to stay stable after tab stalls. A fixed‑ish
sub‑stepping is used for shells so fast shells don't tunnel through thin walls.

1. Read `W/H`; recompute layout (tile, ox, oy).
2. Handle global input (start/restart depending on state).
3. If not `PLAYING`, advance overlay timers and return early (still render).
4. Update player: input → acceleration → integrate → tile collision; turret aim;
   fire/mine on input.
5. Update enemies: FSM (movement/steer/evade) → integrate → tile collision;
   turret aim (LOS + bank solver + jitter + lead); fire/mine on cooldown.
6. Update shells: sub‑stepped move + ricochet + tile destruction; shell‑vs‑tank;
   shell‑vs‑shell; lifetime.
7. Update mines: arm/fuse/proximity → detonate → blast resolution (chain).
8. Resolve explosions: damage tanks & breakables in radius; spawn particles.
9. Update particles + decals (fade).
10. Update screen shake, hitstop, floating texts.
11. Check win/lose transitions (all enemies dead → LEVEL_CLEAR; player hit →
    PLAYER_DEAD).

`render()` is pure draw from current state; it never mutates simulation.

---

## 13. Collision Math Notes

- **Tank vs grid:** treat the tank as an AABB of half‑extent `radius`. After
  moving on an axis, scan the up‑to‑4 overlapped cells; if any is solid, push the
  tank out along that axis by the minimal penetration and zero that velocity
  component. Doing X and Y separately yields smooth wall sliding.
- **Shell vs grid (ricochet):** advance the shell in small sub‑steps. At each
  sub‑step, test the cell at the prospective X (keeping Y) — if solid, negate
  `vx`, snap the shell just outside that cell face, `bounces--`, spark + SFX.
  Repeat for Y. A diagonal corner hit can reflect both axes in one step. If a hit
  cell is `BREAKABLE`, destroy it (spawn debris) and consume the shell unless it
  still has bounces (tunable — default: breakables stop the shell).
- **Circle hits:** shell‑vs‑tank and mine‑radius use simple distance checks.
- **Line of sight:** DDA/Bresenham‑style march over grid cells between two
  points; blocked by any solid cell.
- **Bank‑shot solve:** reflect the target point across a candidate wall plane
  (the inner face of a nearby border/wall), then require LOS from the shooter to
  the mirrored point and aim there; only used occasionally by smart archetypes.

---

## 14. Tuning Defaults (initial values, all tweakable)

| Parameter                | Value (world units)        |
| ------------------------ | -------------------------- |
| Tank radius              | 0.36 tiles                 |
| Player speed             | ~3.4 tiles/s               |
| Player accel / friction  | snappy (reach speed < 0.15s)|
| Shell speed              | ~7.5 tiles/s               |
| Shell default bounces    | 1 (player), per‑archetype  |
| Player max active shells | 5                          |
| Player fire cooldown     | ~0.28 s                    |
| Player mines             | 2 active, ~0.6 s cooldown  |
| Mine arm time            | 0.8 s                      |
| Mine fuse (auto)         | ~8 s                       |
| Mine blast radius        | ~1.8 tiles                 |
| Lives                    | 3 (+1 every 5 levels, cap) |
| dt clamp                 | 1/30 s                     |

These live as named constants at the top of `index.ts`.

---

## 15. Accessibility & UX

- High‑contrast, color‑blind‑friendlier palette (archetypes also differ in
  shape/behavior, not just hue).
- Clear telegraphs before enemy fire; readable shell trails.
- All critical info (lives, enemies left, level) always visible in the HUD.
- Generous respawn invulnerability flicker so the player isn't instantly re‑killed.
- Status line gives a one‑glance controls reminder.

---

## 16. Testing & Acceptance Criteria

- [ ] Compiles under strict TS with **no `any`** and no engine edits.
- [ ] Runs at any size/aspect; resizing/rotating mid‑game never breaks layout.
- [ ] Player can move, aim (mouse on desktop, auto on touch), fire, and lay mines.
- [ ] Shells ricochet the correct number of times and then expire.
- [ ] A single hit kills any tank; player loses a life and respawns/ends.
- [ ] Destroying all enemies advances to the next, harder level.
- [ ] Enemies never shoot through walls; aim is imperfect and dodgeable.
- [ ] Mines arm, detonate, chain, and destroy tanks + breakables.
- [ ] Score reported live; `gameOver(score)` fires once; best persists.
- [ ] Touch controls (dpad + FIRE + MINE) work; auto‑aim is usable.
- [ ] No console errors; `destroy()` leaves no dangling timers.

---

## 17. Future / Stretch (not required for v1)

- Boss tank with multiple weak points and phases.
- Power‑ups (rapid fire, extra bounce, shield, speed) dropped by wrecks.
- Daily seeded challenge using `dailySeed`.
- Local 2‑player versus on one keyboard.
- Replay of the killing shot.

---

*End of PRD.*
