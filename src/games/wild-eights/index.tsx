import { useEffect, useState } from "react";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom, type RoomDoc } from "@/services/rooms";

/* ------------------------------------------------------------------ *
 * Wild Eights — a Crazy Eights / UNO-style shedding game (2-6 players)
 *
 * WILD RULE (the one we picked, see CONFIG.rules):
 *   Rank-8 cards are WILD. An 8 may be played on ANY card, and the player
 *   then names the next color. The deck ALSO contains dedicated Wild and
 *   Wild Draw Four cards which behave the same way (Wild Draw Four also
 *   forces the next player to draw 4 and be skipped).
 * ------------------------------------------------------------------ */

type Color = "red" | "yellow" | "green" | "blue";
/** Digits "0".."9" (8 is wild) plus action ranks. Wild/wild4 are color-less. */
type Rank =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "skip" | "reverse" | "draw2" | "wild" | "wild4";

interface Card {
  id: string;
  /** "wild" for the color-less Wild / Wild Draw Four cards. */
  color: Color | "wild";
  rank: Rank;
}

type Direction = 1 | -1;

interface WEState {
  /** draw pile — we draw from the END (top). */
  deck: Card[];
  /** discard pile — the TOP card is the last element. */
  discard: Card[];
  /** active color; for wild plays this is the chosen color. */
  currentColor: Color;
  hands: Record<string, Card[]>;
  /** count of cards in each hand (kept in sync so opponents see counts). */
  counts: Record<string, number>;
  turn: string;
  direction: Direction;
  winner: string | null;
  /** id of the card just drawn that the current player may still play, else null. */
  drawnCard: string | null;
  /** short human-readable description of the last action. */
  lastAction: string;
}

const COLORS: Color[] = ["red", "yellow", "green", "blue"];
const COLOR_HEX: Record<Color, string> = {
  red: "#ff5c6c",
  yellow: "#ffd23f",
  green: "#46e0a0",
  blue: "#19d3ff",
};
const COLOR_NAME: Record<Color, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
};

const RANK_LABEL: Record<Rank, string> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
  "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  skip: "Ø",
  reverse: "⇄",
  draw2: "+2",
  wild: "★",
  wild4: "+4",
};

const isWildRank = (r: Rank): boolean => r === "8" || r === "wild" || r === "wild4";

