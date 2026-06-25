import { useState } from "react";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom, type RoomDoc } from "@/services/rooms";
import { SPY_WORDS } from "./words";

type Team = "red" | "blue";
type CardColor = Team | "neutral" | "assassin";
type Role = "spymaster" | "operative";

interface Clue {
  word: string;
  number: number;
}

interface SpyState {
  words: string[];
  key: CardColor[];
  revealed: boolean[];
  teams: Record<string, Team>;
  roles: Record<string, Role>;
  turn: Team;
  starter: Team;
  clue: Clue | null;
  guessesLeft: number;
  log: string[];
  winner: Team | null;
}

const GRID = 25;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildKey(starter: Team): CardColor[] {
  const other: Team = starter === "red" ? "blue" : "red";
  const key: CardColor[] = [];
  for (let i = 0; i < 9; i++) key.push(starter);
  for (let i = 0; i < 8; i++) key.push(other);
  for (let i = 0; i < 7; i++) key.push("neutral");
  key.push("assassin");
  return shuffle(key);
}

function buildInitialState(order: string[], _room: RoomDoc<SpyState>): SpyState {
  const words = shuffle(SPY_WORDS).slice(0, GRID);
  const starter: Team = Math.random() < 0.5 ? "red" : "blue";
  const key = buildKey(starter);

  const teams: Record<string, Team> = {};
  const roles: Record<string, Role> = {};
  const reds: string[] = [];
  const blues: string[] = [];
  order.forEach((uid, i) => {
    const team: Team = i % 2 === 0 ? "red" : "blue";
    teams[uid] = team;
    (team === "red" ? reds : blues).push(uid);
  });
  // first member of each team is the spymaster, everyone else an operative
  order.forEach((uid) => {
    const roster = teams[uid] === "red" ? reds : blues;
    roles[uid] = roster[0] === uid ? "spymaster" : "operative";
  });

  return {
    words,
    key,
    revealed: Array.from({ length: GRID }, () => false),
    teams,
    roles,
    turn: starter,
    starter,
    clue: null,
    guessesLeft: 0,
    log: [`${starter === "red" ? "Red" : "Blue"} team goes first.`],
    winner: null,
  };
}

function remaining(state: SpyState, team: Team): number {
  let n = 0;
  for (let i = 0; i < GRID; i++) {
    if (state.key[i] === team && !state.revealed[i]) n++;
  }
  return n;
}

const TEAM_LABEL: Record<Team, string> = { red: "Red", blue: "Blue" };
const COLOR_BG: Record<CardColor, string> = {
  red: "#c0392b",
  blue: "#2563c9",
  neutral: "#b8a98a",
  assassin: "#15171c",
};

