import { roundRect } from "@/engine";
import { TILE } from "./constants";
import type { Enemy } from "./enemies";
import type { Player } from "./player";
import type { Box, Palette, TileType, Viewport } from "./types";
import type { Coin, Mover, Pickup, World } from "./world";

type C = CanvasRenderingContext2D;

/** ---- Parallax background (drawn in screen space, before the camera) ---- */
export function drawBackground(
  c: C,
  W: number,
  H: number,
  pal: Palette,
  camX: number,
  camY: number,
  scale: number,
  t: number,
) {
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyBottom);
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);

  // sun / moon glow
  c.save();
  const gx = W * 0.78;
  const gy = H * 0.24;
  const glow = c.createRadialGradient(gx, gy, 0, gx, gy, H * 0.5);
  glow.addColorStop(0, hexA(pal.accent, 0.35));
  glow.addColorStop(1, hexA(pal.accent, 0));
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);
  c.fillStyle = hexA(pal.cloud, 0.9);
  c.beginPath();
  c.arc(gx, gy, H * 0.07, 0, Math.PI * 2);
  c.fill();
  c.restore();

  const baseY = H * 0.62;
  // far hills
  drawHills(c, W, H, baseY + H * 0.06, -camX * 0.15 * scale, pal.far, H * 0.18, 0.9, t * 4);
  // mid hills
  drawHills(c, W, H, baseY + H * 0.16, -camX * 0.3 * scale, pal.mid, H * 0.24, 1.3, t * 6 + 50);
  // near hills
  drawHills(c, W, H, baseY + H * 0.3, -camX * 0.5 * scale, pal.near, H * 0.34, 1.7, t * 9 + 120);

  // ambient flecks
  drawAmbient(c, W, H, pal, camX, camY, scale, t);
}

function drawHills(
  c: C, W: number, H: number, baseY: number, offset: number,
  color: string, amp: number, freq: number, seedShift: number,
) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, H);
  const span = W + 200;
  const step = 24;
  for (let x = -100; x <= span; x += step) {
    const wx = x - (offset % 400);
    const yy = baseY - (Math.sin((x + seedShift) * 0.004 * freq) * 0.5 + 0.5) * amp
      - Math.sin((x + seedShift) * 0.013 * freq) * amp * 0.25;
    if (x === -100) c.moveTo(wx, yy);
    else c.lineTo(wx, yy);
  }
  c.lineTo(W + 100, H);
  c.lineTo(-100, H);
  c.closePath();
  c.fill();
}

function drawAmbient(
  c: C, W: number, H: number, pal: Palette,
  camX: number, camY: number, scale: number, t: number,
) {
  if (pal.ambient === "clouds") {
    c.fillStyle = hexA(pal.cloud, 0.75);
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 260 - camX * 0.22 * scale - t * 14) % (W + 260) + W + 260) % (W + 260) - 130;
      const cy = H * (0.12 + (i % 3) * 0.09);
      cloud(c, cx, cy, H * 0.05);
    }
  } else if (pal.ambient === "spores") {
    c.fillStyle = hexA(pal.cloud, 0.6);
    for (let i = 0; i < 40; i++) {
      const cx = ((i * 97 - camX * 0.4 * scale) % (W + 40) + W + 40) % (W + 40) - 20;
      const cy = (H * 0.9 - ((t * 16 + i * 53) % (H * 0.9)));
      c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + i);
      c.beginPath();
      c.arc(cx, cy, 2 + (i % 3), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  } else {
    // embers rising
    for (let i = 0; i < 50; i++) {
      const cx = ((i * 83 - camX * 0.45 * scale) % (W + 40) + W + 40) % (W + 40) - 20;
      const cy = (H - ((t * 40 + i * 71) % (H + 40)));
      c.globalAlpha = 0.4 + 0.6 * Math.sin(t * 3 + i);
      c.fillStyle = i % 2 ? pal.accent : pal.cloud;
      c.beginPath();
      c.arc(cx, cy, 1.5 + (i % 3), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }
}

function cloud(c: C, x: number, y: number, r: number) {
  c.beginPath();
  c.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2);
  c.ellipse(x - r * 1.3, y + r * 0.2, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
  c.ellipse(x + r * 1.3, y + r * 0.2, r * 1.4, r * 0.9, 0, 0, Math.PI * 2);
  c.fill();
}

/** ---- Tiles (world space) ---- */
export function drawTiles(c: C, world: World, vp: Viewport, t: number) {
  const pal = world.palette;
  const c0 = Math.max(0, Math.floor(vp.x / TILE) - 1);
  const c1 = Math.min(world.cols - 1, Math.floor((vp.x + vp.w) / TILE) + 1);
  const r0 = Math.max(0, Math.floor(vp.y / TILE) - 1);
  const r1 = Math.min(world.rows - 1, Math.floor((vp.y + vp.h) / TILE) + 1);

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const type = world.tiles[row][col];
      if (type === "empty" || type === "checkpoint" || type === "goal") continue;
      drawTile(c, type, col, row, pal, t, world);
    }
  }
}

