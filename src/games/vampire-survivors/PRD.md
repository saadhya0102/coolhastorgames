# Nightfall Survivors — Product Requirements Document

> An original, canvas-only "auto-attacking survival roguelite" built for the
> CoolHastorGames TypeScript + Vite portal. Move to survive escalating hordes;
> your weapons fire automatically. Collect XP, level up, pick upgrades, evolve
> your arsenal, and outlast the night.

This document is the design + implementation contract for the game that lives in
`src/games/vampire-survivors/`. It is intentionally detailed so the
implementation can be reconstructed from this PRD alone.

---

## 1. Vision & Pillars

**Nightfall Survivors** is a top-down, single-stick survival roguelite in the
spirit of the "bullet-heaven" genre. The player controls a lone Lantern-Knight
trapped in a cursed moonlit field. Enemies pour in from every edge; the only
input is *movement*. All combat is automatic. The fantasy is one of *escalating
power*: starting nearly helpless with a single weapon, and ending the run as a
screen-clearing storm of orbiting blades, chain lightning, and supernovae.

### Design pillars

1. **One-thumb playable.** Movement is the only required input during combat.
   Works with WASD/arrows, an on-screen d-pad, and a dynamic touch joystick.
2. **Readable chaos.** Hundreds of entities on screen, but the player should
   always parse threats. Strong silhouettes, color-coded factions, hit flashes,
   and screen shake sell impact without obscuring danger.
3. **The power curve is the game.** Every 10–30 seconds the player makes a
   meaningful build decision. Builds should feel distinct (orbit tank, projectile
   sniper, aura bruiser, lightning mage).
4. **Original everything.** All art is procedural canvas drawing; all audio is
   the engine's WebAudio synth. No external assets, no copied content.
5. **Performance first.** Object pooling, entity caps, a spatial hash for
   collisions, and cheap draw calls keep it at 60fps with 300+ enemies.

### Non-goals

- No meta-progression / persistent unlocks between runs (only a stored best
  score). Each run is self-contained.
- No multiplayer, no networking.
- No external art, fonts, or sound files.

---

## 2. Engine Integration

The game is a **canvas game module** exporting `create(ctx: GameContext):
GameInstance` from `index.ts`. It only imports from `@/engine` and its own
folder. It never edits shared engine/shell/manifest files.

### GameContext usage

| API | Usage |
| --- | --- |
| `ctx.ctx` | DPR-scaled 2D context. All drawing in **CSS pixels**. |
| `ctx.width` / `ctx.height` | **Getters** — read every frame. The arena adapts to any size/aspect and to mobile orientation changes. |
| `ctx.input` | `isDown`, `pressed`, `released`, and `pointer { x, y, down, justDown, justUp }`. Also `pointers` map for multi-touch. |
| `ctx.audio` | Procedural SFX (`tone`, `sweep`, `noise`, plus `coin`, `hit`, etc.). |
| `ctx.storage` | Best score / settings persistence (namespaced per game). |
| `ctx.reportScore(n)` | Called live as the survival score increases. |
| `ctx.gameOver(score)` | Called on death; the shell submits the best score. |
| `ctx.setStatus(text)` | Short HUD hint shown above the canvas. |
| `ctx.requestControls([{type:'dpad'}])` | Requests the shell d-pad on touch. We additionally render a dynamic on-canvas joystick. |

### GameInstance contract

```ts
interface GameInstance {
  update(dt: number): void;   // dt in seconds, clamped
  render(): void;             // repaints the FULL background each frame
  resize?(w, h): void;        // we mostly read getters, but keep camera sane
  destroy?(): void;           // release listeners/timers (none persistent)
}
```

- `update` advances simulation only while in the `playing` state. While paused
  or in the level-up screen, world simulation is frozen but UI input is handled.
- `render` always repaints the entire background (no smearing).
- `dt` is clamped to a max (e.g. 1/30s) to avoid tunneling after tab-switches.

