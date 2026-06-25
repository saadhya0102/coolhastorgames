import { drawText, roundRect } from "@/engine";
import { hexA } from "./render";
import type { Palette } from "./types";

type C = CanvasRenderingContext2D;

export interface HudInfo {
  coins: number;
  lives: number;
  score: number;
  levelName: string;
  levelIndex: number;
  totalLevels: number;
  time: number;
}

function coinIcon(c: C, x: number, y: number, r: number) {
  c.fillStyle = "#ffcf33";
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#e0a90f";
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = "#e0a90f";
  c.font = `700 ${r}px system-ui`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("$", x, y + 1);
}

function pipIcon(c: C, x: number, y: number, r: number) {
  c.fillStyle = "#4fb0e8";
  roundRect(c, x - r, y - r, r * 2, r * 2, r * 0.7);
  c.fill();
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(x - r * 0.35, y - r * 0.1, r * 0.3, 0, Math.PI * 2);
  c.arc(x + r * 0.45, y - r * 0.1, r * 0.3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#16203a";
  c.beginPath();
  c.arc(x - r * 0.3, y - r * 0.05, r * 0.14, 0, Math.PI * 2);
  c.arc(x + r * 0.5, y - r * 0.05, r * 0.14, 0, Math.PI * 2);
  c.fill();
}

export function drawHud(c: C, W: number, H: number, info: HudInfo, pal: Palette) {
  const s = Math.min(W, H);
  const fs = Math.max(14, s * 0.035);
  const pad = fs * 0.6;
  const barH = fs * 1.9;

  c.save();
  // left panel: coins + score
  const leftW = fs * 7.5;
  roundRect(c, pad, pad, leftW, barH, 10);
  c.fillStyle = "rgba(0,0,0,0.32)";
  c.fill();
  coinIcon(c, pad + fs, pad + barH / 2, fs * 0.55);
  drawText(c, `${info.coins}`, pad + fs * 1.8, pad + barH * 0.32, fs * 0.9, "#fff", "left");
  drawText(c, `${info.score}`, pad + fs * 1.8, pad + barH * 0.72, fs * 0.6, "#ffe08a", "left");

  // right panel: lives + level + time
  const rightW = fs * 8.2;
  const rx = W - pad - rightW;
  roundRect(c, rx, pad, rightW, barH, 10);
  c.fillStyle = "rgba(0,0,0,0.32)";
  c.fill();
  pipIcon(c, rx + fs * 0.9, pad + barH / 2, fs * 0.5);
  drawText(c, `x${info.lives}`, rx + fs * 1.6, pad + barH * 0.32, fs * 0.78, "#fff", "left");
  drawText(c, `${info.levelIndex}/${info.totalLevels}`, rx + fs * 1.6, pad + barH * 0.74, fs * 0.55, "#cfe8ff", "left");
  const tcol = info.time < 15 ? "#ff8a8a" : "#fff";
  drawText(c, `${Math.ceil(info.time)}s`, rx + rightW - fs * 0.5, pad + barH / 2, fs * 0.8, tcol, "right");

  // center: biome name (small)
  drawText(c, info.levelName, W / 2, pad + barH / 2, fs * 0.62, hexA(pal.accent, 0.95));
  c.restore();
}

function dim(c: C, W: number, H: number, a: number) {
  c.fillStyle = `rgba(8,10,20,${a})`;
  c.fillRect(0, 0, W, H);
}

export function drawTitle(
  c: C, W: number, H: number,
  best: number, furthest: number, isTouch: boolean, t: number,
) {
  dim(c, W, H, 0.28);
  const s = Math.min(W, H);
  const cx = W / 2;
  const bob = Math.sin(t * 2) * s * 0.012;

  // big logo Pip
  c.save();
  c.translate(cx, H * 0.3 + bob);
  const r = s * 0.07;
  c.fillStyle = "rgba(0,0,0,0.2)";
  c.beginPath();
  c.ellipse(0, r * 1.4, r, r * 0.3, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#4fb0e8";
  roundRect(c, -r, -r, r * 2, r * 2, r * 0.7);
  c.fill();
  c.fillStyle = "#bfe7ff";
  c.beginPath();
  c.ellipse(0, r * 0.45, r * 0.5, r * 0.4, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#5fce67";
  c.save();
  c.translate(0, -r);
  c.rotate(Math.sin(t * 4) * 0.15 - 0.2);
  c.beginPath();
  c.ellipse(2, -r * 0.3, r * 0.3, r * 0.16, 0.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(-r * 0.35, -r * 0.1, r * 0.28, 0, Math.PI * 2);
  c.arc(r * 0.45, -r * 0.1, r * 0.28, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#16203a";
  c.beginPath();
  c.arc(-r * 0.3, -r * 0.05, r * 0.13, 0, Math.PI * 2);
  c.arc(r * 0.5, -r * 0.05, r * 0.13, 0, Math.PI * 2);
  c.fill();
  c.restore();

  drawText(c, "MOSSBLOOM RUN", cx, H * 0.52, s * 0.085, "#fff");
  c.save();
  c.globalAlpha = 0.85;
  drawText(c, "A forest sprite's leap-and-bop adventure", cx, H * 0.6, s * 0.035, "#dff0ff");
  c.restore();

  const pulse = 0.6 + Math.sin(t * 4) * 0.4;
  c.save();
  c.globalAlpha = pulse;
  drawText(c, isTouch ? "TAP TO START" : "PRESS SPACE TO START", cx, H * 0.72, s * 0.05, "#ffe08a");
  c.restore();

  drawText(
    c,
    furthest > 0 ? `Best Score ${best}   •   Furthest: Level ${furthest}` : "New adventurer — good luck!",
    cx, H * 0.85, s * 0.034, "#bcd",
  );
  drawText(
    c,
    isTouch ? "D-pad to move • JUMP to jump • RUN to sprint" : "Arrows/WASD move • Space/W jump • Shift run • Down drop",
    cx, H * 0.92, s * 0.03, hexA("#ffffff", 0.6),
  );
}

export function drawIntro(c: C, W: number, H: number, name: string, idx: number, total: number, alpha: number) {
  dim(c, W, H, 0.55 * alpha);
  const s = Math.min(W, H);
  c.save();
  c.globalAlpha = alpha;
  drawText(c, `LEVEL ${idx} / ${total}`, W / 2, H * 0.42, s * 0.05, "#ffe08a");
  drawText(c, name, W / 2, H * 0.52, s * 0.08, "#fff");
  c.restore();
}

export interface ClearStats {
  levelName: string;
  coins: number;
  coinScore: number;
  timeBonus: number;
  clearBonus: number;
  total: number;
}

export function drawLevelClear(c: C, W: number, H: number, st: ClearStats, t: number) {
  dim(c, W, H, 0.6);
  const s = Math.min(W, H);
  const cx = W / 2;
  drawText(c, "STAGE CLEAR!", cx, H * 0.26, s * 0.085, "#ffe08a");
  drawText(c, st.levelName, cx, H * 0.34, s * 0.04, "#dff0ff");

  const rows: [string, string][] = [
    [`Coins x${st.coins}`, `+${st.coinScore}`],
    ["Time bonus", `+${st.timeBonus}`],
    ["Clear bonus", `+${st.clearBonus}`],
  ];
  const ry = H * 0.46;
  const lh = s * 0.06;
  const bw = Math.min(W * 0.7, s * 1.1);
  rows.forEach((r, i) => {
    const reveal = t > 0.3 + i * 0.35;
    if (!reveal) return;
    drawText(c, r[0], cx - bw / 2, ry + i * lh, s * 0.045, "#fff", "left");
    drawText(c, r[1], cx + bw / 2, ry + i * lh, s * 0.045, "#9effc0", "right");
  });
  if (t > 1.6) {
    drawText(c, "TOTAL", cx - bw / 2, ry + 3.2 * lh, s * 0.05, "#ffe08a", "left");
    drawText(c, `${st.total}`, cx + bw / 2, ry + 3.2 * lh, s * 0.05, "#ffe08a", "right");
  }
  if (t > 2.0) {
    c.save();
    c.globalAlpha = 0.6 + Math.sin(t * 5) * 0.4;
    drawText(c, "Tap / Space to continue", cx, H * 0.86, s * 0.04, "#fff");
    c.restore();
  }
}

export function drawGameOver(c: C, W: number, H: number, score: number, best: boolean, bestScore: number, isTouch: boolean, t: number) {
  dim(c, W, H, 0.66);
  const s = Math.min(W, H);
  const cx = W / 2;
  drawText(c, "GAME OVER", cx, H * 0.34, s * 0.1, "#ff8a8a");
  drawText(c, `Score ${score}`, cx, H * 0.48, s * 0.06, "#fff");
  drawText(c, best ? "NEW BEST!" : `Best ${bestScore}`, cx, H * 0.56, s * 0.04, best ? "#ffe08a" : "#bcd");
  const pulse = 0.6 + Math.sin(t * 4) * 0.4;
  c.save();
  c.globalAlpha = pulse;
  drawText(c, isTouch ? "TAP TO RETRY" : "PRESS SPACE TO RETRY", cx, H * 0.72, s * 0.05, "#ffe08a");
  c.restore();
}

export function drawVictory(c: C, W: number, H: number, score: number, best: boolean, bestScore: number, isTouch: boolean, t: number) {
  dim(c, W, H, 0.6);
  const s = Math.min(W, H);
  const cx = W / 2;
  const hue = (t * 80) % 360;
  drawText(c, "YOU REACHED THE BLOOM!", cx, H * 0.3, s * 0.07, `hsl(${hue},90%,70%)`);
  drawText(c, "All three biomes conquered.", cx, H * 0.4, s * 0.04, "#dff0ff");
  drawText(c, `Final Score ${score}`, cx, H * 0.52, s * 0.07, "#fff");
  drawText(c, best ? "NEW BEST!" : `Best ${bestScore}`, cx, H * 0.6, s * 0.04, best ? "#ffe08a" : "#bcd");
  const pulse = 0.6 + Math.sin(t * 4) * 0.4;
  c.save();
  c.globalAlpha = pulse;
  drawText(c, isTouch ? "TAP TO PLAY AGAIN" : "PRESS SPACE TO PLAY AGAIN", cx, H * 0.76, s * 0.05, "#ffe08a");
  c.restore();
}

export function drawFlash(c: C, W: number, H: number, color: string, alpha: number) {
  if (alpha <= 0) return;
  c.fillStyle = hexA(color, Math.min(1, alpha));
  c.fillRect(0, 0, W, H);
}
