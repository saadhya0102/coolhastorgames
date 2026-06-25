/**
 * Neon Nexus — renderer.
 *
 * Draws the entire frame procedurally on the 2D canvas. Everything gameplay is
 * drawn in VIRTUAL space via a translate+scale transform so it is resolution
 * independent; the HUD/overlays are drawn in screen space for crisp text. No
 * asset files — all art is generated here.
 */
import { TABLE_W, TABLE_H, COLORS, BALL_R, FLIPPER_R, START_BALLS } from "./constants";
import type { TableLayout } from "./table";
import type { Ball } from "./ball";
import type { Flipper } from "./flipper";
import type { Effects } from "./effects";

export type GameState = "attract" | "ready" | "playing" | "drain" | "gameover";

export interface PinballView {
  ctx: CanvasRenderingContext2D;
  viewW: number;
  viewH: number;
  table: TableLayout;
  balls: Ball[];
  flippers: Flipper[];
  effects: Effects;
  t: number;
  score: number;
  highScore: number;
  ballsRemaining: number;
  multiplier: number;
  combo: number;
  state: GameState;
  status: string;
  banner: string;
  bannerT: number;
  plungerPower: number;
  ballWaiting: boolean;
  flash: Map<string, number>;
  coreHits: number;
  coreLit: boolean;
  multiball: boolean;
}

export interface Transform {
  scale: number;
  ox: number;
  oy: number;
}

export function computeTransform(viewW: number, viewH: number): Transform {
  const scale = Math.min(viewW / TABLE_W, viewH / TABLE_H);
  const ox = (viewW - TABLE_W * scale) / 2;
  const oy = (viewH - TABLE_H * scale) / 2;
  return { scale, ox, oy };
}

export class Renderer {
  render(view: PinballView) {
    const c = view.ctx;
    const { viewW, viewH } = view;
    const tf = computeTransform(viewW, viewH);

    // full background repaint (cabinet)
    this.drawCabinet(c, viewW, viewH, view.t);

    c.save();
    c.translate(tf.ox + view.effects.shakeX * tf.scale, tf.oy + view.effects.shakeY * tf.scale);
    c.scale(tf.scale, tf.scale);

    // clip to the table rectangle
    c.save();
    c.beginPath();
    c.rect(0, 0, TABLE_W, TABLE_H);
    c.clip();

    this.drawPlayfield(c, view.t);
    this.drawDecals(c, view.table);
    this.drawLanes(c, view);
    this.drawDrops(c, view);
    this.drawStandups(c, view);
    this.drawCore(c, view);
    this.drawWalls(c, view.table, view.t);
    this.drawSlings(c, view);
    this.drawBumpers(c, view);
    this.drawPlunger(c, view);
    this.drawParticles(c, view.effects);
    this.drawBalls(c, view);
    this.drawFlippers(c, view);
    this.drawPopups(c, view.effects);

    c.restore(); // clip
    c.restore(); // transform

    // HUD + overlays in screen space
    this.drawHud(c, view, tf);
    this.drawOverlays(c, view, tf);
  }

