/**
 * Card model + rule predicates for Klondike Solitaire.
 * Pure data + logic, no rendering. Everything here is original code.
 */

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Color = "red" | "black";

export const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

/** Rank: 1 = Ace ... 11 = Jack, 12 = Queen, 13 = King. */
export interface Card {
  suit: Suit;
  rank: number; // 1..13
  faceUp: boolean;
  /** Stable identity 0..51 used for animation tracking. */
  id: number;
}

export const RED_SUITS: ReadonlySet<Suit> = new Set<Suit>(["hearts", "diamonds"]);

export const colorOf = (suit: Suit): Color => (RED_SUITS.has(suit) ? "red" : "black");

export const cardColor = (card: Card): Color => colorOf(card.suit);

/** Short rank label: A, 2..10, J, Q, K. */
export function rankLabel(rank: number): string {
  switch (rank) {
    case 1:
      return "A";
    case 11:
      return "J";
    case 12:
      return "Q";
    case 13:
      return "K";
    default:
      return String(rank);
  }
}

export const suitIndex = (suit: Suit): number => SUITS.indexOf(suit);

/** Build an ordered 52-card deck (all face-down). */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank, faceUp: false, id: id++ });
    }
  }
  return deck;
}

/** Unbiased Fisher-Yates shuffle (in place), returns the same array. */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Deep clone a single card. */
export const cloneCard = (c: Card): Card => ({
  suit: c.suit,
  rank: c.rank,
  faceUp: c.faceUp,
  id: c.id,
});

export const clonePile = (pile: Card[]): Card[] => pile.map(cloneCard);

// ----------------------------------------------------------------------------
// Rule predicates
// ----------------------------------------------------------------------------

/** Can `card` be placed on the given foundation pile (built up by suit, A->K)? */
export function canPlaceOnFoundation(card: Card, foundation: Card[]): boolean {
  if (foundation.length === 0) return card.rank === 1; // only an Ace on empty
  const top = foundation[foundation.length - 1];
  return card.suit === top.suit && card.rank === top.rank + 1;
}

/** Can `card` be placed on the given tableau column (build down, alternating)? */
export function canPlaceOnTableau(card: Card, column: Card[]): boolean {
  if (column.length === 0) return card.rank === 13; // only a King on empty
  const bottom = column[column.length - 1];
  if (!bottom.faceUp) return false;
  return cardColor(card) !== cardColor(bottom) && card.rank === bottom.rank - 1;
}

/**
 * Is the slice of `column` starting at `index` a valid movable run
 * (all face-up, descending by one, alternating colors)?
 */
export function isValidRun(column: Card[], index: number): boolean {
  if (index < 0 || index >= column.length) return false;
  for (let i = index; i < column.length; i++) {
    if (!column[i].faceUp) return false;
    if (i > index) {
      const prev = column[i - 1];
      const cur = column[i];
      if (cur.rank !== prev.rank - 1) return false;
      if (cardColor(cur) === cardColor(prev)) return false;
    }
  }
  return true;
}

/** A complete foundation holds 13 cards (A..K). */
export const isFoundationComplete = (foundation: Card[]): boolean =>
  foundation.length === 13;
