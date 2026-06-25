import { useMemo, useState } from "react";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom, type RoomDoc } from "@/services/rooms";

/* ----------------------------- model ----------------------------- */

const SIZE = 10;

interface ShipDef {
  name: string;
  len: number;
}

const SHIPS: ShipDef[] = [
  { name: "Carrier", len: 5 },
  { name: "Battleship", len: 4 },
  { name: "Cruiser", len: 3 },
  { name: "Submarine", len: 3 },
  { name: "Destroyer", len: 2 },
];

interface Ship {
  name: string;
  len: number;
  /** occupied cell indices (0..99) */
  cells: number[];
}

interface PlayerBoard {
  ships: Ship[];
  ready: boolean;
  /** cell indices the OPPONENT has fired at this board */
  shotsReceived: number[];
}

type Phase = "placing" | "firing" | "over";

interface S {
  phase: Phase;
  boards: Record<string, PlayerBoard>;
  /** uid whose turn it is to fire */
  turn: string;
  winner: string | null;
  /** human-readable announcement of the last shot */
  lastEvent: string | null;
}

/* ----------------------------- helpers ----------------------------- */

const idx = (r: number, c: number) => r * SIZE + c;
const rowOf = (i: number) => Math.floor(i / SIZE);
const colOf = (i: number) => i % SIZE;

function freshState(order: string[]): S {
  const boards: Record<string, PlayerBoard> = {};
  for (const u of order) boards[u] = { ships: [], ready: false, shotsReceived: [] };
  return { phase: "placing", boards, turn: order[0] ?? "", winner: null, lastEvent: null };
}

/** Cells a ship would occupy from an anchor; null if it runs off the board. */
function shipCells(anchor: number, len: number, horizontal: boolean): number[] | null {
  const r = rowOf(anchor);
  const c = colOf(anchor);
  const cells: number[] = [];
  for (let k = 0; k < len; k++) {
    const rr = horizontal ? r : r + k;
    const cc = horizontal ? c + k : c;
    if (rr >= SIZE || cc >= SIZE) return null;
    cells.push(idx(rr, cc));
  }
  return cells;
}

/** Random non-overlapping fleet; returns cells per SHIPS index. */
function randomFleet(): number[][] {
  const occupied = new Set<number>();
  const result: number[][] = [];
  for (const ship of SHIPS) {
    for (;;) {
      const horizontal = Math.random() < 0.5;
      const anchor = Math.floor(Math.random() * SIZE * SIZE);
      const cells = shipCells(anchor, ship.len, horizontal);
      if (!cells) continue;
      if (cells.some((x) => occupied.has(x))) continue;
      cells.forEach((x) => occupied.add(x));
      result.push(cells);
      break;
    }
  }
  return result;
}

const isSunk = (ship: Ship, shots: number[]) => ship.cells.every((c) => shots.includes(c));
const fleetSunkCount = (board: PlayerBoard) =>
  board.ships.filter((s) => isSunk(s, board.shotsReceived)).length;
const allShipsSunk = (board: PlayerBoard) =>
  board.ships.length > 0 && board.ships.every((s) => isSunk(s, board.shotsReceived));

/* ----------------------------- grid view ----------------------------- */

type CellKind = "water" | "ship" | "hit" | "miss" | "sunk" | "preview";

const CELL_BG: Record<CellKind, string> = {
  water: "var(--panel-2)",
  ship: "#3c4c84",
  hit: "var(--bad)",
  miss: "var(--bg-2)",
  sunk: "#7a1f3a",
  preview: "rgba(70,224,160,0.4)",
};

