# Klondike Solitaire — Product Requirements Document

> Game id: `solitaire` · Folder: `src/games/solitaire/`
> Original implementation for the CoolHastorGames TypeScript + Vite portal.
> All card art is drawn procedurally on the canvas — there are **no external
> asset files** and nothing is copied from any other application.

---

## 1. Overview

Klondike is the most popular single-player card game in the world — the
"Solitaire" that shipped with Windows. This document specifies a complete,
polished, original implementation that runs inside the portal's canvas game
engine (`GameContext` / `GameInstance`).

The game must:

- Implement the **full standard rules** of Klondike Solitaire.
- Support **mouse and touch** with smooth drag-and-drop of single cards and
  ordered stacks.
- Provide quality-of-life features: **tap / double-tap to auto-send** a card to
  its foundation, **undo**, **new game / reshuffle**, an **auto-complete**
  routine when the board is solvable, a **draw-1 / draw-3 toggle**.
- Be **juicy**: deal animation, snapping, invalid-move bounce-back, card flip
  animation, hint pulse, win fireworks + the classic cascading-card celebration.
- Track and display **score, time and moves**, report the score live, and
  **persist best score + win count** via `ctx.storage`.
- Be fully **responsive** — read `ctx.width` / `ctx.height` every frame and
  reflow for any aspect ratio (portrait phones through wide desktops).
- Be written in **strict TypeScript** with no `any`, no React, no third-party
  libraries, importing only from `@/engine` and this folder.

### Design pillars

1. **Faithful** — the rules and scoring feel exactly like the classic.
2. **Tactile** — every interaction has motion and sound; the table feels alive.
3. **Forgiving** — undo, auto-move, hints and auto-complete reduce frustration.
4. **Portable** — one render path that scales to any screen and input device.

---

## 2. Terminology

| Term | Meaning |
| --- | --- |
| **Card** | One of 52 playing cards: a `suit` (♠ ♥ ♦ ♣) + a `rank` (A,2–10,J,Q,K). |
| **Suit color** | Spades/Clubs are **black**; Hearts/Diamonds are **red**. |
| **Rank value** | Ace = 1 … King = 13. |
| **Pile** | An ordered collection of cards with a role and a position. |
| **Stock** | The face-down draw pile (top-left). |
| **Waste** | The face-up discard beside the stock; you play from its top. |
| **Foundation** | One of four build-up piles (top-right), one per suit, A→K. |
| **Tableau** | One of seven columns where the main play happens. |
| **Face-up / face-down** | Whether a card's front is visible. |
| **Sequence / run** | A set of face-up tableau cards in valid descending, alternating-color order. |
| **Pass** | One full cycle through the stock back to empty. |

---

## 3. Board layout

```
 ┌────────┐ ┌────────┐                ┌────┐┌────┐┌────┐┌────┐
 │ STOCK  │ │ WASTE  │                │ ♠F ││ ♥F ││ ♦F ││ ♣F │   ← foundations
 └────────┘ └────────┘                └────┘└────┘└────┘└────┘
                                                                  (top row)
 ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐
 │ T0 ││ T1 ││ T2 ││ T3 ││ T4 ││ T5 ││ T6 │                       ← tableau
 └────┘└────┘└────┘└────┘└────┘└────┘└────┘
   …cards cascade downward, only the bottom one fully visible…
```

- **Seven tableau columns** define the horizontal grid. The top row reuses the
  same column slots: column 0 → stock, column 1 → waste, columns 3–6 → the four
  foundations (column 2 is an intentional gap).
- Cards keep a **2.5 : 3.5** aspect ratio (height = 1.4 × width), like real
  cards.
- Card width is derived from the available width so all seven columns + gaps
  fit. The layout is recomputed every frame from `ctx.width` / `ctx.height`, so
  resizing and orientation changes are seamless.
- In very tall/narrow (portrait phone) viewports the cards grow to fill width;
  in wide viewports the whole board is centered with comfortable margins.

### Fan offsets

- **Face-down** tableau cards overlap tightly (small vertical step).
- **Face-up** tableau cards overlap more loosely (larger vertical step) so each
  rank/suit index is readable.