### Strict TypeScript rules

- No `any`. No non-null abuse. All entity fields typed.
- No React, no third-party libraries.
- All randomness via `Math.random` wrappers (a small local `rand` helper) or the
  engine `rng`. No seeded determinism is required (endless mode).

---

## 3. Controls

### Desktop

- **Move:** `W A S D` or Arrow keys (8-directional, normalized).
- **Pause:** `P` or `Escape`.
- **Level-up choices:** number keys `1`–`4`, or click a card.
- **Restart on death:** handled by shell overlay (we just call `gameOver`).

### Touch / mobile

- `ctx.requestControls([{ type: 'dpad' }])` registers the shell d-pad which
  injects virtual keys (Arrow keys) consumed by the same movement code.
- **Dynamic joystick:** Touching anywhere on the playfield drops a virtual
  joystick at the touch point. Dragging produces an analog movement vector
  (magnitude scaled by drag distance up to a max radius). Releasing hides it.
- Level-up cards and the pause button are large tap targets.

### Movement resolution priority

1. If the dynamic joystick is active → use its analog vector.
2. Else combine keyboard/d-pad axes into a unit vector.

The player's *facing* direction is the last non-zero movement vector, used by
directional weapons and for sprite orientation.

---

## 4. Game States

A simple state machine in the main module:

- `playing` — normal simulation + rendering.
- `levelup` — world frozen; an upgrade selection overlay is shown. Entered when
  the player gains enough XP. Multiple pending level-ups queue.
- `paused` — manual pause overlay. World frozen.
- `dead` — death sequence (brief slow-mo + particles), then `ctx.gameOver`.

Transitions:

```
playing --(xp full)--> levelup --(choice)--> playing (or another levelup if queued)
playing --(P/Esc)--> paused --(P/Esc/resume)--> playing
playing --(hp<=0)--> dead --> gameOver
```

---

## 5. World & Camera

- The arena is **unbounded** (effectively infinite) — there are no walls. The
  player can run forever; enemies always spawn around the camera. A subtle soft
  "fence" (slowly increasing drag) is *not* used; instead the spawner guarantees
  pressure from all sides.
- **World coordinates** are independent of screen size. Conversion:
  `screenX = worldX - camX + W/2`, `screenY = worldY - camY + H/2`.
- The **camera** follows the player with light smoothing (`lerp` toward the
  player each frame) so movement feels responsive but not jittery.
- **Screen shake** adds a decaying random offset to the camera on big hits,
  boss stomps, and player damage.
- **Background:** a dark gradient field with a parallax grid of faint lines that
  scroll with the camera, scattered ground "tufts"/cracks placed on a hashed
  grid so they appear stable in world space, plus a vignette. Repainted fully
  each frame.
- **Culling:** entities outside an expanded screen rect are skipped during
  rendering (but still simulated if near). Far-offscreen enemies are despawned
  by the spawner to keep counts bounded.

---

## 6. The Player

| Field | Meaning |
| --- | --- |
| `x, y` | World position. |
| `vx, vy` | Current velocity (for smoothing + knock effects). |
| `hp, maxHp` | Health. Death at `hp <= 0`. |
| `level, xp, xpToNext` | Progression. |
| `invuln` | Invulnerability timer after taking a hit (i-frames). |
| `facingX, facingY` | Last movement direction (unit). |
| `flash` | Red flash timer when hit. |
| `regenAcc` | Accumulator for fractional HP regen. |
| `stats` | Derived `Stats` (see §7). |

- **Base move speed** ~ 165 px/s, scaled by `stats.moveMult`.
- **Contact damage:** when an enemy overlaps the player and the player is not in
  i-frames, the player takes the enemy's damage, gains ~0.5s invuln, flashes,
  and the screen shakes. Enemies are knocked back slightly on contact.
