import { useEffect } from "react";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom, type RoomDoc } from "@/services/rooms";

/* ------------------------------------------------------------------ *
 * Moonlight Mafia — an automated (no-moderator) social deduction game.
 * The whole game lives in the shared `room.state` blob and advances via
 * transactional `mutateRoom` writes. Secret information (roles, detective
 * results) is stored in state but only *rendered* to the owning player.
 * ------------------------------------------------------------------ */

type Role = "mafia" | "detective" | "doctor" | "villager";
type Phase = "night" | "announce" | "vote" | "ended";
type Team = "town" | "mafia";
/** A day vote target is a player's uid, or the literal "skip" for no-lynch. */
type DayChoice = string;

interface PlayerState {
  uid: string;
  role: Role;
  alive: boolean;
}

interface NightActions {
  /** mafia uid -> chosen victim uid */
  mafiaVotes: Record<string, string>;
  /** uid the doctor protects tonight (self allowed), or null if not yet chosen */
  doctorTarget: string | null;
  /** uid the detective investigates tonight, or null if not yet chosen */
  detectiveTarget: string | null;
}

interface InvestigationResult {
  round: number;
  target: string;
  isMafia: boolean;
}

interface LogEntry {
  round: number;
  phase: Phase;
  text: string;
}

interface MMState {
  phase: Phase;
  /** night number; the first night is round 1 */
  round: number;
  players: Record<string, PlayerState>;
  /** seating order (frozen at game start) */
  order: string[];
  night: NightActions;
  /** day vote: voter uid -> target uid | "skip" */
  dayVotes: Record<string, DayChoice>;
  /** per-detective private investigation history */
  detectiveResults: Record<string, InvestigationResult[]>;
  /** uids that died during the most recent resolution (for the announcement) */
  lastDeaths: string[];
  log: LogEntry[];
  winner: Team | null;
}

const SKIP = "skip";

const ROLE_LABEL: Record<Role, string> = {
  mafia: "Mafia",
  detective: "Detective",
  doctor: "Doctor",
  villager: "Villager",
};

const ROLE_ICON: Record<Role, string> = {
  mafia: "🔪",
  detective: "🔍",
  doctor: "💉",
  villager: "🧑‍🌾",
};

const ROLE_DESC: Record<Role, string> = {
  mafia: "Each night, conspire with your fellow Mafia to eliminate a townsperson. By day, blend in and avoid suspicion.",
  detective: "Each night, investigate one player to secretly learn whether they are Mafia.",
  doctor: "Each night, choose one player (you may pick yourself) to protect from the Mafia.",
  villager: "You have no night action. Use the daytime discussion and vote to root out the Mafia.",
};

const ROLE_COLOR: Record<Role, string> = {
  mafia: "var(--bad)",
  detective: "var(--accent-2)",
  doctor: "var(--good)",
  villager: "var(--muted)",
};

/* ----------------------------- setup ------------------------------ */

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** ~1 Mafia per 3-4 players. */
function mafiaCountFor(n: number): number {
  if (n <= 6) return 1;
  if (n <= 9) return 2;
  return 3;
}

function buildInitialState(order: string[]): MMState {
  const n = order.length;
  const mafia = mafiaCountFor(n);
  const roles: Role[] = [];
  for (let i = 0; i < mafia; i++) roles.push("mafia");
  roles.push("detective");
  roles.push("doctor");
  while (roles.length < n) roles.push("villager");

  const assignment = shuffle(roles);
  const seats = shuffle(order); // randomize who gets which role
  const players: Record<string, PlayerState> = {};
  seats.forEach((uid, i) => {
    players[uid] = { uid, role: assignment[i], alive: true };
  });

  return {
    phase: "night",
    round: 1,
    players,
    order: order.slice(),
    night: { mafiaVotes: {}, doctorTarget: null, detectiveTarget: null },
    dayVotes: {},
    detectiveResults: {},
    lastDeaths: [],
    log: [{ round: 1, phase: "night", text: "🌙 Night 1 falls. The town drifts to sleep..." }],
    winner: null,
  };
}

/* --------------------------- pure logic --------------------------- */

