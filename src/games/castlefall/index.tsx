import { useState } from "react";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom, type RoomDoc } from "@/services/rooms";
import { CASTLEFALL_WORDS } from "./words";

type TeamIdx = 0 | 1;

interface LogEntry {
  team: TeamIdx;
  text: string;
}

interface CFState {
  list: string[];
  teams: Record<string, TeamIdx>;
  /** secret target word for team 0 and team 1 */
  secret: [string, string];
  /** whose turn it is to give a clue */
  turn: TeamIdx;
  log: LogEntry[];
  scores: [number, number];
  winner: TeamIdx | null;
}

const LIST_SIZE = 16;
const TEAM_NAME: Record<TeamIdx, string> = { 0: "Team 1", 1: "Team 2" };
const TEAM_COLOR: Record<TeamIdx, string> = { 0: "#7c5cff", 1: "#19d3ff" };

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function freshRound(order: string[], scores: [number, number]): CFState {
  const list = shuffle(CASTLEFALL_WORDS).slice(0, LIST_SIZE);
  const picks = shuffle(list).slice(0, 2);
  const teams: Record<string, TeamIdx> = {};
  order.forEach((uid, i) => {
    teams[uid] = (i % 2) as TeamIdx;
  });
  const starter: TeamIdx = Math.random() < 0.5 ? 0 : 1;
  return {
    list,
    teams,
    secret: [picks[0], picks[1]],
    turn: starter,
    log: [{ team: starter, text: `${TEAM_NAME[starter]} gives the first clue.` }],
    scores,
    winner: null,
  };
}

function buildInitialState(order: string[], _room: RoomDoc<CFState>): CFState {
  return freshRound(order, [0, 0]);
}