- **Regen:** `stats.regen` HP/sec (0 unless Regrowth taken).
- **Visual:** an original lantern-knight — a rounded cloaked body with a glowing
  lantern orb that pulses, a directional "visor" gleam, and a soft ground
  shadow. Tints red briefly on hit.

### XP & leveling curve

- `xpToNext(level)` grows super-linearly so early levels are fast and late
  levels are a grind:
  `xpToNext = floor(5 + level * 6 + level^1.55 * 1.2)` (tuned in config).
- Picking up a gem adds `gem.value * stats.xpMult`. When `xp >= xpToNext`,
  the player levels up (xp carries over the remainder), and a level-up is queued.

---

## 7. Stats System

All multiplicative/additive bonuses flow into a single derived `Stats` object,
recomputed whenever a passive (or evolution) changes.

| Stat | Base | Affected by |
| --- | --- | --- |
| `damageMult` | 1.0 | Might |
| `cooldownMult` | 1.0 (lower = faster, floored at 0.4) | Haste |
| `areaMult` | 1.0 | Resonance, Velocity (minor) |
| `projSpeedMult` | 1.0 | Velocity |
| `projCountBonus` | 0 (added projectiles) | certain weapons/evolutions |
| `moveMult` | 1.0 | Boots |
| `magnet` | base pickup radius (px) | Lodestone |
| `xpMult` | 1.0 | Wisdom |
| `regen` | 0 HP/s | Regrowth |
| `armorMult` | 1.0 (damage taken multiplier) | Aegis |
| `durationMult` | 1.0 | Resonance |
| `critChance` | 0.05 | (weapon-specific, Might minor) |
| `critMult` | 1.6 | — |

Recompute: start from base constants, iterate owned passives calling
`def.apply(stats, level)`.

---

## 8. Weapons

Weapons fire automatically on individual cooldowns. The player starts with one
weapon (**Moon Shard**) and can hold up to **6** weapons. Each weapon has up to
**8** levels. Some weapons **evolve** into a stronger form when maxed while the
required passive is owned.

Each weapon definition provides:

- `id`, `name`, `color`, `maxLevel`
- `short` — one-line category description (for the card)
- `describe(level)` — what the *next* level grants
- `icon(c, x, y, s, color)` — procedural icon for the upgrade card
- `update(world, state, dt)` — per-frame behavior (manages its own cooldown)
- optional `evolution { into, requires, name }`

`WeaponState`: `{ defId, level, timer, angle, data }`.

### Weapon roster

1. **Moon Shard** *(projectile)* — Fires a piercing shard at the nearest enemy.
   Levels add damage, projectile count (spread/sequential), pierce, and speed.
   - *Evolution → Star Storm* (requires **Velocity**): fires a fan of fast,
     long-range piercing stars on a short cooldown.

2. **Orbit Blades** *(orbiting melee)* — Blades rotate around the player,
   damaging on contact with a per-enemy re-hit cooldown. Levels add blade count,
   damage, orbit radius, and rotation speed.
   - *Evolution → Cyclone* (requires **Might**): more, larger blades plus a
     pull-in vortex effect; higher tick rate.

3. **Pulse Aura** *(area DOT)* — A damaging field around the player that ticks
   periodically on all enemies inside. Levels add radius, damage, and tick rate.
   - *Evolution → Supernova* (requires **Resonance**): larger aura that also
     emits a damaging shockwave ring on each tick.

4. **Chain Spark** *(chain lightning)* — Periodically zaps the nearest enemy,
   then arcs to additional nearby enemies. Levels add damage, jump count, and
   range. Renders animated lightning beams.
   - *Evolution → Tempest* (requires **Haste**): near-instant cooldown, more
     jumps, and a chance to stun (slow) struck enemies.

5. **Boomerang** *(returning projectile)* — Thrown in the facing direction,
   slows mid-flight, then returns to the player, hitting on both passes. Levels
   add damage, range, count, and width.

