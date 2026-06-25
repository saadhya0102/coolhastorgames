import type { GameContext, GameInstance } from "@/engine";
import { drawText, roundRect, dailySeed, mulberry32 } from "@/engine";
import { ANSWERS, ALLOWED } from "./words";

type LetterState = "correct" | "present" | "absent";

const ROWS = 6;
const COLS = 5;
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "\u23cezxcvbnm\u232b"]; // enter + del glyphs

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  const seed = dailySeed("word-daily");
  const rand = mulberry32(seed);
  const answer = ANSWERS[Math.floor(rand() * ANSWERS.length)].toLowerCase();
  const dayKey = new Date().toISOString().slice(0, 10);

  let guesses: string[] = [];
  let current = "";
  let finished = false;
  let win = false;
  let shake = 0;
  let message = "";
  let messageT = 0;
  const keyState: Record<string, LetterState> = {};
  let keyRects: { key: string; x: number; y: number; w: number; h: number }[] = [];

  // restore today's completed result so the score isn't replayable-spammed
  const saved = ctx.storage.get<{ day: string; guesses: string[]; win: boolean } | null>("today", null);
  if (saved && saved.day === dayKey && saved.guesses.length) {
    guesses = saved.guesses.slice();
    win = saved.win;
    finished = true;
    for (const g of guesses) applyKeyStates(g);
    // Already played today: surface the result and end the round so the portal
    // shows its end screen instead of leaving the player on a frozen board.
    setTimeout(() => ctx.gameOver(win ? guesses.length : undefined), 700);
  }

  ctx.setStatus(
    finished
      ? "Today's word is done — come back tomorrow!"
      : "Guess the daily 5-letter word",
  );

  function applyKeyStates(guess: string) {
    const res = evaluate(guess, answer);
    for (let i = 0; i < COLS; i++) {
      const c = guess[i];
      const s = res[i];
      const prev = keyState[c];
      if (s === "correct" || (s === "present" && prev !== "correct") || (s === "absent" && !prev)) {
        keyState[c] = s;
      }
    }
  }

  function flash(msg: string) {
    message = msg;
    messageT = 1.6;
  }

  function submit() {
    if (finished) return;
    if (current.length < COLS) {
      shake = 0.4;
      flash("Not enough letters");
      audio.tone(200, 0.1, "square", 0.3);
      return;
    }
    if (!ALLOWED.has(current)) {
      shake = 0.4;
      flash("Not in word list");
      audio.tone(180, 0.12, "square", 0.3);
      return;
    }
    guesses.push(current);
    applyKeyStates(current);
    const won = current === answer;
    const guess = current;
    current = "";
    audio.blip();

    if (won) {
      win = true;
      finished = true;
      ctx.storage.set("today", { day: dayKey, guesses, win: true });
      bumpStreak(true);
      audio.win();
      setTimeout(() => ctx.gameOver(guesses.length), 900);
    } else if (guesses.length >= ROWS) {
      finished = true;
      ctx.storage.set("today", { day: dayKey, guesses, win: false });
      bumpStreak(false);
      flash(answer.toUpperCase());
      audio.lose();
      setTimeout(() => ctx.gameOver(), 900);
    }
    void guess;
  }

  function bumpStreak(won: boolean) {
    const s = ctx.storage.get<{ streak: number; best: number; lastDay: string }>("streak", { streak: 0, best: 0, lastDay: "" });
    if (s.lastDay === dayKey) return;
    s.streak = won ? s.streak + 1 : 0;
    s.best = Math.max(s.best, s.streak);
    s.lastDay = dayKey;
    ctx.storage.set("streak", s);
  }

  function typeLetter(c: string) {
    if (finished) return;
    if (current.length < COLS) {
      current += c;
      audio.tone(440, 0.04, "sine", 0.2);
    }
  }
  function backspace() {
    if (finished) return;
    if (current.length > 0) current = current.slice(0, -1);
  }

  function pressKey(k: string) {
    if (k === "\u23ce") submit();
    else if (k === "\u232b") backspace();
    else typeLetter(k);
  }

  return {
    update(dt) {
      if (shake > 0) shake = Math.max(0, shake - dt);
      if (messageT > 0) messageT = Math.max(0, messageT - dt);

      for (let i = 97; i <= 122; i++) {
        const c = String.fromCharCode(i);
        if (input.pressed(c)) typeLetter(c);
      }
      if (input.pressed("Enter")) submit();
      if (input.pressed("Backspace")) backspace();

      if (input.pointer.justDown) {
        const p = input.pointer;
        for (const r of keyRects) {
          if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
            pressKey(r.key);
            break;
          }
        }
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      c.fillStyle = "#0f1320";
      c.fillRect(0, 0, W, H);

      const pad = W * 0.04;
      const boardH = H * 0.62;
      const tile = Math.min((W - pad * 2) / COLS, (boardH - pad) / ROWS) * 0.94;
      const gap = tile * 0.08;
      const gridW = COLS * tile + (COLS - 1) * gap;
      const ox = (W - gridW) / 2;
      const oy = pad + 8;

      for (let r = 0; r < ROWS; r++) {
        const guess = r < guesses.length ? guesses[r] : r === guesses.length && !finished ? current : "";
        const submitted = r < guesses.length;
        const res = submitted ? evaluate(guesses[r], answer) : null;
        const sx = ox + (r === guesses.length && shake > 0 ? Math.sin(shake * 60) * 6 : 0);
        for (let i = 0; i < COLS; i++) {
          const x = sx + i * (tile + gap);
          const y = oy + r * (tile + gap);
          const ch = guess[i] ?? "";
          let bg = "#0f1320";
          let border = ch ? "#566090" : "#2a3358";
          let fg = "#eef1ff";
          if (res) {
            const s = res[i];
            bg = s === "correct" ? "#46a35a" : s === "present" ? "#c8a13a" : "#3a4160";
            border = bg;
          }
          c.fillStyle = bg;
          roundRect(c, x, y, tile, tile, 6);
          c.fill();
          if (!res) {
            c.lineWidth = 2;
            c.strokeStyle = border;
            roundRect(c, x, y, tile, tile, 6);
            c.stroke();
          }
          if (ch) drawText(c, ch.toUpperCase(), x + tile / 2, y + tile / 2, tile * 0.5, fg);
        }
      }

      const bannerY = oy + ROWS * (tile + gap) + 4;
      if (messageT > 0) {
        const a = Math.min(1, messageT);
        c.globalAlpha = a;
        c.fillStyle = "#eef1ff";
        roundRect(c, W / 2 - W * 0.3, bannerY, W * 0.6, 30, 8);
        c.fill();
        drawText(c, message, W / 2, bannerY + 15, 15, "#0f1320");
        c.globalAlpha = 1;
      } else if (finished) {
        const label = win
          ? `Solved in ${guesses.length}/${ROWS}`
          : `Answer: ${answer.toUpperCase()}`;
        c.fillStyle = win ? "#46a35a" : "#c8a13a";
        roundRect(c, W / 2 - W * 0.34, bannerY, W * 0.68, 30, 8);
        c.fill();
        drawText(c, label, W / 2, bannerY + 15, 15, "#0f1320");
      }

      // keyboard
      keyRects = [];
      const kbTop = oy + ROWS * (tile + gap) + 44;
      const kbH = H - kbTop - pad;
      const rowH = kbH / KEY_ROWS.length;
      const keyGap = W * 0.012;
      for (let r = 0; r < KEY_ROWS.length; r++) {
        const keys = KEY_ROWS[r].split("");
        const totalUnits = keys.reduce((s, k) => s + (k === "\u23ce" || k === "\u232b" ? 1.5 : 1), 0);
        const unitW = (W - pad * 2 - keyGap * (keys.length - 1)) / totalUnits;
        let x = pad + (W - pad * 2 - (keys.reduce((s, k) => s + (k === "\u23ce" || k === "\u232b" ? 1.5 : 1) * unitW, 0) + keyGap * (keys.length - 1))) / 2;
        const y = kbTop + r * rowH;
        const kh = rowH * 0.84;
        for (const k of keys) {
          const wide = k === "\u23ce" || k === "\u232b";
          const kw = (wide ? 1.5 : 1) * unitW;
          const st = keyState[k];
          c.fillStyle = st === "correct" ? "#46a35a" : st === "present" ? "#c8a13a" : st === "absent" ? "#3a4160" : "#3b4470";
          roundRect(c, x, y, kw, kh, 6);
          c.fill();
          drawText(c, k === "\u23ce" ? "ENTER" : k === "\u232b" ? "DEL" : k.toUpperCase(), x + kw / 2, y + kh / 2, wide ? kh * 0.32 : kh * 0.42, "#eef1ff");
          keyRects.push({ key: k, x, y, w: kw, h: kh });
          x += kw + keyGap;
        }
      }

    },
  };
}

function evaluate(guess: string, answer: string): LetterState[] {
  const res: LetterState[] = new Array(COLS).fill("absent");
  const counts: Record<string, number> = {};
  for (const ch of answer) counts[ch] = (counts[ch] ?? 0) + 1;
  for (let i = 0; i < COLS; i++) {
    if (guess[i] === answer[i]) {
      res[i] = "correct";
      counts[guess[i]]--;
    }
  }
  for (let i = 0; i < COLS; i++) {
    if (res[i] === "correct") continue;
    const ch = guess[i];
    if (counts[ch] > 0) {
      res[i] = "present";
      counts[ch]--;
    }
  }
  return res;
}