function cloneState(s: MMState): MMState {
  const players: Record<string, PlayerState> = {};
  for (const uid of Object.keys(s.players)) players[uid] = { ...s.players[uid] };
  const detectiveResults: Record<string, InvestigationResult[]> = {};
  for (const uid of Object.keys(s.detectiveResults)) {
    detectiveResults[uid] = s.detectiveResults[uid].map((r) => ({ ...r }));
  }
  return {
    ...s,
    players,
    order: s.order.slice(),
    night: {
      mafiaVotes: { ...s.night.mafiaVotes },
      doctorTarget: s.night.doctorTarget,
      detectiveTarget: s.night.detectiveTarget,
    },
    dayVotes: { ...s.dayVotes },
    detectiveResults,
    lastDeaths: s.lastDeaths.slice(),
    log: s.log.slice(),
  };
}

const alivePlayers = (s: MMState): PlayerState[] => Object.values(s.players).filter((p) => p.alive);

function aliveWithRole(s: MMState, role: Role): PlayerState | undefined {
  return Object.values(s.players).find((p) => p.alive && p.role === role);
}

function checkWinner(players: Record<string, PlayerState>): Team | null {
  const alive = Object.values(players).filter((p) => p.alive);
  const mafia = alive.filter((p) => p.role === "mafia").length;
  const town = alive.length - mafia;
  if (mafia === 0) return "town";
  if (mafia >= town) return "mafia";
  return null;
}

/** Most-voted victim among the mafia (ties broken by seating order). */
function tallyMafiaVictim(s: MMState): string | null {
  const counts: Record<string, number> = {};
  for (const target of Object.values(s.night.mafiaVotes)) {
    counts[target] = (counts[target] ?? 0) + 1;
  }
  let best: string | null = null;
  let bestN = 0;
  for (const uid of s.order) {
    const c = counts[uid] ?? 0;
    if (c > bestN) {
      bestN = c;
      best = uid;
    }
  }
  return bestN > 0 ? best : null;
}

/** Day-vote outcome: a uid to lynch, or null on a tie / skip-majority. */
function tallyDayLynch(s: MMState): string | null {
  const counts: Record<string, number> = {};
  for (const choice of Object.values(s.dayVotes)) {
    counts[choice] = (counts[choice] ?? 0) + 1;
  }
  let bestN = 0;
  for (const k of Object.keys(counts)) if (counts[k] > bestN) bestN = counts[k];
  const top = Object.keys(counts).filter((k) => counts[k] === bestN);
  if (bestN > 0 && top.length === 1 && top[0] !== SKIP) return top[0];
  return null;
}

function nightComplete(s: MMState): boolean {
  for (const m of Object.values(s.players)) {
    if (m.alive && m.role === "mafia" && !s.night.mafiaVotes[m.uid]) return false;
  }
  if (aliveWithRole(s, "doctor") && s.night.doctorTarget === null) return false;
  if (aliveWithRole(s, "detective") && s.night.detectiveTarget === null) return false;
  return true;
}

function voteComplete(s: MMState): boolean {
  for (const p of alivePlayers(s)) {
    if (!s.dayVotes[p.uid]) return false;
  }
  return true;
}

const winText = (w: Team): string =>
  w === "town"
    ? "🌞 Every Mafia has been eliminated. The Town wins!"
    : "🌙 The Mafia now equal the Town. The Mafia wins!";

type NameFn = (uid: string) => string;

function resolveNight(prev: MMState, nameOf: NameFn): MMState {
  const s = cloneState(prev);
  const victim = tallyMafiaVictim(s);
  const protectedUid = s.night.doctorTarget;
  const deaths: string[] = [];
  if (victim && victim !== protectedUid && s.players[victim]?.alive) {
    s.players[victim].alive = false;
    deaths.push(victim);
  }

  // record the detective's private finding for this night
  const det = aliveWithRole(s, "detective");
  const detTarget = s.night.detectiveTarget;
  if (det && detTarget && s.players[detTarget]) {
    const list = s.detectiveResults[det.uid] ? s.detectiveResults[det.uid].slice() : [];
    list.push({ round: s.round, target: detTarget, isMafia: s.players[detTarget].role === "mafia" });
    s.detectiveResults[det.uid] = list;
  }

  s.lastDeaths = deaths;
  s.log.push({
    round: s.round,
    phase: "announce",
    text: deaths.length
      ? `☀️ Dawn of day ${s.round}: ${deaths.map(nameOf).join(", ")} was found dead.`
      : `☀️ Dawn of day ${s.round}: everyone survived the night.`,
  });
  s.night = { mafiaVotes: {}, doctorTarget: null, detectiveTarget: null };
  s.phase = "announce";

  const w = checkWinner(s.players);
  if (w) {
    s.winner = w;
    s.phase = "ended";
    s.log.push({ round: s.round, phase: "ended", text: winText(w) });
  }
  return s;
}

