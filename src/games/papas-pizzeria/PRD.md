# Pizza Palace — Product Requirements Document

> A complete, highly polished, original time‑management cooking game in the
> spirit of the "Papa's" diner series, built for the **CoolHastorGames**
> TypeScript + Vite portal. 100% original code and procedural canvas art — no
> external assets, no copied text, no third‑party libraries.

- **Game id / folder:** `papas-pizzeria`
- **Display title:** *Pizza Palace*
- **Genre:** Time‑management / cooking sim
- **Players:** 1
- **Score metric:** Money earned (`$`), reported live; best persisted
- **Target platforms:** Desktop (mouse + keyboard shortcuts) and mobile (touch),
  any viewport size / aspect ratio
- **Engine:** `@/engine` canvas game module exporting `create(ctx): GameInstance`

---

## 1. Vision & Pillars

Pizza Palace puts the player behind the counter of a bustling pizzeria. A line
of hungry, expressive customers forms at the front. Each one orders a pizza with
a specific set of toppings, a desired bake, and a slice count. The player must
juggle multiple orders through a four‑station pipeline before customers run out
of patience — earning money and tips, climbing through days of escalating
difficulty, and spending earnings on shop upgrades that make the kitchen faster
and the customers happier.

**Design pillars**

1. **Readable juggling.** The fun is managing several pizzas at different
   stations at once. The UI must make it obvious, at a glance, what needs
   attention right now (who's about to leave, which pizza is about to burn).
2. **Tactile, satisfying feedback.** Every action — placing a topping, pulling a
   perfectly baked pie, slicing clean even wedges, serving a happy customer —
   should produce immediate, juicy audio‑visual feedback (particles, pops,
   squashes, sparkles, coins).
3. **Fair, transparent scoring.** Players should always understand *why* they
   got the rating they got. Topping / bake / cut accuracy each contribute a
   visible portion of the final star rating and tip.
4. **Gentle ramp, deep mastery.** Day 1 is forgiving and teaches one station at
   a time conceptually; later days demand fast, accurate multitasking. Upgrades
   give a sense of progression and let players tune the kitchen to their style.
5. **Runs anywhere.** Pure canvas, DPR‑aware, layout recomputed every frame from
   `ctx.width` / `ctx.height`. Works on a phone in portrait and a desktop in
   widescreen with the same code.

**Non‑goals**

- No networking / multiplayer / leaderboard logic beyond `reportScore`.
- No real‑money, no ads, no accounts.
- No imported imagery, fonts beyond the engine default, or sound files.

---

## 2. Engine API contract (how we use it)

The engine hands `create(ctx: GameContext)` a context. We rely on exactly these
members, and nothing outside `@/engine` + this folder:

| Member | Use in Pizza Palace |
| --- | --- |
| `ctx.ctx` | 2D context, already DPR‑scaled. We draw entirely in CSS px. |
| `ctx.width` / `ctx.height` | **Getters** — read every frame in `update` and `render`. All layout is relative. |
| `ctx.input` | `pointer{x,y,down,justDown,justUp}` for tap/drag; `pressed()` for keyboard shortcuts (tab switching, debug). |
| `ctx.audio` | Procedural SFX via `tone/sweep/noise/blip/coin/win/lose`. We add small wrapper sfx. |
| `ctx.storage` | Persist money, day, best money, owned upgrades, lifetime stats. |
| `ctx.reportScore(n)` | Called whenever money changes so the HUD score stays live. |
| `ctx.gameOver(finalScore?)` | Called when a shift ends in failure (quota missed) or the player ends the run; passes final money. |
| `ctx.setStatus(text)` | Short contextual hint above the canvas (current station / objective). |
| `ctx.requestControls([...])` | We request **no** dpad/buttons — all interaction is on‑canvas tap/drag — but we still call it with `[]` to clear any prior controls. |
| `ctx.isTouch` | Slightly enlarge hit targets / tweak hints on touch. |

`GameInstance` we return implements `update(dt)`, `render()`, `resize?()`,
`destroy?()`. `dt` is seconds. We repaint the full background every frame.

**Strictness rules we follow**

- Strict TypeScript, **no `any`**. All state typed via `types.ts`.
- No React, no external libs.
- No asset files — every visual is drawn from shapes / gradients / paths.
- We never edit shared engine files or the registry. (Registration snippet is
  documented in §15 for whoever wires it into the manifest.)

---

## 3. File / module architecture

```
src/games/papas-pizzeria/
  PRD.md          – this document
  index.ts        – create(ctx) entrypoint; constructs Game, forwards lifecycle
  types.ts        – all domain types & enums (no logic)
  config.ts       – tuning constants, palette, TOPPINGS, UPGRADES, difficulty
  rng.ts          – thin wrappers over engine rng for typed picks
  particles.ts    – Particles system (spawn helpers + update/draw)
  ui.ts           – Button, panel/text/star drawing helpers, layout math, sfx
  pizza.ts        – Pizza model helpers, bake colour, topping & slice rendering
  customer.ts     – Customer generation, order tickets, avatar + mood rendering
  kitchen.ts      – Procedural kitchen background scene per station
  game.ts         – Game controller: state machine, stations, scoring, shop,
                    day flow, HUD, persistence
```

Rationale: one cohesive `Game` controller owns mutable state and the state
machine; rendering of complex sprites (pizza, customer, kitchen) is factored
into pure‑ish helper modules that take the context + data and draw. This keeps
`game.ts` focused on flow and scoring while keeping art code reusable and
testable by eye.

---

## 4. Domain model (`types.ts`)

```
ToppingId   = "pepperoni" | "mushroom" | "pepper" | "olive" | "onion"
            | "sausage" | "bacon" | "pineapple" | "ham" | "jalapeno"

ToppingDef  { id, name, short, color, accent, drawKind }
ToppingReq  { id: ToppingId, count: number }            // requested amount
PlacedItem  { id: ToppingId, x, y, rot, pop }            // pop = spawn anim 0..1

BakeBand    { targetMin: number, targetMax: number }     // ideal bake window 0..1

OrderSpec   { toppings: ToppingReq[], bake: BakeBand, slices: number }

Ticket {
  id: number
  customer: Customer
  spec: OrderSpec
  status: TicketStatus          // waiting -> building -> baking -> cutting -> done/left
  placed: PlacedItem[]          // toppings the player added
  bake: number                  // 0..1 bake progress (oven)
  baking: boolean               // currently in oven
  pulledBake: number | null     // bake value at the moment it was pulled
  cuts: number[]                // angles (radians) of player cut lines
  ovenSlot: number | null
  score: PizzaScore | null      // filled on serve
  bornAt: number                // timestamp for patience
}

TicketStatus = "waiting" | "building" | "baking" | "cutting" | "served" | "left"

PizzaScore { topping: number; bake: number; cut: number; overall: number;
             stars: number; pay: number; tip: number }

Customer {
  seed, name, palette (skin/hair/shirt), bodyType, faceMood,
  patience: number (0..1), patienceMax (seconds), arrivedAt
}

GameState = "title" | "dayStart" | "play" | "dayEnd" | "shop" | "over"
Station   = "orders" | "build" | "oven" | "serve"

UpgradeId = "oven_speed" | "oven_slots" | "tray_quick" | "seats" | "decor"
          | "cutter" | "sauce_auto" | "marketing"
Upgrade { id, name, desc, baseCost, maxLevel, costGrowth, icon }

SaveData { money, day, best, upgrades: Record<UpgradeId, number>,
           lifetimeServed, lifetimeTips }
```

---

## 5. Core gameplay loop

A single pizza flows through four stations. The player can have several pizzas
in flight simultaneously and switches between stations using the bottom tab bar
(or number keys 1–4 on desktop).

### 5.1 Station 1 — ORDERS (front counter)
- Customers spawn into a waiting line on a cadence determined by the day.
- Each waiting customer shows a speech bubble / order ticket: the toppings &
  counts they want, their desired bake (light / normal / well‑done band), and
  the number of slices.
- Player taps **Take Order** on a customer (or taps the customer). The ticket
  moves to `building`; the customer walks to the seating area to wait. Their
  **patience timer keeps draining the entire time** until served.
- A small badge on the Build tab shows how many tickets await building.

### 5.2 Station 2 — BUILD (topping bench)
- A list of building tickets on the side; tap to select the active one.
- The selected pizza (raw dough + auto sauce + auto cheese) sits on the bench.
- A topping tray shows every topping. Player **drags** a topping from the tray
  onto the pizza to place one instance at the drop point (or taps a tray slot
  then taps the pizza). Each placement spawns a topping with a little pop.
- The current ticket's requirements are shown with live counts (e.g.
  `Pepperoni 5/8`). Over/under/ wrong toppings are reflected at scoring time.
