/**
 * Core Klondike Solitaire game state, rules, scoring, undo, auto-complete and
 * hints. This module is pure logic — no rendering, input or animation. The
 * controller (index.ts) reads the returned `MoveResult`s to drive animations
 * and sound.
 */

import type { Card } from "./cards";
import {
  SUITS,
  canPlaceOnFoundation,
  canPlaceOnTableau,
  clonePile,
  isValidRun,
  makeDeck,
  shuffle,
  suitIndex,
} from "./cards";

export type DrawMode = 1 | 3;

export type PileRef =
  | { kind: "stock" }
  | { kind: "waste" }
  | { kind: "foundation"; index: number }
  | { kind: "tableau"; index: number };

export interface MoveResult {
  ok: boolean;
  movedCardIds: number[];
  flippedCardId: number | null;
  flippedColumn: number;
  toFoundation: boolean;
  scoreDelta: number;
}

const NO_MOVE: MoveResult = {
  ok: false,
  movedCardIds: [],
  flippedCardId: null,
  flippedColumn: -1,
  toFoundation: false,
  scoreDelta: 0,
};

// Scoring constants (Windows-style timed scoring).
const SCORE = {
  wasteToTableau: 5,
  wasteToFoundation: 10,
  tableauToFoundation: 10,
  flip: 5,
  foundationToTableau: -15,
};

interface Snapshot {
  stock: Card[];
  waste: Card[];
  foundations: Card[][];
  tableau: Card[][];
  score: number;
  moves: number;
  passes: number;
}

export class SolitaireGame {
  stock: Card[] = [];
  waste: Card[] = [];
  foundations: Card[][] = [[], [], [], []];
  tableau: Card[][] = [[], [], [], [], [], [], []];
  score = 0;
  moves = 0;
  /** number of times the waste has been recycled into the stock */
  passes = 0;
  drawMode: DrawMode = 1;
  won = false;

  private undoStack: Snapshot[] = [];
  private readonly maxUndo = 300;

  constructor(drawMode: DrawMode = 1) {
    this.drawMode = drawMode;
  }

  // ---- setup ----------------------------------------------------------------

  newGame(drawMode: DrawMode = this.drawMode): void {
    this.drawMode = drawMode;
    this.score = 0;
    this.moves = 0;
    this.passes = 0;
    this.won = false;
    this.undoStack = [];
    this.foundations = [[], [], [], []];
    this.tableau = [[], [], [], [], [], [], []];
    this.waste = [];

    const deck = shuffle(makeDeck());
    // deal column i gets i+1 cards, last face up
    let k = 0;
    for (let col = 0; col < 7; col++) {
      for (let n = 0; n <= col; n++) {
        const card = deck[k++];
        card.faceUp = n === col;
        this.tableau[col].push(card);
      }
    }
    // remaining -> stock, all face down
    this.stock = [];
    for (; k < deck.length; k++) {
      deck[k].faceUp = false;
      this.stock.push(deck[k]);
    }
  }

  // ---- undo -----------------------------------------------------------------