- When a column is tall enough to overflow the play area, the face-up step
  compresses adaptively so the column always fits on screen.

---

## 4. Setup / deal

1. Build a standard **52-card deck** (4 suits × 13 ranks).
2. **Shuffle** with an unbiased Fisher–Yates shuffle (using `Math.random`; a
   seeded RNG is available from `@/engine` for future daily deals).
3. Deal into the seven tableau columns: column *i* receives *i + 1* cards
   (1, 2, 3, 4, 5, 6, 7 = 28 cards). In each column only the **top (last) card
   is face-up**; the rest are face-down.
4. The remaining **24 cards** form the face-down stock. The waste starts empty.
5. All four foundations start empty.
6. The deal is **animated**: cards fly out from the stock position to their
   tableau slots one-by-one with a short stagger and a landing sound. Input is
   locked until the deal completes.

---

## 5. Rules of play

### 5.1 Foundations (goal piles)

- There are four foundations, one per suit.
- A foundation is built **up by suit starting from the Ace**: A, 2, 3, …, K.
- A card may be moved to a foundation if:
  - the foundation is **empty** and the card is an **Ace**, **or**
  - the foundation's top card is the **same suit** and **exactly one rank
    lower** (e.g. ♥6 onto ♥5).
- The game is **won** when all four foundations are complete (each holds 13
  cards, A→K).

### 5.2 Tableau columns

- A face-up card (or a valid run of face-up cards) may be moved onto another
  tableau column if the destination's bottom (visible) card is:
  - the **opposite color**, and
  - **exactly one rank higher** (e.g. red ♥6 onto black ♠7).
- A run that is itself in valid descending/alternating order moves as a unit.
- An **empty tableau column** may only receive a **King** (or a run headed by a
  King).
- When a face-down tableau card becomes the new bottom card of its column (its
  covering card was moved away), it **automatically flips face-up** (with a flip
  animation and sound, and a small score bonus).

### 5.3 Stock & waste

- **Draw** by clicking/tapping the stock:
  - **Draw 1** mode: move the top stock card to the waste, face up.
  - **Draw 3** mode: move up to three stock cards to the waste; the top one is
    fully visible, the two beneath are fanned/peeked.
- Only the **top** waste card may be played (to a tableau or a foundation).
- When the stock is empty, clicking it **recycles** the entire waste back into
  the stock (face down, order preserved) to begin a new pass.
- **Recycle limits / penalty**: recycling is always allowed, but it costs score
  (see scoring). This matches the classic timed scoring behavior.

### 5.4 Legal-move summary

| From | To | Condition |
| --- | --- | --- |
| Waste top | Foundation | empty+Ace, or same suit +1 rank |
| Waste top | Tableau | onto opposite-color, +1 rank; King → empty column |
| Tableau run | Tableau | bottom of run onto opposite-color, +1 rank; King → empty |
| Tableau top | Foundation | empty+Ace, or same suit +1 rank |
| Foundation top | Tableau | opposite-color, +1 rank (allowed, but penalized) |
| Stock | Waste | draw 1 or 3 |
| Waste (all) | Stock | recycle when stock empty |

---

## 6. Interaction model

### 6.1 Pointer handling

The engine exposes a unified pointer: `input.pointer { x, y, down, justDown,
justUp }` in logical (CSS-pixel) coordinates. We additionally track press
position and time to distinguish **tap** from **drag** and to detect
**double-tap**.

State machine per pointer gesture:

```
IDLE ──justDown on grabbable card──▶ MAYBE_DRAG
MAYBE_DRAG ──moved > threshold──▶ DRAGGING
MAYBE_DRAG ──justUp before threshold──▶ TAP (auto-move attempt / stock draw)
DRAGGING ──justUp──▶ DROP (validate → move or bounce-back)
```

- **Drag threshold**: a few logical pixels (scaled to card size) so a small
  wobble during a tap is not treated as a drag.
- **Tap**: releasing without crossing the threshold.
- **Double-tap**: a second tap on the same card within ~300 ms.

### 6.2 Grabbing cards