function resolveDay(prev: MMState, nameOf: NameFn): MMState {
  const s = cloneState(prev);
  const lynch = tallyDayLynch(s);
  if (lynch && s.players[lynch]?.alive) {
    s.players[lynch].alive = false;
    s.lastDeaths = [lynch];
    s.log.push({
      round: s.round,
      phase: "vote",
      text: `🗳️ The town lynched ${nameOf(lynch)} — they were the ${ROLE_LABEL[s.players[lynch].role]}.`,
    });
  } else {
    s.lastDeaths = [];
    s.log.push({ round: s.round, phase: "vote", text: "🗳️ The vote was tied or skipped — no one was eliminated." });
  }
  s.dayVotes = {};

  const w = checkWinner(s.players);
  if (w) {
    s.winner = w;
    s.phase = "ended";
    s.log.push({ round: s.round, phase: "ended", text: winText(w) });
    return s;
  }

  s.round += 1;
  s.phase = "night";
  s.night = { mafiaVotes: {}, doctorTarget: null, detectiveTarget: null };
  s.log.push({ round: s.round, phase: "night", text: `🌙 Night ${s.round} falls. The town sleeps again...` });
  return s;
}

/* ------------------------------ UI -------------------------------- */

const makeNameOf =
  (room: RoomDoc<MMState>): NameFn =>
  (uid) =>
    room.players[uid]?.name ?? "Player";

