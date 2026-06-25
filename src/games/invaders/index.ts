import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText } from "@/engine";

const COLS = 11;
const ROWS = 5;
const BUNKERS = 4;
const BUNKER_COLS = 6;
const BUNKER_ROWS = 4;

interface Alien {
  col: number;
  row: number;
  alive: boolean;
  type: 0 | 1 | 2;
}

interface Bullet {
  x: number;
  y: number;
}

interface Bomb {
  x: number;
  y: number;
  kind: number;
}

interface Bunker {
  cells: boolean[][];
}

interface Mystery {
  x: number;
  dir: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  let score = 0;
  let lives = 3;
  let wave = 1;
  let dead = false;
  let respawnT = 0;

  let aliens: Alien[] = [];
  let gx = 0;
  let gy = 0;
  let dir = 1;
  let stepClock = 0;
  let animFrame = 0;

  let playerX = 0;
  let bullets: Bullet[] = [];
  let bombs: Bomb[] = [];
  let bunkers: Bunker[] = [];
  let mystery: Mystery | null = null;
  let mysteryTimer = 0;
  let particles: Particle[] = [];

  let fireCd = 0;
  let bombTimer = 0;
  let shakeT = 0;
  let shakeMag = 0;
  let t = 0;
  let lastPointerX = -1;

  // ---- size-relative layout (read every frame) ----
  const cellW = () => ctx.width * 0.072;
  const cellH = () => ctx.height * 0.058;
  const alienW = () => cellW() * 0.66;
  const alienH = () => cellH() * 0.56;
  const playerY = () => ctx.height * 0.9;
  const playerW = () => ctx.width * 0.09;
  const playerH = () => ctx.height * 0.03;
  const bunkerY = () => ctx.height * 0.74;
  const blockSize = () => ctx.width * 0.022;
  const marginX = () => ctx.width * 0.05;

  const alienPos = (a: Alien) => ({
    x: gx + a.col * cellW(),
    y: gy + a.row * cellH(),
  });