/* ----------------------------- deck ----------------------------- */

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function buildDeck(): Card[] {
  const cards: Card[] = [];
  let n = 0;
  const numberRanks: Rank[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const actionRanks: Rank[] = ["skip", "reverse", "draw2"];
  for (const color of COLORS) {
    // two copies of every number (0-9) and every colored action card
    for (const rank of [...numberRanks, ...actionRanks]) {
      cards.push({ id: `c${n++}`, color, rank });
      cards.push({ id: `c${n++}`, color, rank });
    }
  }
  // four Wild and four Wild Draw Four
  for (let i = 0; i < 4; i++) cards.push({ id: `c${n++}`, color: "wild", rank: "wild" });
  for (let i = 0; i < 4; i++) cards.push({ id: `c${n++}`, color: "wild", rank: "wild4" });
  return shuffle(cards);
}

function buildState(order: string[]): WEState {
  const deck = buildDeck();
  const hands: Record<string, Card[]> = {};
  const counts: Record<string, number> = {};
  for (const uid of order) {
    const hand: Card[] = [];
    for (let i = 0; i < 7; i++) {
      const c = deck.pop();
      if (c) hand.push(c);
    }
    hands[uid] = hand;
    counts[uid] = hand.length;
  }
  // Flip a plain numbered starter (avoid wild / action cards opening the game).
  let starterIdx = deck.findIndex((c) => c.color !== "wild" && !isWildRank(c.rank) && !["skip", "reverse", "draw2"].includes(c.rank));
  if (starterIdx < 0) starterIdx = deck.findIndex((c) => c.color !== "wild" && !isWildRank(c.rank));
  if (starterIdx < 0) starterIdx = deck.length - 1;
  const [starter] = deck.splice(starterIdx, 1);
  const startColor: Color = starter.color === "wild" ? "red" : starter.color;
  return {
    deck,
    discard: [starter],
    currentColor: startColor,
    hands,
    counts,
    turn: order[0],
    direction: 1,
    winner: null,
    drawnCard: null,
    lastAction: "Game on — first card flipped.",
  };
}

/* --------------------------- game logic --------------------------- */

const topCard = (s: WEState): Card => s.discard[s.discard.length - 1];

function isPlayable(card: Card, currentColor: Color, top: Card): boolean {
  if (isWildRank(card.rank)) return true;
  if (card.color === currentColor) return true;
  return card.rank === top.rank;
}

/** advance `count` seats from `fromUid` in the given direction. */
function step(order: string[], fromUid: string, dir: Direction, count: number): string {
  const n = order.length;
  let i = order.indexOf(fromUid);
  if (i < 0) i = 0;
  i = (((i + dir * count) % n) + n) % n;
  return order[i];
}

/** Move discard (minus its top) back into the draw pile when it runs dry. */
function reshuffle(deck: Card[], discard: Card[]): { deck: Card[]; discard: Card[] } {
  if (deck.length > 0 || discard.length <= 1) return { deck, discard };
  const top = discard[discard.length - 1];
  return { deck: shuffle(discard.slice(0, -1)), discard: [top] };
}

/** Draw n cards off the top of the deck, reshuffling as needed. */
function drawCards(
  deck: Card[],
  discard: Card[],
  n: number,
): { cards: Card[]; deck: Card[]; discard: Card[] } {
  let d = deck.slice();
  let disc = discard.slice();
  const cards: Card[] = [];
  for (let k = 0; k < n; k++) {
    if (d.length === 0) {
      const re = reshuffle(d, disc);
      d = re.deck;
      disc = re.discard;
      if (d.length === 0) break;
    }
    const c = d.pop();
    if (c) cards.push(c);
  }
  return { cards, deck: d, discard: disc };
}

/* ------------------------------ UI ------------------------------ */

function CardView({
  card,
  color,
  disabled,
  highlight,
  onClick,
  size = "lg",
}: {
  card: Card;
  /** override color for the chosen-color halo on a played wild. */
  color?: Color;
  disabled?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  size?: "sm" | "lg";
}) {
  const wild = card.color === "wild";
  const bg = wild
    ? "conic-gradient(from 210deg, #ff5c6c, #ffd23f, #46e0a0, #19d3ff, #ff5c6c)"
    : COLOR_HEX[card.color as Color];
  const dim = card.rank;
  const w = size === "lg" ? 64 : 44;
  const h = size === "lg" ? 92 : 64;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={`${wild ? "Wild" : COLOR_NAME[card.color as Color]} ${RANK_LABEL[card.rank]}`}
      style={{
        width: w,
        height: h,
        flex: "0 0 auto",
        borderRadius: 12,
        border: highlight ? "3px solid var(--text)" : "2px solid rgba(0,0,0,0.35)",
        background: bg,
        color: "#0b0f1a",
        fontWeight: 800,
        fontSize: size === "lg" ? 26 : 18,
        display: "grid",
        placeItems: "center",
        padding: 0,
        cursor: onClick && !disabled ? "pointer" : "default",
        opacity: disabled ? 0.4 : 1,
        boxShadow: highlight ? "0 0 14px rgba(255,255,255,0.55)" : "var(--shadow)",
        transform: highlight ? "translateY(-8px)" : undefined,
        transition: "transform 0.12s ease, opacity 0.12s ease",
        position: "relative",
        outline: color ? `3px solid ${COLOR_HEX[color]}` : undefined,
        outlineOffset: 2,
      }}
    >
      <span style={{ textShadow: "0 1px 1px rgba(255,255,255,0.5)" }}>{RANK_LABEL[dim]}</span>
      {dim === "8" && (
        <span style={{ position: "absolute", bottom: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
          WILD
        </span>
      )}
    </button>
  );
}

function Board({ room, code, meUid }: BoardProps<WEState>) {
  const state = room.state;
  const order = room.order;
  const [pendingWild, setPendingWild] = useState<Card | null>(null);

  // Host commits the ended status once someone empties their hand.
  useEffect(() => {
    if (state && state.winner !== null && room.status === "playing" && room.hostUid === meUid) {
      void patchRoom(code, { status: "ended", state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.winner, room.status]);

  if (!state) return <div className="loading"><div className="spinner" /></div>;

  const nameOf = (uid: string) => room.players[uid]?.name ?? "Player";
  const top = topCard(state);
  const isMyTurn = state.turn === meUid && state.winner === null;
  const ended = state.winner !== null;
  const myHand = state.hands[meUid] ?? [];
  const drawnPending = state.drawnCard;

  /** Apply a play to a fresh state copy, returning the next state (or null if illegal). */
  const applyPlay = (s: WEState, cardId: string, chosenColor: Color | null): WEState | null => {
    if (s.winner !== null || s.turn !== meUid) return null;
    const hand = (s.hands[meUid] ?? []).slice();
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return null;
    const card = hand[idx];
    // If a card was just drawn, only that card may be played this turn.
    if (s.drawnCard !== null && s.drawnCard !== cardId) return null;
    if (!isPlayable(card, s.currentColor, topCard(s))) return null;
    const wild = isWildRank(card.rank);
    if (wild && !chosenColor) return null;

    hand.splice(idx, 1);
    const hands = { ...s.hands, [meUid]: hand };
    const counts = { ...s.counts, [meUid]: hand.length };
    const discard = [...s.discard, card];
    const nextColor: Color = wild ? (chosenColor as Color) : (card.color as Color);

    // Resolve action effects.
    let dir = s.direction;
    let skip = false;
    let drawN = 0;
    if (card.rank === "reverse") {
      dir = (dir === 1 ? -1 : 1) as Direction;
      if (order.length === 2) skip = true; // reverse acts as skip in a 2-player game
    } else if (card.rank === "skip") {
      skip = true;
    } else if (card.rank === "draw2") {
      drawN = 2;
      skip = true;
    } else if (card.rank === "wild4") {
      drawN = 4;
      skip = true;
    }

    let deck = s.deck;
    let disc = discard;
    const target = step(order, meUid, dir, 1); // the immediate next seat
    if (drawN > 0) {
      const res = drawCards(deck, disc, drawN);
      deck = res.deck;
      disc = res.discard;
      hands[target] = [...(hands[target] ?? []), ...res.cards];
      counts[target] = hands[target].length;
    }
    const winner = hand.length === 0 ? meUid : null;
    const turn = winner ? s.turn : skip ? step(order, target, dir, 1) : target;

    let action = `${nameOf(meUid)} played ${wild ? "Wild" : COLOR_NAME[card.color as Color]} ${RANK_LABEL[card.rank]}`;
    if (wild) action += ` → ${COLOR_NAME[nextColor]}`;
    if (drawN > 0) action += `. ${nameOf(target)} draws ${drawN} & is skipped`;
    else if (skip) action += `. ${nameOf(target)} is skipped`;
    if (winner) action = `${nameOf(meUid)} went out and WINS! 🎉`;

    return {
      deck,
      discard: disc,
      currentColor: nextColor,
      hands,
      counts,
      turn,
      direction: dir,
      winner,
      drawnCard: null,
      lastAction: action,
    };
  };

  const doPlay = async (cardId: string, chosenColor: Color | null) => {
    await mutateRoom<WEState>(code, (r) => {
      const s = r.state;
      if (!s) return null;
      const next = applyPlay(s, cardId, chosenColor);
      return next ? { state: next } : null;
    });
  };

  const onCardTap = (card: Card) => {
    if (!isMyTurn) return;
    if (drawnPending !== null && drawnPending !== card.id) return;
    if (!isPlayable(card, state.currentColor, top)) return;
    if (isWildRank(card.rank)) {
      setPendingWild(card);
      return;
    }
    void doPlay(card.id, null);
  };

  const chooseColor = (color: Color) => {
    const card = pendingWild;
    setPendingWild(null);
    if (card) void doPlay(card.id, color);
  };

  const drawAction = async () => {
    if (!isMyTurn || drawnPending !== null) return;
    await mutateRoom<WEState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner !== null || s.turn !== meUid || s.drawnCard !== null) return null;
      const res = drawCards(s.deck, s.discard, 1);
      if (res.cards.length === 0) {
        // Nothing left to draw — just pass the turn.
        return {
          state: {
            ...s,
            turn: step(order, meUid, s.direction, 1),
            drawnCard: null,
            lastAction: `${nameOf(meUid)} couldn't draw and passed.`,
          } satisfies WEState,
        };
      }
      const card = res.cards[0];
      const hand = [...(s.hands[meUid] ?? []), card];
      const hands = { ...s.hands, [meUid]: hand };
      const counts = { ...s.counts, [meUid]: hand.length };
      const playable = isPlayable(card, s.currentColor, topCard(s));
      const next: WEState = {
        ...s,
        deck: res.deck,
        discard: res.discard,
        hands,
        counts,
        // If the drawn card is playable, keep the turn and let them choose;
        // otherwise the turn passes automatically.
        turn: playable ? meUid : step(order, meUid, s.direction, 1),
        drawnCard: playable ? card.id : null,
        lastAction: playable
          ? `${nameOf(meUid)} drew a card (playable).`
          : `${nameOf(meUid)} drew a card and passed.`,
      };
      return { state: next };
    });
  };

  const passAction = async () => {
    if (!isMyTurn || drawnPending === null) return;
    await mutateRoom<WEState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner !== null || s.turn !== meUid || s.drawnCard === null) return null;
      return {
        state: {
          ...s,
          turn: step(order, meUid, s.direction, 1),
          drawnCard: null,
          lastAction: `${nameOf(meUid)} kept the card and passed.`,
        } satisfies WEState,
      };
    });
  };

  const rematch = async () => {
    await patchRoom(code, { status: "playing", state: buildState(order) });
  };

  const opponents = order.filter((u) => u !== meUid);
  const dirArrow = state.direction === 1 ? "↻ clockwise" : "↺ counter-clockwise";

  let banner: string;
  if (state.winner) banner = `${nameOf(state.winner)} wins! 🎉`;
  else if (isMyTurn) banner = drawnPending ? "Play the drawn card or pass" : "Your turn";
  else banner = `Waiting for ${nameOf(state.turn)}...`;

  return (
    <div className="stage-wrap">
      {/* opponents */}
      <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        {opponents.map((u) => (
          <div
            key={u}
            className="row"
            style={{
              gap: 8,
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: state.turn === u && !ended ? "var(--panel-2)" : "transparent",
              fontWeight: 700,
            }}
          >
            <span>{nameOf(u)}</span>
            <span
              className="muted"
              style={{
                background: "var(--bg-2)",
                borderRadius: 999,
                padding: "1px 9px",
                fontSize: 13,
                border: "1px solid var(--border)",
              }}
            >
              🂠 {state.counts[u] ?? state.hands[u]?.length ?? 0}
            </span>
          </div>
        ))}
      </div>

      <div className="status" style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{banner}</div>
      <div className="muted center" style={{ fontSize: 13, marginTop: -4 }}>
        {dirArrow} · {state.deck.length} in deck · {state.lastAction}
      </div>

      {/* table: discard top + current color */}
      <div
        className="panel"
        style={{ display: "flex", alignItems: "center", gap: 18, padding: 16, marginTop: 4 }}
      >
        <CardView card={top} color={isWildRank(top.rank) ? state.currentColor : undefined} />
        <div className="col" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Current color</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 800,
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: COLOR_HEX[state.currentColor],
                border: "2px solid rgba(0,0,0,0.35)",
              }}
            />
            {COLOR_NAME[state.currentColor]}
          </span>
        </div>
      </div>

      {/* draw / pass controls */}
      {!ended && (
        <div className="row" style={{ gap: 10, marginTop: 4 }}>
          <button
            className="btn secondary"
            onClick={drawAction}
            disabled={!isMyTurn || drawnPending !== null}
          >
            Draw a card
          </button>
          {drawnPending !== null && (
            <button className="btn ghost" onClick={passAction} disabled={!isMyTurn}>
              Pass
            </button>
          )}
        </div>
      )}

      {/* my hand */}
      <div style={{ width: "100%", maxWidth: 760, marginTop: 8 }}>
        <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
          Your hand ({myHand.length})
        </div>
        <div
          className="row"
          style={{
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 12,
            minHeight: 100,
          }}
        >
          {myHand.length === 0 && <span className="muted">No cards</span>}
          {myHand.map((card) => {
            const playableNow =
              isMyTurn &&
              isPlayable(card, state.currentColor, top) &&
              (drawnPending === null || drawnPending === card.id);
            return (
              <CardView
                key={card.id}
                card={card}
                disabled={!playableNow}
                highlight={drawnPending === card.id}
                onClick={() => onCardTap(card)}
              />
            );
          })}
        </div>
      </div>

      {/* rematch */}
      {ended && room.hostUid === meUid && (
        <button className="btn" style={{ marginTop: 10 }} onClick={rematch}>Play again</button>
      )}
      {ended && room.hostUid !== meUid && (
        <p className="muted">Waiting for host to start a rematch...</p>
      )}

      {/* color picker modal */}
      {pendingWild && (
        <div className="overlay" onClick={() => setPendingWild(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Choose the next color</h3>
            <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => chooseColor(c)}
                  aria-label={COLOR_NAME[c]}
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 16,
                    border: "2px solid rgba(0,0,0,0.35)",
                    background: COLOR_HEX[c],
                    color: "#0b0f1a",
                    fontWeight: 800,
                    fontSize: 15,
                    cursor: "pointer",
                    boxShadow: "var(--shadow)",
                  }}
                >
                  {COLOR_NAME[c]}
                </button>
              ))}
            </div>
            <div className="center" style={{ marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setPendingWild(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CONFIG: MultiplayerConfig<WEState> = {
  gameId: "wild-eights",
  title: "Wild Eights",
  icon: "🃏",
  color: "#ff9f1c",
  minPlayers: 2,
  maxPlayers: 6,
  rules: [
    "Match the discard pile by color or rank, or play a wild.",
    "EIGHTS ARE WILD: play an 8 (or a Wild card) on anything, then name the next color.",
    "Skip skips the next player. Reverse flips direction (acts as Skip with 2 players).",
    "Draw Two / Wild Draw Four make the next player draw and lose their turn.",
    "No play? Draw one — play it if you can, otherwise pass. First to empty their hand wins.",
  ],
  buildInitialState: (order: string[], _room: RoomDoc<WEState>) => buildState(order),
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
