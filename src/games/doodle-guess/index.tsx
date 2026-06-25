import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { ReactGameProps } from "@/engine";
import { RoomShell, type BoardProps, type MultiplayerConfig } from "@/shell/RoomShell";
import { mutateRoom, type RoomDoc } from "@/services/rooms";
import { getDb } from "@/services/firebase";
import { pickWords, randomWord } from "./words";

/* ------------------------------------------------------------------ *
 * Timing + scoring constants
 * ------------------------------------------------------------------ */
const CHOOSE_MS = 15_000;
const DRAW_MS = 70_000;
const REVEAL_MS = 6_000;
const ROUNDS_PER_PLAYER = 2;
const CHOICE_COUNT = 3;
const DRAWER_BONUS = 25;

const PALETTE = [
  "#111111", "#ffffff", "#ff5c5c", "#ff9f43", "#ffd23f",
  "#46e0a0", "#19d3ff", "#5c7cff", "#b15cff", "#8b5a2b",
];
const BRUSHES = [3, 6, 12, 22];

/* ------------------------------------------------------------------ *
 * Shared state types (all JSON serializable, no `undefined`)
 * ------------------------------------------------------------------ */
type Phase = "choosing" | "drawing" | "reveal";

interface Guess {
  uid: string;
  name: string;
  text: string;
  correct: boolean;
}

interface DGState {
  round: number;
  totalRounds: number;
  drawerUid: string;
  /** Full word — only revealed in the UI to the drawer (others see a mask). */
  word: string | null;
  /** The drawer's 3 word options while phase === 'choosing'. */
  choices: string[];
  phase: Phase;
  /** ms timestamp when the current phase ends. */
  endsAt: number;
  /** ms timestamp drawing began (used to scope the strokes subcollection). */
  drawStartT: number | null;
  guesses: Guess[];
  correctUids: string[];
  scores: Record<string, number>;
}

interface Point {
  x: number;
  y: number;
}

interface StrokeDoc {
  type: "stroke" | "clear";
  points: Point[];
  color: string;
  size: number;
  t: number;
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function maskWord(word: string): string {
  return word
    .split("")
    .map((ch) => (ch === " " ? "\u00A0\u00A0" : "_"))
    .join(" ");
}

function choosingState(
  order: string[],
  round: number,
  totalRounds: number,
  scores: Record<string, number>,
): DGState {
  const drawerUid = order[(round - 1) % order.length] ?? order[0];
  return {
    round,
    totalRounds,
    drawerUid,
    word: null,
    choices: pickWords(CHOICE_COUNT),
    phase: "choosing",
    endsAt: Date.now() + CHOOSE_MS,
    drawStartT: null,
    guesses: [],
    correctUids: [],
    scores,
  };
}

function startDrawing(state: DGState, word: string): DGState {
  const now = Date.now();
  return {
    ...state,
    word,
    choices: [],
    phase: "drawing",
    endsAt: now + DRAW_MS,
    drawStartT: now,
  };
}

/** Host-driven phase machine. Returns room fields to write, or null to wait. */
function transition(room: RoomDoc<DGState>): Partial<RoomDoc<DGState>> | null {
  if (room.status !== "playing") return null;
  const s = room.state;
  if (!s) return null;
  const now = Date.now();

  if (s.phase === "choosing") {
    if (now < s.endsAt) return null;
    const word = s.choices[0] ?? randomWord();
    return { state: startDrawing(s, word) };
  }

  if (s.phase === "drawing") {
    const guessers = room.order.filter((u) => u !== s.drawerUid);
    const everyone = guessers.length > 0 && guessers.every((u) => s.correctUids.includes(u));
    if (now < s.endsAt && !everyone) return null;
    return { state: { ...s, phase: "reveal", endsAt: now + REVEAL_MS } };
  }

  // reveal
  if (now < s.endsAt) return null;
  if (s.round >= s.totalRounds) {
    return { status: "ended", state: s };
  }
  return { state: choosingState(room.order, s.round + 1, s.totalRounds, s.scores) };
}

async function runHostTick(code: string): Promise<void> {
  await mutateRoom<DGState>(code, (room) => transition(room));
}

/* ------------------------------------------------------------------ *
 * Drawing surface — drawer writes strokes, everyone subscribes + redraws.
 * ------------------------------------------------------------------ */
function DrawCanvas({
  code,
  drawStartT,
  canDraw,
}: {
  code: string;
  drawStartT: number | null;
  canDraw: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<StrokeDoc[]>([]);
  const curRef = useRef<{ points: Point[]; color: string; size: number } | null>(null);
  const drawingRef = useRef(false);
  const [color, setColor] = useState(PALETTE[0]);
  const [size, setSize] = useState(BRUSHES[1]);

  const paintStroke = useCallback(
    (ctx: CanvasRenderingContext2D, st: { points: Point[]; color: string; size: number }, w: number, h: number) => {
      if (st.points.length === 0) return;
      const scale = w / 600;
      const lineW = Math.max(1, st.size * scale);
      ctx.strokeStyle = st.color;
      ctx.fillStyle = st.color;
      ctx.lineWidth = lineW;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (st.points.length === 1) {
        const p = st.points[0];
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, lineW / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(st.points[0].x * w, st.points[0].y * h);
      for (let i = 1; i < st.points.length; i++) {
        ctx.lineTo(st.points[i].x * w, st.points[i].y * h);
      }
      ctx.stroke();
    },
    [],
  );

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = cv;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    for (const st of strokesRef.current) {
      if (st.type === "clear") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        continue;
      }
      paintStroke(ctx, st, w, h);
    }
    if (curRef.current) paintStroke(ctx, curRef.current, w, h);
  }, [paintStroke]);