- A **trash** affordance lets the player clear the last topping / reset.
- **Bake** button sends the pizza to the oven (requires an open oven slot).

### 5.3 Station 3 — OVEN
- The oven has `1..N` slots (N grows with the `oven_slots` upgrade).
- Each baking pizza shows a **bake meter**: a bar filling 0→1 over the bake
  duration, with the ticket's **target band highlighted in green**. The dough/
  toppings visibly darken as bake rises; past the band it begins to char.
- Player taps a pizza (or its **Pull** button) to remove it. The `bake` value at
  pull time is stored. Pulling inside the band = perfect; under = doughy; over =
  burnt. If left far too long it burns to ruin (still servable but ~0 bake
  score, and emits smoke particles as a warning).
- Pulled pizzas move to `cutting`.

### 5.4 Station 4 — CUT & SERVE
- A list of pizzas ready to cut; tap to select.
- The selected pizza sits on a cutting board. The player **drags across the
  pizza** to make a straight cut. Each cut is recorded as an angle (we treat
  full diametric cuts). Requested slices = `2 × cuts` for the common even
  counts; the HUD shows `Cuts 3/4 → 8 slices`.
- Cut scoring rewards (a) the correct number of cuts for the requested slice
  count and (b) **even angular spacing** between cuts.
- When the requested cut count is reached, a **Serve** button delivers the pizza
  to its customer. Scoring is computed, a tip floats up, coins burst, money &
  score update, the customer reacts (happy/neutral/mad), and the ticket is done.