function Board({ room, code, meUid, isHost }: BoardProps<CFState>) {
  const state = room.state;
  const [clue, setClue] = useState("");
  const [busy, setBusy] = useState(false);

  if (!state) return <div className="loading"><div className="spinner" /></div>;

  const myTeam = (state.teams[meUid] ?? null) as TeamIdx | null;
  const roundOver = state.winner !== null;
  const myTurn = myTeam !== null && state.turn === myTeam && !roundOver;
  const mySecret = myTeam !== null ? state.secret[myTeam] : null;

  const listLower = state.list.map((w) => w.toLowerCase());

  const giveClue = async () => {
    const word = clue.trim();
    if (!word || /\s/.test(word)) return;
    if (listLower.includes(word.toLowerCase())) return; // clue can't be on the board
    setBusy(true);
    await mutateRoom<CFState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner !== null) return null;
      const t = s.teams[meUid];
      if (t === undefined || s.turn !== t) return null;
      const other: TeamIdx = t === 0 ? 1 : 0;
      const next: CFState = {
        ...s,
        turn: other,
        log: [...s.log, { team: t, text: `${TEAM_NAME[t]}: "${word}"` }],
      };
      return { state: next };
    });
    setClue("");
    setBusy(false);
  };

  const guess = async (idx: number) => {
    if (myTeam === null || roundOver) return;
    setBusy(true);
    await mutateRoom<CFState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner !== null) return null;
      const t = s.teams[meUid];
      if (t === undefined) return null;
      const picked = s.list[idx];
      const correct = picked === s.secret[t];
      if (correct) {
        const scores: [number, number] = [...s.scores] as [number, number];
        scores[t] += 1;
        const next: CFState = {
          ...s,
          scores,
          winner: t,
          log: [...s.log, { team: t, text: `${TEAM_NAME[t]} guessed "${picked}" — correct! +1 point.` }],
        };
        return { state: next };
      }
      const next: CFState = {
        ...s,
        log: [...s.log, { team: t, text: `${TEAM_NAME[t]} guessed "${picked}" — wrong.` }],
      };
      return { state: next };
    });
    setBusy(false);
  };

  const newRound = async () => {
    const fresh = freshRound(room.order, state.scores);
    await patchRoom(code, { status: "playing", state: fresh });
  };

  const roster = (t: TeamIdx) =>
    room.order
      .filter((u) => state.teams[u] === t)
      .map((u) => room.players[u]?.name ?? "?")
      .join(", ") || "—";

  return (
    <div className="stage-wrap" style={{ justifyContent: "flex-start" }}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        {/* scoreboard */}
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          {([0, 1] as TeamIdx[]).map((t) => (
            <div
              key={t}
              className="panel"
              style={{
                flex: 1,
                padding: "8px 12px",
                borderColor: TEAM_COLOR[t],
                borderWidth: state.turn === t && !roundOver ? 2 : 1,
                background: `${TEAM_COLOR[t]}1f`,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong style={{ color: TEAM_COLOR[t] }}>{TEAM_NAME[t]}</strong>
                <span style={{ fontWeight: 800, fontSize: 18 }}>{state.scores[t]}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{roster(t)}</div>
            </div>
          ))}
        </div>

        {/* status */}
        <div className="panel" style={{ padding: "8px 12px", marginBottom: 8, textAlign: "center" }}>
          {roundOver ? (
            <strong style={{ color: state.winner !== null ? TEAM_COLOR[state.winner] : undefined }}>
              {state.winner !== null ? `${TEAM_NAME[state.winner]} wins the round!` : "Round over"}
            </strong>
          ) : (
            <span>
              <span className="muted">Clue turn: </span>
              <strong style={{ color: TEAM_COLOR[state.turn] }}>{TEAM_NAME[state.turn]}</strong>
              {myTeam !== null && (
                <>
                  {" — your secret word: "}
                  <strong style={{ color: TEAM_COLOR[myTeam] }}>{mySecret}</strong>
                </>
              )}
            </span>
          )}
        </div>

        {/* word list */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {state.list.map((w, i) => {
            const isMine = mySecret === w;
            const clickable = myTeam !== null && !roundOver && !busy;
            return (
              <div
                key={i}
                onClick={() => clickable && guess(i)}
                style={{
                  borderRadius: 10,
                  padding: "12px 4px",
                  minHeight: 52,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  lineHeight: 1.15,
                  userSelect: "none",
                  wordBreak: "break-word",
                  border: isMine ? `2px solid ${myTeam !== null ? TEAM_COLOR[myTeam] : "var(--border)"}` : "1px solid var(--border)",
                  background: isMine && myTeam !== null ? `${TEAM_COLOR[myTeam]}33` : "var(--panel-2)",
                  color: "var(--text)",
                  cursor: clickable ? "pointer" : "default",
                }}
              >
                {w}
              </div>
            );
          })}
        </div>

        {/* clue input */}
        {!roundOver && (
          <div style={{ marginTop: 12 }}>
            {myTurn ? (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 160 }}
                  placeholder="One-word clue (not on the board)"
                  value={clue}
                  maxLength={28}
                  onChange={(e) => setClue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && giveClue()}
                />
                <button className="btn" disabled={busy} onClick={giveClue}>Send clue</button>
              </div>
            ) : (
              <p className="muted center" style={{ margin: 0 }}>
                {myTeam === null
                  ? "Spectating."
                  : `Waiting for ${TEAM_NAME[state.turn]} to give a clue. Tap your secret word above whenever you're confident.`}
              </p>
            )}
          </div>
        )}

        {/* host: new round */}
        {roundOver && isHost && (
          <button className="btn" style={{ marginTop: 12 }} onClick={newRound}>Next round</button>
        )}
        {roundOver && !isHost && (
          <p className="muted center" style={{ marginTop: 12 }}>Waiting for the host to start the next round…</p>
        )}

        {/* clue log */}
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 6 }}>Clue log</div>
          <div className="col" style={{ gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {state.log.slice().reverse().map((l, i) => (
              <div
                key={i}
                style={{
                  fontSize: 14,
                  padding: "4px 8px",
                  borderRadius: 8,
                  background: `${TEAM_COLOR[l.team]}14`,
                  borderLeft: `3px solid ${TEAM_COLOR[l.team]}`,
                }}
              >
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const CONFIG: MultiplayerConfig<CFState> = {
  gameId: "castlefall",
  title: "Castlefall",
  icon: "🏰",
  color: "#7c5cff",
  minPlayers: 2,
  maxPlayers: 8,
  rules: [
    "Players are split into two teams. Everyone sees the same list of 16 words.",
    "Each team is secretly assigned one target word from that list — you only see your own team's word.",
    "Teams alternate giving a one-word clue (it can't be a word on the list) to point teammates at your secret word.",
    "All clues are public, so be subtle — you don't want the other team to figure out your word.",
    "Whenever you're confident, tap the word on the board you think is YOUR team's secret word.",
    "Guess correctly to win the round and score a point. The host can then start a new round; scores carry over.",
  ],
  buildInitialState,
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
