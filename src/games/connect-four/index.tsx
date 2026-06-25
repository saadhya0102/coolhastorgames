import { useEffect, useRef } from "react";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom } from "@/services/rooms";

const ROWS = 6;
const COLS = 7;
const P1 = "#ff5c6c"; // red (order[0])
const P2 = "#ffd54a"; // yellow (order[1])

type Cell = 0 | 1 | 2;
type Winner = string | null | "draw";

interface CFState {
  /** board[row][col]; row 0 is the top, row 5 is the bottom. */
  board: Cell[][];
  turn: string; // uid whose move it is
  winner: Winner; // uid | null | 'draw'
}

const emptyBoard = (): Cell[][] =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0 as Cell));

/** Lowest empty row in a column, or -1 if full. */
function dropRow(board: Cell[][], col: number): number {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) return r;
  }
  return -1;
}

/** Does placing `disc` at (row,col) complete a line of 4? */
function isWin(board: Cell[][], row: number, col: number, disc: Cell): boolean {
  const dirs: Array<[number, number]> = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal down-right
    [1, -1], // diagonal down-left
  ];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === disc) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

const boardFull = (board: Cell[][]): boolean => board[0].every((c) => c !== 0);

function Board({ room, code, meUid }: BoardProps<CFState>) {
  const state = room.state;
  const order = room.order;
  const prevBoard = useRef<Cell[][] | null>(null);
  const lastDrop = useRef<{ r: number; c: number } | null>(null);

  // detect the most recently placed disc so we can animate just that one
  if (state) {
    const prev = prevBoard.current;
    let found: { r: number; c: number } | null = null;
    if (prev) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (state.board[r][c] !== 0 && prev[r][c] === 0) found = { r, c };
        }
      }
    }
    if (found) lastDrop.current = found;
    prevBoard.current = state.board.map((row) => row.slice());
  }

  if (!state) return <div className="loading"><div className="spinner" /></div>;

  const discFor = (uid: string): Cell => (order[0] === uid ? 1 : 2);
  const colorFor = (cell: Cell) => (cell === 1 ? P1 : cell === 2 ? P2 : "transparent");
  const nameOf = (uid: string) => room.players[uid]?.name ?? "Player";

  const myDisc = discFor(meUid);
  const isMyTurn = state.turn === meUid && state.winner === null;
  const ended = state.winner !== null;

  const play = async (col: number) => {
    if (!isMyTurn) return;
    if (dropRow(state.board, col) < 0) return;
    await mutateRoom<CFState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner !== null) return null;
      if (s.turn !== meUid) return null;
      const row = dropRow(s.board, col);
      if (row < 0) return null;
      const disc = discFor(meUid);
      const board = s.board.map((rw) => rw.slice());
      board[row][col] = disc;
      let winner: Winner;
      if (isWin(board, row, col, disc)) winner = meUid;
      else if (boardFull(board)) winner = "draw";
      else winner = null;
      const nextTurn = r.order.find((u) => u !== meUid) ?? meUid;
      return { state: { board, turn: winner === null ? nextTurn : s.turn, winner } };
    });
  };

  // host pushes ended status once a game is decided (any player can be host)
  useEffect(() => {
    if (state.winner !== null && room.status === "playing" && room.hostUid === meUid) {
      void patchRoom(code, { status: "ended", state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.winner, room.status]);

  let banner: string;
  if (state.winner === "draw") banner = "It's a draw!";
  else if (state.winner) banner = `${nameOf(state.winner)} wins! 🎉`;
  else if (isMyTurn) banner = "Your turn — drop a disc";
  else banner = `Waiting for ${nameOf(state.turn)}...`;

  const rematch = async () => {
    await patchRoom(code, {
      status: "playing",
      state: { board: emptyBoard(), turn: order[0], winner: null } as CFState,
    });
  };

  const colFull = (c: number) => dropRow(state.board, c) < 0;

  return (
    <div className="stage-wrap">
      <style>{cfAnim}</style>
      <div className="row" style={{ gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
        {order.map((u) => (
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
            <span style={{ width: 16, height: 16, borderRadius: "50%", background: colorFor(discFor(u)) }} />
            {nameOf(u)}{u === meUid ? " (you)" : ""}
          </div>
        ))}
      </div>

      <div className="status" style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{banner}</div>

      <div
        style={{
          background: "#1142c4",
          padding: "min(2.2vw, 14px)",
          borderRadius: 18,
          boxShadow: "var(--shadow)",
          width: "100%",
          maxWidth: 520,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: "min(1.6vw, 10px)" }}>
          {Array.from({ length: COLS }).map((_, c) => (
            <button
              key={c}
              onClick={() => play(c)}
              disabled={!isMyTurn || colFull(c)}
              aria-label={`Drop in column ${c + 1}`}
              style={{
                display: "grid",
                gridTemplateRows: `repeat(${ROWS}, 1fr)`,
                gap: "min(1.6vw, 10px)",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: isMyTurn && !colFull(c) ? "pointer" : "default",
              }}
            >
              {Array.from({ length: ROWS }).map((__, r) => {
                const cell = state.board[r][c];
                const isLast = lastDrop.current?.r === r && lastDrop.current?.c === c;
                return (
                  <span
                    key={r}
                    style={{
                      aspectRatio: "1 / 1",
                      borderRadius: "50%",
                      background: cell === 0 ? "#0b1f5c" : colorFor(cell),
                      boxShadow: cell === 0 ? "inset 0 3px 6px rgba(0,0,0,0.5)" : "inset 0 -3px 6px rgba(0,0,0,0.35)",
                      animation: isLast && cell !== 0 ? `cf-drop ${0.06 * (r + 1) + 0.18}s ease-in` : undefined,
                    }}
                  />
                );
              })}
            </button>
          ))}
        </div>
      </div>

      {ended && room.hostUid === meUid && (
        <button className="btn" style={{ marginTop: 8 }} onClick={rematch}>Play again</button>
      )}
      {ended && room.hostUid !== meUid && (
        <p className="muted">Waiting for host to start a rematch...</p>
      )}
    </div>
  );
}

const cfAnim = `@keyframes cf-drop { from { transform: translateY(-340%); } to { transform: translateY(0); } }`;

const CONFIG: MultiplayerConfig<CFState> = {
  gameId: "connect-four",
  title: "Connect Four",
  icon: "🔴",
  color: "#ffd54a",
  minPlayers: 2,
  maxPlayers: 2,
  rules: [
    "Take turns dropping discs into the columns.",
    "First to line up four in a row — across, down, or diagonally — wins.",
    "Fill the board with no four-in-a-row and it's a draw.",
  ],
  buildInitialState: (order) => ({ board: emptyBoard(), turn: order[0], winner: null }),
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