### 5.5 Concurrency & attention
- Any number of tickets can be `building`/`baking`/`cutting`; oven capacity is
  the natural bottleneck.
- Tab badges show pending counts; the most urgent customer (lowest patience) and
  any pizza about to burn pulse / flash to draw the eye. An ambient bell sfx
  plays when a new customer arrives.

---

## 6. Scoring & economy

Each served pizza is scored on three components in `[0,1]`, then combined.

### 6.1 Topping accuracy (`topping`)
For each **requested** topping: `1 - clamp(|placed-requested| / requested, 0,1)`,
averaged. Then penalise **wrong** toppings (placed types not requested):
`-0.15` each, and **placement spread** gives a small bonus for spreading
toppings out rather than stacking them in one spot (encourages "covering the
pie"). Final clamped to `[0,1]`.

### 6.2 Bake accuracy (`bake`)
Let band be `[lo,hi]`, pulled value `p`.
- If `lo ≤ p ≤ hi`: `1.0` (perfect), with a tiny bonus for centering.
- Else distance `d` from the nearest band edge maps through a falloff:
  `max(0, 1 - d / TOLERANCE)`. Under‑bake and over‑bake both penalised; severe
  over‑bake floors near 0.

### 6.3 Cut accuracy (`cut`)
- `countScore`: `1` if cuts == requiredCuts, else falls off by `0.34` per cut of
  difference.
- `evenScore`: sort cut angles into `[0,π)`, compute gaps including wrap, score
  `1 - normalizedStdDev(gaps)`.
- `cut = 0.55*countScore + 0.45*evenScore` (only if at least one cut, else 0).

### 6.4 Overall, stars, pay & tips
- `overall = 0.42*topping + 0.33*bake + 0.25*cut`.
- `stars = round(overall*5)` clamped `[0,5]` (display only; halves allowed via
  fractional fill).
- **Patience bonus:** the fraction of patience remaining at serve time scales
  the tip. Serving a near‑impatient customer well still pays the base; serving
  fast pays a fat tip.
- `pay = BASE_PRICE` (per pizza, scales slightly with day).
- `tip = round(pay * TIP_MAX * overall * (0.5 + 0.5*patienceRemaining) *
  marketingMultiplier)`.
- `earned = pay*overall_floor + tip`; a fully botched pizza still returns a small
  base so the player isn't bankrupted by one mistake, but a walked customer pays
  **nothing** and dents the day's reputation.

### 6.5 Failure / walkouts
- If a customer's patience hits 0 before served, they **leave**: ticket →
  `left`, angry particles, `lose`‑ish sfx, no pay, and a walkout counter
  increments. Their in‑progress pizza (if any) is discarded.

---

## 7. Day progression

- Each **day** has: a customer count `C(day)`, an arrival cadence, a difficulty
  profile (max toppings per order, bake tolerance, slice variety, patience), and
  a **rent / quota** the player must clear by day's end.
- Day flow: `dayStart` card (Day N, quota, what's new) → `play` until all the
  day's customers have been resolved (served or walked) → `dayEnd` earnings
  summary → `shop` → next `dayStart`.
- **Quota check** at `dayEnd`: if money earned that day ≥ quota, proceed; else
  the run ends — `ctx.gameOver(totalMoney)`.
- Difficulty ramps: more concurrent customers, shorter patience, tighter bake
  bands, more toppings & higher slice counts, faster arrivals.

### 7.1 Difficulty schedule (illustrative)
| Day | Customers | Max toppings | Bake tol | Slices | Patience | Quota |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 5 | 2 | wide | 2–4 | generous | low |
| 2 | 6 | 2 | wide | 4 | generous | low |
| 3 | 7 | 3 | normal | 4–6 | normal | med |
| 4 | 8 | 3 | normal | 6 | normal | med |
| 5 | 9 | 4 | tight | 6–8 | tight | high |
| 6+ | +1/day | up to 5 | tight | 8–12 | tighter | scaling |

Values are computed in `config.ts` via formulas, not a hand table, so the ramp
is smooth and endless.

---

## 8. Upgrade shop

Spent between days from accumulated money. Each upgrade has levels with rising
cost. Buying applies immediately to the next day.

| Upgrade | Effect per level | Levels |
| --- | --- | --- |
| **Faster Oven** (`oven_speed`) | Bake fills slower → wider effective timing window | 3 |
| **Extra Oven Rack** (`oven_slots`) | +1 simultaneous oven slot | 2 |
| **Prepped Tray** (`tray_quick`) | Toppings place faster / bigger drop tolerance | 3 |
| **Comfy Seats** (`seats`) | +patience for all customers | 3 |
| **Cozy Decor** (`decor`) | Slower patience drain (ambience) | 3 |
| **Sharper Cutter** (`cutter`) | More forgiving cut evenness scoring | 3 |
| **Auto Sauce** (`sauce_auto`) | Cosmetic: nicer base, small topping bonus | 1 |
| **Marketing** (`marketing`) | Higher tip multiplier | 3 |

Shop UI: grid of cards with icon, name, description, current level (pips),
price, **Buy** button (disabled when unaffordable or maxed). A **Start Day**
button advances. Owned levels persist.

---

## 9. Controls

**Universal (tap/drag — mouse & touch identical):**
- Tap a tab to switch station. Tap buttons to act.
- Tap a customer / **Take Order** to accept an order.
- **Drag** a topping from the tray onto the pizza to place it; or tap a tray slot
  to "hold" it, then tap the pizza.
- Tap the trash to remove the last topping.
- Tap **Bake** to send to oven; tap a baking pizza / **Pull** to remove it.
- **Drag across** the pizza on the cutting board to slice; tap **Serve**.
- Tap shop cards' **Buy**; tap **Start Day**.

**Desktop shortcuts (in addition):**
- `1 2 3 4` → switch to Orders / Build / Oven / Serve.
- `Space` / `Enter` → primary action of current station where unambiguous
  (e.g., take next order, pull most‑baked pizza, serve ready pizza).
- `Esc` → pause/title (optional).

**Touch ergonomics:** hit targets enlarge when `ctx.isTouch`; drag has a small
dead‑zone so a tap isn't misread as a drag.

---

## 10. Visual design

Cartoon kitchen rendered entirely with canvas primitives and gradients.

- **Palette:** warm pizzeria — terracotta / tomato reds, cheese golds, basil
  greens, checkered tablecloth accents, dark wood, cream walls. Defined centrally
  in `config.ts` `PALETTE`.
- **Background / kitchen:** tiled wall, a counter, a brick oven with a glowing
  mouth, hanging utensils, a checker‑floor — varies subtly per station so each
  tab feels like a different spot in the shop.
- **Pizza:** layered draw — crust ring (with bake‑darkening gradient), sauce
  disc, mottled cheese (procedural blobs), then toppings drawn per `drawKind`
  (pepperoni = red disc with speckles, mushroom = stylised cap, pepper = green
  ring arc, olive = ring, onion = translucent arc, etc.). Slice lines overlaid on
  the cutting board with subtle separation.
- **Customers:** procedurally generated avatars — rounded body, head, hair, and
  an expressive face whose **mouth/eyes morph with mood** (happy → flat →
  frown). A **patience bar** above each customer drains and shifts green→amber→
  red; the avatar subtly bounces when happy and shakes when angry.
- **HUD:** top bar with Day, Money (animated count‑up), today's served/total,
  and a mute toggle. Bottom tab bar with the four stations, each with an icon and
  an attention badge.
- **Polish:** count‑up money, floating `+$` text, star burst on great pizzas,
  oven glow flicker, steam/smoke particles, cheese sprinkle particles when
  placing, screen‑shake on walkouts, button press squash, smooth tab slide.

---

## 11. Audio design (procedural via `ctx.audio`)

- **Bell** (customer arrives): short two‑tone chime.
- **Pop** (place topping): tiny square blip with slight pitch jitter.
- **Whoosh** (send to oven): sweep down.
- **Sizzle** (pull pizza): filtered noise burst, pitch tied to bake quality.
- **Slice** (cut): quick high noise + tone.
- **Coins** (serve / tip): `coin()` plus extra for high stars.
- **Cha‑ching / win** (day cleared, big tip): ascending arpeggio.
- **Buzz / lose** (walkout, quota miss): descending tones.
- **Button tap**: subtle blip.
- Respects the engine's global mute; we never construct our own AudioContext.

---

## 12. Layout & responsiveness

- All geometry is computed each frame from `W = ctx.width`, `H = ctx.height`.
- Vertical split: **top HUD** (~9% H, min/max clamped), **stage** (middle),
  **tab bar** (~11% H). Stage content lays out within the remaining rect.
- The pizza/work area is sized to `min(stageW, stageH)` so it never clips, and is
  centered; side panels (ticket list, tray) flank it in landscape and stack /
  shrink in portrait.
- Font sizes derive from a base unit `u = clamp(min(W,H)*0.045, 11, 30)`.
- `resize()` simply lets the next frame recompute; no cached pixel positions
  persist across frames except animation state.

---

## 13. Persistence (`ctx.storage`)

Saved keys (namespaced by engine under `chg.save.papas-pizzeria.*`):
- `save`: `SaveData { money, day, best, upgrades, lifetimeServed, lifetimeTips }`.
- Best money also submitted via `ctx.storage.submitScore` / surfaced through
  `reportScore`.
- On `create`, load save; if present and mid‑run, offer **Continue** vs **New
  Shift** on the title. New shift resets money/day/upgrades for a fresh run but
  keeps `best`.
- Save is written at every meaningful transition (day end, shop purchase, run
  over) so progress survives a refresh.

---

## 14. State machine (`game.ts`)

```
title ──Play/Continue──► dayStart ──tap──► play
play ──all customers resolved──► dayEnd
dayEnd ──quota met──► shop ──Start Day──► dayStart(next)
dayEnd ──quota missed──► over ──► ctx.gameOver(money)
over ──tap──► title
```

`update(dt)` advances timers (patience, bake, arrivals, particles, animations),
processes input for the active state/station, recomputes derived flags. Each
state has its own update + render. `render()` always paints the kitchen
background, then the active station/screen, then the HUD overlay, then
particles, then transient floaters.

---

## 15. Registration (for the portal maintainer)

This game ships as a self‑contained folder and does **not** edit shared files.
To make it appear in the hub, add one entry to `src/registry/manifest.ts`:

```ts
{
  id: "papas-pizzeria", title: "Pizza Palace",
  description: "Run a pizzeria: take orders, top, bake, slice and serve before patience runs out.",
  section: "featured", category: "arcade", color: "#ff6b3d", icon: "🍕",
  players: "1P", aspect: 1.3, leaderboard: true, scoreLabel: "Money",
  instructions: ["Take orders, build, bake, slice & serve", "Drag toppings; pull pizzas at the green bake zone", "Beat the daily quota to keep going"],
  kind: "canvas", load: () => import("../games/papas-pizzeria"),
}
```

---

## 16. Acceptance criteria

1. `create(ctx)` returns a valid `GameInstance`; no `any`; compiles under strict
   TS using only `@/engine` + this folder.
2. Full background repainted each frame; reads `ctx.width/height` every frame and
   adapts to any aspect/size and to mobile touch.
3. All four stations are implemented and playable purely via tap/drag, with
   desktop keyboard shortcuts as a bonus.
4. Customers arrive, order, wait with a draining patience bar, and walk out if
   ignored; orders flow build → bake → cut → serve.
5. Scoring combines topping + bake + cut accuracy into stars + a tip; money and
   score update live via `reportScore`.
6. Day‑based progression with earnings screen, an upgrade shop, ramping
   difficulty, and a quota fail → `ctx.gameOver(money)`.
7. Best money + run progress persist across reloads via `ctx.storage`.
8. Polished procedural visuals (kitchen, animated customers, pizzas, particles),
   procedural SFX, and a clear HUD.

---

## 17. Tuning constants (initial, see `config.ts`)

- `BASE_PRICE = 12` (+`day*1.5`)
- `TIP_MAX = 0.9`
- Bake duration ≈ `9s` (− oven_speed), target band width ≈ `0.16` (+ tol level)
- Patience ≈ `42s` day 1, scaling `−2.5s/day` floored at `16s` (+ seats/decor)
- Arrival interval ≈ `6.5s` day 1, shrinking with day
- Oven slots `1` base, up to `3` with upgrade
- Quota ≈ `day * 60 * 0.8`, scaling

All values are centralised so balance can be tweaked in one place.

---

*End of PRD.*