6. **Frost Shard** *(slow projectile)* — Fires a shard at the nearest enemy that
   **slows** on hit and shatters into a small frost burst. Levels add damage,
   slow strength/duration, and count.

7. **Ember Burst** *(targeted explosion)* — Periodically drops a fiery explosion
   on the densest nearby enemy cluster, dealing area damage. Levels add damage,
   radius, and explosion count.

All damage is multiplied by `stats.damageMult` and area by `stats.areaMult`;
cooldowns by `stats.cooldownMult`. Critical hits (per `critChance`) multiply by
`critMult` and render larger/brighter damage numbers.

### Re-hit model

- **Projectiles** (Shard, Frost, Boomerang, Star, Comet) track `hits: number[]`
  of enemy ids so each pierce hits a given enemy once.
- **Persistent weapons** (Blades, Aura, Cyclone, Supernova) use a per-enemy
  `hitTimers[slotIndex]` cooldown so they re-tick at a fixed interval rather than
  every frame.

---

## 9. Passive Items

Passives modify `Stats`. Up to **6** passives, each up to **5** levels.

| Passive | Effect per level |
| --- | --- |
| **Might** | +12% damage |
| **Haste** | −8% weapon cooldown (floored) |
| **Velocity** | +14% projectile speed, +4% area |
| **Resonance** | +13% area, +8% effect duration |
| **Swift Boots** | +9% move speed |
| **Vitality** | +18% max HP (and heals the difference) |
| **Lodestone** | +28% pickup (magnet) radius |
| **Wisdom** | +12% XP gain |
| **Regrowth** | +0.6 HP/s regen |
| **Aegis** | −7% damage taken |

Passives are the keys to evolutions (Velocity→Star Storm, Might→Cyclone,
Resonance→Supernova, Haste→Tempest).

---

## 10. Evolutions

When the player levels up:

- If a weapon is at `maxLevel` and the required passive is owned (level ≥ 1) and
  it has not yet evolved, an **evolution choice** is offered (highlighted,
  golden). Choosing it replaces the base weapon in place with the evolved weapon
  at level 1 of its evolved form (which is already much stronger).

This is the single biggest power spike per build and is the "win condition"
texture for surviving the late game.

---

## 11. Enemies

Enemies spawn just outside the visible camera rect and move toward the player.
All stats scale with elapsed time (see §12). Up to **~350** enemies live at once
(spawner respects the cap).

| Type | Kind | Role | Notes |
| --- | --- | --- | --- |
| **Bat** | chase | early swarmer | fast, fragile, tiny |
| **Husk** | chase | basic | medium hp/speed (zombie-like) |
| **Skitter** | chase | filler | quick, low hp |
| **Stalker** | charger | pressure | periodically dashes toward the player |
| **Brute** | chase | tank | large, slow, high hp + contact damage |
| **Hexer** | shooter | ranged | keeps distance, fires slow homing-ish orbs |
| **Reaper** | boss | miniboss/boss | huge hp, knockback-resistant, big contact damage; spawns on a timer |

Each enemy:

- chases the player by steering its velocity toward them at `speed` (with
  separation so they don't perfectly stack — light boids-style push apart using
  the spatial grid).
- has `flash` (white hit flash), `slow` timer (frost), `knockX/knockY` decaying
  knockback velocity, and `contactCd` so it deals contact damage at most a few
  times per second.
- **Chargers** wind up and dash in a straight line, then recover.
- **Shooters** stop at a preferred range and fire enemy projectiles (handled by
  the same projectile pool with `fromEnemy = true`).
- **Boss** has an HP bar, is much larger, and on death drops a big XP cluster +
  heals nothing but causes a satisfying explosion + shake.

### Enemy visuals (all original, procedural)

