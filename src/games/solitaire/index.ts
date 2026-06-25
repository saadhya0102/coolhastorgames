/**
 * Klondike Solitaire — canvas game controller.
 *
 * Ties together the rules engine (logic.ts), procedural card art (art.ts) and
 * responsive geometry (layout.ts) into a polished, animated, mouse + touch
 * playable game. Exports `create(ctx): GameInstance` per the engine contract.
 *
 * Original implementation — all visuals are drawn procedurally, no assets.
 */

import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, formatTime, lerp, pointInRect, roundRect } from "@/engine";

import type { Card, Suit } from "./cards";
import { drawCard, drawCardBack, drawPlaceholder } from "./art";
import { computeLayout, type Layout } from "./layout";
import { SolitaireGame, type DrawMode, type PileRef } from "./logic";

interface Vec {
  x: number;
  y: number;
}

interface FlyAnim {
  cards: Card[];
  from: Vec[];
  to: Vec[];
  t: number;
  dur: number;
  onDone?: () => void;
}

interface BounceAnim {
  cards: Card[];
  from: Vec[];
  to: Vec[];
  t: number;
  dur: number;
  ids: number[];
}

interface FlipAnim {
  id: number;
  t: number;
  dur: number;
}

interface DealCard {
  card: Card;
  col: number;
  index: number;
  delay: number;
  t: number;
  dur: number;
  started: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Bouncer {
  card: Card;
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: Vec[];
}

type Phase = "dealing" | "playing" | "autocomplete" | "celebrating";

// ---- easing -----------------------------------------------------------------
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const BUTTON_IDS = ["new", "undo", "hint", "draw", "auto", "sound"];

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  const game = new SolitaireGame(
    storage.get<DrawMode>("drawMode", 1) === 3 ? 3 : 1,
  );

  let best = storage.get<number>("best", 0);
  let wins = storage.get<number>("wins", 0);
  let bestTime = storage.get<number>("bestTime", 0);

  let L: Layout = computeLayout(ctx.width, ctx.height, {
    tableauCounts: [0, 0, 0, 0, 0, 0, 0],
    tableauFaceDown: [0, 0, 0, 0, 0, 0, 0],
    buttonIds: BUTTON_IDS,
  });

  let phase: Phase = "dealing";
  let now = 0; // seconds accumulator
  let timeMs = 0;
  let timerRunning = false;

  // animations
  const flies: FlyAnim[] = [];
  const bounces: BounceAnim[] = [];
  const flips: FlipAnim[] = [];
  const animatingIds = new Set<number>();
  const bouncingIds = new Set<number>();
  const draggingIds = new Set<number>();

  // deal
  let dealCards: DealCard[] = [];
  let dealClock = 0;
  const pendingDealIds = new Set<number>();

  // drag
  interface Drag {
    source: PileRef;
    sourceIndex: number;
    cards: Card[];
    grabDX: number;
    grabDY: number;
    px: number;
    py: number;
  }
  let drag: Drag | null = null;

  // press tracking (tap vs drag, buttons)
  interface Press {
    x: number;
    y: number;
    candidate: { ref: PileRef; index: number } | null;
    button: string | null;
    stock: boolean;
    overlay: string | null;
  }
  let press: Press | null = null;
  let lastTap = { id: -1, time: 0 };

  // hint
  let hint: { source: PileRef; target: PileRef; until: number } | null = null;

  // auto
  let autoTimer = 0;
  let autoNoProgress = 0;

  // celebration
  let particles: Particle[] = [];
  let bouncers: Bouncer[] = [];
  let celebrateTime = 0;
  let nextBurst = 0;
  let bouncerSpawnIdx = 0;
  let finalScore = 0;
  let gameOverCalled = false;

  // overlays
  let confirmNew = false;

  ctx.setStatus("Drag cards to build · tap a card to send it home");
  ctx.requestControls([]);

  // --------------------------------------------------------------------------
  // helpers: positions
  // --------------------------------------------------------------------------

  function pileCards(ref: PileRef): Card[] {
    return game.pileCards(ref);
  }

  function getCardPos(ref: PileRef, idx: number): Vec {
    switch (ref.kind) {
      case "stock":
        return { x: L.stock.x, y: L.stock.y };
      case "foundation":
        return { x: L.foundations[ref.index].x, y: L.foundations[ref.index].y };
      case "waste": {
        const len = game.waste.length;
        const vis = Math.min(len, game.drawMode === 3 ? 3 : 1);
        const firstVisible = len - vis;
        const r = L.waste;
        if (idx < firstVisible) return { x: r.x, y: r.y };
        return { x: r.x + (idx - firstVisible) * L.wasteFanStep, y: r.y };
      }
      case "tableau": {
        const col = game.tableau[ref.index];
        const r = L.tableau[ref.index];
        let off = 0;
        for (let i = 0; i < idx && i < col.length; i++) {
          off += col[i].faceUp ? L.faceUpStep : L.faceDownStep;
        }
        return { x: r.x, y: r.y + off };
      }
    }
  }