- **Stock**: tap → draw (or recycle if empty). Not draggable.
- **Waste**: the top card is grabbable (drag) and tappable (auto-move).
- **Foundation**: the top card is grabbable (you can pull it back to the
  tableau) — penalized in score.
- **Tableau**: tapping/grabbing a **face-up** card picks up that card **plus all
  cards below it** *only if* they form a valid descending/alternating run; if
  the cards below are not a valid run you can still only pick up from a card
  whose tail is valid (in practice the visible run is always valid because we
  only ever build valid runs). A **face-down** card is not grabbable (tapping it
  does nothing; tapping the column's top face-down card after a move triggers
  its flip automatically).

### 6.3 Drag & drop

- While dragging, the held stack is drawn following the pointer with a slight
  lift (shadow + offset), preserving the fan spacing between the held cards.
- Valid drop targets are **highlighted** while a compatible card hovers over
  them.
- On release we find the pile under the pointer (top-most hit). If the move is
  **legal**, the stack snaps into place with a short ease and a "place" sound.
- If the move is **illegal** (or released over empty space), the stack
  **bounces back** to its origin with a spring-like ease and a soft "deny"
  sound. No state changes.
- Dropping a single card: prefer foundation if it overlaps a foundation and the
  move is legal; otherwise tableau.

### 6.4 Tap / double-tap to auto-send

