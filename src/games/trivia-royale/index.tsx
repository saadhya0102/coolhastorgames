import { useEffect, useState } from "react";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type MultiplayerConfig, type BoardProps } from "@/shell/RoomShell";
import { mutateRoom, patchRoom } from "@/services/rooms";
import { QUESTIONS } from "./questions";

/** How many questions a single match runs through. */
const QUESTION_COUNT = 10;
/** Time players have to answer each question, in ms. */
const QUESTION_MS = 15_000;
/** Time the correct answer + scoreboard is shown between questions, in ms. */
const REVEAL_MS = 6_000;
/** Base points for a correct answer; up to SPEED_BONUS more for answering fast. */
const BASE_POINTS = 500;
const SPEED_BONUS = 500;

const CHOICE_LABELS = ["A", "B", "C", "D"] as const;
const CHOICE_COLORS = ["#ff5c8a", "#19d3ff", "#ffd95c", "#46e0a0"] as const;

type Phase = "question" | "reveal" | "done";

interface Answer {
  /** index 0-3 of the choice the player locked in */
  choice: number;
  /** ms elapsed from the start of the question until they answered */
  timeMs: number;
}

/** Shared, JSON-serializable match state stored in room.state.
 * No `undefined` values are ever written (Firestore rejects them). */
interface TriviaState {
  /** indices into QUESTIONS for this match (length QUESTION_COUNT) */
  questionIds: number[];
  /** which question we're on (0-based) */
  index: number;
  phase: Phase;
  /** epoch ms when the current phase ends (host-driven) */
  endsAt: number;
  /** answers for the CURRENT question only; reset each question */
  answers: Record<string, Answer>;
  /** cumulative scores keyed by uid */
  scores: Record<string, number>;
  /** lets the typed state satisfy the room layer's Record<string, unknown>
   * contract (used by the non-generic patchRoom); declared fields keep their
   * concrete types. */
  [k: string]: unknown;
}

/** Pick `n` distinct random question indices from the bank. */
function pickQuestionIds(n: number): number[] {
  const pool = QUESTIONS.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(n, pool.length));
}

function freshState(order: string[]): TriviaState {
  const scores: Record<string, number> = {};
  for (const uid of order) scores[uid] = 0;
  return {
    questionIds: pickQuestionIds(QUESTION_COUNT),
    index: 0,
    phase: "question",
    endsAt: Date.now() + QUESTION_MS,
    answers: {},
    scores,
  };
}

/** Points earned for a correct answer given how fast it came in. */
function scoreFor(timeMs: number): number {
  const frac = Math.max(0, Math.min(1, 1 - timeMs / QUESTION_MS));
  return BASE_POINTS + Math.round(SPEED_BONUS * frac);
}