  const buildWave = () => {
    aliens = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const type: 0 | 1 | 2 = row === 0 ? 0 : row < 3 ? 1 : 2;
        aliens.push({ col, row, alive: true, type });
      }
    }
    gx = marginX();
    gy = ctx.height * (0.12 + Math.min(wave - 1, 5) * 0.03);
    dir = 1;
    bombs = [];
    bullets = [];
  };

  // Bunker x is derived from the current width every frame so resizing keeps
  // the existing erosion state instead of healing the bunkers.
  const bunkerX = (i: number) => {
    const bs = blockSize();
    const bunkerW = BUNKER_COLS * bs;
    const spacing = (ctx.width - BUNKERS * bunkerW) / (BUNKERS + 1);
    return spacing + i * (bunkerW + spacing);
  };

  const buildBunkers = () => {
    bunkers = [];
    for (let i = 0; i < BUNKERS; i++) {
      const cells: boolean[][] = [];
      for (let r = 0; r < BUNKER_ROWS; r++) {
        const rowArr: boolean[] = [];
        for (let cc = 0; cc < BUNKER_COLS; cc++) {
          // carve an arch in the bottom-middle
          const arch = r >= BUNKER_ROWS - 2 && cc >= 2 && cc <= 3;
          rowArr.push(!arch);
        }
        cells.push(rowArr);
      }
      bunkers.push({ cells });
    }
  };

  playerX = ctx.width / 2;
  buildWave();
  buildBunkers();
  mysteryTimer = 12 + Math.random() * 10;

  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "Space", label: "FIRE", id: "fire" },
  ]);
  ctx.setStatus("◀ ▶ / drag move · Space fire");

  const aliveCount = () => aliens.reduce((n, a) => (a.alive ? n + 1 : n), 0);

  const shake = (m: number) => {
    shakeMag = Math.max(shakeMag, m);
    shakeT = Math.max(shakeT, 0.25);
  };

  const burst = (x: number, y: number, color: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * ctx.height * 0.4;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.3 + Math.random() * 0.4,
        color,
      });
    }
  };

  const fire = () => {
    if (fireCd > 0 || dead || respawnT > 0) return;
    if (bullets.length >= 2) return;
    fireCd = 0.32;
    bullets.push({ x: playerX, y: playerY() - playerH() });
    audio.tone(880, 0.05, "square", 0.25);
  };

  const dropBomb = () => {
    const alive = aliens.filter((a) => a.alive);
    if (alive.length === 0) return;
    // prefer the lowest alien in a random column
    const shooter = alive[Math.floor(Math.random() * alive.length)];
    let lowest = shooter;
    for (const a of alive) {
      if (a.col === shooter.col && a.row > lowest.row) lowest = a;
    }
    const p = alienPos(lowest);
    bombs.push({ x: p.x + alienW() / 2, y: p.y + alienH(), kind: Math.floor(Math.random() * 2) });
  };

  const damageBunkers = (x: number, y: number): boolean => {
    const bs = blockSize();
    const by = bunkerY();
    for (let i = 0; i < bunkers.length; i++) {
      const bk = bunkers[i];
      const bx = bunkerX(i);
      if (x < bx || x > bx + BUNKER_COLS * bs) continue;
      const cc = Math.floor((x - bx) / bs);
      const rr = Math.floor((y - by) / bs);
      if (rr < 0 || rr >= BUNKER_ROWS || cc < 0 || cc >= BUNKER_COLS) continue;
      if (bk.cells[rr][cc]) {
        bk.cells[rr][cc] = false;
        // chip a neighbour for nicer erosion
        const nr = rr + (Math.random() < 0.5 ? 1 : -1);
        if (nr >= 0 && nr < BUNKER_ROWS && bk.cells[nr][cc]) bk.cells[nr][cc] = false;
        burst(x, y, "#46e0a0", 6);
        return true;
      }
    }
    return false;
  };

  const loseLife = () => {
    if (dead) return;
    lives--;
    burst(playerX, playerY(), "#67e8ff", 26);
    shake(10);
    audio.explosion();
    if (lives <= 0) {
      dead = true;
      setTimeout(() => ctx.gameOver(score), 700);
      return;
    }
    respawnT = 1.5;
    bombs = [];
    playerX = ctx.width / 2;
  };

  const nextWave = () => {
    wave++;
    audio.win();
    buildWave();
    buildBunkers();
  };

  return {
    update(dt) {
      t += dt;
      const W = ctx.width;
      const H = ctx.height;
      if (shakeT > 0) shakeT -= dt;
      if (fireCd > 0) fireCd -= dt;

      stepParticles(dt);

      if (dead) return;
      if (respawnT > 0) {
        respawnT -= dt;
      }

      // player movement
      const pSpeed = W * 0.9;
      const half = playerW() / 2;
      if (respawnT <= 0) {
        const left = input.isDown("ArrowLeft", "a");
        const right = input.isDown("ArrowRight", "d");
        if (left || right) {
          playerX += ((right ? 1 : 0) - (left ? 1 : 0)) * pSpeed * dt;
        } else if (input.pointer.down && input.pointer.x !== lastPointerX) {
          playerX = input.pointer.x;
        }
        lastPointerX = input.pointer.x;
        playerX = clamp(playerX, half, W - half);

        if (input.pressed("Space") || input.pointer.justDown) fire();
        if (input.isDown("Space")) fire();
      }

      // alien march (stepped for that classic feel, scales with kills)
      const alive = aliveCount();
      const total = COLS * ROWS;
      // Classic speed-up: a full swarm marches slowly; the fewer aliens remain,
      // the faster it gets. (Previously inverted, so it slowed down on kills.)
      const speedF = 0.1 + (alive / total) * 0.48 - wave * 0.03;
      const stepEvery = clamp(speedF, 0.05, 0.6);
      stepClock += dt;
      while (stepClock >= stepEvery) {
        stepClock -= stepEvery;
        animFrame ^= 1;
        // find horizontal extents of alive aliens
        let minC = COLS;
        let maxC = -1;
        for (const a of aliens) {
          if (!a.alive) continue;
          if (a.col < minC) minC = a.col;
          if (a.col > maxC) maxC = a.col;
        }
        if (maxC < 0) break;
        const stepX = cellW() * 0.18;
        const leftEdge = gx + minC * cellW();
        const rightEdge = gx + maxC * cellW() + alienW();
        if ((dir > 0 && rightEdge + stepX > W - marginX() * 0.4) || (dir < 0 && leftEdge - stepX < marginX() * 0.4)) {
          dir *= -1;
          gy += cellH() * 0.55;
          audio.tone(140, 0.05, "square", 0.2);
        } else {
          gx += dir * stepX;
          audio.tone(animFrame ? 150 : 120, 0.03, "square", 0.12);
        }
      }

      // aliens reaching player / bottom
      for (const a of aliens) {
        if (!a.alive) continue;
        const p = alienPos(a);
        if (p.y + alienH() >= playerY()) {
          loseLife();
          if (!dead) {
            // push the swarm back up a touch so it isn't instant repeat
            gy -= cellH();
          }
          break;
        }
      }

      // bombs
      bombTimer -= dt;
      const bombRate = clamp(0.9 - wave * 0.08, 0.3, 1.1);
      if (bombTimer <= 0) {
        bombTimer = bombRate + Math.random() * 0.6;
        if (Math.random() < 0.85) dropBomb();
      }
      for (const b of bombs) {
        b.y += H * 0.5 * dt;
        if (damageBunkers(b.x, b.y)) {
          b.y = H + 999;
          continue;
        }
        if (
          respawnT <= 0 &&
          b.y > playerY() - playerH() &&
          b.x > playerX - half &&
          b.x < playerX + half
        ) {
          b.y = H + 999;
          loseLife();
        }
      }
      bombs = bombs.filter((b) => b.y < H + 20);

      // player bullets
      for (const bl of bullets) {
        bl.y -= H * 1.3 * dt;
        // bunkers
        if (damageBunkers(bl.x, bl.y)) {
          bl.y = -999;
          continue;
        }
        // aliens
        for (const a of aliens) {
          if (!a.alive) continue;
          const p = alienPos(a);
          if (bl.x > p.x && bl.x < p.x + alienW() && bl.y > p.y && bl.y < p.y + alienH()) {
            a.alive = false;
            bl.y = -999;
            score += a.type === 0 ? 30 : a.type === 1 ? 20 : 10;
            ctx.reportScore(score);
            burst(p.x + alienW() / 2, p.y + alienH() / 2, alienColor(a.type), 12);
            shake(3);
            audio.tone(420, 0.05, "square", 0.3);
            if (aliveCount() === 0) nextWave();
            break;
          }
        }
        // mystery
        if (mystery && bl.y > -10) {
          const my = ctx.height * 0.06;
          const mw = ctx.width * 0.07;
          if (bl.x > mystery.x - mw / 2 && bl.x < mystery.x + mw / 2 && bl.y < my + ctx.height * 0.03) {
            bl.y = -999;
            score += 150;
            ctx.reportScore(score);
            burst(mystery.x, my, "#ff5c8a", 18);
            shake(5);
            audio.coin();
            mystery = null;
          }
        }
      }
      bullets = bullets.filter((b) => b.y > -20);

      // mystery ship
      if (!mystery) {
        mysteryTimer -= dt;
        if (mysteryTimer <= 0) {
          mysteryTimer = 16 + Math.random() * 14;
          const fromLeft = Math.random() < 0.5;
          mystery = { x: fromLeft ? -W * 0.08 : W + W * 0.08, dir: fromLeft ? 1 : -1 };
          audio.sweep(500, 700, 0.4, "sine", 0.15);
        }
      } else {
        mystery.x += mystery.dir * W * 0.22 * dt;
        if (mystery.x < -W * 0.1 || mystery.x > W + W * 0.1) mystery = null;
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#04060f");
      bg.addColorStop(1, "#0a0a18");
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);

      c.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 7919) % W;
        const sy = (i * 104729) % H;
        c.fillRect(sx, sy, 1.5, 1.5);
      }

      c.save();
      if (shakeT > 0) {
        const m = shakeMag * (shakeT / 0.25);
        c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      }

      // mystery
      if (mystery) {
        const my = H * 0.06;
        const mw = W * 0.07;
        c.fillStyle = "#ff5c8a";
        c.beginPath();
        c.ellipse(mystery.x, my, mw / 2, H * 0.02, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#ffd23f";
        for (let i = -2; i <= 2; i++) c.fillRect(mystery.x + i * mw * 0.12 - 2, my - 2, 4, 4);
      }

      // aliens
      const aw = alienW();
      const ah = alienH();
      for (const a of aliens) {
        if (!a.alive) continue;
        const p = alienPos(a);
        drawAlien(c, p.x, p.y, aw, ah, a.type, animFrame);
      }

      // bunkers
      const bs = blockSize();
      const by = bunkerY();
      c.fillStyle = "#46e0a0";
      for (let i = 0; i < bunkers.length; i++) {
        const bk = bunkers[i];
        const bx = bunkerX(i);
        for (let r = 0; r < BUNKER_ROWS; r++) {
          for (let cc = 0; cc < BUNKER_COLS; cc++) {
            if (bk.cells[r][cc]) c.fillRect(bx + cc * bs, by + r * bs, bs - 1, bs - 1);
          }
        }
      }

      // bombs
      for (const b of bombs) {
        c.fillStyle = "#ff5c8a";
        if (b.kind === 0) {
          c.fillRect(b.x - 2, b.y - 8, 4, 16);
        } else {
          c.save();
          c.translate(b.x, b.y);
          c.rotate(Math.sin(t * 20) * 0.6);
          c.fillRect(-2, -8, 4, 16);
          c.restore();
        }
      }

      // player bullets
      c.fillStyle = "#9bf6ff";
      for (const bl of bullets) c.fillRect(bl.x - 2, bl.y - 10, 4, 16);

      // player cannon
      if (!dead && (respawnT <= 0 || Math.floor(t * 12) % 2 === 0)) {
        const pY = playerY();
        const pw = playerW();
        const ph = playerH();
        c.fillStyle = "#67e8ff";
        c.fillRect(playerX - pw / 2, pY - ph * 0.4, pw, ph * 0.8);
        c.fillRect(playerX - pw * 0.08, pY - ph, pw * 0.16, ph * 0.7);
        c.fillStyle = "#2c7be5";
        c.fillRect(playerX - pw / 2, pY + ph * 0.2, pw, ph * 0.2);
      }

      // particles
      for (const p of particles) {
        c.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
        c.fillStyle = p.color;
        c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      c.globalAlpha = 1;

      c.restore();

      // HUD
      drawText(c, `SCORE ${score}`, W * 0.04, H * 0.045, H * 0.034, "#fff", "left");
      drawText(c, `WAVE ${wave}`, W / 2, H * 0.045, H * 0.034, "#9bf6ff");
      drawText(c, "▮".repeat(Math.max(0, lives)), W - W * 0.04, H * 0.045, H * 0.04, "#67e8ff", "right");
    },

    resize(w, h) {
      // Layout (aliens, bunkers) recomputes from current size every frame, so we
      // only need to keep the player on-screen. Bunkers keep their damage now.
      playerX = clamp(playerX, playerW() / 2, w - playerW() / 2);
      gx = clamp(gx, marginX(), w);
      void h;
    },
  };

  function stepParticles(dt: number) {
    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += ctx.height * 0.4 * dt;
    }
    particles = particles.filter((p) => p.life < p.max);
  }
}