  const resize = useCallback(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const w = Math.max(1, Math.round(wrap.clientWidth));
    const h = Math.max(1, Math.round(wrap.clientHeight || w * 0.75));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    redraw();
  }, [redraw]);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // subscribe to this round's strokes only
  useEffect(() => {
    if (drawStartT == null) {
      strokesRef.current = [];
      redraw();
      return;
    }
    const q = query(
      collection(getDb(), "rooms", code, "strokes"),
      where("t", ">=", drawStartT),
      orderBy("t"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr: StrokeDoc[] = [];
        snap.forEach((d) => arr.push(d.data() as StrokeDoc));
        strokesRef.current = arr;
        redraw();
      },
      (err) => console.warn("strokes subscribe error", err),
    );
    return () => unsub();
  }, [code, drawStartT, redraw]);

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const cv = canvasRef.current;
    if (!cv) return { x: 0, y: 0 };
    const rect = cv.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drawingRef.current = true;
    curRef.current = { points: [toPoint(e)], color, size };
    redraw();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || !drawingRef.current || !curRef.current) return;
    e.preventDefault();
    curRef.current.points.push(toPoint(e));
    redraw();
  };

  const onUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || !drawingRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
    const cur = curRef.current;
    curRef.current = null;
    redraw();
    if (cur && cur.points.length > 0) {
      try {
        await addDoc(collection(getDb(), "rooms", code, "strokes"), {
          type: "stroke",
          points: cur.points,
          color: cur.color,
          size: cur.size,
          t: Date.now(),
        } satisfies StrokeDoc);
      } catch (err) {
        console.warn("stroke write failed", err);
      }
    }
  };

  const clear = async () => {
    if (!canDraw) return;
    strokesRef.current = [];
    redraw();
    try {
      await addDoc(collection(getDb(), "rooms", code, "strokes"), {
        type: "clear",
        points: [],
        color: "",
        size: 0,
        t: Date.now(),
      } satisfies StrokeDoc);
    } catch (err) {
      console.warn("clear write failed", err);
    }
  };

  return (
    <div className="col" style={{ width: "100%", maxWidth: 760, gap: 8 }}>
      <div
        ref={wrapRef}
        className="stage"
        style={{ aspectRatio: "4 / 3", background: "#fff", touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
          style={{ cursor: canDraw ? "crosshair" : "default", touchAction: "none" }}
        />
      </div>

      {canDraw && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                aria-label={`color ${c}`}
                onClick={() => setColor(c)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: c,
                  border: c === color ? "3px solid var(--accent-2)" : "2px solid var(--border)",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {BRUSHES.map((b) => (
              <button
                key={b}
                aria-label={`brush ${b}`}
                onClick={() => setSize(b)}
                className="icon-btn"
                style={{
                  width: 40,
                  height: 36,
                  display: "grid",
                  placeItems: "center",
                  borderColor: b === size ? "var(--accent)" : "var(--border)",
                }}
              >
                <span style={{ width: b, height: b, borderRadius: "50%", background: "var(--text)" }} />
              </button>
            ))}
            <button className="btn secondary" onClick={clear} style={{ marginLeft: "auto" }}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chat / guessing column
 * ------------------------------------------------------------------ */
function GuessPanel({
  guesses,
  disabled,
  placeholder,
  onGuess,
}: {
  guesses: Guess[];
  disabled: boolean;
  placeholder: string;
  onGuess: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [guesses.length]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onGuess(t);
    setText("");
  };

  return (
    <div className="panel col" style={{ flex: 1, minWidth: 240, maxWidth: 340, gap: 8 }}>
      <h4 style={{ margin: 0 }}>Guesses</h4>
      <div
        ref={logRef}
        className="col"
        style={{ gap: 4, overflowY: "auto", maxHeight: 320, minHeight: 120, fontSize: 14 }}
      >
        {guesses.length === 0 && <p className="muted" style={{ margin: 0 }}>Type your guesses here…</p>}
        {guesses.map((g, i) => (
          <div key={i} style={{ color: g.correct ? "var(--good)" : "var(--text)" }}>
            {g.correct ? (
              <span><strong>{g.name}</strong> guessed the word! ✓</span>
            ) : (
              <span><strong>{g.name}:</strong> {g.text}</span>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <input
          className="input"
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn" disabled={disabled} onClick={submit}>Send</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */
function Board({ room, code, meUid, isHost }: BoardProps<DGState>) {
  const s = room.state;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // host drives all phase/timer transitions
  useEffect(() => {
    if (!isHost) return;
    void runHostTick(code);
    const id = window.setInterval(() => void runHostTick(code), 1000);
    return () => window.clearInterval(id);
  }, [isHost, code]);

  const nameOf = useCallback(
    (uid: string) => room.players[uid]?.name ?? "Player",
    [room.players],
  );

  const standings = useMemo(() => {
    if (!s) return [] as Array<{ uid: string; score: number }>;
    return room.order
      .map((uid) => ({ uid, score: s.scores[uid] ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }, [room.order, s]);

  const chooseWord = (word: string) =>
    mutateRoom<DGState>(code, (r) => {
      const st = r.state;
      if (!st || st.phase !== "choosing") return null;
      if (st.drawerUid !== meUid) return null;
      if (!st.choices.includes(word)) return null;
      return { state: startDrawing(st, word) };
    });

  const guess = (raw: string) =>
    mutateRoom<DGState>(code, (r) => {
      const st = r.state;
      if (!st || st.phase !== "drawing") return null;
      if (meUid === st.drawerUid) return null;
      if (st.correctUids.includes(meUid)) return null;
      const name = r.players[meUid]?.name ?? "Player";
      const correct = !!st.word && normalize(raw) === normalize(st.word);
      if (!correct) {
        return { state: { ...st, guesses: [...st.guesses, { uid: meUid, name, text: raw, correct: false }] } };
      }
      const remaining = Math.max(0, st.endsAt - Date.now());
      const earned = 50 + Math.round(150 * (remaining / DRAW_MS));
      const scores: Record<string, number> = { ...st.scores };
      scores[meUid] = (scores[meUid] ?? 0) + earned;
      scores[st.drawerUid] = (scores[st.drawerUid] ?? 0) + DRAWER_BONUS;
      return {
        state: {
          ...st,
          scores,
          correctUids: [...st.correctUids, meUid],
          guesses: [...st.guesses, { uid: meUid, name, text: "", correct: true }],
        },
      };
    });

  if (!s) return <div className="loading"><div className="spinner" /></div>;

  const isDrawer = s.drawerUid === meUid;
  const iAmCorrect = s.correctUids.includes(meUid);
  const secsLeft = Math.max(0, Math.ceil((s.endsAt - now) / 1000));

  /* ---------- final standings ---------- */
  if (room.status === "ended") {
    return (
      <div className="stage-wrap">
        <div className="panel" style={{ maxWidth: 460, width: "100%" }}>
          <h2 className="center" style={{ marginTop: 0 }}>Final Standings 🏆</h2>
          <table className="lb">
            <tbody>
              {standings.map((row, i) => (
                <tr key={row.uid} className={row.uid === meUid ? "me" : ""}>
                  <td className="rank">{i + 1}</td>
                  <td>{nameOf(row.uid)}{row.uid === meUid ? " (you)" : ""}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{row.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ---------- header / word hint ---------- */
  let headline: string;
  if (s.phase === "choosing") {
    headline = isDrawer ? "Pick a word to draw!" : `${nameOf(s.drawerUid)} is choosing a word…`;
  } else if (s.phase === "drawing") {
    headline = isDrawer
      ? `Draw:  ${s.word ?? ""}`
      : iAmCorrect
        ? "You got it! 🎉"
        : maskWord(s.word ?? "");
  } else {
    headline = `The word was “${s.word ?? ""}”`;
  }

  const guessDisabled = s.phase !== "drawing" || isDrawer || iAmCorrect;
  const guessPlaceholder = isDrawer
    ? "You're drawing…"
    : iAmCorrect
      ? "You already guessed it!"
      : "Type your guess…";

  return (
    <div className="stage-wrap" style={{ width: "100%" }}>
      {/* status bar */}
      <div className="row" style={{ width: "100%", maxWidth: 1120, justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span className="muted">Round {s.round} / {s.totalRounds}</span>
        <span
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: s.phase === "drawing" && !isDrawer && !iAmCorrect ? 4 : 1,
          }}
        >
          {headline}
        </span>
        <span
          style={{
            fontWeight: 800,
            color: secsLeft <= 10 && s.phase === "drawing" ? "var(--bad)" : "var(--text)",
            minWidth: 44,
            textAlign: "right",
          }}
        >
          ⏱ {secsLeft}s
        </span>
      </div>

      {/* main area: canvas + chat */}
      <div
        className="row"
        style={{ width: "100%", maxWidth: 1120, alignItems: "flex-start", justifyContent: "center", gap: 14, flexWrap: "wrap" }}
      >
        <DrawCanvas code={code} drawStartT={s.drawStartT} canDraw={isDrawer && s.phase === "drawing"} />

        <div className="col" style={{ flex: 1, minWidth: 240, maxWidth: 340, gap: 12 }}>
          {/* scoreboard */}
          <div className="panel col" style={{ gap: 6 }}>
            <h4 style={{ margin: 0 }}>Players</h4>
            {standings.map((row) => (
              <div key={row.uid} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  {row.uid === s.drawerUid ? "✏️ " : s.correctUids.includes(row.uid) ? "✓ " : ""}
                  {nameOf(row.uid)}{row.uid === meUid ? " (you)" : ""}
                </span>
                <strong>{row.score}</strong>
              </div>
            ))}
          </div>

          <GuessPanel
            guesses={s.guesses}
            disabled={guessDisabled}
            placeholder={guessPlaceholder}
            onGuess={(t) => void guess(t)}
          />
        </div>
      </div>

      {/* word choosing overlay for the drawer */}
      {s.phase === "choosing" && isDrawer && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {s.choices.map((w) => (
            <button key={w} className="btn" onClick={() => void chooseWord(w)}>{w}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Config + entry component
 * ------------------------------------------------------------------ */
const CONFIG: MultiplayerConfig<DGState> = {
  gameId: "doodle-guess",
  title: "Doodle Guess",
  icon: "🎨",
  color: "#46e0a0",
  minPlayers: 2,
  maxPlayers: 10,
  rules: [
    "Each round one player draws a secret word; everyone else guesses.",
    "Type your guesses in the chat — faster correct guesses score more.",
    "The drawer earns points for every friend who guesses right.",
    "Everyone takes turns drawing. Most points after all rounds wins!",
  ],
  buildInitialState: (order) => {
    const scores: Record<string, number> = {};
    for (const uid of order) scores[uid] = 0;
    const totalRounds = Math.max(order.length, order.length * ROUNDS_PER_PLAYER);
    return choosingState(order, 1, totalRounds, scores);
  },
  Board,
};

export function Component({ onExit }: ReactGameProps) {
  return <RoomShell config={CONFIG} onExit={onExit} />;
}