- A **single tap** on a waste/tableau top card (that didn't become a drag)
  attempts to **auto-send it to a foundation** if legal. This is the fast path
  for clearing aces/low cards.
- A **double-tap** also attempts the foundation auto-send (kept as an explicit
  alternative and for users who tap-drag). If a foundation move isn't available,
  a single/double tap may optionally try a "best tableau" move — but the primary
  behavior is foundation auto-send to avoid surprising the player.
- Auto-send animates the card flying to the foundation.

### 6.5 On-screen controls / buttons (HUD)

A compact button bar (works for mouse and touch) provides:

- **New** — start a fresh shuffled game (with confirmation if a game is in
  progress and not won, to avoid accidental loss).
- **Undo** — revert the last move (disabled when there's nothing to undo).
- **Hint** — pulse-highlight a suggested legal move (best available).
- **Draw 1 / Draw 3** — toggle the draw mode (applies on the next new game, and
  immediately if safe).
- **Auto** — appears/enables only when the board is in an auto-completable state
  (no face-down tableau cards remain). Runs the auto-complete routine.
- **Sound** — mute/unmute toggle (mirrors the engine's global mute).

Buttons are drawn on the canvas (no DOM) so they scale with the board and work
identically on every device. `ctx.requestControls([...])` may also register a
couple of engine touch buttons as a fallback.

---

## 7. Undo

- Every state-changing action pushes an **undo record** onto a stack before it
  mutates state. Actions: draw, recycle, tableau↔tableau move, waste→pile move,
  pile→foundation move, foundation→tableau move, auto-send, and the flips that
  result from a move (flips are bundled into the move that caused them so a
  single undo reverses both).
- **Undo** pops the last record and restores the exact prior state (including
  face-up/face-down flags and score), then plays a soft sound.
- Undo does **not** restore time (the clock keeps the real elapsed time) but it
  **does** restore the move-count and score so scoring stays consistent.
- The deal itself is not undoable (use New game instead). Auto-complete moves
  are not individually undoable while running.

Implementation: the simplest robust approach is to **snapshot** the serializable
game state (piles + score + moves + draw mode + pass count) before each action
and store snapshots in a bounded stack (e.g. last 200). Undo restores the most
recent snapshot. This avoids fiddly inverse-operation bugs.

---

## 8. Scoring

We use a **standard Windows-style timed score**, never allowed below zero:

| Event | Points |
| --- | --- |
| Waste → Tableau | +5 |
| Waste → Foundation | +10 |
| Tableau → Foundation | +10 |
| Turn over (flip) a tableau card | +5 |
| Foundation → Tableau | −15 |
| Recycle waste (Draw 1), each pass after the first | −100 |
| Recycle waste (Draw 3), each pass after the third | −20 |

Additional:

- **Move counter** increments on each player move (draws + relocations).
- **Timer** counts up from the first action; shown as `m:ss`.
- **Time bonus on win**: a bonus inversely proportional to elapsed time is added
  to the final score (faster wins score more), e.g.
  `bonus = floor(700000 / max(seconds, 30))` (classic Windows formula
  `bonus = 700000 / seconds` for games longer than 30 s).
- The HUD score is reported **live** via `ctx.reportScore(score)`.
- On win we call `ctx.gameOver(finalScore)` after the celebration.

`scoreLabel` for this game is **"Score"** (higher is better).

### Persistence (`ctx.storage`)

| Key | Meaning |
| --- | --- |
| `best` | Best score achieved (also submitted via `storage.submitScore`). |
| `wins` | Total games won. |
| `played` | Total games started. |
| `drawMode` | Last chosen draw mode (1 or 3). |
| `bestTime` | Fastest win time in ms (for flavor in HUD). |

---

## 9. Win condition & celebration

- **Win** = all four foundations complete (52 cards home).
- On win:
  1. Add the time bonus and report the final score.
  2. Update `wins`, `best`, `bestTime` in storage.
  3. Play the win jingle.
  4. Trigger the **celebration**: fireworks particles + the classic
     "bouncing cards" cascade where cards launch from the foundations and bounce
     across the table leaving trails.
  5. After the celebration, call `ctx.gameOver(finalScore)`.
- A **You Win!** banner shows the final score, time and move count, with a
  **Play Again** affordance.

---

## 10. Auto-complete

- The **Auto** button becomes available when the board is **auto-completable**:
  there are **no face-down cards remaining in the tableau** (everything the
  solver needs is freely reachable, possibly via cycling the stock).
- The routine repeatedly performs the best foundation move:
  - Scan the tops of all tableau columns, the waste top, and (by drawing) the
    stock for any card that is currently legal on a foundation.
  - Prefer playing the **lowest rank** available to keep all foundations
    climbing evenly so that no needed card stays buried.
  - If nothing is immediately playable, **draw** from the stock (recycling when
    empty) to expose more cards.
  - Each step is **animated** (card flies to its foundation) with a small delay
    for a satisfying cascade.
  - A safety guard stops the routine if a full stock cycle yields no progress
    (prevents infinite loops in degenerate states).
- Auto-complete naturally drives the game to the **win** state and celebration.

---

## 11. Hint system

- **Hint** scans for a legal, *useful* move in priority order:
  1. Any card → foundation (especially aces and cards that unblock).
  2. A move that exposes/flips a face-down tableau card.
  3. A move that empties a column (frees it for a King) or relocates a useful
     run.
  4. Drawing from the stock if nothing else is available.
- The chosen source + destination are **pulse-highlighted** for ~1.5 s. Hint is
  advisory only — it does not perform the move.

---

## 12. Rendering

Every frame (`render()`):

1. **Repaint the full background** (felt-green radial/linear gradient with a
   subtle vignette and table texture) — never assume the canvas is cleared.
2. Recompute the **layout** from `ctx.width` / `ctx.height`.
3. Draw **empty pile placeholders** (rounded outline + a faint suit/⟳ marker for
   foundations and stock).
4. Draw the **stock, waste, foundations, tableau** in order, including fanned
   cards.
5. Draw any **in-flight animation cards** (deal, auto-send, bounce-back, flip)
   on top of their piles.
6. Draw the **dragged stack** following the pointer (on top of everything).
7. Draw **highlights** (valid drop target, hint pulse).
8. Draw the **HUD**: title/score/time/moves, the **button bar**, draw-mode
   indicator, best score & win count.
9. Draw **overlays**: win banner + celebration particles; new-game confirm.

### Procedural card art

Each card is drawn from scratch (no images):

- **Card body**: white rounded rectangle with a subtle inner border and soft
  drop shadow; gentle gradient for a printed feel.
- **Suit pips**: ♠ ♥ ♦ ♣ are drawn with canvas paths (no font glyph reliance for
  the big center symbol; small corner pips can use the unicode glyph as a
  fallback but the primary art is path-drawn for crispness and originality).
- **Rank**: A, 2–10, J, Q, K drawn in the top-left and bottom-right corners
  (bottom-right rotated 180°), colored red or black by suit.
- **Center**: pip layout per rank (the traditional arrangement of 1–10 pips) for
  number cards; a decorative monogram panel for J/Q/K with a large suit and the
  letter, in an original ornamental style.
- **Ace**: one large ornamental center pip.
- **Face-down back**: an original repeating diamond/lattice pattern in a deep
  blue/teal with a border — clearly our own design, not a copy of any product.
- **Highlight/selected** states tint or outline the card (glow ring).

All sizes (corner text, pip radius, spacing) are derived from the current card
width so art stays crisp at any scale and on HiDPI (the engine pre-scales the
context by device pixel ratio).

---

## 13. Animation system

A lightweight tween list drives motion. Each animated card stores
`{ card, fromX, fromY, toX, toY, t, dur, kind, onDone }`; `update(dt)` advances
`t`, eased position = `lerp(from, to, ease(t/dur))`. Kinds:

- **deal** — staggered fly from stock to tableau on new game (input locked).
- **fly** — auto-send / auto-complete card to a foundation (or any programmatic
  move) then commit.
- **snap** — a dropped legal move eases into place (can be instant + a small
  scale pop instead of a full tween for snappiness).
- **bounce** — illegal drop springs back to origin.
- **flip** — a tableau card turning face-up: horizontal scale 1 → 0 → 1 swapping
  the face at the midpoint.
- **celebrate** — physics-y bouncing cards + fireworks particles on win.

Easing helpers: `easeOutCubic`, `easeOutBack` (for the pop/snap), and a damped
spring for bounce-back. All durations are short (80–350 ms) to keep play snappy.

Input is **locked** during the deal and during auto-complete; normal drag is
always responsive otherwise (a programmatic fly for a tapped card does not lock
the whole board, only that card is in transit).

---

## 14. Audio (procedural, via `ctx.audio`)

Map game events to the engine's synth helpers:

| Event | Sound |
| --- | --- |
| Draw / deal land | short `tone` blip / soft click |
| Legal place | `tone` pleasant click (pitch rises with foundation progress) |
| Flip reveal | quick `sweep` |
| Foundation score | `coin` |
| Illegal / deny | low `tone` buzz |
| Undo | soft descending `tone` |
| Recycle | `sweep` whoosh |
| Win | `win` jingle + sparkle blips during fireworks |

All sounds respect the global mute. Audio must be triggered only from user
gestures or the update loop (the engine resumes the audio context on first
interaction).

---

## 15. HUD details

- **Top bar**: `Score`, `Time` (`m:ss`), `Moves`, plus `Best` and `Wins` from
  storage. Compact, readable on small screens (scales with viewport).
- **Button bar**: New · Undo · Hint · Draw 1/3 · Auto (when available) · Sound.
- Buttons show **disabled** styling when not actionable (e.g. Undo with empty
  history, Auto when not yet solvable).
- The bar position adapts: in portrait it sits at the bottom; in landscape it
  may sit along the top or bottom depending on space. Hit-testing matches the
  drawn rects exactly.

---

## 16. Responsiveness & input details

- Read `ctx.width` / `ctx.height` **every frame**; never cache stage size.
- Compute a `Layout` object each frame: card size, pile origins, fan steps,
  button rects, HUD positions.
- Support **mouse** (hover highlights, click) and **touch** (drag, tap,
  double-tap). The same pointer abstraction handles both.
- Ensure tap targets are large enough on phones; the stock/foundations remain
  comfortably tappable.
- On `resize()` nothing special is required because layout is per-frame; we just
  avoid storing absolute pixel positions in game state (positions are derived).

---

## 17. Data model (types)

```ts
type Suit = "spades" | "hearts" | "diamonds" | "clubs";
type Color = "red" | "black";
interface Card { suit: Suit; rank: number /*1..13*/; faceUp: boolean; id: number; }

type PileKind = "stock" | "waste" | "foundation" | "tableau";
interface Pile { kind: PileKind; index: number; cards: Card[]; }

interface GameState {
  stock: Card[];
  waste: Card[];
  foundations: Card[][]; // length 4
  tableau: Card[][];     // length 7
  score: number;
  moves: number;
  passes: number;        // stock cycles used
  drawMode: 1 | 3;
}
```

State is kept directly on the engine instance; snapshots (deep clones) power
undo. Card `id` is a stable 0–51 index used for animation identity.

---

## 18. Core algorithms

- **Shuffle**: Fisher–Yates over the 52-card array.
- **canMoveToFoundation(card, foundation)**: empty ⇒ rank 1; else same suit and
  `card.rank === top.rank + 1`.
- **canMoveToTableau(card, column)**: empty ⇒ rank 13 (King); else
  `color(card) !== color(bottom)` and `card.rank === bottom.rank - 1`.
- **grabbableRun(column, index)**: from `index` to end, valid if each adjacent
  pair is descending by one and alternating color and all face-up.
- **applyMove**: snapshot → mutate piles → flip newly-exposed tableau card →
  update score/moves → check win.
- **isAutoCompletable**: no face-down cards in any tableau column.
- **autoStep**: pick lowest-rank legal foundation move from reachable tops; else
  draw/recycle; else done.
- **findHint**: priority scan described in §11.

---

## 19. Edge cases

- Dropping a stack so its top overlaps multiple piles → choose the pile with the
  greatest overlap area; ties prefer foundations for single cards.
- Recycling an empty stock with an empty waste → no-op (no penalty).
- Auto-send tapped card with no legal foundation → gentle deny feedback, no
  state change.
- Dragging the only face-up card off a column then dropping illegally → bounce
  back, the face-down card stays face-down.
- Rapid taps → debounce double-tap detection; never double-apply a move.
- Window resized mid-drag → drag uses live pointer + live layout, so it keeps
  working; the origin for bounce-back is recomputed from the source pile.
- Extremely small viewports → fan steps compress; card text uses minimum legible
  sizes; buttons may wrap/shrink labels.

---

## 20. Acceptance criteria

A build is complete when:

- [ ] A new game deals 28 tableau + 24 stock with the correct face-up pattern,
      animated.
- [ ] Draw 1 and Draw 3 both work, with recycle and the correct penalties.
- [ ] All legal moves validated correctly; illegal moves bounce back.
- [ ] Dragging single cards and valid runs works for mouse and touch.
- [ ] Tap / double-tap auto-sends a card to its foundation when legal.
- [ ] Tableau cards flip when exposed (animated, scored).
- [ ] Undo reliably restores the prior state (incl. flips & score).
- [ ] New game reshuffles; confirmation guards an in-progress game.
- [ ] Auto button appears only when solvable and finishes the game.
- [ ] Win is detected; celebration plays; `gameOver(finalScore)` is called.
- [ ] Score (with time bonus), time and moves are correct and reported live.
- [ ] Best score + win count persist across sessions.
- [ ] Fully responsive across portrait/landscape and HiDPI; no layout caching.
- [ ] Strict TS, no `any`, only `@/engine` + local imports, canvas-only visuals.

---

## 21. File structure

```
src/games/solitaire/
  PRD.md      ← this document
  cards.ts    ← types, deck creation, shuffle, rule predicates, helpers
  art.ts      ← procedural card / back / pip / placeholder drawing
  layout.ts   ← per-frame responsive geometry (piles, fans, buttons, HUD)
  logic.ts    ← GameState, moves, undo snapshots, scoring, auto, hint
  index.ts    ← create(ctx): GameInstance — input, animation, render, HUD
```

`index.ts` exports `create(ctx: GameContext): GameInstance` as required by the
canvas game module contract.

---

## 22. Controls summary (for the player)

- **Draw**: click/tap the stock pile (recycles when empty).
- **Move**: drag a card or a valid run onto a legal pile.
- **Auto to foundation**: tap (or double-tap) a card.
- **Undo**: Undo button or `Z` / `Ctrl+Z`.
- **New game**: New button or `N`.
- **Hint**: Hint button or `H`.
- **Auto-complete**: Auto button (when available) or `A`.
- **Toggle draw mode**: Draw 1/3 button.
- **Mute**: Sound button or `M`.

Keyboard shortcuts are a bonus on desktop; pointer is the primary input.
