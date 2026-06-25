import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, type RoomDoc } from "@/services/rooms";

/* =========================================================================
 * Secret Agenda - a Secret Hitler-style hidden-role game.
 * Two factions: Loyalists (good majority) vs Agents (bad minority) led by a
 * hidden Mole. 5-10 players. All hidden info is gated by render (we only ever
 * show a player their own secrets) and every state change is applied through a
 * transactional mutateRoom so the latency-tolerant room layer stays consistent.
 * ========================================================================= */

type Faction = "loyalist" | "agent";
type Policy = "good" | "bad";
type Power = "investigate" | "peek" | "execute" | "special";
type Phase =
  | "nomination"
  | "vote"
  | "legislative-president"
  | "legislative-chancellor"
  | "executive";

interface PlayerSecret {
  uid: string;
  faction: Faction;
  isMole: boolean;
  alive: boolean;
}

interface State {
  /** total seats at game start (drives role knowledge + power table) */
  count: number;
  /** seating order of uids (dead players stay in the array) */
  order: string[];
  players: PlayerSecret[];

  deck: Policy[];
  discard: Policy[];
  goodEnacted: number;
  badEnacted: number;
  electionTracker: number; // failed elections, 0..2

  presidentIndex: number; // index into order
  chancellor: string | null;
  lastPresident: string | null; // term-limited next round
  lastChancellor: string | null; // term-limited next round
  /** one-shot return index after a special-election detour */
  specialElectionReturn: number | null;

  phase: Phase;
  round: number;

  votes: Record<string, "ja" | "nein">;

  drawn: Policy[]; // president's 3 (render only to president)
  passed: Policy[]; // chancellor's 2 (render only to chancellor)
  peeked: Policy[]; // top-3 peek (render only to president)
  pendingPower: Power | null;
  /** investigator uid -> (target uid -> revealed faction) */
  investigations: Record<string, Record<string, Faction>>;

  log: string[];
  winner: Faction | null;
  winReason: string | null;
}

const GOOD_TO_WIN = 5;
const BAD_TO_WIN = 6;

/* ----------------------------- pure helpers ----------------------------- */

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Agents (including the Mole) by player count - standard distribution. */
function agentTeamSize(n: number): number {
  if (n <= 6) return 2;
  if (n <= 8) return 3;
  return 4; // 9-10
}

/** The Mole only learns the other Agents in small games (5-6 players). */
const moleKnowsAgents = (n: number) => n <= 6;

/** Executive power unlocked when the Nth bad policy is enacted. */
function powerFor(n: number, badNumber: number): Power | null {
  if (n <= 6) {
    if (badNumber === 3) return "peek";
    if (badNumber === 4 || badNumber === 5) return "execute";
    return null;
  }
  if (n <= 8) {
    if (badNumber === 2) return "investigate";
    if (badNumber === 3) return "special";
    if (badNumber === 4 || badNumber === 5) return "execute";
    return null;
  }
  // 9-10
  if (badNumber === 1 || badNumber === 2) return "investigate";
  if (badNumber === 3) return "special";
  if (badNumber === 4 || badNumber === 5) return "execute";
  return null;
}

const playerOf = (s: State, uid: string): PlayerSecret | undefined =>
  s.players.find((p) => p.uid === uid);

const aliveUids = (s: State): string[] =>
  s.order.filter((u) => playerOf(s, u)?.alive);

const presidentUid = (s: State): string => s.order[s.presidentIndex];

function nextAliveIndex(s: State, from: number): number {
  const n = s.order.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (playerOf(s, s.order[idx])?.alive) return idx;
  }
  return from;
}

function reshuffleIfNeeded(s: State, need: number): void {
  if (s.deck.length < need) {
    s.deck = shuffle([...s.deck, ...s.discard]);
    s.discard = [];
  }
}

function drawTop(s: State, n: number): Policy[] {
  reshuffleIfNeeded(s, n);
  return s.deck.splice(0, n);
}

/** Reset per-round fields and bump the round counter (does NOT rotate). */
function toNomination(s: State): void {
  s.phase = "nomination";
  s.round += 1;
  s.chancellor = null;
  s.votes = {};
  s.drawn = [];
  s.passed = [];
  s.peeked = [];
  s.pendingPower = null;
}

/** Rotate the presidency (honouring a pending special-election return). */
function advanceRound(s: State): void {
  if (s.specialElectionReturn !== null) {
    s.presidentIndex = s.specialElectionReturn;
    s.specialElectionReturn = null;
  } else {
    s.presidentIndex = nextAliveIndex(s, s.presidentIndex);
  }
  toNomination(s);
}