function Board({ room, code, meUid }: BoardProps<SpyState>) {
  const state = room.state;
  const [clueWord, setClueWord] = useState("");
  const [clueNum, setClueNum] = useState("1");
  const [busy, setBusy] = useState(false);

  if (!state) return <div className="loading"><div className="spinner" /></div>;

  const myTeam = state.teams[meUid] ?? null;
  const myRole = state.roles[meUid] ?? null;
  const isSpymaster = myRole === "spymaster";
  const ended = room.status === "ended" || state.winner !== null;

  // who is allowed to guess for the current turn team: operatives, or the
  // spymaster if their team has no operatives (e.g. a 2-player game).
  const turnRoster = room.order.filter((u) => state.teams[u] === state.turn);
  const turnHasOperative = turnRoster.some((u) => state.roles[u] === "operative");
  const myTurn = myTeam === state.turn && !ended;
  const canGuess =
    myTurn && state.clue !== null && (myRole === "operative" || (!turnHasOperative && isSpymaster));
  const canClue = myTurn && isSpymaster && state.clue === null;

  const redLeft = remaining(state, "red");
  const blueLeft = remaining(state, "blue");

  const giveClue = async () => {
    const word = clueWord.trim();
    const num = parseInt(clueNum, 10);
    if (!word || /\s/.test(word) || Number.isNaN(num) || num < 0 || num > 9) return;
    setBusy(true);
    await mutateRoom<SpyState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner || s.clue) return null;
      if (s.teams[meUid] !== s.turn || s.roles[meUid] !== "spymaster") return null;
      const next: SpyState = {
        ...s,
        clue: { word, number: num },
        guessesLeft: num + 1,
        log: [...s.log, `${TEAM_LABEL[s.turn]} clue: "${word}" ${num}`],
      };
      return { state: next };
    });
    setClueWord("");
    setClueNum("1");
    setBusy(false);
  };

  const endTurn = async () => {
    setBusy(true);
    await mutateRoom<SpyState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner) return null;
      if (s.teams[meUid] !== s.turn) return null;
      const nextTeam: Team = s.turn === "red" ? "blue" : "red";
      const next: SpyState = {
        ...s,
        turn: nextTeam,
        clue: null,
        guessesLeft: 0,
        log: [...s.log, `${TEAM_LABEL[s.turn]} ended their turn.`],
      };
      return { state: next };
    });
    setBusy(false);
  };

  const guess = async (idx: number) => {
    setBusy(true);
    await mutateRoom<SpyState>(code, (r) => {
      const s = r.state;
      if (!s || s.winner || !s.clue || s.revealed[idx]) return null;
      const operative = s.roles[meUid] === "operative";
      const roster = r.order.filter((u) => s.teams[u] === s.turn);
      const hasOp = roster.some((u) => s.roles[u] === "operative");
      const allowed = operative || (!hasOp && s.roles[meUid] === "spymaster");
      if (s.teams[meUid] !== s.turn || !allowed) return null;

      const revealed = s.revealed.slice();
      revealed[idx] = true;
      const color = s.key[idx];
      const turn = s.turn;
      const other: Team = turn === "red" ? "blue" : "red";
      const log = [...s.log, `${TEAM_LABEL[turn]} picked ${s.words[idx]} (${color}).`];
      let next: SpyState = { ...s, revealed, log };

      if (color === "assassin") {
        next = { ...next, winner: other, clue: null, guessesLeft: 0, log: [...log, `Assassin! ${TEAM_LABEL[other]} wins.`] };
        return { state: next, status: "ended" };
      }

      const redLeftN = remaining(next, "red");
      const blueLeftN = remaining(next, "blue");
      if (redLeftN === 0 || blueLeftN === 0) {
        const winner: Team = redLeftN === 0 ? "red" : "blue";
        next = { ...next, winner, clue: null, guessesLeft: 0, log: [...log, `${TEAM_LABEL[winner]} found all their agents and wins!`] };
        return { state: next, status: "ended" };
      }

      if (color === turn) {
        const left = next.guessesLeft - 1;
        if (left <= 0) {
          next = { ...next, turn: other, clue: null, guessesLeft: 0, log: [...log, `${TEAM_LABEL[turn]} is out of guesses.`] };
        } else {
          next = { ...next, guessesLeft: left };
        }
      } else {
        // neutral or opponent card -> turn passes
        next = { ...next, turn: other, clue: null, guessesLeft: 0, log: [...log, `Turn passes to ${TEAM_LABEL[other]}.`] };
      }
      return { state: next };
    });
    setBusy(false);
  };

  const rematch = async () => {
    const fresh = buildInitialState(room.order, room);
    await patchRoom(code, { status: "playing", state: fresh });
  };

  const tileStyle = (idx: number): React.CSSProperties => {
    const isRevealed = state.revealed[idx];
    const color = state.key[idx];
    const base: React.CSSProperties = {
      borderRadius: 10,
      padding: "12px 4px",
      minHeight: 54,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      fontWeight: 700,
      fontSize: 13,
      lineHeight: 1.1,
      userSelect: "none",
      border: "1px solid var(--border)",
      background: "var(--panel-2)",
      color: "var(--text)",
      cursor: canGuess && !isRevealed ? "pointer" : "default",
      wordBreak: "break-word",
    };
    if (isRevealed) {
      base.background = COLOR_BG[color];
      base.color = color === "neutral" ? "#1a1206" : "#fff";
      base.opacity = 0.95;
      if (color === "assassin") base.color = "#ff5c8a";
    } else if (isSpymaster) {
      // spymaster sees the key as a colored border + tint
      base.borderColor = COLOR_BG[color];
      base.borderWidth = 2;
      base.boxShadow = `inset 0 0 0 9999px ${COLOR_BG[color]}22`;
    }
    return base;
  };

  return (
    <div className="stage-wrap" style={{ justifyContent: "flex-start" }}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        {/* scoreboard */}
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <ScorePill team="red" left={redLeft} active={state.turn === "red"} />
          <div className="center">
            {ended ? (
              <strong style={{ color: state.winner ? COLOR_BG[state.winner] : undefined }}>
                {state.winner ? `${TEAM_LABEL[state.winner]} team wins!` : "Game over"}
              </strong>
            ) : (
              <span className="muted">
                {TEAM_LABEL[state.turn]}'s turn{state.clue ? ` — guesses left: ${state.guessesLeft}` : ""}
              </span>
            )}
          </div>
          <ScorePill team="blue" left={blueLeft} active={state.turn === "blue"} />
        </div>

        {/* current clue */}
        <div className="panel" style={{ padding: "8px 12px", marginBottom: 8, textAlign: "center" }}>
          {state.clue ? (
            <span>
              Clue: <strong style={{ fontSize: 18 }}>{state.clue.word}</strong> — {state.clue.number}
            </span>
          ) : (
            <span className="muted">
              Waiting for {TEAM_LABEL[state.turn]} spymaster's clue…
            </span>
          )}
        </div>

        {/* grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
          {state.words.map((w, i) => (
            <div
              key={i}
              style={tileStyle(i)}
              onClick={() => canGuess && !state.revealed[i] && !busy && guess(i)}
            >
              {w}
            </div>
          ))}
        </div>

        {/* controls */}
        <div style={{ marginTop: 12 }}>
          {!ended && canClue && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ flex: 2, minWidth: 140 }}
                placeholder="One-word clue"
                value={clueWord}
                maxLength={24}
                onChange={(e) => setClueWord(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && giveClue()}
              />
              <input
                className="input"
                style={{ width: 70 }}
                type="number"
                min={0}
                max={9}
                value={clueNum}
                onChange={(e) => setClueNum(e.target.value)}
              />
              <button className="btn" disabled={busy} onClick={giveClue}>Give clue</button>
            </div>
          )}
          {!ended && canGuess && (
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={endTurn}>
              End guessing
            </button>
          )}
          {!ended && myTeam && !canClue && !canGuess && (
            <p className="muted center" style={{ margin: "6px 0" }}>
              {myRole === "spymaster"
                ? state.clue
                  ? "Your operatives are guessing…"
                  : "Waiting — it's the other team's turn."
                : "Watch for your spymaster's clue, then guess on your turn."}
            </p>
          )}
          {ended && room.hostUid === meUid && (
            <button className="btn" style={{ marginTop: 8 }} onClick={rematch}>Play again</button>
          )}
        </div>

        {/* your role */}
        <p className="muted center" style={{ fontSize: 13, marginTop: 8 }}>
          You are {myTeam ? `${TEAM_LABEL[myTeam]} ${myRole}` : "spectating"}.
          {isSpymaster && " You can see every agent's color."}
        </p>

        {/* log */}
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>Game log</summary>
          <div className="col" style={{ gap: 2, marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
            {state.log.slice().reverse().map((l, i) => (
              <span key={i} className="muted" style={{ fontSize: 13 }}>{l}</span>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

function ScorePill({ team, left, active }: { team: Team; left: number; active: boolean }) {
  return (
    <div
      className="panel"
      style={{
        padding: "6px 14px",
        borderColor: COLOR_BG[team],
        borderWidth: active ? 2 : 1,
        background: `${COLOR_BG[team]}22`,
        textAlign: "center",
        minWidth: 70,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color: COLOR_BG[team] }}>{left}</div>
      <div className="muted" style={{ fontSize: 11 }}>{TEAM_LABEL[team]}</div>
    </div>
  );
}

const CONFIG: MultiplayerConfig<SpyState> = {
  gameId: "spy-words",
  title: "Spy Words",
  icon: "🕵️",
  color: "#19d3ff",
  minPlayers: 2,
  maxPlayers: 8,
  rules: [
    "Two teams, Red and Blue. The first player on each team is that team's Spymaster.",
    "25 word tiles hide secret agents: 9 for the first team, 8 for the other, 7 bystanders, and 1 assassin.",
    "Spymasters see every tile's color and give a one-word clue plus a number hinting how many tiles relate to it.",
    "Operatives tap tiles to find their own color. A correct tile lets you keep guessing (up to the number + 1).",
    "Tap a bystander or the enemy's tile and your turn ends; tap the assassin and your team loses instantly.",
    "First team to reveal all of its agents wins. Use End guessing to stop early.",
  ],
  buildInitialState,
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
