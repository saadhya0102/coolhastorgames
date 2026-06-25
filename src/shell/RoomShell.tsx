import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  patchRoom,
  startGame,
  subscribeRoom,
  myUid,
  type RoomDoc,
} from "@/services/rooms";

export interface BoardProps<S = Record<string, unknown>> {
  room: RoomDoc<S>;
  code: string;
  meUid: string;
  isHost: boolean;
}

export interface MultiplayerConfig<S = Record<string, unknown>> {
  gameId: string;
  title: string;
  icon: string;
  color: string;
  minPlayers: number;
  maxPlayers: number;
  /** how-to text shown in the lobby */
  rules?: string[];
  /** build the initial shared state when the host starts (order = seating). */
  buildInitialState: (order: string[], room: RoomDoc<S>) => S;
  Board: ComponentType<BoardProps<S>>;
}

export function RoomShell<S>({ config, onExit }: { config: MultiplayerConfig<S>; onExit: () => void }) {
  const uid = myUid();
  const [code, setCode] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomDoc<S> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    if (!code) return;
    const unsub = subscribeRoom<S>(code, (r) => setRoom(r));
    return () => unsub();
  }, [code]);

  // leave the room when leaving the game
  useEffect(() => {
    return () => {
      if (code) void leaveRoom(code);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const doCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const c = await createRoom<S>(config.gameId, null);
      setCode(c);
    } catch (e) {
      setError("Couldn't create a room. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const doJoin = async () => {
    const c = joinCode.trim().toUpperCase();
    if (c.length < 4) {
      setError("Enter a 4-letter room code.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await joinRoom(c, config.maxPlayers);
    setBusy(false);
    if (res.ok) setCode(c);
    else setError(res.error || "Couldn't join.");
  };

  const isHost = !!room && room.hostUid === uid;

  const start = async () => {
    if (!room || !code) return;
    const order = room.order.slice();
    const state = config.buildInitialState(order, room);
    await startGame<S>(code, state, order);
  };

  const backToLobby = async () => {
    if (!code) return;
    await patchRoom(code, { status: "lobby", state: null });
  };

  // ---------- entry menu ----------
  if (!code) {
    return (
      <div className="game-page">
        <TopRow title={config.title} color={config.color} onExit={onExit} />
        <div className="stage-wrap">
          <div className="panel" style={{ maxWidth: 460, width: "100%" }}>
            <div className="center" style={{ fontSize: 54 }}>{config.icon}</div>
            <h2 className="center" style={{ marginTop: 0 }}>{config.title}</h2>
            {config.rules && (
              <ul className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
                {config.rules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <div className="col" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy} onClick={doCreate}>Create Room</button>
              <div className="row">
                <input
                  className="input"
                  placeholder="CODE"
                  value={joinCode}
                  maxLength={4}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && doJoin()}
                  style={{ textTransform: "uppercase", letterSpacing: 4, fontWeight: 700 }}
                />
                <button className="btn secondary" disabled={busy} onClick={doJoin}>Join</button>
              </div>
              {error && <p style={{ color: "var(--bad)", margin: 0 }}>{error}</p>}
              <p className="muted center" style={{ fontSize: 13, margin: 0 }}>
                Needs {config.minPlayers}-{config.maxPlayers} players. Share the code with friends.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="game-page">
        <TopRow title={config.title} color={config.color} onExit={onExit} />
        <div className="loading"><div className="spinner" /></div>
      </div>
    );
  }

  // ---------- lobby ----------
  if (room.status === "lobby") {
    const players = room.order.map((u) => room.players[u]).filter(Boolean);
    const enough = players.length >= config.minPlayers;
    return (
      <div className="game-page">
        <TopRow title={config.title} color={config.color} onExit={onExit} />
        <div className="stage-wrap">
          <div className="panel" style={{ maxWidth: 460, width: "100%" }}>
            <h3 style={{ marginTop: 0 }}>Room Code</h3>
            <div
              className="center"
              style={{ fontSize: 44, fontWeight: 800, letterSpacing: 8, color: config.color, cursor: "pointer" }}
              onClick={() => navigator.clipboard?.writeText(code)}
              title="Tap to copy"
            >
              {code}
            </div>
            <p className="muted center" style={{ fontSize: 13 }}>Tap the code to copy. Share it so friends can join.</p>
            <h4>Players ({players.length})</h4>
            <div className="col" style={{ gap: 6 }}>
              {players.map((p) => (
                <div key={p.uid} className="row" style={{ justifyContent: "space-between" }}>
                  <span>{p.name}{p.uid === room.hostUid ? "  (host)" : ""}{p.uid === uid ? "  (you)" : ""}</span>
                </div>
              ))}
            </div>
            <div className="col" style={{ marginTop: 16 }}>
              {isHost ? (
                <button className="btn" disabled={!enough} onClick={start}>
                  {enough ? "Start Game" : `Waiting for ${config.minPlayers - players.length} more...`}
                </button>
              ) : (
                <p className="muted center">Waiting for the host to start...</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- in game / ended ----------
  return (
    <div className="game-page">
      <TopRow
        title={config.title}
        color={config.color}
        onExit={onExit}
        right={isHost && room.status === "ended" ? (
          <button className="icon-btn" onClick={backToLobby}>Back to lobby</button>
        ) : null}
      />
      <config.Board room={room} code={code} meUid={uid} isHost={isHost} />
    </div>
  );
}

function TopRow({
  title,
  color,
  onExit,
  right,
}: {
  title: string;
  color: string;
  onExit: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="game-top">
      <button className="icon-btn" onClick={onExit}>&larr; Back</button>
      <h2 style={{ color }}>{title}</h2>
      <div className="spacer" />
      {right}
    </div>
  );
}
