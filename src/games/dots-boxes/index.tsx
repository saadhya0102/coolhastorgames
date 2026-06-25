import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom } from "@/services/rooms";
import { useEffect } from "react";

const BOXES = 5; // 5x5 boxes => 6x6 dots
const DOTS = BOXES + 1;
const P1 = "#19d3ff"; // order[0]
const P2 = "#ff5c8a"; // order[1]

type Winner = string | null | "draw";

interface DBState {
  /** horizontal edges: h[row][col], row 0..BOXES, col 0..BOXES-1 */
  h: boolean[][];
  /** vertical edges: v[row][col], row 0..BOXES-1, col 0..BOXES */
  v: boolean[][];
  /** box owners: owners[row][col] in {0,1,2} */
  owners: number[][];
  scores: [number, number]; // [order0, order1]
  turn: string; // uid
  winner: Winner;
}

const grid = <T,>(rows: number, cols: number, val: T): T[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => val));

function buildState(order: string[]): DBState {
  return {
    h: grid(DOTS, BOXES, false),
    v: grid(BOXES, DOTS, false),
    owners: grid(BOXES, BOXES, 0),
    scores: [0, 0],
    turn: order[0],
    winner: null,
  };
}

const allEdgesFilled = (s: DBState): boolean =>
  s.h.every((row) => row.every(Boolean)) && s.v.every((row) => row.every(Boolean));