function setWin(s: State, faction: Faction, reason: string): void {
  s.winner = faction;
  s.winReason = reason;
}

/** Enact a policy, update tracks, and detect track-based wins. */
function enact(s: State, policy: Policy): void {
  if (policy === "good") {
    s.goodEnacted += 1;
    if (s.goodEnacted >= GOOD_TO_WIN)
      setWin(s, "loyalist", `${GOOD_TO_WIN} Loyalist policies enacted.`);
  } else {
    s.badEnacted += 1;
    if (s.badEnacted >= BAD_TO_WIN)
      setWin(s, "agent", `${BAD_TO_WIN} Agent policies enacted.`);
  }
}

/* --------------------------- transition logic --------------------------- */

/** After a normal enactment, fire an executive power or move to the next round. */
function afterEnact(s: State, policy: Policy): void {
  s.drawn = [];
  s.passed = [];
  if (s.winner) return;
  const power = policy === "bad" ? powerFor(s.count, s.badEnacted) : null;
  if (!power) {
    advanceRound(s);
    return;
  }
  s.pendingPower = power;
  s.phase = "executive";
  if (power === "peek") {
    reshuffleIfNeeded(s, 3);
    s.peeked = s.deck.slice(0, 3);
  }
}

function resolveVote(s: State, nameOf: (u: string) => string): void {
  const alive = aliveUids(s);
  let ja = 0;
  let nein = 0;
  const detail: string[] = [];
  for (const u of alive) {
    const v = s.votes[u];
    if (v === "ja") ja += 1;
    else nein += 1;
    detail.push(`${nameOf(u)}: ${v === "ja" ? "Ja" : "Nein"}`);
  }
  const passed = ja > nein;
  s.log.push(`Vote ${ja} Ja / ${nein} Nein - ${passed ? "PASSED" : "FAILED"} (${detail.join(", ")})`);

  if (!passed) {
    s.electionTracker += 1;
    if (s.electionTracker >= 3) {
      const [top] = drawTop(s, 1);
      enact(s, top);
      s.log.push(`Government collapsed 3x - top policy auto-enacted: ${top === "good" ? "Loyalist" : "Agent"}.`);
      s.electionTracker = 0;
      s.lastPresident = null;
      s.lastChancellor = null;
      if (!s.winner) advanceRound(s);
    } else {
      advanceRound(s);
    }
    return;
  }

  // Government passes.
  const chancellor = s.chancellor as string;
  const chSecret = playerOf(s, chancellor);
  if (chSecret?.isMole && s.badEnacted >= 3) {
    setWin(s, "agent", `${nameOf(chancellor)} (the Mole) was elected Chancellor with 3+ Agent policies in play.`);
    return;
  }
  s.lastPresident = presidentUid(s);
  s.lastChancellor = chancellor;
  s.electionTracker = 0;
  s.votes = {};
  s.drawn = drawTop(s, 3);
  s.phase = "legislative-president";
}

/* --------------------------- initial state ------------------------------ */

function buildInitialState(order: string[]): State {
  const n = order.length;
  const teamAgents = agentTeamSize(n);
  const roles: { faction: Faction; isMole: boolean }[] = [];
  roles.push({ faction: "agent", isMole: true });
  for (let i = 0; i < teamAgents - 1; i++) roles.push({ faction: "agent", isMole: false });
  for (let i = 0; i < n - teamAgents; i++) roles.push({ faction: "loyalist", isMole: false });
  const shuffled = shuffle(roles);

  const players: PlayerSecret[] = order.map((uid, i) => ({
    uid,
    faction: shuffled[i].faction,
    isMole: shuffled[i].isMole,
    alive: true,
  }));

  const deckRaw: Policy[] = [];
  for (let i = 0; i < 11; i++) deckRaw.push("bad");
  for (let i = 0; i < 6; i++) deckRaw.push("good");

  return {
    count: n,
    order: order.slice(),
    players,
    deck: shuffle(deckRaw),
    discard: [],
    goodEnacted: 0,
    badEnacted: 0,
    electionTracker: 0,
    presidentIndex: 0,
    chancellor: null,
    lastPresident: null,
    lastChancellor: null,
    specialElectionReturn: null,
    phase: "nomination",
    round: 1,
    votes: {},
    drawn: [],
    passed: [],
    peeked: [],
    pendingPower: null,
    investigations: {},
    log: ["The game begins. Loyalists, find the Mole. Agents, deceive everyone."],
    winner: null,
    winReason: null,
  };
}