function Board({ room, code, meUid, isHost }: BoardProps<TriviaState>) {
  const state = room.state;

  // local clock so every client can render a smooth countdown
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Host owns the timeline: it polls and advances phases transactionally.
  // The mutation re-validates against fresh server state, so it stays correct
  // even if a tick fires slightly late or twice.
  useEffect(() => {
    if (!isHost) return;
    const advance = () => {
      void mutateRoom<TriviaState>(code, (r) => {
        const s = r.state;
        if (!s) return null;
        if (Date.now() < s.endsAt) return null;

        if (s.phase === "question") {
          const q = QUESTIONS[s.questionIds[s.index]];
          const scores: Record<string, number> = { ...s.scores };
          for (const uid of Object.keys(s.answers)) {
            const a = s.answers[uid];
            if (a.choice === q.answer) {
              scores[uid] = (scores[uid] ?? 0) + scoreFor(a.timeMs);
            }
          }
          return {
            state: { ...s, phase: "reveal", scores, endsAt: Date.now() + REVEAL_MS },
          };
        }

        if (s.phase === "reveal") {
          if (s.index + 1 < s.questionIds.length) {
            return {
              state: {
                ...s,
                phase: "question",
                index: s.index + 1,
                answers: {},
                endsAt: Date.now() + QUESTION_MS,
              },
            };
          }
          return { state: { ...s, phase: "done", answers: {} } };
        }

        return null;
      });
    };
    const id = window.setInterval(advance, 500);
    return () => window.clearInterval(id);
  }, [isHost, code]);

  if (!state) return <div className="loading"><div className="spinner" /></div>;

  const nameOf = (uid: string): string => room.players[uid]?.name ?? "Player";
  const question = QUESTIONS[state.questionIds[state.index]];
  const myAnswer = state.answers[meUid];
  const msLeft = Math.max(0, state.endsAt - now);
  const secLeft = Math.ceil(msLeft / 1000);
  const totalPhaseMs = state.phase === "reveal" ? REVEAL_MS : QUESTION_MS;
  const progress = Math.max(0, Math.min(1, msLeft / totalPhaseMs));

  const standings = room.order
    .map((uid) => ({ uid, score: state.scores[uid] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const answeredCount = Object.keys(state.answers).length;

  const submit = (choice: number): void => {
    if (state.phase !== "question") return;
    if (myAnswer) return;
    void mutateRoom<TriviaState>(code, (r) => {
      const s = r.state;
      if (!s || s.phase !== "question") return null;
      if (Date.now() >= s.endsAt) return null;
      if (s.answers[meUid]) return null; // one answer per player per question
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) return null;
      const qStart = s.endsAt - QUESTION_MS;
      const timeMs = Math.max(0, Date.now() - qStart);
      return { state: { ...s, answers: { ...s.answers, [meUid]: { choice, timeMs } } } };
    });
  };

  const rematch = (): void => {
    void patchRoom(code, { status: "playing", state: freshState(room.order) });
  };

  // ---------- final standings ----------
  if (state.phase === "done") {
    const winner = standings[0];
    return (
      <div className="stage-wrap">
        <div className="panel" style={{ maxWidth: 520, width: "100%" }}>
          <div className="center" style={{ fontSize: 52 }}>🏆</div>
          <h2 className="center" style={{ marginTop: 0 }}>
            {winner ? `${nameOf(winner.uid)} wins!` : "Game over"}
          </h2>
          <Scoreboard standings={standings} meUid={meUid} nameOf={nameOf} showRank />
          <div className="col" style={{ marginTop: 16 }}>
            {isHost ? (
              <button className="btn" onClick={rematch}>Play again (new questions)</button>
            ) : (
              <p className="muted center">Waiting for the host to start a rematch...</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const revealing = state.phase === "reveal";

  return (
    <div className="stage-wrap">
      <style>{styles}</style>
      <div className="tr-layout">
        <div className="tr-main">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="tr-cat" style={{ borderColor: CONFIG.color, color: CONFIG.color }}>
              {question.category}
            </span>
            <span className="muted" style={{ fontWeight: 700 }}>
              Q{state.index + 1} / {state.questionIds.length}
            </span>
          </div>

          <div className="tr-timerbar">
            <div
              className="tr-timerfill"
              style={{
                width: `${progress * 100}%`,
                background: revealing ? "var(--good)" : CONFIG.color,
              }}
            />
          </div>
          <div className="center muted" style={{ fontSize: 13 }}>
            {revealing
              ? `Next question in ${secLeft}s`
              : `${secLeft}s left · ${answeredCount}/${room.order.length} answered`}
          </div>

          <h2 className="tr-question">{question.q}</h2>

          <div className="tr-choices">
            {question.choices.map((choice, i) => {
              const isCorrect = i === question.answer;
              const isMine = myAnswer?.choice === i;
              const locked = !!myAnswer || revealing || msLeft <= 0;

              let cls = "tr-choice";
              if (revealing) {
                if (isCorrect) cls += " correct";
                else if (isMine) cls += " wrong";
                else cls += " dim";
              } else if (isMine) {
                cls += " picked";
              }

              return (
                <button
                  key={i}
                  className={cls}
                  disabled={locked}
                  onClick={() => submit(i)}
                  aria-label={`Answer ${CHOICE_LABELS[i]}: ${choice}`}
                >
                  <span className="tr-letter" style={{ background: CHOICE_COLORS[i] }}>
                    {CHOICE_LABELS[i]}
                  </span>
                  <span className="tr-choicetext">{choice}</span>
                  {revealing && isCorrect && <span className="tr-mark">✓</span>}
                  {revealing && isMine && !isCorrect && <span className="tr-mark">✗</span>}
                </button>
              );
            })}
          </div>

          {!revealing && myAnswer && (
            <p className="center muted" style={{ margin: "8px 0 0" }}>
              Locked in {CHOICE_LABELS[myAnswer.choice]} — waiting for the timer...
            </p>
          )}
          {revealing && (
            <p className="center" style={{ margin: "10px 0 0", fontWeight: 700 }}>
              {!myAnswer
                ? "You didn't answer in time."
                : myAnswer.choice === question.answer
                  ? `Correct! +${scoreFor(myAnswer.timeMs)} points`
                  : "Not quite!"}
            </p>
          )}
        </div>

        <div className="tr-side panel">
          <h4 style={{ margin: "0 0 8px" }}>Scoreboard</h4>
          <Scoreboard standings={standings} meUid={meUid} nameOf={nameOf} showRank />
        </div>
      </div>
    </div>
  );
}

function Scoreboard({
  standings,
  meUid,
  nameOf,
  showRank,
}: {
  standings: { uid: string; score: number }[];
  meUid: string;
  nameOf: (uid: string) => string;
  showRank?: boolean;
}) {
  return (
    <table className="lb">
      <thead>
        <tr>
          {showRank && <th className="rank">#</th>}
          <th>Player</th>
          <th style={{ textAlign: "right" }}>Score</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((row, i) => (
          <tr key={row.uid} className={row.uid === meUid ? "me" : ""}>
            {showRank && <td className="rank">{i + 1}</td>}
            <td>
              {nameOf(row.uid)}
              {row.uid === meUid ? " (you)" : ""}
            </td>
            <td style={{ textAlign: "right", fontWeight: 700 }}>{row.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const styles = `
.tr-layout {
  display: flex;
  gap: 16px;
  width: 100%;
  max-width: 920px;
  align-items: flex-start;
}
.tr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tr-side {
  width: 240px;
  flex-shrink: 0;
}
.tr-cat {
  border: 1px solid;
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.tr-timerbar {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: var(--panel-2);
  overflow: hidden;
  border: 1px solid var(--border);
}
.tr-timerfill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.25s linear;
}
.tr-question {
  font-size: clamp(20px, 4.5vw, 30px);
  line-height: 1.25;
  text-align: center;
  margin: 8px 0 4px;
  min-height: 1.2em;
}
.tr-choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.tr-choice {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: 14px 16px;
  border-radius: 14px;
  border: 2px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 16px;
  font-weight: 600;
  min-height: 60px;
  transition: transform 0.08s ease, border-color 0.12s ease, background 0.12s ease;
}
.tr-choice:not(:disabled):hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.tr-choice:not(:disabled):active {
  transform: translateY(0);
}
.tr-choice.picked {
  border-color: var(--accent);
  background: var(--panel-2);
}
.tr-choice.correct {
  border-color: var(--good);
  background: rgba(70, 224, 160, 0.18);
}
.tr-choice.wrong {
  border-color: var(--bad);
  background: rgba(255, 92, 138, 0.16);
}
.tr-choice.dim {
  opacity: 0.5;
}
.tr-choice:disabled {
  cursor: default;
}
.tr-letter {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: #0b0f1a;
  font-weight: 800;
  flex-shrink: 0;
}
.tr-choicetext {
  flex: 1;
  min-width: 0;
}
.tr-mark {
  font-weight: 800;
  font-size: 18px;
}
@media (max-width: 720px) {
  .tr-layout {
    flex-direction: column-reverse;
  }
  .tr-side {
    width: 100%;
  }
  .tr-choices {
    grid-template-columns: 1fr;
  }
}
`;

const CONFIG: MultiplayerConfig<TriviaState> = {
  gameId: "trivia-royale",
  title: "Trivia Royale",
  icon: "❓",
  color: "#ffd95c",
  minPlayers: 1,
  maxPlayers: 12,
  rules: [
    "Everyone gets the same question at the same time.",
    "Tap an answer before the 15-second timer runs out — your pick locks in.",
    "Answer correctly to score; the faster you answer, the more points you earn.",
    "Highest total after 10 questions wins. The host can start a rematch.",
  ],
  buildInitialState: (order) => freshState(order),
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