function Board({ room, code, meUid }: BoardProps<DBState>) {
  const state = room.state;
  const order = room.order;

  // host commits the ended status when the board fills up
  useEffect(() => {
    if (state && state.winner !== null && room.status === "playing" && room.hostUid === meUid) {
      void patchRoom(code, { status: "ended", state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.winner, room.status]);

  if (!state) return <div className="loading"><div className="spinner" /></div>;

  const playerNum = (uid: string): 1 | 2 => (order[0] === uid ? 1 : 2);
  const colorOf = (n: number) => (n === 1 ? P1 : n === 2 ? P2 : "transparent");
  const nameOf = (uid: string) => room.players[uid]?.name ?? "Player";

  const isMyTurn = state.turn === meUid && state.winner === null;
  const ended = state.winner !== null;

  /** Count completed boxes adjacent to a just-drawn edge, marking owners. */
  const claimFor = (
    h: boolean[][],
    v: boolean[][],
    owners: number[][],
    boxes: Array<[number, number]>,
    mine: number,
  ): number => {
    let gained = 0;
    for (const [br, bc] of boxes) {
      if (br < 0 || br >= BOXES || bc < 0 || bc >= BOXES) continue;
      if (owners[br][bc] !== 0) continue;
      const complete = h[br][bc] && h[br + 1][bc] && v[br][bc] && v[br][bc + 1];
      if (complete) {
        owners[br][bc] = mine;
        gained++;
      }
    }
    return gained;
  };

  const playH = (r: number, c: number) => playEdge("h", r, c);
  const playV = (r: number, c: number) => playEdge("v", r, c);

  const playEdge = async (kind: "h" | "v", r: number, c: number) => {
    if (!isMyTurn) return;
    if (kind === "h" && state.h[r][c]) return;
    if (kind === "v" && state.v[r][c]) return;
    await mutateRoom<DBState>(code, (room2) => {
      const s = room2.state;
      if (!s || s.winner !== null) return null;
      if (s.turn !== meUid) return null;
      const h = s.h.map((row) => row.slice());
      const v = s.v.map((row) => row.slice());
      const owners = s.owners.map((row) => row.slice());
      const mine = playerNum(meUid);

      let neighbors: Array<[number, number]>;
      if (kind === "h") {
        if (h[r][c]) return null;
        h[r][c] = true;
        neighbors = [
          [r - 1, c],
          [r, c],
        ];
      } else {
        if (v[r][c]) return null;
        v[r][c] = true;
        neighbors = [
          [r, c - 1],
          [r, c],
        ];
      }

      const gained = claimFor(h, v, owners, neighbors, mine);
      const scores: [number, number] = [s.scores[0], s.scores[1]];
      if (gained > 0) scores[mine - 1] += gained;

      const next: DBState = {
        h,
        v,
        owners,
        scores,
        turn: gained > 0 ? s.turn : room2.order.find((u) => u !== meUid) ?? s.turn,
        winner: null,
      };
      if (allEdgesFilled(next)) {
        if (scores[0] > scores[1]) next.winner = room2.order[0];
        else if (scores[1] > scores[0]) next.winner = room2.order[1];
        else next.winner = "draw";
      }
      return { state: next };
    });
  };

  const rematch = async () => {
    await patchRoom(code, { status: "playing", state: buildState(order) });
  };

  let banner: string;
  if (state.winner === "draw") banner = "It's a tie!";
  else if (state.winner) banner = `${nameOf(state.winner)} wins! 🎉`;
  else if (isMyTurn) banner = "Your turn — draw a line";
  else banner = `Waiting for ${nameOf(state.turn)}...`;

  // svg geometry
  const GAP = 64; // distance between dots in svg units
  const PAD = 26;
  const DOT = 7;
  const EDGE = 12; // clickable thickness
  const size = PAD * 2 + GAP * (DOTS - 1);
  const px = (i: number) => PAD + i * GAP;

  return (
    <div className="stage-wrap">
      <div className="row" style={{ gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
        {order.map((u, i) => (
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
            <span style={{ width: 14, height: 14, borderRadius: 4, background: colorOf(i + 1) }} />
            {nameOf(u)}{u === meUid ? " (you)" : ""}: {state.scores[i]}
          </div>
        ))}
      </div>

      <div className="status" style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{banner}</div>

      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          touchAction: "manipulation",
        }}
      >
        {/* filled boxes */}
        {state.owners.map((row, br) =>
          row.map((own, bc) =>
            own !== 0 ? (
              <rect
                key={`b${br}-${bc}`}
                x={px(bc)}
                y={px(br)}
                width={GAP}
                height={GAP}
                fill={colorOf(own)}
                opacity={0.22}
              />
            ) : null,
          ),
        )}

        {/* drawn + clickable horizontal edges */}
        {state.h.map((row, r) =>
          row.map((on, c) => (
            <g key={`h${r}-${c}`}>
              <line
                x1={px(c)}
                y1={px(r)}
                x2={px(c + 1)}
                y2={px(r)}
                stroke={on ? "var(--text)" : "var(--border)"}
                strokeWidth={on ? 6 : 2}
                strokeLinecap="round"
              />
              {!on && isMyTurn && (
                <rect
                  x={px(c) + DOT}
                  y={px(r) - EDGE / 2}
                  width={GAP - DOT * 2}
                  height={EDGE}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => playH(r, c)}
                />
              )}
            </g>
          )),
        )}

        {/* drawn + clickable vertical edges */}
        {state.v.map((row, r) =>
          row.map((on, c) => (
            <g key={`v${r}-${c}`}>
              <line
                x1={px(c)}
                y1={px(r)}
                x2={px(c)}
                y2={px(r + 1)}
                stroke={on ? "var(--text)" : "var(--border)"}
                strokeWidth={on ? 6 : 2}
                strokeLinecap="round"
              />
              {!on && isMyTurn && (
                <rect
                  x={px(c) - EDGE / 2}
                  y={px(r) + DOT}
                  width={EDGE}
                  height={GAP - DOT * 2}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => playV(r, c)}
                />
              )}
            </g>
          )),
        )}

        {/* dots */}
        {Array.from({ length: DOTS }).map((_, r) =>
          Array.from({ length: DOTS }).map((__, c) => (
            <circle key={`d${r}-${c}`} cx={px(c)} cy={px(r)} r={DOT} fill="var(--accent)" />
          )),
        )}
      </svg>

      {ended && room.hostUid === meUid && (
        <button className="btn" style={{ marginTop: 8 }} onClick={rematch}>Play again</button>
      )}
      {ended && room.hostUid !== meUid && <p className="muted">Waiting for host to start a rematch...</p>}
    </div>
  );
}

const CONFIG: MultiplayerConfig<DBState> = {
  gameId: "dots-boxes",
  title: "Dots & Boxes",
  icon: "🔲",
  color: "#19d3ff",
  minPlayers: 2,
  maxPlayers: 2,
  rules: [
    "Take turns drawing a line between two adjacent dots.",
    "Close the 4th side of a box to claim it and score — then go again.",
    "When the grid is full, the most boxes wins.",
  ],
  buildInitialState: (order) => buildState(order),
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