function Board({ room, code, meUid }: BoardProps<MMState>) {
  const state = room.state;

  // Any player who is host pushes the ended status so the lobby button appears.
  useEffect(() => {
    if (state && state.winner && room.status === "playing" && room.hostUid === meUid) {
      void patchRoom(code, { status: "ended", state: state as unknown as Record<string, unknown> });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.winner, room.status]);

  if (!state) return <div className="loading"><div className="spinner" /></div>;

  const nameOf = makeNameOf(room);
  const me = state.players[meUid];
  const isHost = room.hostUid === meUid;
  const seats = state.order.map((u) => state.players[u]).filter(Boolean);

  /* --------- moves --------- */

  const setMafiaVote = (target: string) =>
    mutateRoom<MMState>(code, (r) => {
      const s = r.state;
      if (!s || s.phase !== "night") return null;
      const actor = s.players[meUid];
      if (!actor?.alive || actor.role !== "mafia") return null;
      if (!s.players[target]?.alive || target === meUid) return null;
      const ns = cloneState(s);
      ns.night.mafiaVotes[meUid] = target;
      const next = nightComplete(ns) ? resolveNight(ns, makeNameOf(r)) : ns;
      return { state: next };
    });

  const setDoctorTarget = (target: string) =>
    mutateRoom<MMState>(code, (r) => {
      const s = r.state;
      if (!s || s.phase !== "night") return null;
      const actor = s.players[meUid];
      if (!actor?.alive || actor.role !== "doctor") return null;
      if (!s.players[target]?.alive) return null;
      const ns = cloneState(s);
      ns.night.doctorTarget = target;
      const next = nightComplete(ns) ? resolveNight(ns, makeNameOf(r)) : ns;
      return { state: next };
    });

  const setDetectiveTarget = (target: string) =>
    mutateRoom<MMState>(code, (r) => {
      const s = r.state;
      if (!s || s.phase !== "night") return null;
      const actor = s.players[meUid];
      if (!actor?.alive || actor.role !== "detective") return null;
      if (!s.players[target]?.alive || target === meUid) return null;
      const ns = cloneState(s);
      ns.night.detectiveTarget = target;
      const next = nightComplete(ns) ? resolveNight(ns, makeNameOf(r)) : ns;
      return { state: next };
    });

  const beginVote = () =>
    mutateRoom<MMState>(code, (r) => {
      const s = r.state;
      if (!s || s.phase !== "announce") return null;
      if (!s.players[meUid]?.alive) return null;
      const ns = cloneState(s);
      ns.phase = "vote";
      ns.dayVotes = {};
      ns.log.push({ round: ns.round, phase: "vote", text: `💬 Day ${ns.round}: discussion begins. Cast your votes.` });
      return { state: ns };
    });

  const castVote = (choice: DayChoice) =>
    mutateRoom<MMState>(code, (r) => {
      const s = r.state;
      if (!s || s.phase !== "vote") return null;
      const actor = s.players[meUid];
      if (!actor?.alive) return null;
      if (choice !== SKIP && !s.players[choice]?.alive) return null;
      const ns = cloneState(s);
      ns.dayVotes[meUid] = choice;
      const next = voteComplete(ns) ? resolveDay(ns, makeNameOf(r)) : ns;
      return { state: next };
    });

  // Host escape hatch in case a player disconnects and stalls a phase.
  const forceResolve = () =>
    mutateRoom<MMState>(code, (r) => {
      const s = r.state;
      if (!s) return null;
      if (s.phase === "night") return { state: resolveNight(cloneState(s), makeNameOf(r)) };
      if (s.phase === "vote") return { state: resolveDay(cloneState(s), makeNameOf(r)) };
      return null;
    });

  /* --------- derived view helpers --------- */

  const myRole = me?.role ?? null;
  const iAmAlive = !!me?.alive;
  const revealRole = (p: PlayerState): boolean =>
    state.phase === "ended" ||
    !p.alive ||
    p.uid === meUid ||
    (myRole === "mafia" && p.role === "mafia");

  const phaseLabel =
    state.phase === "night"
      ? `🌙 Night ${state.round}`
      : state.phase === "announce"
        ? `☀️ Day ${state.round} — Dawn`
        : state.phase === "vote"
          ? `💬 Day ${state.round} — Vote`
          : "🏁 Game Over";

  /* --------- render --------- */

  return (
    <div className="stage-wrap" style={{ alignItems: "stretch", maxWidth: 760, width: "100%", margin: "0 auto" }}>
      <div className="center" style={{ fontSize: 20, fontWeight: 800 }}>{phaseLabel}</div>

      {state.phase === "ended" && state.winner && (
        <div
          className="panel center"
          style={{
            fontSize: 20,
            fontWeight: 800,
            borderColor: state.winner === "mafia" ? "var(--bad)" : "var(--good)",
            color: state.winner === "mafia" ? "var(--bad)" : "var(--good)",
          }}
        >
          {winText(state.winner)}
        </div>
      )}

      {/* your secret role */}
      {me && (
        <div className="panel" style={{ borderColor: ROLE_COLOR[me.role] }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 26 }}>{ROLE_ICON[me.role]}</span>
              <div>
                <div style={{ fontWeight: 800, color: ROLE_COLOR[me.role] }}>
                  You are the {ROLE_LABEL[me.role]}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{iAmAlive ? "Alive" : "Eliminated — you may watch but not act."}</div>
              </div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{ROLE_DESC[me.role]}</p>
          {me.role === "detective" && (
            <DetectiveResults results={state.detectiveResults[meUid] ?? []} nameOf={nameOf} />
          )}
        </div>
      )}

      {/* phase controls */}
      {state.phase === "night" && (
        <NightControls
          state={state}
          me={me}
          meUid={meUid}
          nameOf={nameOf}
          onMafia={setMafiaVote}
          onDoctor={setDoctorTarget}
          onDetective={setDetectiveTarget}
        />
      )}

      {state.phase === "announce" && (
        <div className="panel center">
          {state.lastDeaths.length ? (
            <p style={{ fontSize: 16, margin: "4px 0 12px" }}>
              <b>{state.lastDeaths.map(nameOf).join(", ")}</b> did not survive the night.
            </p>
          ) : (
            <p style={{ fontSize: 16, margin: "4px 0 12px" }}>The night passed with no deaths.</p>
          )}
          {iAmAlive ? (
            <button className="btn" onClick={beginVote}>Begin discussion &amp; vote</button>
          ) : (
            <p className="muted">Waiting for the living to gather...</p>
          )}
        </div>
      )}

      {state.phase === "vote" && (
        <VoteControls state={state} me={me} meUid={meUid} nameOf={nameOf} onVote={castVote} />
      )}

      {/* host stall-breaker */}
      {isHost && (state.phase === "night" || state.phase === "vote") && (
        <button className="btn ghost" style={{ alignSelf: "center" }} onClick={forceResolve}>
          Force resolve (host) — use if someone is disconnected
        </button>
      )}

      {/* roster */}
      <div className="panel">
        <h4 style={{ margin: "0 0 10px" }}>Players ({alivePlayers(state).length} alive)</h4>
        <div className="col" style={{ gap: 6 }}>
          {seats.map((p) => {
            const shown = revealRole(p);
            return (
              <div
                key={p.uid}
                className="row"
                style={{
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: p.alive ? "var(--panel-2)" : "transparent",
                  opacity: p.alive ? 1 : 0.55,
                }}
              >
                <span style={{ fontWeight: 700, textDecoration: p.alive ? "none" : "line-through" }}>
                  {nameOf(p.uid)}
                  {p.uid === meUid ? " (you)" : ""}
                  {p.uid === room.hostUid ? " · host" : ""}
                </span>
                <span style={{ fontSize: 13, color: shown ? ROLE_COLOR[p.role] : "var(--muted)" }}>
                  {p.alive ? "" : "💀 "}
                  {shown ? `${ROLE_ICON[p.role]} ${ROLE_LABEL[p.role]}` : "Unknown"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* public log */}
      <EventLog log={state.log} />
    </div>
  );
}

function DetectiveResults({ results, nameOf }: { results: InvestigationResult[]; nameOf: NameFn }) {
  if (!results.length) return <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>No investigations yet.</p>;
  return (
    <div className="col" style={{ gap: 4, marginTop: 8 }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>Your investigations</div>
      {results.map((r, i) => (
        <div key={i} className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
          <span>Night {r.round}: {nameOf(r.target)}</span>
          <span style={{ fontWeight: 800, color: r.isMafia ? "var(--bad)" : "var(--good)" }}>
            {r.isMafia ? "MAFIA" : "Not Mafia"}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlayerPicker({
  candidates,
  selected,
  nameOf,
  onPick,
}: {
  candidates: PlayerState[];
  selected: string | null;
  nameOf: NameFn;
  onPick: (uid: string) => void;
}) {
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      {candidates.map((p) => (
        <button
          key={p.uid}
          className={selected === p.uid ? "btn" : "btn secondary"}
          onClick={() => onPick(p.uid)}
        >
          {nameOf(p.uid)}
        </button>
      ))}
    </div>
  );
}

function NightControls({
  state,
  me,
  meUid,
  nameOf,
  onMafia,
  onDoctor,
  onDetective,
}: {
  state: MMState;
  me: PlayerState | undefined;
  meUid: string;
  nameOf: NameFn;
  onMafia: (uid: string) => void;
  onDoctor: (uid: string) => void;
  onDetective: (uid: string) => void;
}) {
  if (!me || !me.alive) {
    return (
      <div className="panel center muted">
        The town sleeps. {me && !me.alive ? "You are dead — rest in peace." : "Waiting for night actions..."}
      </div>
    );
  }

  const alive = alivePlayers(state);

  if (me.role === "mafia") {
    const others = alive.filter((p) => p.uid !== meUid);
    const myPick = state.night.mafiaVotes[meUid] ?? null;
    const fellow = Object.values(state.players).filter((p) => p.alive && p.role === "mafia" && p.uid !== meUid);
    const leading = tallyMafiaVictim(state);
    return (
      <div className="panel">
        <h4 style={{ marginTop: 0 }}>🔪 Choose tonight's victim</h4>
        {fellow.length > 0 && (
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Fellow Mafia: {fellow.map((p) => nameOf(p.uid)).join(", ")}
          </p>
        )}
        <PlayerPicker candidates={others} selected={myPick} nameOf={nameOf} onPick={onMafia} />
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          {myPick ? `Your vote: ${nameOf(myPick)}. ` : "Pick a target. "}
          {leading ? `Mafia currently leaning toward ${nameOf(leading)}.` : ""}
        </p>
      </div>
    );
  }

  if (me.role === "doctor") {
    const myPick = state.night.doctorTarget;
    return (
      <div className="panel">
        <h4 style={{ marginTop: 0 }}>💉 Choose someone to protect</h4>
        <PlayerPicker candidates={alive} selected={myPick} nameOf={nameOf} onPick={onDoctor} />
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          {myPick ? `Protecting ${myPick === meUid ? "yourself" : nameOf(myPick)}. You may change until the night resolves.` : "You may protect yourself."}
        </p>
      </div>
    );
  }

  if (me.role === "detective") {
    const others = alive.filter((p) => p.uid !== meUid);
    const myPick = state.night.detectiveTarget;
    return (
      <div className="panel">
        <h4 style={{ marginTop: 0 }}>🔍 Investigate a player</h4>
        <PlayerPicker candidates={others} selected={myPick} nameOf={nameOf} onPick={onDetective} />
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          {myPick ? `Investigating ${nameOf(myPick)}. Result revealed at dawn.` : "Pick someone to investigate."}
        </p>
      </div>
    );
  }

  return (
    <div className="panel center muted">
      You are a Villager — you have no night action. Waiting for the special roles to act...
    </div>
  );
}

function VoteControls({
  state,
  me,
  meUid,
  nameOf,
  onVote,
}: {
  state: MMState;
  me: PlayerState | undefined;
  meUid: string;
  nameOf: NameFn;
  onVote: (choice: DayChoice) => void;
}) {
  const alive = alivePlayers(state);
  const myVote = state.dayVotes[meUid] ?? null;
  const votedCount = Object.keys(state.dayVotes).length;

  const countFor = (uid: string): number =>
    Object.values(state.dayVotes).filter((c) => c === uid).length;
  const skipCount = Object.values(state.dayVotes).filter((c) => c === SKIP).length;

  return (
    <div className="panel">
      <h4 style={{ marginTop: 0 }}>🗳️ Vote to eliminate</h4>
      {me?.alive ? (
        <>
          <div className="col" style={{ gap: 6 }}>
            {alive.map((p) => (
              <button
                key={p.uid}
                className={myVote === p.uid ? "btn" : "btn secondary"}
                style={{ justifyContent: "space-between", display: "flex" }}
                onClick={() => onVote(p.uid)}
              >
                <span>{nameOf(p.uid)}{p.uid === meUid ? " (you)" : ""}</span>
                <span>{countFor(p.uid)} ▮</span>
              </button>
            ))}
            <button
              className={myVote === SKIP ? "btn" : "btn ghost"}
              style={{ justifyContent: "space-between", display: "flex" }}
              onClick={() => onVote(SKIP)}
            >
              <span>Skip — no lynch</span>
              <span>{skipCount} ▮</span>
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {votedCount}/{alive.length} have voted. Majority is eliminated; ties spare everyone.
          </p>
        </>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          You are dead and cannot vote. {votedCount}/{alive.length} of the living have voted.
        </p>
      )}
    </div>
  );
}

function EventLog({ log }: { log: LogEntry[] }) {
  const recent = log.slice(-12).reverse();
  return (
    <div className="panel">
      <h4 style={{ margin: "0 0 8px" }}>Event log</h4>
      <div className="col" style={{ gap: 4, maxHeight: 200, overflow: "auto" }}>
        {recent.map((e, i) => (
          <div key={log.length - i} className="muted" style={{ fontSize: 13 }}>{e.text}</div>
        ))}
      </div>
    </div>
  );
}

const CONFIG: MultiplayerConfig<MMState> = {
  gameId: "moonlight-mafia",
  title: "Moonlight Mafia",
  icon: "🌙",
  color: "#7c5cff",
  minPlayers: 4,
  maxPlayers: 12,
  rules: [
    "A hidden Mafia hunts the town. No moderator needed — the game runs itself.",
    "Roles: Mafia (kill at night), Detective (investigate one player nightly), Doctor (protect one player nightly), and Villagers.",
    "Night: special roles secretly act. Day: everyone discusses and votes to eliminate a suspect.",
    "Town wins when all Mafia are gone. Mafia win when they equal the rest of the town.",
    "You only ever see your own secret role (and the Detective sees their own findings).",
  ],
  buildInitialState: (order) => buildInitialState(order),
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