- **Bat:** small dark body with flapping wing triangles + glowing eyes.
- **Husk:** lumpy rounded body, shambling tilt animation.
- **Skitter:** spiky low diamond with skittering legs.
- **Stalker:** elongated wraith; glows brighter while charging.
- **Brute:** big armored blob with cracked plates.
- **Hexer:** floating robed orb with a single eye that flares before firing.
- **Reaper (boss):** large hooded form with a scythe arc and pulsing aura.

---

## 12. Spawn Director & Difficulty

A single director controls pressure:

- `spawnInterval` starts ~1.1s and decreases toward a floor (~0.18s) as time
  passes; each tick spawns a small batch (1–N) scaled by time.
- **Enemy type weighting** shifts over time: only Bats/Husks early; Skitter and
  Stalker unlock by ~1 min; Brute and Hexer by ~2–3 min; everything mixed late.
- **Stat scaling:** `hp *= 1 + t/45`, `damage *= 1 + t/120`, `xp` scales mildly,
  `speed` scales very mildly (capped) so the game stays fair.
- **Bosses:** spawn every ~90s (and a tougher one each interval), announced with
  a warning flash + shake. Boss HP scales aggressively with time.
- **Caps:** if `enemies.length >= MAX_ENEMIES`, spawns are skipped. Enemies that
  wander far beyond the camera (e.g. > 1.6× screen diagonal) are recycled to the
  far side near the player to maintain pressure and bound counts.
- **Pacing events:** occasional "swarm" bursts spawn a ring of many weak enemies
  for a screen-clearing power fantasy moment.

---

## 13. XP Gems & Pickups

- On death, an enemy drops a gem worth `enemy.xp` (bosses drop a burst of
  several large gems). Gems are pooled and capped (~600); if over cap, oldest
  low-value gems merge/expire.
- Gems sit until the player comes within `stats.magnet` radius, then accelerate
  toward the player and are collected on contact (`audio.coin` blip, particle).
- Gem color encodes value tiers (green → blue → purple → gold).
- Occasional special pickups:
  - **Heart** (rare drop): heals a chunk of HP.
  - **Magnet orb** (rare): instantly pulls all on-screen gems.

---

## 14. Level-Up Screen

When a level-up is queued, the game enters `levelup`:

- World freezes; a darkened overlay with a title ("LEVEL UP!") appears.
- **3–4 cards** are presented (4 on wide screens, 3 on small/portrait).
- Each card shows: icon, name, type tag (Weapon/Passive/Evolution/New), the
  effect of taking it (`describe`), and a level pip row.
- Selection by clicking/tapping a card or pressing `1`–`4`.
- **Choice pool** generation:
  1. Evolution options (if eligible) — always surfaced, golden.
  2. Owned weapons below max — "Level Up".
  3. Owned passives below max — "Level Up".
  4. New weapons (if weapon slots free).
  5. New passives (if passive slots free).
  6. **Fallbacks** if the pool is short: "Recover" (heal 30% max HP) and
     "+1 Max HP & full heal" so there are always enough cards.
- After choosing, if more level-ups are queued, immediately present the next set;
  otherwise resume play.

A small "reroll" is *not* included (keeps scope tight) — but the fallback system
guarantees valid choices.

---

## 15. HUD

Drawn in screen space (not world space), scaled to the smaller of width/height
for consistency across aspect ratios.

- **Top center:** large survival timer `M:SS`.
- **Top left:** Level + XP bar (thin bar that fills toward `xpToNext`).
- **Top right:** Kill count + a small pause button (tap target).
- **Bottom (player HP):** a health bar near the player or a fixed bottom bar —
  we use a fixed slim bar under the timer plus a floating ring under the player
  for at-a-glance reading. (Implementation: top XP bar + a HP bar; plus low-HP
  red vignette pulse.)
- **Weapon/Item tray:** small icons of owned weapons & passives with level pips
  along an edge (bottom-left), so the build is always visible.
- **Boss bar:** when a boss is alive, a wide HP bar appears near the top under
  the timer with the boss name.