function alienColor(type: 0 | 1 | 2): string {
  return type === 0 ? "#ff5c8a" : type === 1 ? "#ffd23f" : "#46e0a0";
}

function drawAlien(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  type: 0 | 1 | 2,
  frame: number,
) {
  c.fillStyle = alienColor(type);
  const ux = w / 6;
  const uy = h / 5;
  // body
  c.fillRect(x + ux, y + uy, w - ux * 2, uy * 3);
  // head/eyes
  c.fillRect(x + ux * 1.5, y, w - ux * 3, uy);
  c.fillStyle = "#0a0a18";
  c.fillRect(x + ux * 2, y + uy * 1.5, ux, uy);
  c.fillRect(x + w - ux * 3, y + uy * 1.5, ux, uy);
  // legs (animated)
  c.fillStyle = alienColor(type);
  if (frame === 0) {
    c.fillRect(x, y + uy * 4, ux, uy);
    c.fillRect(x + w - ux, y + uy * 4, ux, uy);
    c.fillRect(x + ux * 2, y + uy * 4, ux, uy);
    c.fillRect(x + w - ux * 3, y + uy * 4, ux, uy);
  } else {
    c.fillRect(x + ux, y + uy * 4, ux, uy);
    c.fillRect(x + w - ux * 2, y + uy * 4, ux, uy);
    c.fillRect(x + ux * 3, y + uy * 4, ux, uy);
    c.fillRect(x + w - ux * 4, y + uy * 4, ux, uy);
  }
}