  // ---- background ---------------------------------------------------------
  private drawCabinet(c: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, COLORS.bgTop);
    g.addColorStop(1, COLORS.bgBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // subtle moving neon glow blobs in the bezel
    c.save();
    c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const bx = w * (0.2 + 0.3 * i) + Math.cos(t * 0.3 + i) * w * 0.05;
      const by = h * (0.15 + 0.35 * i) + Math.sin(t * 0.4 + i) * h * 0.04;
      const rg = c.createRadialGradient(bx, by, 0, bx, by, Math.max(w, h) * 0.25);
      const col = i === 0 ? "rgba(70,240,255,0.05)" : i === 1 ? "rgba(255,69,200,0.05)" : "rgba(157,255,60,0.04)";
      rg.addColorStop(0, col);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = rg;
      c.fillRect(0, 0, w, h);
    }
    c.restore();
  }

  private drawPlayfield(c: CanvasRenderingContext2D, t: number) {
    const g = c.createLinearGradient(0, 0, 0, TABLE_H);
    g.addColorStop(0, COLORS.playTop);
    g.addColorStop(1, COLORS.playBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, TABLE_W, TABLE_H);

    // animated grid
    c.save();
    c.strokeStyle = COLORS.grid;
    c.lineWidth = 1.2;
    const step = 40;
    const off = (t * 14) % step;
    c.beginPath();
    for (let y = -step + off; y < TABLE_H; y += step) {
      c.moveTo(0, y);
      c.lineTo(TABLE_W, y);
    }
    for (let x = 0; x < TABLE_W; x += step) {
      c.moveTo(x, 0);
      c.lineTo(x, TABLE_H);
    }
    c.stroke();
    c.restore();

    // vignette
    const rg = c.createRadialGradient(TABLE_W / 2, TABLE_H * 0.42, TABLE_H * 0.2, TABLE_W / 2, TABLE_H * 0.5, TABLE_H * 0.75);
    rg.addColorStop(0, "rgba(0,0,0,0)");
    rg.addColorStop(1, "rgba(0,0,0,0.55)");
    c.fillStyle = rg;
    c.fillRect(0, 0, TABLE_W, TABLE_H);
  }

  private drawDecals(c: CanvasRenderingContext2D, table: TableLayout) {
    c.save();
    c.lineCap = "round";
    for (const d of table.decals) {
      c.strokeStyle = d.color;
      c.lineWidth = d.width;
      c.beginPath();
      c.moveTo(d.pts[0].x, d.pts[0].y);
      for (let i = 1; i < d.pts.length; i++) c.lineTo(d.pts[i].x, d.pts[i].y);
      c.stroke();
    }
    c.restore();
  }

  // ---- neon helpers -------------------------------------------------------
  private neonLine(c: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color: string, glowColor: string, width: number) {
    c.save();
    c.lineCap = "round";
    c.globalCompositeOperation = "lighter";
    c.strokeStyle = glowColor;
    c.shadowColor = glowColor;
    c.shadowBlur = 16;
    c.lineWidth = width + 6;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.stroke();
    c.restore();
    c.save();
    c.lineCap = "round";
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.stroke();
    c.restore();
  }

  private drawWalls(c: CanvasRenderingContext2D, table: TableLayout, _t: number) {
    for (const w of table.walls) {
      if (w.oneWay) continue; // gate drawn subtly below
      this.neonLine(c, w.ax, w.ay, w.bx, w.by, COLORS.wall, COLORS.wallGlow, w.thick);
    }
    // launch gate (dim dashed)
    for (const w of table.walls) {
      if (!w.oneWay) continue;
      c.save();
      c.strokeStyle = "rgba(76,240,255,0.35)";
      c.setLineDash([6, 6]);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(w.ax, w.ay);
      c.lineTo(w.bx, w.by);
      c.stroke();
      c.restore();
    }
  }

  private drawBumpers(c: CanvasRenderingContext2D, view: PinballView) {
    for (const b of view.table.bumpers) {
      const fl = view.flash.get(b.id) ?? 0;
      const pulse = 1 + Math.sin(view.t * 4 + b.x) * 0.04 + fl * 0.25;
      const r = b.r * pulse;
      c.save();
      c.globalCompositeOperation = "lighter";
      // outer glow
      const rg = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 1.6);
      rg.addColorStop(0, `rgba(52,245,255,${0.5 + fl * 0.4})`);
      rg.addColorStop(1, "rgba(52,245,255,0)");
      c.fillStyle = rg;
      c.beginPath();
      c.arc(b.x, b.y, r * 1.6, 0, Math.PI * 2);
      c.fill();
      c.restore();

      // rings
      c.save();
      c.strokeStyle = COLORS.bumper;
      c.shadowColor = COLORS.bumper;
      c.shadowBlur = 14;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(b.x, b.y, r, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 2;
      c.beginPath();
      c.arc(b.x, b.y, r * 0.66, 0, Math.PI * 2);
      c.stroke();
      c.restore();

      // core dot
      c.fillStyle = fl > 0.1 ? "#ffffff" : "#bff8ff";
      c.beginPath();
      c.arc(b.x, b.y, r * 0.32, 0, Math.PI * 2);
      c.fill();
    }
  }

  private drawSlings(c: CanvasRenderingContext2D, view: PinballView) {
    for (const s of view.table.slings) {
      const fl = view.flash.get(s.id) ?? 0;
      c.save();
      c.globalCompositeOperation = "lighter";
      c.fillStyle = `rgba(255,69,200,${0.18 + fl * 0.5})`;
      c.beginPath();
      c.moveTo(s.ax, s.ay);
      c.lineTo(s.bx, s.by);
      c.lineTo(s.cx, s.cy);
      c.closePath();
      c.fill();
      c.restore();
      this.neonLine(c, s.ax, s.ay, s.bx, s.by, fl > 0.1 ? "#ffffff" : COLORS.sling, COLORS.sling, 5);
    }
  }

  private drawDrops(c: CanvasRenderingContext2D, view: PinballView) {
    for (const d of view.table.drops) {
      const cx = (d.ax + d.bx) / 2;
      const cy = (d.ay + d.by) / 2;
      if (d.dropped) {
        c.save();
        c.fillStyle = "rgba(157,255,60,0.12)";
        c.fillRect(cx - 20, cy - 4, 40, 8);
        c.restore();
        continue;
      }
      const fl = view.flash.get(d.id) ?? 0;
      this.neonLine(c, d.ax, d.ay, d.bx, d.by, fl > 0.1 ? "#ffffff" : COLORS.drop, COLORS.drop, 9);
    }
  }

  private drawStandups(c: CanvasRenderingContext2D, view: PinballView) {
    for (const u of view.table.standups) {
      const fl = view.flash.get(u.id) ?? 0;
      this.neonLine(c, u.ax, u.ay, u.bx, u.by, fl > 0.1 ? "#ffffff" : COLORS.standup, COLORS.standup, 8);
    }
  }

  private drawLanes(c: CanvasRenderingContext2D, view: PinballView) {
    for (const ln of view.table.lanes) {
      c.save();
      const lit = ln.lit;
      if (lit) {
        c.globalCompositeOperation = "lighter";
        const rg = c.createRadialGradient(ln.x, ln.y, 0, ln.x, ln.y, ln.r * 2.2);
        rg.addColorStop(0, "rgba(138,123,255,0.7)");
        rg.addColorStop(1, "rgba(138,123,255,0)");
        c.fillStyle = rg;
        c.beginPath();
        c.arc(ln.x, ln.y, ln.r * 2.2, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      c.save();
      c.strokeStyle = lit ? "#d7d0ff" : "rgba(138,123,255,0.5)";
      c.lineWidth = 3;
      c.beginPath();
      c.arc(ln.x, ln.y, ln.r, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = lit ? "#ffffff" : COLORS.textDim;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `700 ${ln.r * 1.1}px system-ui, sans-serif`;
      c.fillText(ln.letter, ln.x, ln.y + 1);
      c.restore();
    }
  }

  private drawCore(c: CanvasRenderingContext2D, view: PinballView) {
    const core = view.table.core;
    const fl = view.flash.get("core") ?? 0;
    const lit = view.coreLit;
    c.save();
    c.globalCompositeOperation = "lighter";
    const pulse = lit ? 0.5 + Math.sin(view.t * 8) * 0.3 : 0.25;
    const rg = c.createRadialGradient(core.x, core.y, 0, core.x, core.y, core.r * 2.4);
    rg.addColorStop(0, `rgba(255,210,63,${pulse + fl * 0.4})`);
    rg.addColorStop(1, "rgba(255,210,63,0)");
    c.fillStyle = rg;
    c.beginPath();
    c.arc(core.x, core.y, core.r * 2.4, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.save();
    c.strokeStyle = lit ? "#fff3c4" : COLORS.core;
    c.shadowColor = COLORS.core;
    c.shadowBlur = 16;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(core.x, core.y, core.r, 0, Math.PI * 2);
    c.stroke();
    c.restore();

    // hit pips
    c.save();
    c.fillStyle = "#fff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `800 ${core.r * 0.8}px system-ui, sans-serif`;
    c.fillText(lit ? "MB" : String(view.coreHits), core.x, core.y + 1);
    c.restore();
  }

  private drawPlunger(c: CanvasRenderingContext2D, view: PinballView) {
    const p = view.table.plunger;
    const compress = view.plungerPower * 48;
    const topY = p.restY + 24;
    // shaft
    c.save();
    c.strokeStyle = "rgba(160,170,210,0.5)";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(p.laneCx, topY + compress);
    c.lineTo(p.laneCx, TABLE_H);
    c.stroke();
    // head
    c.fillStyle = view.plungerPower > 0.01 ? "#ff6a8a" : "#6a7bd6";
    c.shadowColor = view.plungerPower > 0.01 ? "#ff6a8a" : "#6a7bd6";
    c.shadowBlur = 10;
    c.fillRect(p.laneX0 + 1, topY + compress, p.laneX1 - p.laneX0 - 2, 18);
    c.restore();

    // power gauge along the lane
    if (view.ballWaiting && view.plungerPower > 0.01) {
      c.save();
      c.globalCompositeOperation = "lighter";
      const gh = (p.restY - p.topY) * view.plungerPower;
      const grd = c.createLinearGradient(0, p.restY, 0, p.restY - gh);
      grd.addColorStop(0, "rgba(157,255,60,0.5)");
      grd.addColorStop(1, "rgba(255,69,200,0.5)");
      c.fillStyle = grd;
      c.fillRect(p.laneX0 + 3, p.restY - gh, p.laneX1 - p.laneX0 - 6, gh);
      c.restore();
    }
  }

  private drawBalls(c: CanvasRenderingContext2D, view: PinballView) {
    for (const b of view.balls) {
      if (!b.alive) continue;
      // trail
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let i = b.trail.length - 1; i >= 0; i--) {
        const tp = b.trail[i];
        const f = 1 - i / b.trail.length;
        c.fillStyle = `rgba(180,225,255,${0.16 * f})`;
        c.beginPath();
        c.arc(tp.x, tp.y, BALL_R * (0.5 + 0.5 * f), 0, Math.PI * 2);
        c.fill();
      }
      c.restore();

      // ball body
      const g = c.createRadialGradient(b.pos.x - BALL_R * 0.35, b.pos.y - BALL_R * 0.4, BALL_R * 0.1, b.pos.x, b.pos.y, BALL_R);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.4, COLORS.ball);
      g.addColorStop(1, "#5f6f9a");
      c.fillStyle = g;
      c.shadowColor = "rgba(120,180,255,0.6)";
      c.shadowBlur = 12;
      c.beginPath();
      c.arc(b.pos.x, b.pos.y, BALL_R, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      // specular
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.beginPath();
      c.arc(b.pos.x - BALL_R * 0.34, b.pos.y - BALL_R * 0.4, BALL_R * 0.22, 0, Math.PI * 2);
      c.fill();
    }
  }

  private drawFlippers(c: CanvasRenderingContext2D, view: PinballView) {
    for (const f of view.flippers) {
      const p = f.spec.pivot;
      const tip = f.tip();
      const color = f.spec.id === "L" ? COLORS.flipperL : COLORS.flipperR;
      // glow capsule
      c.save();
      c.lineCap = "round";
      c.globalCompositeOperation = "lighter";
      c.strokeStyle = color;
      c.shadowColor = color;
      c.shadowBlur = 16;
      c.lineWidth = FLIPPER_R * 2 + 4;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(tip.x, tip.y);
      c.stroke();
      c.restore();
      // body
      c.save();
      c.lineCap = "round";
      c.strokeStyle = f.active ? "#ffffff" : color;
      c.lineWidth = FLIPPER_R * 2;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(tip.x, tip.y);
      c.stroke();
      // pivot hub
      c.fillStyle = "#1a1830";
      c.beginPath();
      c.arc(p.x, p.y, FLIPPER_R * 0.6, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  private drawParticles(c: CanvasRenderingContext2D, fx: Effects) {
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const p of fx.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      c.fillStyle = p.color;
      c.globalAlpha = a;
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  private drawPopups(c: CanvasRenderingContext2D, fx: Effects) {
    c.save();
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const s of fx.popups) {
      const a = Math.max(0, s.life / s.maxLife);
      c.globalAlpha = a;
      c.fillStyle = s.color;
      c.font = `800 26px system-ui, sans-serif`;
      c.fillText(s.text, s.x, s.y);
    }
    c.restore();
  }

  // ---- HUD (screen space) -------------------------------------------------
  private drawHud(c: CanvasRenderingContext2D, view: PinballView, tf: Transform) {
    const W = view.viewW;
    const pad = Math.max(10, W * 0.03);
    const top = Math.max(8, tf.oy * 0.5);
    c.save();
    c.textBaseline = "top";

    // score
    c.textAlign = "left";
    c.fillStyle = COLORS.text;
    c.font = `800 ${Math.round(W * 0.07)}px system-ui, sans-serif`;
    c.shadowColor = "rgba(76,240,255,0.6)";
    c.shadowBlur = 10;
    c.fillText(view.score.toLocaleString(), pad, top);
    c.shadowBlur = 0;
    c.fillStyle = COLORS.textDim;
    c.font = `700 ${Math.round(W * 0.032)}px system-ui, sans-serif`;
    c.fillText(`BEST ${Math.max(view.highScore, view.score).toLocaleString()}`, pad, top + W * 0.075);

    // balls + multiplier (right)
    c.textAlign = "right";
    let pips = "";
    for (let i = 0; i < START_BALLS; i++) pips += i < view.ballsRemaining ? "● " : "○ ";
    c.fillStyle = COLORS.text;
    c.font = `700 ${Math.round(W * 0.045)}px system-ui, sans-serif`;
    c.fillText(pips.trim(), W - pad, top);
    c.fillStyle = view.multiplier > 1 ? COLORS.drop : COLORS.textDim;
    c.font = `800 ${Math.round(W * 0.05)}px system-ui, sans-serif`;
    c.fillText(`×${view.multiplier}`, W - pad, top + W * 0.055);
    if (view.combo > 1) {
      c.fillStyle = COLORS.sling;
      c.font = `800 ${Math.round(W * 0.035)}px system-ui, sans-serif`;
      c.fillText(`COMBO ×${view.combo}`, W - pad, top + W * 0.11);
    }
    c.restore();

    // mode banner
    if (view.banner && view.bannerT > 0) {
      c.save();
      const a = Math.min(1, view.bannerT);
      c.globalAlpha = a;
      c.textAlign = "center";
      const bannerColor = view.multiball ? COLORS.jackpot : COLORS.core;
      c.fillStyle = bannerColor;
      c.shadowColor = bannerColor;
      c.shadowBlur = 18;
      c.font = `900 ${Math.round(W * 0.08)}px system-ui, sans-serif`;
      c.fillText(view.banner, W / 2, view.viewH * 0.12);
      c.restore();
    }
  }

  private drawOverlays(c: CanvasRenderingContext2D, view: PinballView, tf: Transform) {
    if (view.state === "playing" || view.state === "drain") return;
    const W = view.viewW;
    const H = view.viewH;
    c.save();
    c.fillStyle = "rgba(5,4,13,0.72)";
    c.fillRect(0, 0, W, H);
    c.textAlign = "center";

    if (view.state === "attract" || view.state === "ready") {
      // title
      c.fillStyle = COLORS.wall;
      c.shadowColor = COLORS.wall;
      c.shadowBlur = 24;
      c.font = `900 ${Math.round(W * 0.13)}px system-ui, sans-serif`;
      c.fillText("NEON", W / 2, H * 0.32);
      c.fillStyle = COLORS.sling;
      c.shadowColor = COLORS.sling;
      c.fillText("NEXUS", W / 2, H * 0.32 + W * 0.14);
      c.shadowBlur = 0;
      c.fillStyle = COLORS.textDim;
      c.font = `700 ${Math.round(W * 0.04)}px system-ui, sans-serif`;
      c.fillText("ORIGINAL PINBALL", W / 2, H * 0.32 + W * 0.26);

      c.fillStyle = COLORS.text;
      c.font = `800 ${Math.round(W * 0.05)}px system-ui, sans-serif`;
      const blink = 0.5 + 0.5 * Math.sin(view.t * 4);
      c.globalAlpha = 0.4 + 0.6 * blink;
      c.fillText("HOLD LAUNCH TO CHARGE", W / 2, H * 0.62);
      c.globalAlpha = 1;
      c.fillStyle = COLORS.textDim;
      c.font = `600 ${Math.round(W * 0.034)}px system-ui, sans-serif`;
      c.fillText("◀ / ▶ flip   •   tap screen halves   •   release to fire", W / 2, H * 0.62 + W * 0.07);
      c.fillStyle = COLORS.core;
      c.font = `700 ${Math.round(W * 0.04)}px system-ui, sans-serif`;
      c.fillText(`HIGH SCORE  ${view.highScore.toLocaleString()}`, W / 2, H * 0.72);
    } else if (view.state === "gameover") {
      c.fillStyle = COLORS.sling;
      c.shadowColor = COLORS.sling;
      c.shadowBlur = 20;
      c.font = `900 ${Math.round(W * 0.1)}px system-ui, sans-serif`;
      c.fillText("GAME OVER", W / 2, H * 0.34);
      c.shadowBlur = 0;
      c.fillStyle = COLORS.text;
      c.font = `800 ${Math.round(W * 0.07)}px system-ui, sans-serif`;
      c.fillText(view.score.toLocaleString(), W / 2, H * 0.47);
      c.fillStyle = COLORS.core;
      c.font = `700 ${Math.round(W * 0.04)}px system-ui, sans-serif`;
      const best = Math.max(view.highScore, view.score);
      const isNew = view.score >= view.highScore && view.score > 0;
      c.fillText(isNew ? "NEW HIGH SCORE!" : `BEST ${best.toLocaleString()}`, W / 2, H * 0.55);
      c.fillStyle = COLORS.textDim;
      c.font = `700 ${Math.round(W * 0.042)}px system-ui, sans-serif`;
      const blink = 0.5 + 0.5 * Math.sin(view.t * 4);
      c.globalAlpha = 0.4 + 0.6 * blink;
      c.fillText("TAP / LAUNCH TO PLAY AGAIN", W / 2, H * 0.66);
    }
    c.restore();
  }
}