- **Status line:** `ctx.setStatus` shows a short rotating hint early, then the
  best score.

Low-HP feedback: screen edges pulse red; heartbeat tone when `hp < 25%`.

---

## 16. Combat Math

- **Damage to enemy:** `final = weaponBase * stats.damageMult * (crit ? critMult : 1)`,
  rounded. Spawns a damage number (white normal, gold crit), a hit flash, small
  particles, and applies optional knockback/slow.
- **Damage to player:** `final = enemy.damage * stats.armorMult`, applied once
  per contact window; triggers i-frames, flash, shake, and a low tone.
- **Knockback:** added to enemy `knockX/knockY`, decays via friction each frame;
  bosses have a knockback resistance multiplier.
- **Slow:** sets `enemy.slow` timer and `slowFactor`; effective speed is
  `speed * (slow>0 ? slowFactor : 1)`.
- **Score:** `score = floor(elapsedSeconds) + kills` reported live via
  `reportScore`; `gameOver(score)` on death. We also track and display the stored
  best.

---

## 17. Juice / Game Feel

- **Hit flashes** on every enemy hit (white overlay that decays).
- **Floating damage numbers** (pooled), rising and fading; crits larger/gold.
- **Particles** (pooled, capped ~400): blood/spark bursts on hits, gem-pickup
  sparkles, muzzle flashes, explosion debris, boss-death confetti.
- **Projectile trails:** short fading trails for shards/stars/comets.
- **Screen shake:** scaled by event magnitude, decays smoothly.
- **Hit-stop (micro):** brief time-scale dip on boss death / player hit.
- **Level-up flash:** golden bloom + chime.
- **Audio:** procedural — shard "tick", explosion noise, lightning crackle,
  coin blip for gems, level-up arpeggio, boss horn, death chord.

---

## 18. Performance Plan

- **Object pools** for enemies, projectiles, gems, particles, damage numbers,
  and beams. Each pool preallocates and uses swap-remove (no per-frame GC churn,
  no array `filter` allocations in hot paths).
- **Spatial hash grid** (uniform cells ~64px) rebuilt each frame from live
  enemies. Used for:
  - nearest-enemy queries (weapon targeting),
  - radius queries (aura, explosion, chain),
  - enemy separation (boids push-apart).
- **Caps:** `MAX_ENEMIES ≈ 350`, `MAX_PROJECTILES ≈ 500`, `MAX_PARTICLES ≈ 400`,
  `MAX_GEMS ≈ 600`, `MAX_DMGNUM ≈ 200`. When at cap, lowest-priority items are
  recycled.
- **Cheap rendering:** avoid `shadowBlur` in per-entity loops; use solid fills,
  small gradients reused, and `globalAlpha` for fades. Background grid limited to
  on-screen lines.
- **dt clamp** to `1/30` to prevent post-stall tunneling; fixed-ish stepping not
  required because collisions use radius overlap (forgiving).
- **Culling** in render: skip entities outside an inflated screen rect.

---

## 19. Persistence

- Best score stored by the shell via `gameOver` → `storage.submitScore`.
- We additionally read `storage.bestScore()` (or a stored `__best`) to show the
  best on the HUD and the death/intro screens.
- Optional: store last-build summary for display (not required).

---

## 20. File Structure

```
src/games/vampire-survivors/
  PRD.md        — this document
  types.ts      — all entity + definition interfaces, the World interface
  config.ts     — tunables, palette, caps, curves
  grid.ts       — uniform spatial hash grid
  defs.ts       — enemy / weapon / passive / evolution definitions (data-driven)
  index.ts      — main game: state machine, pools, World impl, camera, spawner,
                  input, level-up UI, HUD, rendering, juice
```

- `types.ts` and `config.ts` have no runtime deps beyond `@/engine`.
- `defs.ts` imports types + config + engine draw helpers; it references the
  `World` interface so it stays decoupled from `index.ts` (no circular import).