function drawTile(c: C, type: TileType, col: number, row: number, pal: Palette, t: number, world: World) {
  const x = col * TILE;
  const y = row * TILE;
  switch (type) {
    case "ground": {
      const grassTop = world.typeAt(col, row - 1) === "ground" || world.typeAt(col, row - 1) === "dirt";
      c.fillStyle = pal.groundFace;
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = pal.groundShade;
      c.fillRect(x, y + TILE - 5, TILE, 5);
      if (!grassTop) {
        c.fillStyle = pal.groundTop;
        c.fillRect(x, y, TILE, 9);
        c.fillStyle = hexA("#ffffff", 0.12);
        c.fillRect(x, y, TILE, 3);
        // little grass blades
        c.fillStyle = pal.groundTop;
        for (let i = 0; i < 3; i++) {
          const bx = x + 4 + i * 10;
          c.beginPath();
          c.moveTo(bx, y);
          c.lineTo(bx + 3, y - 5);
          c.lineTo(bx + 6, y);
          c.fill();
        }
      }
      c.strokeStyle = hexA("#000000", 0.08);
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      break;
    }
    case "dirt": {
      c.fillStyle = pal.dirt;
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = hexA("#000000", 0.12);
      for (let i = 0; i < 4; i++) {
        const dx = x + ((col * 7 + i * 11) % TILE);
        const dy = y + ((row * 5 + i * 13) % TILE);
        c.fillRect(dx, dy, 3, 3);
      }
      break;
    }
    case "brick": {
      c.fillStyle = pal.brick;
      c.fillRect(x, y, TILE, TILE);
      c.strokeStyle = pal.brickMortar;
      c.lineWidth = 2;
      c.strokeRect(x + 1, y + 1, TILE - 2, TILE / 2 - 1);
      c.strokeRect(x + 1, y + TILE / 2, TILE - 2, TILE / 2 - 1);
      c.beginPath();
      c.moveTo(x + TILE / 2, y + 1);
      c.lineTo(x + TILE / 2, y + TILE / 2);
      c.moveTo(x + TILE / 4, y + TILE / 2);
      c.lineTo(x + TILE / 4, y + TILE - 1);
      c.moveTo(x + (TILE * 3) / 4, y + TILE / 2);
      c.lineTo(x + (TILE * 3) / 4, y + TILE - 1);
      c.stroke();
      break;
    }
    case "question": {
      const spent = world.isQuestionSpent(col, row);
      const bob = spent ? 0 : Math.sin(t * 4 + col) * 1.5;
      c.fillStyle = spent ? "#6b6b6b" : pal.accent;
      roundRect(c, x + 2, y + 2 + bob, TILE - 4, TILE - 4, 5);
      c.fill();
      if (!spent) {
        c.fillStyle = hexA("#ffffff", 0.25);
        roundRect(c, x + 4, y + 4 + bob, TILE - 8, 6, 3);
        c.fill();
        c.fillStyle = "#7a4d00";
        c.font = `700 ${TILE * 0.6}px system-ui, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("?", x + TILE / 2, y + TILE / 2 + bob + 1);
      }
      c.strokeStyle = hexA("#000000", 0.2);
      c.lineWidth = 2;
      roundRect(c, x + 2, y + 2 + bob, TILE - 4, TILE - 4, 5);
      c.stroke();
      break;
    }
    case "oneway": {
      c.fillStyle = pal.groundTop;
      roundRect(c, x, y, TILE, TILE * 0.4, 4);
      c.fill();
      c.fillStyle = hexA("#000000", 0.18);
      c.fillRect(x, y + TILE * 0.34, TILE, 3);
      c.fillStyle = hexA("#ffffff", 0.2);
      c.fillRect(x + 2, y + 2, TILE - 4, 3);
      break;
    }
    case "spike": {
      c.fillStyle = "#c9d2da";
      const n = 3;
      for (let i = 0; i < n; i++) {
        const sx = x + (i * TILE) / n;
        c.beginPath();
        c.moveTo(sx, y + TILE);
        c.lineTo(sx + TILE / n / 2, y + TILE * 0.25);
        c.lineTo(sx + TILE / n, y + TILE);
        c.closePath();
        c.fill();
      }
      c.fillStyle = "#7e8a96";
      c.fillRect(x, y + TILE - 4, TILE, 4);
      break;
    }
    case "lava": {
      const surfTop = world.typeAt(col, row - 1) !== "lava";
      c.fillStyle = "#cf3a14";
      c.fillRect(x, y, TILE, TILE);
      const grad = c.createLinearGradient(0, y, 0, y + TILE);
      grad.addColorStop(0, "#ff8a2a");
      grad.addColorStop(1, "#b3260a");
      c.fillStyle = grad;
      c.fillRect(x, y + 3, TILE, TILE - 3);
      if (surfTop) {
        c.fillStyle = "#ffd089";
        c.beginPath();
        c.moveTo(x, y + 4);
        for (let i = 0; i <= TILE; i += 4) {
          c.lineTo(x + i, y + 4 + Math.sin((x + i) * 0.3 + t * 6) * 2.5);
        }
        c.lineTo(x + TILE, y + 9);
        c.lineTo(x, y + 9);
        c.closePath();
        c.fill();
      }
      break;
    }
    default:
      break;
  }
}

/** ---- Checkpoints & goal (world space) ---- */
export function drawCheckpoints(c: C, world: World, t: number) {
  for (const cp of world.checkpoints) {
    const px = cp.x;
    const baseY = cp.y + TILE;
    c.strokeStyle = "#cfcfcf";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(px, baseY);
    c.lineTo(px, cp.y - TILE * 1.4);
    c.stroke();
    c.fillStyle = "#9a9a9a";
    c.beginPath();
    c.arc(px, cp.y - TILE * 1.4, 4, 0, Math.PI * 2);
    c.fill();
    const wave = cp.active ? Math.sin(t * 6) * 4 : 0;
    c.fillStyle = cp.active ? world.palette.accent : "#9aa4af";
    c.beginPath();
    c.moveTo(px, cp.y - TILE * 1.4);
    c.lineTo(px + TILE * 0.9 + wave, cp.y - TILE * 1.1);
    c.lineTo(px, cp.y - TILE * 0.8);
    c.closePath();
    c.fill();
  }
}

export function drawGoal(c: C, world: World, t: number) {
  const g = world.goal;
  const px = g.x + g.w / 2;
  const topY = g.y;
  const baseY = g.y + g.h;
  // pole
  c.strokeStyle = "#e8e8e8";
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(px, baseY);
  c.lineTo(px, topY - TILE);
  c.stroke();
  // glowing bloom on top
  const pal = world.palette;
  const r = TILE * (0.7 + Math.sin(t * 3) * 0.06);
  const grad = c.createRadialGradient(px, topY - TILE, 0, px, topY - TILE, r * 2);
  grad.addColorStop(0, hexA(pal.accent, 0.9));
  grad.addColorStop(1, hexA(pal.accent, 0));
  c.fillStyle = grad;
  c.beginPath();
  c.arc(px, topY - TILE, r * 2, 0, Math.PI * 2);
  c.fill();
  // petals
  c.fillStyle = pal.accent;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + t * 0.8;
    c.beginPath();
    c.ellipse(px + Math.cos(a) * r * 0.6, (topY - TILE) + Math.sin(a) * r * 0.6,
      r * 0.5, r * 0.28, a, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = "#fff7d6";
  c.beginPath();
  c.arc(px, topY - TILE, r * 0.4, 0, Math.PI * 2);
  c.fill();
  // banner
  const wave = Math.sin(t * 5) * 4;
  c.fillStyle = hexA(pal.accent, 0.85);
  c.beginPath();
  c.moveTo(px, topY);
  c.lineTo(px + TILE * 1.2 + wave, topY + TILE * 0.3);
  c.lineTo(px, topY + TILE * 0.7);
  c.closePath();
  c.fill();
}

/** ---- Coins ---- */
export function drawCoins(c: C, coins: Coin[], pal: Palette, t: number) {
  for (const coin of coins) {
    if (coin.collected) continue;
    const wob = Math.cos(t * 5 + coin.phase);
    const w = Math.abs(wob) * 9 + 2;
    c.save();
    c.translate(coin.x, coin.y + Math.sin(t * 3 + coin.phase) * 2);
    c.fillStyle = "#ffcf33";
    c.beginPath();
    c.ellipse(0, 0, w, 11, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#e0a90f";
    c.lineWidth = 2;
    c.stroke();
    if (w > 5) {
      c.fillStyle = hexA("#fff3b0", 0.9);
      c.fillRect(-1.5, -6, 3, 12);
    }
    c.restore();
  }
}

/** ---- Pickups ---- */
export function drawPickups(c: C, pickups: Pickup[], t: number) {
  for (const p of pickups) {
    if (!p.active) continue;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    if (p.kind === "mushroom") {
      c.fillStyle = "#f6e7c8";
      roundRect(c, p.x + p.w * 0.2, cy, p.w * 0.6, p.h * 0.5, 3);
      c.fill();
      c.fillStyle = "#e23b3b";
      c.beginPath();
      c.arc(cx, cy + 2, p.w * 0.5, Math.PI, 0);
      c.fill();
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(cx - 5, cy - 2, 3, 0, Math.PI * 2);
      c.arc(cx + 6, cy + 1, 2.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#3a2a1a";
      c.beginPath();
      c.arc(cx - 3, cy + 8, 1.6, 0, Math.PI * 2);
      c.arc(cx + 4, cy + 8, 1.6, 0, Math.PI * 2);
      c.fill();
    } else if (p.kind === "star") {
      const hue = (t * 240) % 360;
      c.save();
      c.translate(cx, cy);
      c.rotate(t * 3);
      c.fillStyle = `hsl(${hue},90%,60%)`;
      starPath(c, p.w * 0.6, p.w * 0.26);
      c.fill();
      c.strokeStyle = "#fff";
      c.lineWidth = 1.5;
      c.stroke();
      c.restore();
    } else {
      c.fillStyle = "#46e0a0";
      roundRect(c, p.x, p.y, p.w, p.h, 5);
      c.fill();
      c.fillStyle = "#063";
      c.font = `700 ${p.h * 0.7}px system-ui`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("1↑", cx, cy);
    }
  }
}

function starPath(c: C, outer: number, inner: number) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

/** ---- Moving platforms ---- */
export function drawMovers(c: C, movers: Mover[], pal: Palette) {
  for (const m of movers) {
    c.fillStyle = pal.brick;
    roundRect(c, m.x, m.y, m.w, m.h, 6);
    c.fill();
    c.fillStyle = pal.accent;
    c.fillRect(m.x + 3, m.y + 3, m.w - 6, 4);
    c.fillStyle = hexA("#000", 0.25);
    for (let i = 0; i < m.w; i += 14) {
      c.beginPath();
      c.arc(m.x + 8 + i, m.y + m.h - 6, 2, 0, Math.PI * 2);
      c.fill();
    }
  }
}

/** ---- Enemies ---- */
export function drawEnemy(c: C, e: Enemy, pal: Palette) {
  const cx = e.x + e.w / 2;
  if (e.state === "dead") {
    c.save();
    c.globalAlpha = Math.max(0, 1 - e.deadT / 1.4);
    c.translate(cx, e.y + e.h / 2);
    c.scale(1, -1);
    drawEnemyBody(c, e, pal, 0, 0);
    c.restore();
    return;
  }
  if (e.kind === "snapper" && (e.state === "shell" || e.state === "shellmove")) {
    drawShell(c, e, pal);
    return;
  }
  drawEnemyBody(c, e, pal, e.x, e.y);
}

function drawEnemyBody(c: C, e: Enemy, pal: Palette, ox: number, oy: number) {
  const cx = ox + e.w / 2;
  const cy = oy + e.h / 2;
  if (e.kind === "grumbug") {
    const legSwing = Math.sin(e.animT * 12) * 3;
    c.fillStyle = "#5a3b8c";
    c.fillRect(cx - 8 - legSwing, oy + e.h - 4, 4, 5);
    c.fillRect(cx + 4 + legSwing, oy + e.h - 4, 4, 5);
    c.fillStyle = "#7a52b8";
    c.beginPath();
    c.ellipse(cx, cy, e.w * 0.5, e.h * 0.46, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#4a2f78";
    c.beginPath();
    c.ellipse(cx, oy + e.h * 0.34, e.w * 0.5, e.h * 0.22, 0, 0, Math.PI * 2);
    c.fill();
    eyes(c, cx, oy + e.h * 0.42, e.dir, 4);
    // angry brow
    c.strokeStyle = "#2a1a44";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - 7, oy + e.h * 0.3);
    c.lineTo(cx - 2, oy + e.h * 0.36);
    c.moveTo(cx + 7, oy + e.h * 0.3);
    c.lineTo(cx + 2, oy + e.h * 0.36);
    c.stroke();
  } else if (e.kind === "flutter") {
    const flap = Math.sin(e.animT * 16) * 0.5 + 0.5;
    c.fillStyle = hexA("#fff", 0.85);
    c.save();
    c.translate(cx, cy);
    c.rotate(-0.5 - flap * 0.5);
    c.beginPath();
    c.ellipse(-e.w * 0.4, 0, e.w * 0.5, e.h * 0.3, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.save();
    c.translate(cx, cy);
    c.rotate(0.5 + flap * 0.5);
    c.beginPath();
    c.ellipse(e.w * 0.4, 0, e.w * 0.5, e.h * 0.3, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.fillStyle = "#d98a3a";
    c.beginPath();
    c.ellipse(cx, cy, e.w * 0.34, e.h * 0.46, 0, 0, Math.PI * 2);
    c.fill();
    eyes(c, cx, cy - 2, e.dir, 3);
  } else {
    // snapper (walking)
    const legSwing = Math.sin(e.animT * 10) * 3;
    c.fillStyle = "#e8c06a";
    c.fillRect(cx - 9 - legSwing, oy + e.h - 5, 5, 6);
    c.fillRect(cx + 4 + legSwing, oy + e.h - 5, 5, 6);
    c.fillStyle = "#2f9e6b";
    c.beginPath();
    c.ellipse(cx, cy + 2, e.w * 0.5, e.h * 0.5, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#247a52";
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.arc(cx + i * 8, cy, 4, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#f6e0a8";
    c.beginPath();
    c.arc(cx + e.dir * e.w * 0.4, oy + e.h * 0.3, 6, 0, Math.PI * 2);
    c.fill();
    eyes(c, cx + e.dir * e.w * 0.4, oy + e.h * 0.28, e.dir, 3);
    void pal;
  }
}

function drawShell(c: C, e: Enemy, pal: Palette) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const spin = e.state === "shellmove" ? e.animT * 14 : 0;
  c.save();
  c.translate(cx, cy);
  c.rotate(spin);
  c.fillStyle = "#2f9e6b";
  c.beginPath();
  c.ellipse(0, 0, e.w * 0.5, e.h * 0.7, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#1c6b46";
  c.beginPath();
  c.ellipse(0, 0, e.w * 0.32, e.h * 0.46, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#f6e0a8";
  c.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(Math.cos(a) * e.w * 0.45, Math.sin(a) * e.h * 0.6);
    c.stroke();
  }
  c.restore();
  void pal;
}

function eyes(c: C, x: number, y: number, dir: number, r: number) {
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(x - 5, y, r, 0, Math.PI * 2);
  c.arc(x + 5, y, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#1a1a1a";
  c.beginPath();
  c.arc(x - 5 + dir * 1.5, y, r * 0.5, 0, Math.PI * 2);
  c.arc(x + 5 + dir * 1.5, y, r * 0.5, 0, Math.PI * 2);
  c.fill();
}

/** ---- Player (Pip) ---- */
export function drawPlayer(c: C, p: Player, t: number) {
  // flicker during i-frames
  if (p.invuln > 0 && Math.floor(t * 20) % 2 === 0) return;

  const cx = p.x + p.w / 2;
  const bottom = p.y + p.h;
  const sq = p.squash;
  const bodyW = p.w * (2 - sq) * 0.6 + p.w * 0.4;
  const bodyH = p.h * sq;
  const top = bottom - bodyH;
  const cyBody = top + bodyH * 0.55;

  const star = p.power === "star";
  let bodyColor = "#4fb0e8";
  let bellyColor = "#bfe7ff";
  if (p.size === "big") bodyColor = "#3a9be0";
  if (star) {
    const hue = (t * 360) % 360;
    bodyColor = `hsl(${hue},85%,60%)`;
    bellyColor = `hsl(${(hue + 40) % 360},90%,80%)`;
  }

  c.save();

  // shadow
  c.fillStyle = "rgba(0,0,0,0.18)";
  c.beginPath();
  c.ellipse(cx, bottom + 1, bodyW * 0.6, 4, 0, 0, Math.PI * 2);
  c.fill();

  // limbs
  const swing = Math.sin(p.runPhase) * (p.anim === "run" ? 6 : 0);
  const legY = bottom - 2;
  c.strokeStyle = bodyColor;
  c.lineWidth = 5;
  c.lineCap = "round";
  if (p.anim === "jump" || p.anim === "fall") {
    // tucked
    c.beginPath();
    c.moveTo(cx - 5, bottom - 6);
    c.lineTo(cx - 7, bottom - (p.anim === "jump" ? 1 : 2));
    c.moveTo(cx + 5, bottom - 6);
    c.lineTo(cx + 7, bottom - (p.anim === "jump" ? 1 : 2));
    c.stroke();
  } else {
    c.beginPath();
    c.moveTo(cx - 4, bottom - 8);
    c.lineTo(cx - 4 - swing, legY);
    c.moveTo(cx + 4, bottom - 8);
    c.lineTo(cx + 4 + swing, legY);
    c.stroke();
  }

  // arms
  c.lineWidth = 4;
  const armSwing = Math.sin(p.runPhase + Math.PI) * (p.anim === "run" ? 6 : 0);
  c.beginPath();
  if (p.anim === "jump") {
    c.moveTo(cx - bodyW * 0.4, cyBody);
    c.lineTo(cx - bodyW * 0.55, cyBody - 8);
    c.moveTo(cx + bodyW * 0.4, cyBody);
    c.lineTo(cx + bodyW * 0.55, cyBody - 8);
  } else {
    c.moveTo(cx - bodyW * 0.4, cyBody);
    c.lineTo(cx - bodyW * 0.5, cyBody + 6 + armSwing);
    c.moveTo(cx + bodyW * 0.4, cyBody);
    c.lineTo(cx + bodyW * 0.5, cyBody + 6 - armSwing);
  }
  c.stroke();

  // body
  c.fillStyle = bodyColor;
  roundRect(c, cx - bodyW / 2, top, bodyW, bodyH, bodyW * 0.45);
  c.fill();
  // belly
  c.fillStyle = bellyColor;
  c.beginPath();
  c.ellipse(cx, cyBody + bodyH * 0.12, bodyW * 0.3, bodyH * 0.28, 0, 0, Math.PI * 2);
  c.fill();

  // leaf sprout
  c.fillStyle = star ? "#fff" : "#5fce67";
  c.save();
  c.translate(cx, top);
  c.rotate(Math.sin(t * 4) * 0.1 - 0.2);
  c.beginPath();
  c.ellipse(2, -6, 7, 4, 0.6, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // eyes
  const eyeY = top + bodyH * 0.34;
  const look = p.facing * 1.6;
  const blink = p.blinkT < 0.12;
  c.fillStyle = "#fff";
  c.beginPath();
  c.ellipse(cx - 4, eyeY, 4, blink ? 1 : 5, 0, 0, Math.PI * 2);
  c.ellipse(cx + 6, eyeY, 4, blink ? 1 : 5, 0, 0, Math.PI * 2);
  c.fill();
  if (!blink) {
    c.fillStyle = "#16203a";
    c.beginPath();
    c.arc(cx - 4 + look, eyeY + 1, 2, 0, Math.PI * 2);
    c.arc(cx + 6 + look, eyeY + 1, 2, 0, Math.PI * 2);
    c.fill();
  }
  // cheeks
  c.fillStyle = "rgba(255,120,140,0.5)";
  c.beginPath();
  c.arc(cx - 8, eyeY + 6, 2.5, 0, Math.PI * 2);
  c.arc(cx + 9, eyeY + 6, 2.5, 0, Math.PI * 2);
  c.fill();

  // star sparkle outline
  if (star) {
    c.strokeStyle = hexA("#ffffff", 0.6 + Math.sin(t * 20) * 0.4);
    c.lineWidth = 2;
    roundRect(c, cx - bodyW / 2 - 2, top - 2, bodyW + 4, bodyH + 4, bodyW * 0.45);
    c.stroke();
  }

  c.restore();
}

/** ---- color helper ---- */
export function hexA(hex: string, a: number): string {
  if (hex.startsWith("hsl")) {
    return hex.replace("hsl", "hsla").replace(")", `,${a})`);
  }
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Convenience for drawing an outlined filled rounded box (used by HUD). */
export function panel(c: C, b: Box, fill: string, stroke?: string, r = 10) {
  roundRect(c, b.x, b.y, b.w, b.h, r);
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = 2;
    c.stroke();
  }
}