  function findCard(id: number): { ref: PileRef; idx: number; card: Card } | null {
    for (let i = game.waste.length - 1; i >= 0; i--) {
      if (game.waste[i].id === id) return { ref: { kind: "waste" }, idx: i, card: game.waste[i] };
    }
    for (let f = 0; f < 4; f++) {
      const arr = game.foundations[f];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === id) return { ref: { kind: "foundation", index: f }, idx: i, card: arr[i] };
      }
    }
    for (let t = 0; t < 7; t++) {
      const arr = game.tableau[t];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === id) return { ref: { kind: "tableau", index: t }, idx: i, card: arr[i] };
      }
    }
    for (let i = game.stock.length - 1; i >= 0; i--) {
      if (game.stock[i].id === id) return { ref: { kind: "stock" }, idx: i, card: game.stock[i] };
    }
    return null;
  }

  const isHidden = (id: number): boolean =>
    animatingIds.has(id) ||
    bouncingIds.has(id) ||
    draggingIds.has(id) ||
    (phase === "dealing" && pendingDealIds.has(id));

  // --------------------------------------------------------------------------
  // animation helpers
  // --------------------------------------------------------------------------

  function addFly(cards: Card[], from: Vec[], to: Vec[], dur: number, onDone?: () => void) {
    for (const c of cards) animatingIds.add(c.id);
    flies.push({ cards, from, to, t: 0, dur, onDone });
  }

  function addBounce(cards: Card[], from: Vec[], to: Vec[]) {
    const ids = cards.map((c) => c.id);
    for (const id of ids) bouncingIds.add(id);
    bounces.push({ cards, from, to, t: 0, dur: 0.32, ids });
  }

  function addFlip(id: number) {
    flips.push({ id, t: 0, dur: 0.26 });
  }

  function clearAnims() {
    flies.length = 0;
    bounces.length = 0;
    flips.length = 0;
    animatingIds.clear();
    bouncingIds.clear();
    draggingIds.clear();
    drag = null;
  }

  const animationsActive = () => flies.length > 0 || bounces.length > 0;

  // --------------------------------------------------------------------------
  // moves
  // --------------------------------------------------------------------------

  function afterMove() {
    timerRunning = true;
    ctx.reportScore(game.score);
    if (game.won && phase !== "celebrating") startCelebration();
  }

  function performMove(
    source: PileRef,
    sourceIndex: number,
    target: PileRef,
    fromOverride?: Vec[],
  ): boolean {
    const moving = game.movableSlice(source, sourceIndex);
    if (moving.length === 0) return false;
    const cards = moving.slice();
    const fromPos =
      fromOverride ?? cards.map((_, i) => getCardPos(source, sourceIndex + i));
    const res = game.applyMove(source, sourceIndex, target);
    if (!res.ok) return false;

    const toPos = cards.map((c) => {
      const loc = findCard(c.id);
      return loc ? getCardPos(loc.ref, loc.idx) : fromPos[0];
    });
    addFly(cards, fromPos, toPos, target.kind === "foundation" ? 0.22 : 0.16);

    if (res.toFoundation) audio.coin();
    else audio.tone(420, 0.05, "sine", 0.25);
    if (res.flippedCardId != null) {
      addFlip(res.flippedCardId);
      audio.sweep(300, 620, 0.12, "sine", 0.25);
    }
    afterMove();
    return true;
  }

  function performDraw() {
    const res = game.draw();
    if (!res.ok) return;
    if (res.movedCardIds.length) {
      const cards = res.movedCardIds
        .map((id) => findCard(id))
        .filter((x): x is { ref: PileRef; idx: number; card: Card } => x !== null)
        .map((x) => x.card);
      const fromPos = cards.map(() => ({ x: L.stock.x, y: L.stock.y }));
      const toPos = cards.map((c) => {
        const loc = findCard(c.id);
        return loc ? getCardPos(loc.ref, loc.idx) : { x: L.waste.x, y: L.waste.y };
      });
      addFly(cards, fromPos, toPos, 0.16);
      audio.tone(360, 0.05, "sine", 0.3);
    } else {
      audio.sweep(500, 200, 0.22, "sine", 0.3);
    }
    afterMove();
  }

  function doUndo() {
    if (!game.canUndo) {
      audio.tone(180, 0.08, "sine", 0.2);
      return;
    }
    clearAnims();
    game.undo();
    audio.sweep(420, 260, 0.14, "sine", 0.28);
    ctx.reportScore(game.score);
  }

  function doHint() {
    const h = game.findHint();
    if (!h) {
      audio.tone(180, 0.08, "sine", 0.2);
      return;
    }
    if ("isDraw" in h) {
      hint = { source: { kind: "stock" }, target: { kind: "stock" }, until: now + 1.4 };
    } else {
      hint = { source: h.source, target: h.target, until: now + 1.6 };
    }
    audio.tone(700, 0.05, "sine", 0.25);
  }

  function startAuto() {
    if (!game.isAutoCompletable() || game.won) return;
    clearAnims();
    phase = "autocomplete";
    autoTimer = 0;
    autoNoProgress = 0;
    audio.tone(660, 0.06, "triangle", 0.3);
  }

  function startNewGame(mode?: DrawMode) {
    game.newGame(mode ?? game.drawMode);
    const played = storage.get<number>("played", 0) + 1;
    storage.set("played", played);
    storage.set("drawMode", game.drawMode);
    timeMs = 0;
    timerRunning = false;
    clearAnims();
    particles = [];
    bouncers = [];
    confirmNew = false;
    hint = null;
    gameOverCalled = false;
    phase = "dealing";
    buildDeal();
    ctx.reportScore(0);
  }

  function buildDeal() {
    dealCards = [];
    pendingDealIds.clear();
    dealClock = 0;
    let order = 0;
    for (let n = 0; n < 7; n++) {
      for (let col = n; col < 7; col++) {
        const card = game.tableau[col][n];
        if (!card) continue;
        pendingDealIds.add(card.id);
        dealCards.push({
          card,
          col,
          index: n,
          delay: order * 0.05,
          t: 0,
          dur: 0.3,
          started: false,
        });
        order++;
      }
    }
  }

  function finishDeal() {
    dealCards = [];
    pendingDealIds.clear();
    phase = "playing";
  }

  // --------------------------------------------------------------------------
  // win celebration
  // --------------------------------------------------------------------------

  function startCelebration() {
    phase = "celebrating";
    const sec = timeMs / 1000;
    const bonus = sec > 0 ? Math.floor(700000 / Math.max(sec, 30)) : 20000;
    finalScore = game.score + bonus;
    game.score = finalScore;
    ctx.reportScore(finalScore);

    wins += 1;
    storage.set("wins", wins);
    if (finalScore > best) {
      best = finalScore;
    }
    storage.submitScore(finalScore);
    best = Math.max(best, finalScore);
    if (bestTime === 0 || timeMs < bestTime) {
      bestTime = timeMs;
      storage.set("bestTime", bestTime);
    }

    audio.win();
    celebrateTime = 0;
    nextBurst = 0;
    bouncerSpawnIdx = 0;
    bouncers = [];
    particles = [];
  }

  function spawnBurst(x: number, y: number) {
    const palette = ["#ffd23f", "#ff5c8a", "#46e0a0", "#19d3ff", "#ff7b54", "#c8a0ff"];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const count = 22;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const sp = (0.4 + Math.random() * 0.9) * Math.min(L.W, L.H);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        maxLife: 0.8 + Math.random() * 0.7,
        color,
        size: L.cardW * (0.04 + Math.random() * 0.05),
      });
    }
    audio.tone(700 + Math.random() * 500, 0.08, "triangle", 0.25);
  }

  function updateCelebration(dt: number) {
    celebrateTime += dt;
    const W = L.W;
    const H = L.H;

    // periodic fireworks
    nextBurst -= dt;
    if (nextBurst <= 0 && celebrateTime < 6) {
      nextBurst = 0.35;
      spawnBurst(W * (0.15 + Math.random() * 0.7), H * (0.15 + Math.random() * 0.4));
    }

    // launch bouncing cards from foundations over time
    if (bouncerSpawnIdx < 52 && bouncers.length < 14) {
      const fi = bouncerSpawnIdx % 4;
      const f = game.foundations[fi];
      if (f.length > 0) {
        const card = f[f.length - 1 - Math.floor(bouncerSpawnIdx / 4)] ?? f[f.length - 1];
        bouncers.push({
          card,
          x: L.foundations[fi].x,
          y: L.foundations[fi].y,
          vx: (Math.random() - 0.5) * W * 0.6,
          vy: -H * (0.3 + Math.random() * 0.3),
          trail: [],
        });
      }
      bouncerSpawnIdx++;
    }

    const grav = H * 1.8;
    for (const b of bouncers) {
      b.vy += grav * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 8) b.trail.shift();
      const floor = H - L.cardH;
      if (b.y > floor) {
        b.y = floor;
        b.vy *= -0.72;
        b.vx *= 0.98;
      }
    }
    bouncers = bouncers.filter((b) => b.x > -L.cardW * 2 && b.x < W + L.cardW * 2);

    for (const p of particles) {
      p.life += dt;
      p.vy += grav * 0.25 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.life < p.maxLife);

    if ((celebrateTime > 6.5 || input.pointer.justDown) && !gameOverCalled) {
      gameOverCalled = true;
      ctx.gameOver(finalScore);
    }
  }

  // --------------------------------------------------------------------------
  // hit testing
  // --------------------------------------------------------------------------

  function hitButton(px: number, py: number): string | null {
    for (const b of L.buttons) {
      if (pointInRect(px, py, b)) return b.id;
    }
    return null;
  }

  function hitBoard(px: number, py: number): { ref: PileRef; index: number } | null {
    if (pointInRect(px, py, L.stock)) {
      return { ref: { kind: "stock" }, index: Math.max(0, game.stock.length - 1) };
    }
    if (game.waste.length) {
      const top = game.waste.length - 1;
      const p = getCardPos({ kind: "waste" }, top);
      if (pointInRect(px, py, { x: p.x, y: p.y, w: L.cardW, h: L.cardH })) {
        return { ref: { kind: "waste" }, index: top };
      }
    }
    for (let i = 0; i < 4; i++) {
      if (pointInRect(px, py, L.foundations[i])) {
        return { ref: { kind: "foundation", index: i }, index: game.foundations[i].length - 1 };
      }
    }
    for (let col = 0; col < 7; col++) {
      const r = L.tableau[col];
      if (px < r.x || px > r.x + L.cardW) continue;
      const cards = game.tableau[col];
      for (let i = cards.length - 1; i >= 0; i--) {
        const p = getCardPos({ kind: "tableau", index: col }, i);
        if (pointInRect(px, py, { x: p.x, y: p.y, w: L.cardW, h: L.cardH })) {
          return { ref: { kind: "tableau", index: col }, index: i };
        }
      }
    }
    return null;
  }

  function overlapArea(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return x * y;
  }

  function computeDropTarget(headRect: { x: number; y: number; w: number; h: number }): PileRef | null {
    if (!drag) return null;
    let best: PileRef | null = null;
    let bestArea = 0;
    for (let i = 0; i < 4; i++) {
      const ref: PileRef = { kind: "foundation", index: i };
      if (!game.canDrop(drag.cards, ref)) continue;
      const a = overlapArea(headRect, L.foundations[i]);
      if (a > bestArea) {
        bestArea = a;
        best = ref;
      }
    }
    for (let col = 0; col < 7; col++) {
      const ref: PileRef = { kind: "tableau", index: col };
      if (!game.canDrop(drag.cards, ref)) continue;
      const r = L.tableau[col];
      const len = game.tableau[col].length;
      let h = L.cardH;
      if (len > 0) {
        const lastY = getCardPos(ref, len - 1).y;
        h = lastY - r.y + L.cardH;
      }
      const a = overlapArea(headRect, { x: r.x, y: r.y, w: L.cardW, h });
      if (a > bestArea) {
        bestArea = a;
        best = ref;
      }
    }
    return bestArea > 0 ? best : null;
  }

  // --------------------------------------------------------------------------
  // input
  // --------------------------------------------------------------------------

  function startDrag(ref: PileRef, index: number) {
    const moving = game.movableSlice(ref, index);
    if (moving.length === 0) return false;
    const pos = getCardPos(ref, index);
    drag = {
      source: ref,
      sourceIndex: index,
      cards: moving,
      grabDX: input.pointer.x - pos.x,
      grabDY: input.pointer.y - pos.y,
      px: pos.x,
      py: pos.y,
    };
    for (const c of moving) draggingIds.add(c.id);
    audio.tone(520, 0.04, "sine", 0.18);
    return true;
  }

  function dropDrag() {
    if (!drag) return;
    const headRect = { x: drag.px, y: drag.py, w: L.cardW, h: L.cardH };
    const target = computeDropTarget(headRect);
    const fromPos = drag.cards.map((_, i) => ({ x: drag!.px, y: drag!.py + i * L.faceUpStep }));
    const src = drag.source;
    const srcIndex = drag.sourceIndex;
    const cards = drag.cards;
    // release the hold so render uses fresh state
    for (const c of cards) draggingIds.delete(c.id);
    drag = null;
    if (target) {
      performMove(src, srcIndex, target, fromPos);
    } else {
      const toPos = cards.map((_, i) => getCardPos(src, srcIndex + i));
      addBounce(cards, fromPos, toPos);
      audio.tone(160, 0.1, "sine", 0.22);
    }
  }

  function tapCard(ref: PileRef, index: number) {
    const cards = pileCards(ref);
    if (index !== cards.length - 1) return; // only the top card auto-sends
    const top = cards[index];
    if (!top || !top.faceUp) return;
    const mv = game.autoToFoundation(ref);
    const t = now;
    const isDouble = lastTap.id === top.id && t - lastTap.time < 0.35;
    lastTap = { id: top.id, time: t };
    if (mv) {
      performMove(mv.source, mv.sourceIndex, mv.target);
    } else if (isDouble) {
      audio.tone(180, 0.07, "sine", 0.18);
    }
  }

  function activateButton(id: string) {
    switch (id) {
      case "new":
        if (game.moves > 0 && !game.won && phase === "playing") confirmNew = true;
        else startNewGame();
        break;
      case "undo":
        if (phase === "playing") doUndo();
        break;
      case "hint":
        if (phase === "playing") doHint();
        break;
      case "draw": {
        const next: DrawMode = game.drawMode === 1 ? 3 : 1;
        game.drawMode = next;
        storage.set("drawMode", next);
        audio.tone(560, 0.05, "square", 0.25);
        break;
      }
      case "auto":
        if (phase === "playing") startAuto();
        break;
      case "sound":
        audio.setMuted(!audio.muted);
        if (!audio.muted) audio.tone(660, 0.06, "square", 0.3);
        break;
    }
  }

  function confirmRects(): { yes: { x: number; y: number; w: number; h: number }; no: { x: number; y: number; w: number; h: number } } {
    const w = Math.min(L.W * 0.32, 200);
    const h = clamp(L.H * 0.08, 36, 60);
    const cx = L.W / 2;
    const cy = L.H * 0.58;
    const gap = w * 0.16;
    return {
      yes: { x: cx - w - gap / 2, y: cy, w, h },
      no: { x: cx + gap / 2, y: cy, w, h },
    };
  }

  function handleInput() {
    const p = input.pointer;

    // keyboard shortcuts (desktop bonus)
    if (input.pressed("z")) activateButton("undo");
    if (input.pressed("n")) activateButton("new");
    if (input.pressed("h")) activateButton("hint");
    if (input.pressed("a")) activateButton("auto");
    if (input.pressed("m")) activateButton("sound");

    if (phase === "dealing") {
      if (p.justDown) finishDeal();
      return;
    }
    if (phase === "celebrating") return; // handled in updateCelebration
    if (phase === "autocomplete") {
      if (p.justDown) phase = "playing"; // tap to stop auto
      return;
    }

    // confirm overlay intercepts everything
    if (confirmNew) {
      if (p.justDown) {
        const r = confirmRects();
        if (pointInRect(p.x, p.y, r.yes)) {
          startNewGame();
        } else if (pointInRect(p.x, p.y, r.no)) {
          confirmNew = false;
          audio.tone(300, 0.05, "sine", 0.2);
        }
      }
      return;
    }

    if (p.justDown) {
      const btn = hitButton(p.x, p.y);
      const hb = btn ? null : hitBoard(p.x, p.y);
      press = {
        x: p.x,
        y: p.y,
        candidate: hb && hb.ref.kind !== "stock" ? hb : null,
        button: btn,
        stock: hb?.ref.kind === "stock",
        overlay: null,
      };
      hint = null;
    }

    // begin drag once movement passes threshold
    if (p.down && press && press.candidate && !drag) {
      const dx = p.x - press.x;
      const dy = p.y - press.y;
      const threshold = Math.max(5, L.cardW * 0.1);
      if (Math.hypot(dx, dy) > threshold) {
        if (startDrag(press.candidate.ref, press.candidate.index)) {
          press.candidate = null;
        }
      }
    }

    // update drag position
    if (drag && p.down) {
      drag.px = p.x - drag.grabDX;
      drag.py = p.y - drag.grabDY;
    }

    if (p.justUp) {
      if (drag) {
        dropDrag();
      } else if (press) {
        if (press.button && hitButton(p.x, p.y) === press.button) {
          activateButton(press.button);
        } else if (press.stock && pointInRect(p.x, p.y, L.stock)) {
          performDraw();
        } else if (press.candidate) {
          // it was a tap on a card (didn't cross drag threshold)
          const hb = hitBoard(p.x, p.y);
          if (hb && samePile(hb.ref, press.candidate.ref)) {
            tapCard(press.candidate.ref, press.candidate.index);
          }
        }
      }
      press = null;
    }
  }

  function samePile(a: PileRef, b: PileRef): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "tableau" && b.kind === "tableau") return a.index === b.index;
    if (a.kind === "foundation" && b.kind === "foundation") return a.index === b.index;
    return true;
  }

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------

  function updateAnims(dt: number) {
    // flies
    for (let i = flies.length - 1; i >= 0; i--) {
      const f = flies[i];
      f.t += dt;
      if (f.t >= f.dur) {
        for (const c of f.cards) animatingIds.delete(c.id);
        f.onDone?.();
        flies.splice(i, 1);
      }
    }
    // bounces
    for (let i = bounces.length - 1; i >= 0; i--) {
      const b = bounces[i];
      b.t += dt;
      if (b.t >= b.dur) {
        for (const id of b.ids) bouncingIds.delete(id);
        bounces.splice(i, 1);
      }
    }
    // flips
    for (let i = flips.length - 1; i >= 0; i--) {
      flips[i].t += dt;
      if (flips[i].t >= flips[i].dur) flips.splice(i, 1);
    }
  }

  function updateDeal(dt: number) {
    dealClock += dt;
    let allDone = true;
    for (const d of dealCards) {
      if (!d.started) {
        if (dealClock >= d.delay) {
          d.started = true;
          audio.tone(300 + d.index * 20, 0.04, "sine", 0.18);
        } else {
          allDone = false;
          continue;
        }
      }
      if (d.t < d.dur) {
        d.t += dt;
        allDone = false;
        if (d.t >= d.dur) pendingDealIds.delete(d.card.id);
      }
    }
    if (allDone && dealCards.length > 0) {
      finishDeal();
    }
  }

  function update(dt: number) {
    const d = Math.min(dt, 0.05);
    now += d;
    L = computeLayout(ctx.width, ctx.height, {
      tableauCounts: game.tableau.map((c) => c.length),
      tableauFaceDown: game.tableau.map((_, i) => game.faceDownCount(i)),
      buttonIds: BUTTON_IDS,
    });

    handleInput();
    updateAnims(d);

    if (phase === "dealing") {
      updateDeal(d);
    } else if (phase === "celebrating") {
      updateCelebration(d);
    } else if (phase === "autocomplete") {
      if (!animationsActive()) {
        autoTimer += d;
        if (autoTimer >= 0.1) {
          autoTimer = 0;
          const step = game.findAutoStep();
          if (step.kind === "move") {
            performMove(step.source, step.sourceIndex, step.target);
            autoNoProgress = 0;
          } else if (step.kind === "draw") {
            performDraw();
            autoNoProgress++;
            if (autoNoProgress > 60) phase = "playing";
          } else if (step.kind === "stuck") {
            phase = "playing";
          }
        }
      }
    }

    if (timerRunning && (phase === "playing" || phase === "autocomplete")) {
      timeMs += d * 1000;
    }
  }

  // --------------------------------------------------------------------------
  // render
  // --------------------------------------------------------------------------

  function drawBackground(c: CanvasRenderingContext2D, W: number, H: number) {
    const g = c.createRadialGradient(W / 2, H * 0.4, Math.min(W, H) * 0.1, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, "#1e7a52");
    g.addColorStop(0.7, "#15603f");
    g.addColorStop(1, "#0c3d28");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // subtle vignette
    c.fillStyle = "rgba(0,0,0,0.12)";
    c.fillRect(0, 0, W, L.topBarH);
    c.fillRect(0, H - L.buttonBarH, W, L.buttonBarH);
  }

  function drawFlipCard(c: CanvasRenderingContext2D, card: Card, x: number, y: number) {
    const fa = flips.find((f) => f.id === card.id);
    if (!fa) {
      drawCard(c, card, x, y, L.cardW, L.cardH);
      return;
    }
    const t = fa.t / fa.dur;
    if (t < 0.5) {
      // first half: shrink showing back
      const s = 1 - t * 2;
      const back: Card = { ...card, faceUp: false };
      drawCard(c, back, x, y, L.cardW, L.cardH, { flipScale: Math.max(0.02, s) });
    } else {
      const s = (t - 0.5) * 2;
      drawCard(c, card, x, y, L.cardW, L.cardH, { flipScale: Math.max(0.02, s) });
    }
  }

  function drawPiles(c: CanvasRenderingContext2D) {
    // placeholders
    drawPlaceholder(c, L.stock.x, L.stock.y, L.cardW, L.cardH, { kind: "recycle" });
    drawPlaceholder(c, L.waste.x, L.waste.y, L.cardW, L.cardH);
    const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
    for (let i = 0; i < 4; i++) {
      drawPlaceholder(c, L.foundations[i].x, L.foundations[i].y, L.cardW, L.cardH, {
        kind: "suit",
        suit: suits[i],
      });
    }
    for (let i = 0; i < 7; i++) {
      if (game.tableau[i].length === 0) {
        drawPlaceholder(c, L.tableau[i].x, L.tableau[i].y, L.cardW, L.cardH);
      }
    }

    // stock (face-down pile) — draw a couple for depth
    if (game.stock.length > 0) {
      const depth = Math.min(3, game.stock.length);
      for (let i = 0; i < depth; i++) {
        const off = (depth - 1 - i) * L.cardW * 0.012;
        drawCardBack(c, L.stock.x - off, L.stock.y - off, L.cardW, L.cardH);
      }
    }

    // waste
    const len = game.waste.length;
    const vis = Math.min(len, game.drawMode === 3 ? 3 : 1);
    for (let i = len - vis; i < len; i++) {
      if (i < 0) continue;
      const card = game.waste[i];
      if (isHidden(card.id)) continue;
      const p = getCardPos({ kind: "waste" }, i);
      drawCard(c, card, p.x, p.y, L.cardW, L.cardH, { shadow: i === len - 1 });
    }

    // foundations (top card)
    for (let i = 0; i < 4; i++) {
      const arr = game.foundations[i];
      // draw the topmost non-hidden card
      for (let j = arr.length - 1; j >= 0; j--) {
        if (isHidden(arr[j].id)) continue;
        drawCard(c, arr[j], L.foundations[i].x, L.foundations[i].y, L.cardW, L.cardH);
        break;
      }
    }

    // tableau
    for (let col = 0; col < 7; col++) {
      const arr = game.tableau[col];
      for (let i = 0; i < arr.length; i++) {
        const card = arr[i];
        if (isHidden(card.id)) continue;
        const p = getCardPos({ kind: "tableau", index: col }, i);
        const isTop = i === arr.length - 1;
        drawFlipCard(c, card, p.x, p.y);
        if (isTop) {
          // re-stroke shadow effect handled in drawCard via shadow option only on lift
        }
      }
    }
  }

  function drawFlies(c: CanvasRenderingContext2D) {
    for (const f of flies) {
      const t = easeOutCubic(Math.min(1, f.t / f.dur));
      for (let i = 0; i < f.cards.length; i++) {
        const x = lerp(f.from[i].x, f.to[i].x, t);
        const y = lerp(f.from[i].y, f.to[i].y, t);
        drawCard(c, f.cards[i], x, y, L.cardW, L.cardH, { shadow: true });
      }
    }
    for (const b of bounces) {
      const t = easeOutCubic(Math.min(1, b.t / b.dur));
      for (let i = 0; i < b.cards.length; i++) {
        const x = lerp(b.from[i].x, b.to[i].x, t);
        const y = lerp(b.from[i].y, b.to[i].y, t);
        drawCard(c, b.cards[i], x, y, L.cardW, L.cardH, { shadow: true });
      }
    }
  }

  function drawDrag(c: CanvasRenderingContext2D) {
    if (!drag) return;
    // highlight valid drop target
    const headRect = { x: drag.px, y: drag.py, w: L.cardW, h: L.cardH };
    const target = computeDropTarget(headRect);
    if (target) {
      const r =
        target.kind === "foundation"
          ? L.foundations[target.index]
          : L.tableau[(target as { index: number }).index];
      let ty = r.y;
      if (target.kind === "tableau") {
        const len = game.tableau[target.index].length;
        if (len > 0) ty = getCardPos(target, len - 1).y + L.faceUpStep * 0.5;
      }
      c.save();
      c.strokeStyle = "rgba(255,236,140,0.9)";
      c.lineWidth = Math.max(2, L.cardW * 0.04);
      c.shadowColor = "rgba(255,236,140,0.8)";
      c.shadowBlur = L.cardW * 0.3;
      roundRect(c, r.x, ty, L.cardW, L.cardH, L.cardW * 0.1);
      c.stroke();
      c.restore();
    }
    for (let i = 0; i < drag.cards.length; i++) {
      drawCard(c, drag.cards[i], drag.px, drag.py + i * L.faceUpStep, L.cardW, L.cardH, {
        shadow: true,
      });
    }
  }

  function drawHintHighlight(c: CanvasRenderingContext2D) {
    if (!hint || now > hint.until) {
      hint = null;
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(now * 9);
    const glow = `rgba(120,220,255,${0.45 + pulse * 0.45})`;
    const mark = (ref: PileRef) => {
      let r: { x: number; y: number };
      if (ref.kind === "stock") r = { x: L.stock.x, y: L.stock.y };
      else if (ref.kind === "waste") r = { x: L.waste.x, y: L.waste.y };
      else if (ref.kind === "foundation") r = L.foundations[ref.index];
      else {
        const len = game.tableau[ref.index].length;
        r = len ? getCardPos(ref, len - 1) : L.tableau[ref.index];
      }
      c.save();
      c.strokeStyle = glow;
      c.lineWidth = Math.max(2, L.cardW * 0.05);
      c.shadowColor = glow;
      c.shadowBlur = L.cardW * 0.4;
      roundRect(c, r.x, r.y, L.cardW, L.cardH, L.cardW * 0.1);
      c.stroke();
      c.restore();
    };
    mark(hint.source);
    if (!samePile(hint.source, hint.target)) mark(hint.target);
  }

  function drawDealAnim(c: CanvasRenderingContext2D) {
    for (const d of dealCards) {
      if (!d.started) continue;
      if (d.t >= d.dur) continue;
      const t = easeOutCubic(d.t / d.dur);
      const from = { x: L.stock.x, y: L.stock.y };
      const to = getCardPos({ kind: "tableau", index: d.col }, d.index);
      const x = lerp(from.x, to.x, t);
      const y = lerp(from.y, to.y, t);
      drawCard(c, d.card, x, y, L.cardW, L.cardH, { shadow: true });
    }
  }

  function drawHud(c: CanvasRenderingContext2D) {
    const W = L.W;
    const pad = clamp(W * 0.02, 8, 24);
    const fs = clamp(L.topBarH * 0.4, 12, 24);
    const y = L.topBarH * 0.5;

    drawText(c, `Score`, pad, y - fs * 0.6, fs * 0.62, "rgba(255,255,255,0.65)", "left", "700");
    drawText(c, `${game.score}`, pad, y + fs * 0.4, fs, "#fff", "left", "800");

    // center: time + moves
    const tlabel = formatTime(timeMs);
    drawText(c, `⏱ ${tlabel}`, W * 0.5, y - fs * 0.05, fs * 0.85, "#ffe9a8", "center", "800");
    drawText(c, `Moves ${game.moves}`, W * 0.5, y + fs * 0.85, fs * 0.6, "rgba(255,255,255,0.7)", "center", "700");

    // right: best + wins
    drawText(c, `Best ${best}`, W - pad, y - fs * 0.05, fs * 0.72, "#9ff0c8", "right", "800");
    drawText(c, `Wins ${wins} · ${game.drawMode === 3 ? "Draw 3" : "Draw 1"}`, W - pad, y + fs * 0.8, fs * 0.55, "rgba(255,255,255,0.65)", "right", "700");
  }

  function buttonLabel(id: string): string {
    switch (id) {
      case "new":
        return "New";
      case "undo":
        return "Undo";
      case "hint":
        return "Hint";
      case "draw":
        return game.drawMode === 3 ? "Draw 3" : "Draw 1";
      case "auto":
        return "Auto";
      case "sound":
        return audio.muted ? "Muted" : "Sound";
      default:
        return id;
    }
  }

  function buttonEnabled(id: string): boolean {
    if (phase === "dealing" || phase === "celebrating") return false;
    if (phase === "autocomplete") return false;
    switch (id) {
      case "undo":
        return game.canUndo;
      case "auto":
        return game.isAutoCompletable();
      case "hint":
        return true;
      default:
        return true;
    }
  }

  function drawButtons(c: CanvasRenderingContext2D) {
    for (const b of L.buttons) {
      const enabled = buttonEnabled(b.id);
      c.save();
      c.globalAlpha = enabled ? 1 : 0.4;
      const g = c.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      g.addColorStop(0, b.id === "auto" && enabled ? "#ffe27a" : "#2f5466");
      g.addColorStop(1, b.id === "auto" && enabled ? "#ffb627" : "#1c3947");
      c.fillStyle = g;
      roundRect(c, b.x, b.y, b.w, b.h, b.h * 0.24);
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = "rgba(255,255,255,0.18)";
      roundRect(c, b.x, b.y, b.w, b.h, b.h * 0.24);
      c.stroke();
      const fs = clamp(b.h * 0.4, 11, 20);
      drawText(
        c,
        buttonLabel(b.id),
        b.x + b.w / 2,
        b.y + b.h / 2,
        Math.min(fs, (b.w / Math.max(4, buttonLabel(b.id).length)) * 1.7),
        b.id === "auto" && enabled ? "#222" : "#eef6ff",
        "center",
        "800",
      );
      c.restore();
    }
  }

  function drawConfirm(c: CanvasRenderingContext2D) {
    if (!confirmNew) return;
    const W = L.W;
    const H = L.H;
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillRect(0, 0, W, H);
    drawText(c, "Start a new game?", W / 2, H * 0.42, clamp(W * 0.05, 18, 36), "#fff", "center", "800");
    drawText(c, "Your current progress will be lost.", W / 2, H * 0.49, clamp(W * 0.028, 12, 20), "rgba(255,255,255,0.7)", "center", "700");
    const r = confirmRects();
    const btn = (rect: { x: number; y: number; w: number; h: number }, label: string, color: string, fg: string) => {
      c.fillStyle = color;
      roundRect(c, rect.x, rect.y, rect.w, rect.h, rect.h * 0.24);
      c.fill();
      drawText(c, label, rect.x + rect.w / 2, rect.y + rect.h / 2, clamp(rect.h * 0.42, 13, 22), fg, "center", "800");
    };
    btn(r.yes, "New Game", "#46e0a0", "#0c3d28");
    btn(r.no, "Keep Playing", "#2f5466", "#eef6ff");
  }

  function drawCelebration(c: CanvasRenderingContext2D) {
    const W = L.W;
    const H = L.H;
    // bouncers + trails
    for (const b of bouncers) {
      for (let i = 0; i < b.trail.length; i++) {
        const tp = b.trail[i];
        c.save();
        c.globalAlpha = (i / b.trail.length) * 0.35;
        drawCard(c, b.card, tp.x, tp.y, L.cardW, L.cardH);
        c.restore();
      }
      drawCard(c, b.card, b.x, b.y, L.cardW, L.cardH, { shadow: true });
    }
    // particles
    for (const p of particles) {
      const a = clamp(1 - p.life / p.maxLife, 0, 1);
      c.globalAlpha = a;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    // banner
    const by = H * 0.36;
    c.save();
    c.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(c, W * 0.12, by - H * 0.02, W * 0.76, H * 0.26, 18);
    c.fill();
    c.restore();
    drawText(c, "YOU WIN!", W / 2, by + H * 0.06, clamp(W * 0.09, 28, 72), "#ffd23f", "center", "900");
    drawText(c, `Score ${finalScore}`, W / 2, by + H * 0.135, clamp(W * 0.04, 16, 32), "#fff", "center", "800");
    drawText(
      c,
      `Time ${formatTime(timeMs)} · ${game.moves} moves`,
      W / 2,
      by + H * 0.19,
      clamp(W * 0.028, 12, 22),
      "rgba(255,255,255,0.8)",
      "center",
      "700",
    );
    drawText(c, "tap to continue", W / 2, by + H * 0.235, clamp(W * 0.022, 10, 16), "rgba(255,255,255,0.55)", "center", "700");
  }

  function render() {
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;
    drawBackground(c, W, H);
    drawPiles(c);
    drawDealAnim(c);
    drawFlies(c);
    drawHintHighlight(c);
    drawDrag(c);
    drawHud(c);
    drawButtons(c);
    if (phase === "celebrating") drawCelebration(c);
    drawConfirm(c);
  }

  // --------------------------------------------------------------------------
  // boot
  // --------------------------------------------------------------------------

  startNewGame(game.drawMode);

  return {
    update,
    render,
    resize() {
      L = computeLayout(ctx.width, ctx.height, {
        tableauCounts: game.tableau.map((cc) => cc.length),
        tableauFaceDown: game.tableau.map((_, i) => game.faceDownCount(i)),
        buttonIds: BUTTON_IDS,
      });
    },
  };
}