- `index.ts` implements `World` and wires everything together.

---

## 21. Tuning Tables (initial values)

These are starting points; balance is iterated in `config.ts`.

### Player
- `BASE_MOVE = 165` px/s, `BASE_MAXHP = 100`, `START_INVULN = 0.55s`.
- XP curve: `xpToNext(L) = floor(5 + L*6 + L^1.55 * 1.2)`.

### Spawner
- `spawnInterval`: `clamp(1.15 - t*0.012, 0.18, 1.15)` seconds.
- batch size: `1 + floor(t/30)` (capped ~6).
- boss every `BOSS_EVERY = 90`s; boss hp `= 600 * (1 + t/30)`.
- stat scaling: `hpScale = 1 + t/45`, `dmgScale = 1 + t/120`.

### Weapons (level-1 baselines)
- Moon Shard: dmg 10, cd 1.1s, 1 proj, pierce 1, speed 430.
- Orbit Blades: dmg 8/tick, 2 blades, radius 70, hitInterval 0.45s.
- Pulse Aura: dmg 6/tick, radius 78, tick 0.6s.
- Chain Spark: dmg 12, cd 1.6s, 3 jumps, range 200.
- Boomerang: dmg 14, cd 1.8s, range 260.
- Frost Shard: dmg 7, cd 1.5s, slow 45% for 1.6s.
- Ember Burst: dmg 22, cd 2.6s, radius 70.

### Enemies (level-1 baselines, pre-scaling)
- Bat: hp 8, spd 96, r 11, dmg 6, xp 1.
- Husk: hp 22, spd 52, r 16, dmg 10, xp 2.
- Skitter: hp 14, spd 78, r 12, dmg 8, xp 2.
- Stalker: hp 18, spd 70 (dash 320), r 13, dmg 11, xp 4.
- Brute: hp 95, spd 40, r 25, dmg 18, xp 7.
- Hexer: hp 20, spd 46, r 14, dmg 8 (orb 9), xp 5.
- Reaper (boss): hp 600+, spd 52, r 46, dmg 30, xp 80.

---

## 22. Accessibility & Robustness

- Works at any aspect ratio and on resize/orientation change (all sizes derived
  from `ctx.width/height` each frame; HUD scales by `min(W,H)`).
- Keyboard-only and touch-only both fully playable.
- Color choices keep factions distinguishable; threats are also distinguished by
  size/shape, not color alone.
- Defensive coding: pools never overflow; division/normalization guards against
  zero-length vectors; `dt` clamped; no reliance on exact frame rate.
- `destroy()` clears any timers (we keep none beyond RAF, which the shell owns)
  and drops references.

---

## 23. Testing Checklist

- [ ] Boots into an intro/play state; movement works (keys, d-pad, touch drag).
- [ ] Weapons auto-fire; first kills drop gems; gems are collected via magnet.
- [ ] Level-up triggers, freezes world, shows 3–4 cards, selection works by
      tap and by `1`–`4`.
- [ ] All 7 weapons and 10 passives obtainable; level pips update.
- [ ] At least 4 evolutions reachable and visibly stronger.
- [ ] Bosses spawn on schedule with HP bar; boss death is satisfying.
- [ ] Hundreds of enemies on screen stay at/near 60fps.
- [ ] HP, i-frames, death → `gameOver(score)`; best persists across runs.
- [ ] Resize / rotate mid-run keeps everything centered and playable.
- [ ] Pause (`P`/`Esc` + button) freezes and resumes cleanly.

---

## 24. Future Extensions (out of scope now)

- Multiple selectable characters with starting weapons/passives.
- Stage hazards (destructible obstacles, light sources).
- Chest pickups granting multi-level rewards.
- Meta-progression currency and permanent upgrades.
- Daily seeded challenge using `dailySeed`.

---

*End of PRD.*