/* ------------------------------ actions --------------------------------- */

function commit(next: State): Partial<RoomDoc<State>> {
  return next.winner
    ? { state: next, status: "ended" }
    : { state: next };
}

const nameMap = (room: RoomDoc<State>) => (uid: string) =>
  room.players[uid]?.name ?? "Player";

/* ------------------------------ UI bits --------------------------------- */

function PolicyCard({ policy }: { policy: Policy }) {
  const good = policy === "good";
  return (
    <div
      style={{
        flex: "1 1 80px",
        minWidth: 80,
        textAlign: "center",
        padding: "18px 8px",
        borderRadius: 12,
        fontWeight: 800,
        color: "#0b0f1a",
        background: good ? "var(--good)" : "var(--bad)",
        border: "1px solid rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ fontSize: 24 }}>{good ? "🕊️" : "💣"}</div>
      {good ? "Loyalist" : "Agent"}
    </div>
  );
}

function Track({
  label,
  filled,
  total,
  color,
  marks,
}: {
  label: string;
  filled: number;
  total: number;
  color: string;
  marks?: (string | null)[];
}) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{ flex: 1, minWidth: 26, textAlign: "center" }}>
            <div
              style={{
                height: 30,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: i < filled ? color : "var(--bg-2)",
                display: "grid",
                placeItems: "center",
                fontSize: 16,
                color: "#0b0f1a",
                fontWeight: 800,
              }}
            >
              {i < filled ? (color === "var(--good)" ? "🕊️" : "💣") : ""}
            </div>
            {marks && (
              <div className="muted" style={{ fontSize: 9, marginTop: 2, lineHeight: 1 }}>
                {marks[i] ?? ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const POWER_LABEL: Record<Power, string> = {
  investigate: "🔍 inv",
  peek: "👁 peek",
  execute: "💀 exec",
  special: "🗳 elect",
};

function Board({ room, code, meUid }: BoardProps<State>) {
  const s = room.state;
  if (!s) return <div className="loading"><div className="spinner" /></div>;

  const nameOf = (uid: string) => room.players[uid]?.name ?? "Player";
  const me = playerOf(s, meUid);
  const presUid = presidentUid(s);
  const iAmPresident = presUid === meUid && (me?.alive ?? false);
  const iAmChancellor = s.chancellor === meUid && (me?.alive ?? false);

  /* ---- actions ---- */
  const nominate = (chancellor: string) =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "nomination") return null;
      if (presidentUid(st) !== meUid) return null;
      const next = clone(st);
      next.chancellor = chancellor;
      next.phase = "vote";
      next.votes = {};
      next.log.push(`${nameMap(r)(presidentUid(st))} nominated ${nameMap(r)(chancellor)} as Chancellor.`);
      return commit(next);
    });

  const castVote = (v: "ja" | "nein") =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "vote") return null;
      if (!playerOf(st, meUid)?.alive) return null;
      const next = clone(st);
      next.votes[meUid] = v;
      if (aliveUids(next).every((u) => next.votes[u])) resolveVote(next, nameMap(r));
      return commit(next);
    });

  const presidentDiscard = (i: number) =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "legislative-president") return null;
      if (presidentUid(st) !== meUid) return null;
      const next = clone(st);
      const discarded = next.drawn.splice(i, 1)[0];
      if (!discarded) return null;
      next.discard.push(discarded);
      next.passed = next.drawn.slice();
      next.drawn = [];
      next.phase = "legislative-chancellor";
      next.log.push(`${nameMap(r)(presidentUid(st))} passed 2 policies to ${nameMap(r)(st.chancellor ?? "")}.`);
      return commit(next);
    });

  const chancellorEnact = (i: number) =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "legislative-chancellor") return null;
      if (st.chancellor !== meUid) return null;
      const next = clone(st);
      const chosen = next.passed.splice(i, 1)[0];
      if (!chosen) return null;
      const leftover = next.passed[0];
      if (leftover) next.discard.push(leftover);
      next.passed = [];
      enact(next, chosen);
      next.log.push(`A ${chosen === "good" ? "Loyalist 🕊️" : "Agent 💣"} policy was enacted.`);
      afterEnact(next, chosen);
      return commit(next);
    });

  const doInvestigate = (target: string) =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "executive" || st.pendingPower !== "investigate") return null;
      if (presidentUid(st) !== meUid) return null;
      const t = playerOf(st, target);
      if (!t || !t.alive || target === meUid) return null;
      const next = clone(st);
      const rec = next.investigations[meUid] ?? {};
      rec[target] = t.faction;
      next.investigations[meUid] = rec;
      next.log.push(`${nameMap(r)(meUid)} investigated ${nameMap(r)(target)}'s loyalty.`);
      advanceRound(next);
      return commit(next);
    });

  const peekDone = () =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "executive" || st.pendingPower !== "peek") return null;
      if (presidentUid(st) !== meUid) return null;
      const next = clone(st);
      next.peeked = [];
      next.log.push(`${nameMap(r)(meUid)} peeked at the top of the deck.`);
      advanceRound(next);
      return commit(next);
    });

  const doExecute = (target: string) =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "executive" || st.pendingPower !== "execute") return null;
      if (presidentUid(st) !== meUid) return null;
      const t = playerOf(st, target);
      if (!t || !t.alive || target === meUid) return null;
      const next = clone(st);
      const victim = playerOf(next, target);
      if (!victim) return null;
      victim.alive = false;
      next.log.push(`${nameMap(r)(meUid)} executed ${nameMap(r)(target)}.`);
      if (victim.isMole) {
        setWin(next, "loyalist", `${nameMap(r)(target)} was the Mole and has been executed.`);
        return commit(next);
      }
      advanceRound(next);
      return commit(next);
    });

  const doSpecial = (target: string) =>
    mutateRoom<State>(code, (r) => {
      const st = r.state;
      if (r.status !== "playing" || !st || st.phase !== "executive" || st.pendingPower !== "special") return null;
      if (presidentUid(st) !== meUid) return null;
      const t = playerOf(st, target);
      if (!t || !t.alive || target === meUid) return null;
      const next = clone(st);
      if (next.specialElectionReturn === null)
        next.specialElectionReturn = nextAliveIndex(next, next.presidentIndex);
      next.presidentIndex = next.order.indexOf(target);
      next.pendingPower = null;
      next.peeked = [];
      next.log.push(`${nameMap(r)(meUid)} called a Special Election: ${nameMap(r)(target)} is the next President.`);
      toNomination(next);
      return commit(next);
    });

  /* ---- derived view data ---- */
  const badMarks: (string | null)[] = Array.from({ length: BAD_TO_WIN }, (_, i) => {
    if (i === BAD_TO_WIN - 1) return "WIN";
    const p = powerFor(s.count, i + 1);
    return p ? POWER_LABEL[p] : null;
  });

  const eligibleChancellors = aliveUids(s).filter((u) => {
    if (u === presUid) return false;
    if (u === s.lastChancellor) return false;
    if (aliveUids(s).length > 5 && u === s.lastPresident) return false;
    return true;
  });

  const myInvestigations = s.investigations[meUid] ?? {};

  /* ---- render ---- */
  return (
    <div className="stage-wrap" style={{ justifyContent: "flex-start" }}>
      <div className="panel" style={{ width: "100%", maxWidth: 760 }}>
        {/* board tracks */}
        <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 260px" }}>
            <Track label="Loyalist policies (5 to win)" filled={s.goodEnacted} total={GOOD_TO_WIN} color="var(--good)" />
          </div>
          <div style={{ flex: "1 1 300px" }}>
            <Track label="Agent policies (6 to win)" filled={s.badEnacted} total={BAD_TO_WIN} color="var(--bad)" marks={badMarks} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Failed elections:{" "}
            {Array.from({ length: 3 }, (_, i) => (i < s.electionTracker ? "●" : "○")).join(" ")}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            Round {s.round} · Deck {s.deck.length} · Discard {s.discard.length}
          </span>
        </div>
      </div>

      {/* government / role */}
      <div className="panel" style={{ width: "100%", maxWidth: 760 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>President</div>
            <b>{nameOf(presUid)}{presUid === meUid ? " (you)" : ""}</b>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Chancellor</div>
            <b>{s.chancellor ? nameOf(s.chancellor) + (s.chancellor === meUid ? " (you)" : "") : "—"}</b>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 12 }}>Phase</div>
            <b>{phaseLabel(s.phase)}</b>
          </div>
        </div>

        {me && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
            }}
          >
            <RoleReveal s={s} me={me} nameOf={nameOf} myInvestigations={myInvestigations} />
          </div>
        )}
      </div>

      {/* phase controls */}
      <div className="panel" style={{ width: "100%", maxWidth: 760 }}>
        {s.winner ? (
          <div className="center">
            <h3 style={{ marginTop: 0, color: s.winner === "loyalist" ? "var(--good)" : "var(--bad)" }}>
              {s.winner === "loyalist" ? "Loyalists win! 🕊️" : "Agents win! 💣"}
            </h3>
            <p className="muted">{s.winReason}</p>
            <div className="col" style={{ gap: 4, marginTop: 8 }}>
              {s.players.map((p) => (
                <div key={p.uid} className="row" style={{ justifyContent: "center", gap: 6 }}>
                  <span>{nameOf(p.uid)}</span>
                  <span className="muted">
                    — {p.isMole ? "the Mole 🎯" : p.faction === "agent" ? "Agent 🕶️" : "Loyalist 🕊️"}
                    {!p.alive ? " (executed)" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : !me?.alive ? (
          <p className="muted center" style={{ margin: 0 }}>You were executed. Spectating…</p>
        ) : (
          <Controls
            s={s}
            meUid={meUid}
            nameOf={nameOf}
            iAmPresident={iAmPresident}
            iAmChancellor={iAmChancellor}
            eligibleChancellors={eligibleChancellors}
            onNominate={nominate}
            onVote={castVote}
            onDiscard={presidentDiscard}
            onEnact={chancellorEnact}
            onInvestigate={doInvestigate}
            onPeekDone={peekDone}
            onExecute={doExecute}
            onSpecial={doSpecial}
          />
        )}
      </div>

      {/* log */}
      <div className="panel" style={{ width: "100%", maxWidth: 760 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Action log</div>
        <div className="col" style={{ gap: 4, maxHeight: 220, overflow: "auto" }}>
          {s.log.slice().reverse().map((line, i) => (
            <div key={s.log.length - i} style={{ fontSize: 13 }}>• {line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case "nomination": return "Nomination";
    case "vote": return "Voting";
    case "legislative-president": return "President legislating";
    case "legislative-chancellor": return "Chancellor legislating";
    case "executive": return "Executive action";
  }
}

function RoleReveal({
  s,
  me,
  nameOf,
  myInvestigations,
}: {
  s: State;
  me: PlayerSecret;
  nameOf: (u: string) => string;
  myInvestigations: Record<string, Faction>;
}) {
  const roleText = me.isMole ? "the Mole 🎯" : me.faction === "agent" ? "an Agent 🕶️" : "a Loyalist 🕊️";
  const showTeam =
    me.faction === "agent" && (!me.isMole || moleKnowsAgents(s.count));
  const teammates = s.players.filter((p) => p.faction === "agent");

  return (
    <div>
      <div>
        Your secret role: <b style={{ color: me.faction === "agent" ? "var(--bad)" : "var(--good)" }}>{roleText}</b>
      </div>
      {showTeam && (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Your faction:{" "}
          {teammates
            .map((p) => `${nameOf(p.uid)}${p.isMole ? " (Mole)" : ""}`)
            .join(", ")}
        </div>
      )}
      {me.faction === "agent" && me.isMole && !moleKnowsAgents(s.count) && (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          You don't know your fellow Agents — they know you. Watch for the Ja votes.
        </div>
      )}
      {Object.keys(myInvestigations).length > 0 && (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Investigations:{" "}
          {Object.entries(myInvestigations)
            .map(([uid, f]) => `${nameOf(uid)} = ${f === "agent" ? "Agent 🕶️" : "Loyalist 🕊️"}`)
            .join(", ")}
        </div>
      )}
    </div>
  );
}

function Controls({
  s,
  meUid,
  nameOf,
  iAmPresident,
  iAmChancellor,
  eligibleChancellors,
  onNominate,
  onVote,
  onDiscard,
  onEnact,
  onInvestigate,
  onPeekDone,
  onExecute,
  onSpecial,
}: {
  s: State;
  meUid: string;
  nameOf: (u: string) => string;
  iAmPresident: boolean;
  iAmChancellor: boolean;
  eligibleChancellors: string[];
  onNominate: (uid: string) => void;
  onVote: (v: "ja" | "nein") => void;
  onDiscard: (i: number) => void;
  onEnact: (i: number) => void;
  onInvestigate: (uid: string) => void;
  onPeekDone: () => void;
  onExecute: (uid: string) => void;
  onSpecial: (uid: string) => void;
}) {
  const presName = nameOf(presidentUid(s));

  if (s.phase === "nomination") {
    if (!iAmPresident)
      return <p className="muted center" style={{ margin: 0 }}>Waiting for {presName} to nominate a Chancellor…</p>;
    return (
      <div className="col">
        <b>Pick your Chancellor:</b>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {eligibleChancellors.map((u) => (
            <button key={u} className="btn secondary" onClick={() => onNominate(u)}>{nameOf(u)}</button>
          ))}
        </div>
      </div>
    );
  }

  if (s.phase === "vote") {
    const total = aliveUids(s).length;
    const cast = aliveUids(s).filter((u) => s.votes[u]).length;
    const myVote = s.votes[meUid];
    return (
      <div className="col" style={{ alignItems: "center" }}>
        <b>Vote on this government</b>
        <p className="muted center" style={{ margin: 0 }}>
          President {presName} & Chancellor {nameOf(s.chancellor ?? "")}
        </p>
        {myVote ? (
          <p className="muted">You voted <b>{myVote === "ja" ? "Ja" : "Nein"}</b>. Waiting… ({cast}/{total})</p>
        ) : (
          <div className="row">
            <button className="btn" onClick={() => onVote("ja")}>Ja 👍</button>
            <button className="btn ghost" onClick={() => onVote("nein")}>Nein 👎</button>
          </div>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{cast}/{total} votes in</span>
      </div>
    );
  }

  if (s.phase === "legislative-president") {
    if (!iAmPresident)
      return <p className="muted center" style={{ margin: 0 }}>{presName} is reviewing 3 policies…</p>;
    return (
      <div className="col">
        <b>Discard one policy (the other two go to the Chancellor):</b>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {s.drawn.map((p, i) => (
            <div key={i} className="col" style={{ flex: "1 1 90px", gap: 6 }}>
              <PolicyCard policy={p} />
              <button className="btn secondary" onClick={() => onDiscard(i)}>Discard</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (s.phase === "legislative-chancellor") {
    if (!iAmChancellor)
      return <p className="muted center" style={{ margin: 0 }}>{nameOf(s.chancellor ?? "")} is enacting a policy…</p>;
    return (
      <div className="col">
        <b>Enact one policy (the other is discarded):</b>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {s.passed.map((p, i) => (
            <div key={i} className="col" style={{ flex: "1 1 90px", gap: 6 }}>
              <PolicyCard policy={p} />
              <button className="btn" onClick={() => onEnact(i)}>Enact</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // executive
  const power = s.pendingPower;
  if (!iAmPresident)
    return <p className="muted center" style={{ margin: 0 }}>{presName} is using a power: {power ? POWER_LABEL[power] : ""}…</p>;

  const targets = aliveUids(s).filter((u) => u !== meUid);

  if (power === "peek")
    return (
      <div className="col" style={{ alignItems: "center" }}>
        <b>Top 3 policies (only you can see these):</b>
        <div className="row" style={{ flexWrap: "wrap", justifyContent: "center" }}>
          {s.peeked.map((p, i) => <PolicyCard key={i} policy={p} />)}
        </div>
        <button className="btn" onClick={onPeekDone}>Done</button>
      </div>
    );

  const verb =
    power === "investigate" ? "Investigate a player's loyalty"
    : power === "execute" ? "Execute a player"
    : "Choose the next President (Special Election)";
  const handler =
    power === "investigate" ? onInvestigate
    : power === "execute" ? onExecute
    : onSpecial;

  return (
    <div className="col">
      <b>{verb}:</b>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {targets.map((u) => (
          <button
            key={u}
            className={power === "execute" ? "btn" : "btn secondary"}
            onClick={() => handler(u)}
          >
            {nameOf(u)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ config ---------------------------------- */

const CONFIG: MultiplayerConfig<State> = {
  gameId: "secret-agenda",
  title: "Secret Agenda",
  icon: "🕵️",
  color: "#ff5c8a",
  minPlayers: 5,
  maxPlayers: 10,
  rules: [
    "Two hidden factions: Loyalists (good majority) vs Agents (bad minority) led by a secret Mole.",
    "Each round a rotating President nominates a Chancellor; everyone votes Ja/Nein.",
    "If elected, the President draws 3 policy tiles, discards 1, and the Chancellor enacts 1 of the remaining 2.",
    "Loyalists win by enacting 5 Loyalist policies OR executing the Mole.",
    "Agents win by enacting 6 Agent policies OR getting the Mole elected Chancellor once 3 Agent policies are in play.",
    "Agent policies unlock Presidential powers: investigate, peek, special election, and execution.",
    "3 failed elections in a row auto-enact the top policy.",
  ],
  buildInitialState: (order) => buildInitialState(order),
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