  private snapshot(): void {
    this.undoStack.push({
      stock: clonePile(this.stock),
      waste: clonePile(this.waste),
      foundations: this.foundations.map(clonePile),
      tableau: this.tableau.map(clonePile),
      score: this.score,
      moves: this.moves,
      passes: this.passes,
    });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.won;
  }

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.stock = snap.stock;
    this.waste = snap.waste;
    this.foundations = snap.foundations;
    this.tableau = snap.tableau;
    this.score = snap.score;
    this.moves = snap.moves;
    this.passes = snap.passes;
    this.won = false;
    return true;
  }

  // ---- queries --------------------------------------------------------------

  pileCards(ref: PileRef): Card[] {
    switch (ref.kind) {
      case "stock":
        return this.stock;
      case "waste":
        return this.waste;
      case "foundation":
        return this.foundations[ref.index];
      case "tableau":
        return this.tableau[ref.index];
    }
  }

  /** The cards that would move if the player grabs `ref` at `index`. */
  movableSlice(ref: PileRef, index: number): Card[] {
    const cards = this.pileCards(ref);
    if (ref.kind === "tableau") {
      if (!isValidRun(cards, index)) return [];
      return cards.slice(index);
    }
    // waste / foundation: only the top card is movable
    if (cards.length === 0) return [];
    if (index !== cards.length - 1) return [];
    return cards.slice(cards.length - 1);
  }

  /** Can the given moving stack be legally dropped on `target`? */
  canDrop(moving: Card[], target: PileRef): boolean {
    if (moving.length === 0) return false;
    const head = moving[0];
    if (target.kind === "foundation") {
      if (moving.length !== 1) return false;
      return canPlaceOnFoundation(head, this.foundations[target.index]);
    }
    if (target.kind === "tableau") {
      return canPlaceOnTableau(head, this.tableau[target.index]);
    }
    return false; // can't drop onto stock/waste
  }

  /** Index of the foundation this card legally belongs on, or -1. */
  foundationFor(card: Card): number {
    for (let i = 0; i < 4; i++) {
      if (canPlaceOnFoundation(card, this.foundations[i])) {
        // prefer the foundation already holding this suit
        return i;
      }
    }
    return -1;
  }

  // ---- mutations ------------------------------------------------------------

  /** Draw from stock to waste, or recycle when stock is empty. */
  draw(): MoveResult {
    if (this.stock.length === 0 && this.waste.length === 0) return NO_MOVE;
    this.snapshot();
    let scoreDelta = 0;
    const movedCardIds: number[] = [];

    if (this.stock.length === 0) {
      // recycle waste -> stock (reverse, face down)
      while (this.waste.length) {
        const c = this.waste.pop() as Card;
        c.faceUp = false;
        this.stock.push(c);
      }
      this.passes++;
      const penalty = this.drawMode === 1 ? -100 : this.passes > 3 ? -20 : 0;
      scoreDelta += penalty;
    } else {
      const n = Math.min(this.drawMode, this.stock.length);
      for (let i = 0; i < n; i++) {
        const c = this.stock.pop() as Card;
        c.faceUp = true;
        this.waste.push(c);
        movedCardIds.push(c.id);
      }
    }
    this.applyScore(scoreDelta);
    this.moves++;
    return {
      ok: true,
      movedCardIds,
      flippedCardId: null,
      flippedColumn: -1,
      toFoundation: false,
      scoreDelta,
    };
  }

  /**
   * Move a slice of cards from `source` (starting at `sourceIndex`) onto
   * `target`. Validates the move; returns ok:false if illegal (no state change).
   */
  applyMove(source: PileRef, sourceIndex: number, target: PileRef): MoveResult {
    const moving = this.movableSlice(source, sourceIndex);
    if (moving.length === 0) return NO_MOVE;
    if (!this.canDrop(moving, target)) return NO_MOVE;

    this.snapshot();
    const movedCardIds = moving.map((c) => c.id);
    const srcCards = this.pileCards(source);
    const removed = srcCards.splice(srcCards.length - moving.length, moving.length);
    const dstCards = this.pileCards(target);
    for (const c of removed) dstCards.push(c);

    // expose / flip newly revealed tableau card
    let flippedCardId: number | null = null;
    let flippedColumn = -1;
    let scoreDelta = this.moveScore(source, target);
    if (source.kind === "tableau") {
      const col = this.tableau[source.index];
      if (col.length > 0 && !col[col.length - 1].faceUp) {
        col[col.length - 1].faceUp = true;
        flippedCardId = col[col.length - 1].id;
        flippedColumn = source.index;
        scoreDelta += SCORE.flip;
      }
    }

    this.applyScore(scoreDelta);
    this.moves++;
    this.checkWin();
    return {
      ok: true,
      movedCardIds,
      flippedCardId,
      flippedColumn,
      toFoundation: target.kind === "foundation",
      scoreDelta,
    };
  }

  private moveScore(source: PileRef, target: PileRef): number {
    if (target.kind === "foundation") {
      if (source.kind === "waste") return SCORE.wasteToFoundation;
      if (source.kind === "tableau") return SCORE.tableauToFoundation;
      return 0;
    }
    if (target.kind === "tableau") {
      if (source.kind === "waste") return SCORE.wasteToTableau;
      if (source.kind === "foundation") return SCORE.foundationToTableau;
      return 0; // tableau -> tableau: no points
    }
    return 0;
  }

  private applyScore(delta: number): void {
    this.score = Math.max(0, this.score + delta);
  }

  private checkWin(): void {
    this.won = this.foundations.every((f) => f.length === 13);
  }

  // ---- auto / hint ----------------------------------------------------------

  /** No face-down cards remain in any tableau column. */
  isAutoCompletable(): boolean {
    if (this.won) return false;
    for (const col of this.tableau) {
      for (const c of col) if (!c.faceUp) return false;
    }
    return true;
  }

  /**
   * Next step for the auto-complete routine. Prefers playing the lowest-rank
   * card that legally goes to a foundation; otherwise draws/recycles.
   */
  findAutoStep():
    | { kind: "move"; source: PileRef; sourceIndex: number; target: PileRef }
    | { kind: "draw" }
    | { kind: "done" }
    | { kind: "stuck" } {
    if (this.won) return { kind: "done" };

    let best: { source: PileRef; rank: number } | null = null;
    const consider = (ref: PileRef) => {
      const cards = this.pileCards(ref);
      if (cards.length === 0) return;
      const top = cards[cards.length - 1];
      if (!top.faceUp) return;
      if (this.foundationFor(top) >= 0) {
        if (!best || top.rank < best.rank) best = { source: ref, rank: top.rank };
      }
    };
    consider({ kind: "waste" });
    for (let i = 0; i < 7; i++) consider({ kind: "tableau", index: i });

    if (best) {
      const src = (best as { source: PileRef }).source;
      const cards = this.pileCards(src);
      const top = cards[cards.length - 1];
      const fi = this.foundationFor(top);
      return {
        kind: "move",
        source: src,
        sourceIndex: cards.length - 1,
        target: { kind: "foundation", index: fi },
      };
    }

    if (this.stock.length > 0 || this.waste.length > 0) return { kind: "draw" };
    return this.won ? { kind: "done" } : { kind: "stuck" };
  }

  /** Try to send the top card of `ref` to a foundation. Returns the move or null. */
  autoToFoundation(
    ref: PileRef,
  ): { source: PileRef; sourceIndex: number; target: PileRef } | null {
    const cards = this.pileCards(ref);
    if (cards.length === 0) return null;
    const top = cards[cards.length - 1];
    if (!top.faceUp) return null;
    const fi = this.foundationFor(top);
    if (fi < 0) return null;
    return {
      source: ref,
      sourceIndex: cards.length - 1,
      target: { kind: "foundation", index: fi },
    };
  }

  /**
   * Find a suggested legal move for the Hint feature. Priority:
   * 1) to foundation, 2) move that flips a face-down card, 3) waste->tableau,
   * 4) any tableau->tableau, 5) draw.
   */
  findHint():
    | { source: PileRef; sourceIndex: number; target: PileRef }
    | { source: PileRef; sourceIndex: number; target: PileRef; isDraw: true }
    | null {
    // 1) any top card to foundation
    const fWaste = this.autoToFoundation({ kind: "waste" });
    if (fWaste) return fWaste;
    for (let i = 0; i < 7; i++) {
      const f = this.autoToFoundation({ kind: "tableau", index: i });
      if (f) return f;
    }

    // 2) a tableau run move that flips a face-down card
    for (let i = 0; i < 7; i++) {
      const col = this.tableau[i];
      // first face-up index
      let firstUp = -1;
      for (let j = 0; j < col.length; j++) {
        if (col[j].faceUp) {
          firstUp = j;
          break;
        }
      }
      if (firstUp <= 0) continue; // nothing face-down beneath, or empty
      if (!isValidRun(col, firstUp)) continue;
      const moving = col.slice(firstUp);
      for (let t = 0; t < 7; t++) {
        if (t === i) continue;
        if (this.canDrop(moving, { kind: "tableau", index: t })) {
          return { source: { kind: "tableau", index: i }, sourceIndex: firstUp, target: { kind: "tableau", index: t } };
        }
      }
    }

    // 3) waste -> tableau
    if (this.waste.length) {
      const top = this.waste[this.waste.length - 1];
      for (let t = 0; t < 7; t++) {
        if (this.canDrop([top], { kind: "tableau", index: t })) {
          return { source: { kind: "waste" }, sourceIndex: this.waste.length - 1, target: { kind: "tableau", index: t } };
        }
      }
    }

    // 4) any useful tableau run -> tableau (move a face-up run onto another col)
    for (let i = 0; i < 7; i++) {
      const col = this.tableau[i];
      for (let j = 0; j < col.length; j++) {
        if (!col[j].faceUp) continue;
        if (!isValidRun(col, j)) continue;
        // don't suggest moving a whole column that's already on the table base
        const moving = col.slice(j);
        for (let t = 0; t < 7; t++) {
          if (t === i) continue;
          if (this.canDrop(moving, { kind: "tableau", index: t })) {
            // skip pointless King-only relocation from an otherwise empty col
            if (j === 0 && this.tableau[t].length === 0) continue;
            return { source: { kind: "tableau", index: i }, sourceIndex: j, target: { kind: "tableau", index: t } };
          }
        }
        break; // only consider the topmost valid run start per column
      }
    }

    // 5) draw
    if (this.stock.length > 0 || this.waste.length > 0) {
      return { source: { kind: "stock" }, sourceIndex: 0, target: { kind: "stock" }, isDraw: true };
    }
    return null;
  }

  /** Count of face-down tableau cards in a column (for layout). */
  faceDownCount(col: number): number {
    let n = 0;
    for (const c of this.tableau[col]) if (!c.faceUp) n++;
    return n;
  }

  /** Total cards correctly home on foundations. */
  foundationProgress(): number {
    return this.foundations.reduce((s, f) => s + f.length, 0);
  }

  /** For debugging / reference: index helpers re-exported. */
  static suitOrder(): number[] {
    return SUITS.map((s) => suitIndex(s));
  }
}
