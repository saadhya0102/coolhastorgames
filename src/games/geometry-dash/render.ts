/** Neon Dash — all canvas rendering. Reads game state, draws in CSS pixels. */
import { drawText, roundRect } from "@/engine";
import {
  Cell,
  CEIL_BOTTOM_ROW,
  FLOOR_TOP_ROW,
  GRID_ROWS,
} from "./constants";
import { cellAt } from "./level";
import type { LevelMeta } from "./types";
import type { NeonDash } from "./game";

const SPIKE_FILL = "#ff2e63";
const SPIKE_TIP = "#ffd6e4";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export class Renderer {
  render(g: NeonDash): void {
    const c = g.ctx.ctx;
    const v = g.v;
    const meta = g.state === "select" ? g.compiled[g.selIndex].meta : g.level.meta;

    c.save();
    if (g.shake > 0) {
      const s = g.shake * g.v.cs * 0.5;
      c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    const scroll = g.state === "select" ? g.clock * 1.6 : g.scrollX;
    this.drawBackground(c, g, meta, scroll);

    if (g.state === "select") {
      c.restore();
      this.drawSelect(c, g);
      this.drawFlash(c, g);
      return;
    }

    this.drawWorld(c, g, meta);
    if (g.state !== "death") this.drawCube(c, g, meta);
    g.particles.render(c);
    c.restore();

    this.drawFlash(c, g);
    this.drawHud(c, g, meta);

    if (g.state === "countdown") this.drawCountdown(c, g, meta);
    if (g.state === "complete") this.drawComplete(c, g, meta);
  }

  // ---- background -------------------------------------------------------
  private drawBackground(
    c: CanvasRenderingContext2D,
    g: NeonDash,
    meta: LevelMeta,
    scroll: number,
  ): void {
    const { W, H, cs } = g.v;
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, meta.c1);
    grad.addColorStop(1, meta.c2);
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);

    const pulse = g.pulse;

    // far layer — big rotating outlined polygons
    c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const span = W + cs * 8;
      const x = ((i * 260 - scroll * cs * 0.12) % span + span) % span - cs * 4;
      const y = H * (0.2 + (i % 3) * 0.24);
      const r = cs * (1.8 + (i % 3) * 0.7) * (1 + pulse * 0.06);
      c.strokeStyle = rgba(meta.accent, 0.07 + pulse * 0.05);
      this.polygon(c, x, y, r, i % 2 === 0 ? 3 : 4, g.clock * 0.2 + i);
      c.stroke();
    }

    // mid layer — small filled diamonds
    for (let i = 0; i < 10; i++) {
      const span = W + cs * 4;
      const x = ((i * 130 - scroll * cs * 0.3) % span + span) % span - cs * 2;
      const y = H * (0.12 + ((i * 37) % 70) / 100);
      const r = cs * 0.28 * (1 + pulse * 0.18);
      c.fillStyle = rgba(meta.glow, 0.06 + pulse * 0.04);
      this.polygon(c, x, y, r, 4, Math.PI / 4);
      c.fill();
    }

    // perspective grid lines toward the floor
    c.strokeStyle = rgba(meta.accent, 0.06);
    c.lineWidth = 1;
    const horizon = g.sy(FLOOR_TOP_ROW);
    const gridStep = cs * 1.5;
    const off = (scroll * cs * 0.5) % gridStep;
    for (let x = -off; x < W; x += gridStep) {
      c.beginPath();
      c.moveTo(x, horizon);
      c.lineTo((x - W / 2) * 2.4 + W / 2, H);
      c.stroke();
    }
  }

  private polygon(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    sides: number,
    rot: number,
  ): void {
    c.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  }

  // ---- world -----------------------------------------------------------
  private drawWorld(c: CanvasRenderingContext2D, g: NeonDash, meta: LevelMeta): void {
    const { W, H, cs } = g.v;
    const lvl = g.level;
    const left = g.scrollX - g.v.psx / cs;
    const right = g.scrollX + (W - g.v.psx) / cs;
    const first = Math.max(0, Math.floor(left) - 1);
    const last = Math.min(lvl.cols - 1, Math.ceil(right) + 1);

    const edgeGlow = 0.5 + g.pulse * 0.5;

    // ceiling bar
    const ceilY = g.sy(CEIL_BOTTOM_ROW);
    c.fillStyle = rgba(meta.c1, 0.92);
    c.fillRect(0, 0, W, ceilY);
    c.fillStyle = rgba(meta.accent, edgeGlow);
    c.fillRect(0, ceilY - Math.max(2, cs * 0.06), W, Math.max(2, cs * 0.06));

    // floor (per-column, with gaps)
    const floorY = g.sy(FLOOR_TOP_ROW);
    for (let col = first; col <= last; col++) {
      if (!lvl.floor[col]) continue;
      const x = g.sx(col);
      c.fillStyle = rgba(meta.c2, 0.96);
      c.fillRect(x - 0.5, floorY, cs + 1, H - floorY);
      c.fillStyle = rgba(meta.accent, edgeGlow * 0.9);
      c.fillRect(x - 0.5, floorY - Math.max(2, cs * 0.06), cs + 1, Math.max(2, cs * 0.06));
    }
    // floor grid texture
    c.strokeStyle = rgba(meta.glow, 0.12);
    c.lineWidth = 1;
    for (let col = first; col <= last; col++) {
      if (!lvl.floor[col]) continue;
      const x = g.sx(col);
      c.beginPath();
      c.moveTo(x, floorY);
      c.lineTo(x, H);
      c.stroke();
    }

    // cells
    for (let col = first; col <= last; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const cell = cellAt(lvl, col, row);
        if (cell === Cell.EMPTY) continue;
        const x = g.sx(col);
        const y = g.sy(row);
        if (cell === Cell.BLOCK) this.drawBlock(c, x, y, cs, meta);
        else if (cell === Cell.SPIKE_UP) this.drawSpike(c, x, y, cs, true);
        else if (cell === Cell.SPIKE_DOWN) this.drawSpike(c, x, y, cs, false);
        else if (cell === Cell.PAD) this.drawPad(c, x, y, cs, g.clock);
        else if (cell === Cell.ORB) this.drawOrb(c, x, y, cs, g.clock);
      }
    }

    // portals
    for (const p of lvl.portals) {
      if (p.col < first || p.col > last) continue;
      this.drawPortal(c, g, p.col, p.type);
    }

    // finish line
    if (g.finishCol >= first && g.finishCol <= last + 4) {
      this.drawFinish(c, g, meta);
    }
  }

  private drawBlock(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    cs: number,
    meta: LevelMeta,
  ): void {
    const pad = cs * 0.04;
    const grad = c.createLinearGradient(x, y, x, y + cs);
    grad.addColorStop(0, rgba(meta.glow, 0.95));
    grad.addColorStop(0.5, rgba(meta.accent, 0.85));
    grad.addColorStop(1, rgba(meta.c2, 0.95));
    c.fillStyle = grad;
    roundRect(c, x + pad, y + pad, cs - pad * 2, cs - pad * 2, cs * 0.14);
    c.fill();
    c.strokeStyle = rgba("#ffffff", 0.55);
    c.lineWidth = Math.max(1, cs * 0.04);
    c.stroke();
    c.fillStyle = rgba("#ffffff", 0.18);
    c.fillRect(x + pad * 2, y + pad * 2, cs - pad * 4, cs * 0.14);
  }

  private drawSpike(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    cs: number,
    up: boolean,
  ): void {
    c.save();
    c.beginPath();
    if (up) {
      c.moveTo(x + cs * 0.08, y + cs);
      c.lineTo(x + cs * 0.92, y + cs);
      c.lineTo(x + cs * 0.5, y + cs * 0.06);
    } else {
      c.moveTo(x + cs * 0.08, y);
      c.lineTo(x + cs * 0.92, y);
      c.lineTo(x + cs * 0.5, y + cs * 0.94);
    }
    c.closePath();
    c.fillStyle = SPIKE_FILL;
    c.shadowColor = SPIKE_FILL;
    c.shadowBlur = cs * 0.4;
    c.fill();
    c.shadowBlur = 0;
    // bright tip highlight
    c.strokeStyle = SPIKE_TIP;
    c.lineWidth = Math.max(1, cs * 0.05);
    c.stroke();
    c.restore();
  }

  private drawPad(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    cs: number,
    clock: number,
  ): void {
    const cy = y + cs * 0.85;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 8);
    c.fillStyle = "#ffe14a";
    c.shadowColor = "#ffe14a";
    c.shadowBlur = cs * 0.5;
    roundRect(c, x + cs * 0.12, cy, cs * 0.76, cs * 0.14, cs * 0.06);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = rgba("#fff7c2", 0.4 + pulse * 0.5);
    c.lineWidth = Math.max(1, cs * 0.05);
    c.beginPath();
    c.moveTo(x + cs * 0.5, cy - cs * 0.02);
    c.lineTo(x + cs * 0.5 - cs * 0.18, cy - cs * 0.28);
    c.moveTo(x + cs * 0.5, cy - cs * 0.02);
    c.lineTo(x + cs * 0.5 + cs * 0.18, cy - cs * 0.28);
    c.stroke();
  }

  private drawOrb(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    cs: number,
    clock: number,
  ): void {
    const cx = x + cs * 0.5;
    const cy = y + cs * 0.5;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    c.strokeStyle = rgba("#ff5cc8", 0.6 + pulse * 0.4);
    c.lineWidth = Math.max(1.5, cs * 0.07);
    c.shadowColor = "#ff5cc8";
    c.shadowBlur = cs * 0.5;
    c.beginPath();
    c.arc(cx, cy, cs * (0.3 + pulse * 0.04), 0, Math.PI * 2);
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = rgba("#ffd6f2", 0.5 + pulse * 0.3);
    c.beginPath();
    c.arc(cx, cy, cs * 0.12, 0, Math.PI * 2);
    c.fill();
  }

  private drawPortal(
    c: CanvasRenderingContext2D,
    g: NeonDash,
    col: number,
    type: number,
  ): void {
    const cs = g.v.cs;
    const x = g.sx(col) + cs * 0.5;
    const topY = g.sy(CEIL_BOTTOM_ROW);
    const botY = g.sy(FLOOR_TOP_ROW);
    const cy = (topY + botY) / 2;
    const h = botY - topY;
    let col1 = "#5cff9e";
    let col2 = "#0aff66";
    if (type === Cell.PORTAL_SHIP) {
      col1 = "#9b6bff";
      col2 = "#19d3ff";
    } else if (type === Cell.PORTAL_CUBE) {
      col1 = "#ffb14a";
      col2 = "#ff6b4a";
    }
    const t = g.clock * 2;
    c.save();
    c.globalAlpha = 0.85;
    const grad = c.createLinearGradient(x, topY, x, botY);
    grad.addColorStop(0, rgba(col1, 0.0));
    grad.addColorStop(0.5, rgba(col1, 0.5));
    grad.addColorStop(1, rgba(col1, 0.0));
    c.fillStyle = grad;
    c.fillRect(x - cs * 0.32, topY, cs * 0.64, h);
    c.strokeStyle = col2;
    c.lineWidth = Math.max(2, cs * 0.08);
    c.shadowColor = col2;
    c.shadowBlur = cs * 0.6;
    for (let i = 0; i < 3; i++) {
      const rr = cs * (0.45 + i * 0.06);
      const ry = h * 0.42;
      c.beginPath();
      c.ellipse(x, cy, rr * (0.8 + 0.2 * Math.sin(t + i)), ry, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  }

  private drawFinish(c: CanvasRenderingContext2D, g: NeonDash, meta: LevelMeta): void {
    const cs = g.v.cs;
    const x = g.sx(g.finishCol);
    const topY = g.sy(CEIL_BOTTOM_ROW);
    const botY = g.sy(FLOOR_TOP_ROW);
    const w = cs * 0.5;
    const rows = 12;
    const rh = (botY - topY) / rows;
    for (let i = 0; i < rows; i++) {
      c.fillStyle = i % 2 === 0 ? "#ffffff" : meta.accent;
      c.fillRect(x, topY + i * rh, w, rh);
    }
    c.fillStyle = rgba(meta.glow, 0.4 + g.pulse * 0.4);
    c.fillRect(x - cs * 0.1, topY, cs * 0.1, botY - topY);
  }

  // ---- cube ------------------------------------------------------------
  private drawCube(c: CanvasRenderingContext2D, g: NeonDash, meta: LevelMeta): void {
    const cs = g.v.cs;
    // trail
    for (const t of g.particles.trail) {
      const a = (1 - t.life / 0.4) * 0.35;
      c.save();
      c.globalAlpha = a;
      c.translate(t.x, t.y);
      c.rotate(t.rot);
      c.fillStyle = meta.glow;
      const s = cs * 0.6;
      c.fillRect(-s / 2, -s / 2, s, s);
      c.restore();
    }
    c.globalAlpha = 1;

    const cx = g.sx(g.scrollX + 0.5);
    const cyRow = g.py + 0.5;
    const cy = g.sy(cyRow);
    const s = cs * 0.78;

    c.save();
    c.translate(cx, cy);
    c.rotate(g.rot);

    // thruster (ship mode)
    if (g.mode === "ship") {
      c.fillStyle = rgba("#ffcf4a", 0.8);
      c.shadowColor = "#ffae4a";
      c.shadowBlur = cs * 0.5;
      const flame = cs * (0.4 + Math.random() * 0.3) * g.gravDir;
      c.beginPath();
      c.moveTo(-s * 0.5, -s * 0.2);
      c.lineTo(-s * 0.5 - flame, 0);
      c.lineTo(-s * 0.5, s * 0.2);
      c.closePath();
      c.fill();
      c.shadowBlur = 0;
    }

    // body
    const grad = c.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    grad.addColorStop(0, meta.glow);
    grad.addColorStop(1, meta.accent);
    c.fillStyle = grad;
    c.shadowColor = meta.accent;
    c.shadowBlur = cs * 0.6;
    roundRect(c, -s / 2, -s / 2, s, s, s * 0.16);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = "#ffffff";
    c.lineWidth = Math.max(1.5, cs * 0.05);
    c.stroke();

    // inner face
    c.fillStyle = rgba("#04122a", 0.85);
    roundRect(c, -s * 0.26, -s * 0.26, s * 0.52, s * 0.52, s * 0.12);
    c.fill();
    c.fillStyle = "#ffffff";
    const eye = s * 0.1;
    c.fillRect(-s * 0.16, -s * 0.08, eye, eye);
    c.fillRect(s * 0.06, -s * 0.08, eye, eye);
    c.restore();
  }

  // ---- flash / hud -----------------------------------------------------
  private drawFlash(c: CanvasRenderingContext2D, g: NeonDash): void {
    if (g.flash <= 0) return;
    c.fillStyle = rgba("#ffffff", g.flash * 0.7);
    c.fillRect(0, 0, g.v.W, g.v.H);
  }

  private drawHud(c: CanvasRenderingContext2D, g: NeonDash, meta: LevelMeta): void {
    const { W, H } = g.v;
    // progress bar
    const barW = W * 0.6;
    const barH = Math.max(8, H * 0.022);
    const barX = (W - barW) / 2;
    const barY = H * 0.045;
    c.fillStyle = rgba("#000000", 0.35);
    roundRect(c, barX, barY, barW, barH, barH / 2);
    c.fill();
    c.fillStyle = meta.accent;
    roundRect(c, barX, barY, Math.max(barH, barW * g.progress), barH, barH / 2);
    c.fill();
    c.strokeStyle = rgba("#ffffff", 0.4);
    c.lineWidth = 1.5;
    roundRect(c, barX, barY, barW, barH, barH / 2);
    c.stroke();
    drawText(c, `${Math.floor(g.progress * 100)}%`, W / 2, barY + barH + H * 0.03, H * 0.035, "#fff");

    // attempts + best
    drawText(
      c,
      `ATTEMPT ${g.attempts}`,
      barX,
      barY + barH * 0.5,
      H * 0.03,
      rgba("#ffffff", 0.85),
      "left",
    );
    drawText(
      c,
      `BEST ${g.bestPct[g.levelIndex]}%`,
      barX + barW,
      barY + barH * 0.5,
      H * 0.03,
      rgba("#ffffff", 0.85),
      "right",
    );

    // mode / practice tags
    if (g.mode === "ship") {
      drawText(c, "FLY", W * 0.08, H * 0.12, H * 0.04, meta.glow, "left");
    }
    if (g.gravDir === -1) {
      drawText(c, "INVERTED", W * 0.08, H * 0.17, H * 0.032, "#5cff9e", "left");
    }
    if (g.practice) {
      drawText(c, "PRACTICE", W * 0.92, H * 0.12, H * 0.032, "#5cff9e", "right");
    }
  }

  private drawCountdown(c: CanvasRenderingContext2D, g: NeonDash, meta: LevelMeta): void {
    const { W, H } = g.v;
    const n = Math.ceil(g.countdownT);
    const label = n <= 0 ? "GO" : String(n);
    const frac = g.countdownT - Math.floor(g.countdownT);
    const scale = 0.6 + (1 - frac) * 0.6;
    c.save();
    c.translate(W / 2, H * 0.46);
    c.scale(scale, scale);
    drawText(c, label, 0, 0, H * 0.18, meta.accent);
    c.restore();
    drawText(c, meta.name.toUpperCase(), W / 2, H * 0.66, H * 0.05, "#fff");
  }

  // ---- screens ---------------------------------------------------------
  private drawSelect(c: CanvasRenderingContext2D, g: NeonDash): void {
    const { W, H } = g.v;
    c.fillStyle = rgba("#000000", 0.35);
    c.fillRect(0, 0, W, H);

    drawText(c, "NEON DASH", W / 2, H * 0.14, H * 0.1, "#fff");
    drawText(
      c,
      "rhythm auto-runner · tap / Space to jump",
      W / 2,
      H * 0.22,
      H * 0.034,
      rgba("#ffffff", 0.7),
    );

    const cards = g.selectLayout();
    for (const r of cards) {
      const m = g.compiled[r.id].meta;
      const selected = r.id === g.selIndex;
      const grad = c.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      grad.addColorStop(0, m.c1);
      grad.addColorStop(1, m.c2);
      c.fillStyle = grad;
      roundRect(c, r.x, r.y, r.w, r.h, r.w * 0.08);
      c.fill();
      c.lineWidth = selected ? Math.max(3, r.w * 0.03) : 1.5;
      c.strokeStyle = selected ? m.accent : rgba("#ffffff", 0.25);
      if (selected) {
        c.shadowColor = m.accent;
        c.shadowBlur = r.w * 0.18;
      }
      roundRect(c, r.x, r.y, r.w, r.h, r.w * 0.08);
      c.stroke();
      c.shadowBlur = 0;

      // mini cube emblem
      c.save();
      c.translate(r.x + r.w / 2, r.y + r.h * 0.32);
      c.rotate(g.clock * (0.6 + r.id * 0.2));
      const s = r.w * 0.26;
      const gg = c.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
      gg.addColorStop(0, m.glow);
      gg.addColorStop(1, m.accent);
      c.fillStyle = gg;
      roundRect(c, -s / 2, -s / 2, s, s, s * 0.18);
      c.fill();
      c.restore();

      drawText(c, m.name, r.x + r.w / 2, r.y + r.h * 0.62, r.w * 0.13, "#fff");
      const stars = "★★★".substring(0, m.difficulty) + "☆☆☆".substring(0, 3 - m.difficulty);
      drawText(c, stars, r.x + r.w / 2, r.y + r.h * 0.74, r.w * 0.12, m.accent);
      drawText(
        c,
        `BEST ${g.bestPct[r.id]}%`,
        r.x + r.w / 2,
        r.y + r.h * 0.88,
        r.w * 0.1,
        rgba("#ffffff", 0.85),
      );
    }

    // practice toggle
    const pr = g.practiceToggleRect();
    c.fillStyle = g.practice ? rgba("#5cff9e", 0.25) : rgba("#000000", 0.3);
    roundRect(c, pr.x, pr.y, pr.w, pr.h, pr.h * 0.3);
    c.fill();
    c.strokeStyle = g.practice ? "#5cff9e" : rgba("#ffffff", 0.4);
    c.lineWidth = 2;
    roundRect(c, pr.x, pr.y, pr.w, pr.h, pr.h * 0.3);
    c.stroke();
    drawText(
      c,
      g.practice ? "PRACTICE: ON" : "PRACTICE: OFF",
      pr.x + pr.w / 2,
      pr.y + pr.h / 2,
      pr.h * 0.4,
      g.practice ? "#5cff9e" : "#fff",
    );
    drawText(
      c,
      "← → choose · Space start · P practice",
      W / 2,
      H * 0.96,
      H * 0.03,
      rgba("#ffffff", 0.6),
    );
  }

  private drawComplete(c: CanvasRenderingContext2D, g: NeonDash, meta: LevelMeta): void {
    const { W, H } = g.v;
    c.fillStyle = rgba("#000000", 0.55);
    c.fillRect(0, 0, W, H);
    drawText(c, "LEVEL COMPLETE", W / 2, H * 0.3, H * 0.09, meta.accent);
    drawText(c, meta.name, W / 2, H * 0.4, H * 0.05, "#fff");
    drawText(c, "100%", W / 2, H * 0.49, H * 0.06, meta.glow);

    const btns = g.completeButtons();
    const labels = ["NEXT", "RETRY", "MENU"];
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      c.fillStyle = rgba(meta.accent, i === 0 ? 0.85 : 0.2);
      roundRect(c, b.x, b.y, b.w, b.h, b.h * 0.25);
      c.fill();
      c.strokeStyle = rgba("#ffffff", 0.5);
      c.lineWidth = 2;
      roundRect(c, b.x, b.y, b.w, b.h, b.h * 0.25);
      c.stroke();
      drawText(c, labels[i], b.x + b.w / 2, b.y + b.h / 2, b.h * 0.36, "#fff");
    }
  }
}