function Grid({
  kinds,
  glyphs,
  onCell,
  disabled,
}: {
  kinds: CellKind[];
  glyphs: (string | null)[];
  onCell?: (i: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
        gap: 2,
        width: "100%",
        maxWidth: 360,
        aspectRatio: "1 / 1",
        background: "var(--border)",
        padding: 2,
        borderRadius: 10,
        touchAction: "manipulation",
      }}
    >
      {kinds.map((kind, i) => {
        const clickable = !!onCell && !disabled;
        return (
          <button
            key={i}
            disabled={!clickable}
            onClick={clickable ? () => onCell!(i) : undefined}
            style={{
              all: "unset",
              aspectRatio: "1 / 1",
              background: CELL_BG[kind],
              borderRadius: 3,
              display: "grid",
              placeItems: "center",
              fontSize: "min(3.4vw, 16px)",
              cursor: clickable ? "pointer" : "default",
              boxShadow: kind === "miss" ? "inset 0 0 0 1px var(--border)" : undefined,
              transition: "background 0.1s",
            }}
          >
            {glyphs[i]}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- placement ----------------------------- */

function PlacementPanel({
  code,
  meUid,
  order,
}: {
  code: string;
  meUid: string;
  order: string[];
}) {
  const [draft, setDraft] = useState<(number[] | null)[]>(() => SHIPS.map(() => null));
  const [selected, setSelected] = useState(0);
  const [horizontal, setHorizontal] = useState(true);
  const [busy, setBusy] = useState(false);

  const occupied = useMemo(() => {
    const set = new Set<number>();
    draft.forEach((cells, i) => {
      if (i !== selected && cells) cells.forEach((c) => set.add(c));
    });
    return set;
  }, [draft, selected]);

  const allPlaced = draft.every((d) => d !== null);

  const place = (anchor: number) => {
    const cells = shipCells(anchor, SHIPS[selected].len, horizontal);
    if (!cells) return;
    if (cells.some((c) => occupied.has(c))) return;
    setDraft((prev) => {
      const next = prev.slice();
      next[selected] = cells;
      return next;
    });
    const nextUnplaced = draft.findIndex((d, i) => i !== selected && d === null);
    if (nextUnplaced !== -1) setSelected(nextUnplaced);
  };

  const randomize = () => {
    setDraft(randomFleet());
    setSelected(0);
  };
  const clear = () => {
    setDraft(SHIPS.map(() => null));
    setSelected(0);
  };

  const ready = async () => {
    if (!allPlaced) return;
    const ships: Ship[] = SHIPS.map((def, i) => ({
      name: def.name,
      len: def.len,
      cells: draft[i] as number[],
    }));
    setBusy(true);
    await mutateRoom<S>(code, (room) => {
      const st = room.state;
      if (!st || st.phase !== "placing") return null;
      const mine = st.boards[meUid];
      if (!mine || mine.ready) return null;
      const boards = { ...st.boards, [meUid]: { ...mine, ships, ready: true } };
      const bothReady = order.every((u) => boards[u]?.ready);
      return { state: { ...st, boards, phase: bothReady ? "firing" : "placing" } };
    });
    setBusy(false);
  };

  // build the grid view from the draft
  const kinds: CellKind[] = Array(SIZE * SIZE).fill("water");
  const glyphs: (string | null)[] = Array(SIZE * SIZE).fill(null);
  draft.forEach((cells, i) => {
    if (!cells) return;
    cells.forEach((c) => {
      kinds[c] = i === selected ? "preview" : "ship";
    });
  });

  return (
    <div className="col" style={{ alignItems: "center", gap: 14 }}>
      <p className="status center">
        Arrange your fleet. Pick a ship, choose orientation, then tap a cell to place it.
      </p>
      <Grid kinds={kinds} glyphs={glyphs} onCell={place} />

      <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
        {SHIPS.map((def, i) => {
          const placed = draft[i] !== null;
          const active = i === selected;
          return (
            <button
              key={def.name}
              className={`btn ${active ? "" : "secondary"}`}
              style={{ padding: "8px 12px", fontSize: 13, opacity: placed && !active ? 0.6 : 1 }}
              onClick={() => setSelected(i)}
            >
              {def.name} ({def.len}) {placed ? "✓" : ""}
            </button>
          );
        })}
      </div>

      <div className="row" style={{ flexWrap: "wrap", justifyContent: "center" }}>
        <button className="btn secondary" onClick={() => setHorizontal((h) => !h)}>
          Orientation: {horizontal ? "Horizontal ↔" : "Vertical ↕"}
        </button>
        <button className="btn secondary" onClick={randomize}>
          Randomize
        </button>
        <button className="btn secondary" onClick={clear}>
          Clear
        </button>
        <button className="btn" disabled={!allPlaced || busy} onClick={ready}>
          {busy ? "..." : "Ready"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- fleet status ----------------------------- */

function FleetStatus({
  title,
  board,
  reveal,
}: {
  title: string;
  board: PlayerBoard;
  reveal: boolean;
}) {
  return (
    <div className="col" style={{ gap: 4, fontSize: 13 }}>
      <strong>{title}</strong>
      {board.ships.length === 0 ? (
        <span className="muted">placing…</span>
      ) : (
        board.ships.map((s) => {
          const sunk = isSunk(s, board.shotsReceived);
          // hide intact ship names from the opponent's perspective
          const label = reveal || sunk ? s.name : "Ship";
          return (
            <span
              key={s.name}
              className={sunk ? "" : "muted"}
              style={{ textDecoration: sunk ? "line-through" : "none", color: sunk ? "var(--bad)" : undefined }}
            >
              {sunk ? "💀" : "•"} {label} ({s.len})
            </span>
          );
        })
      )}
    </div>
  );
}

/* ----------------------------- board ----------------------------- */

function Board({ room, code, meUid, isHost }: BoardProps<S>) {
  const st = room.state;
  const order = room.order;
  const oppUid = order.find((u) => u !== meUid) ?? "";

  if (!st) {
    return (
      <div className="stage-wrap">
        <div className="loading"><div className="spinner" /></div>
      </div>
    );
  }

  const myBoard = st.boards[meUid];
  const oppBoard = st.boards[oppUid];

  /* ---- placing ---- */
  if (st.phase === "placing") {
    if (myBoard?.ready) {
      return (
        <div className="stage-wrap">
          <div className="panel" style={{ maxWidth: 460, width: "100%" }}>
            <h3 className="center" style={{ marginTop: 0 }}>Fleet locked in 🚢</h3>
            <p className="muted center">Waiting for your opponent to finish placing…</p>
            <div className="loading"><div className="spinner" /></div>
          </div>
        </div>
      );
    }
    return (
      <div className="stage-wrap">
        <PlacementPanel code={code} meUid={meUid} order={order} />
      </div>
    );
  }

  if (!myBoard || !oppBoard) {
    return (
      <div className="stage-wrap">
        <p className="muted">Waiting for both players…</p>
      </div>
    );
  }

  const myTurn = st.turn === meUid && st.phase === "firing";

  const fire = async (cell: number) => {
    if (!myTurn) return;
    if (oppBoard.shotsReceived.includes(cell)) return;
    await mutateRoom<S>(code, (r) => {
      const cur = r.state;
      if (!cur || cur.phase !== "firing") return null;
      if (cur.turn !== meUid) return null;
      const target = cur.boards[oppUid];
      if (!target || target.shotsReceived.includes(cell)) return null;

      const shots = [...target.shotsReceived, cell];
      const ship = target.ships.find((s) => s.cells.includes(cell));
      let event: string;
      if (ship) {
        event = isSunk(ship, shots) ? `You sank their ${ship.name}!` : "Direct hit!";
      } else {
        event = "Splash — miss.";
      }
      const nextBoards = { ...cur.boards, [oppUid]: { ...target, shotsReceived: shots } };
      const won = allShipsSunk(nextBoards[oppUid]);
      if (won) {
        return {
          state: { ...cur, boards: nextBoards, phase: "over", winner: meUid, lastEvent: event },
          status: "ended",
        };
      }
      return { state: { ...cur, boards: nextBoards, turn: oppUid, lastEvent: event } };
    });
  };

  const rematch = async () => {
    const fields: Partial<RoomDoc<S>> = { status: "playing", state: freshState(order) };
    await patchRoom(code, fields as Partial<RoomDoc>);
  };

  /* ---- my grid (ships + incoming fire) ---- */
  const myKinds: CellKind[] = Array(SIZE * SIZE).fill("water");
  const myGlyphs: (string | null)[] = Array(SIZE * SIZE).fill(null);
  const myShipCells = new Set<number>();
  myBoard.ships.forEach((s) => s.cells.forEach((c) => myShipCells.add(c)));
  myShipCells.forEach((c) => (myKinds[c] = "ship"));
  myBoard.ships.forEach((s) => {
    const sunk = isSunk(s, myBoard.shotsReceived);
    s.cells.forEach((c) => {
      if (myBoard.shotsReceived.includes(c)) {
        myKinds[c] = sunk ? "sunk" : "hit";
        myGlyphs[c] = "💥";
      }
    });
  });
  myBoard.shotsReceived.forEach((c) => {
    if (!myShipCells.has(c)) {
      myKinds[c] = "miss";
      myGlyphs[c] = "•";
    }
  });

  /* ---- opponent grid (only my shots revealed) ---- */
  const oppKinds: CellKind[] = Array(SIZE * SIZE).fill("water");
  const oppGlyphs: (string | null)[] = Array(SIZE * SIZE).fill(null);
  oppBoard.shotsReceived.forEach((c) => {
    const hitShip = oppBoard.ships.find((s) => s.cells.includes(c));
    if (hitShip) {
      const sunk = isSunk(hitShip, oppBoard.shotsReceived);
      oppKinds[c] = sunk ? "sunk" : "hit";
      oppGlyphs[c] = "💥";
    } else {
      oppKinds[c] = "miss";
      oppGlyphs[c] = "•";
    }
  });

  const over = st.phase === "over";
  const iWon = st.winner === meUid;
  const oppName = room.players[oppUid]?.name ?? "Opponent";

  let banner: string;
  if (over) banner = iWon ? "🏆 Victory! You sank their entire fleet." : `💥 Defeated — ${oppName} won.`;
  else if (myTurn) banner = "Your turn — fire on the enemy grid!";
  else banner = `Waiting for ${oppName} to fire…`;

  return (
    <div className="stage-wrap">
      <div className="panel center" style={{ width: "100%", maxWidth: 780 }}>
        <h3 style={{ margin: "0 0 4px" }}>{banner}</h3>
        {st.lastEvent && <p className="muted" style={{ margin: 0 }}>{st.lastEvent}</p>}
      </div>

      <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 18, alignItems: "flex-start", width: "100%" }}>
        <div className="col" style={{ alignItems: "center", gap: 8, flex: "1 1 280px", maxWidth: 360 }}>
          <strong style={{ color: "var(--accent-2)" }}>Enemy waters</strong>
          <Grid kinds={oppKinds} glyphs={oppGlyphs} onCell={fire} disabled={!myTurn} />
          <FleetStatus title={`${oppName}'s fleet — ${fleetSunkCount(oppBoard)}/${oppBoard.ships.length} sunk`} board={oppBoard} reveal={over} />
        </div>

        <div className="col" style={{ alignItems: "center", gap: 8, flex: "1 1 280px", maxWidth: 360 }}>
          <strong>Your fleet</strong>
          <Grid kinds={myKinds} glyphs={myGlyphs} />
          <FleetStatus title={`Your fleet — ${fleetSunkCount(myBoard)}/${myBoard.ships.length} sunk`} board={myBoard} reveal />
        </div>
      </div>

      {over && isHost && (
        <button className="btn" onClick={rematch} style={{ marginTop: 8 }}>
          Rematch
        </button>
      )}
      {over && !isHost && <p className="muted">Waiting for host to start a rematch…</p>}
    </div>
  );
}

/* ----------------------------- config / export ----------------------------- */

const CONFIG: MultiplayerConfig<S> = {
  gameId: "battleship",
  title: "Battleship",
  icon: "🚢",
  color: "#19d3ff",
  minPlayers: 2,
  maxPlayers: 2,
  rules: [
    "Each captain secretly arranges 5 ships on a 10×10 grid.",
    "Take turns firing at the enemy grid — a 💥 is a hit, a • is a miss.",
    "Sink an opponent's whole ship to take it out of the fight.",
    "First to sink the entire enemy fleet wins.",
  ],
  buildInitialState: (order: string[], _room: RoomDoc<S>) => freshState(order),
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
