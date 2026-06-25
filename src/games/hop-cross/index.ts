import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, lerp, roundRect, rng } from "@/engine";

const COLS = 9;

type RowType = "grass" | "road" | "water" | "rail";

interface Vehicle {
  x: number;
  w: number;
  truck: boolean;
  color: string;
}

interface Log {
  x: number;
  w: number;
}

interface Row {
  type: RowType;
  dir: number;
  speed: number;
  gap: number;
  vehicles: Vehicle[];
  logs: Log[];
  trees: Set<number>;
  shade: number;
  // rail
  trainActive: boolean;
  trainT: number;
  trainX: number;
  trainLen: number;
  trainSpeed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: string;
  r: number;
}

const VEH_COLORS = ["#ff5c5c", "#ffb13b", "#4cd1ff", "#9d6bff", "#ff7ad1", "#5fe08a"];

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  const rows = new Map<number, Row>();
  let parts: Particle[] = [];

  let playerX = Math.floor(COLS / 2);
  let playerRow = 0;
  let hopActive = false;
  let hp = 0;
  let hopFromX = playerX;
  let hopFromRow = playerRow;
  let facing = 0; // -1 left, 1 right, 0 fwd
  let squash = 0;

  let camFollow = 0;
  let autoMin = -3;
  let score = 0;
  let best = storage.get<number>("best", 0);
  let started = false;
  let grace = 1.6;
  let dead = false;
  let shake = 0;

  let startPos: { x: number; y: number } | null = null;

  ctx.requestControls([{ type: "dpad" }]);
  ctx.setStatus("Arrows / swipe to hop · don't get left behind!");

  function vehColor(): string {
    return VEH_COLORS[Math.floor(Math.random() * VEH_COLORS.length)];
  }

  function makeRow(r: number): Row {
    const diff = clamp(r / 220, 0, 1);
    let type: RowType;
    if (r <= 2) type = "grass";
    else {
      const prev = rows.get(r - 1)?.type;
      const roll = Math.random();
      if (roll < 0.3) type = "grass";
      else if (roll < 0.6) type = "road";
      else if (roll < 0.82) type = "water";
      else type = "rail";
      if (type === "rail" && prev === "rail") type = "road";
    }
    const row: Row = {
      type,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: 0,
      gap: 3,
      vehicles: [],
      logs: [],
      trees: new Set<number>(),
      shade: Math.random() < 0.5 ? 0 : 1,
      trainActive: false,
      trainT: rng.range(1.8, 4.5),
      trainX: 0,
      trainLen: COLS + 4,
      trainSpeed: (COLS * 2 + 8) / 0.45,
    };

    if (type === "road") {
      row.speed = rng.range(2.2, 3.6) * (1 + diff * 0.8);
      row.gap = Math.max(2.4, rng.range(3.4, 5.4) - diff * 1.2);
      let x = rng.range(0, row.gap);
      while (x < COLS + row.gap) {
        const truck = Math.random() < 0.3;
        row.vehicles.push({ x, w: truck ? 2 : 1, truck, color: vehColor() });
        x += row.gap + (truck ? 1 : 0);
      }
    } else if (type === "water") {
      row.speed = rng.range(1.4, 2.6) * (1 + diff * 0.5);
      row.gap = rng.range(2.6, 3.8);
      let x = rng.range(0, row.gap);
      while (x < COLS + row.gap) {
        const w = rng.int(2, 3);
        row.logs.push({ x, w });
        x += w + row.gap;
      }
    } else if (type === "grass" && r > 2) {
      for (let c = 0; c < COLS; c++) if (Math.random() < 0.12) row.trees.add(c);
      while (row.trees.size > 3) row.trees.delete([...row.trees][0]);
    }
    return row;
  }

  function ensureRow(r: number): Row {
    let row = rows.get(r);
    if (!row) {
      row = makeRow(r);
      rows.set(r, row);
    }
    return row;
  }

  function spawnParts(x: number, y: number, n: number, col: string, spread: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * rng.range(0.3, 1);
      parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rng.range(0.3, 0.6),
        max: 0.6,
        col,
        r: spread * rng.range(0.04, 0.1),
      });
    }
  }

  function die(reason: "hit" | "drown" | "edge" | "train" | "behind", tile: number, cx: number, cy: number) {
    if (dead) return;
    dead = true;
    shake = tile * 0.5;
    if (reason === "train") audio.explosion();
    else if (reason === "drown") audio.noise(0.3, 0.4);
    else audio.hit();
    const col = reason === "drown" ? "#6fd3ff" : "#ff6b6b";
    spawnParts(cx, cy, 26, col, tile * 0.9);
    if (score > best) {
      best = score;
      storage.set("best", best);
    }
    setTimeout(() => ctx.gameOver(score), 750);
  }

  function tryHop(dx: number, dr: number) {
    if (dead || hopActive) return;
    const baseCol = clamp(Math.round(playerX), 0, COLS - 1);
    const nx = clamp(baseCol + dx, 0, COLS - 1);
    const nr = Math.max(0, playerRow + dr);
    if (dx !== 0 && nx === baseCol) return; // wall
    const target = ensureRow(nr);
    if (target.trees.has(nx)) {
      audio.tone(160, 0.05, "square", 0.2);
      return;
    }
    hopFromX = playerX;
    hopFromRow = playerRow;
    playerX = nx;
    playerRow = nr;
    hopActive = true;
    hp = 0;
    squash = 1;
    facing = dx;
    started = true;
    audio.tone(620, 0.05, "square", 0.18);
    if (playerRow > score) {
      score = playerRow;
      ctx.reportScore(score);
    }
  }

  function tileSize(): number {
    return Math.min(ctx.width / COLS, ctx.height / 13);
  }

  return {
    update(dt) {
      const W = ctx.width;
      const H = ctx.height;
      const tile = tileSize();

      // ---- input ----
      if (input.pressed("ArrowUp", "w")) tryHop(0, 1);
      if (input.pressed("ArrowDown", "s")) tryHop(0, -1);
      if (input.pressed("ArrowLeft", "a")) tryHop(-1, 0);
      if (input.pressed("ArrowRight", "d")) tryHop(1, 0);

      if (input.pointer.justDown) startPos = { x: input.pointer.x, y: input.pointer.y };
      if (input.pointer.justUp && startPos) {
        const dx = input.pointer.x - startPos.x;
        const dy = input.pointer.y - startPos.y;
        const thresh = tile * 0.4;
        if (Math.abs(dx) < thresh && Math.abs(dy) < thresh) {
          tryHop(0, 1); // tap = forward
        } else if (Math.abs(dx) > Math.abs(dy)) {
          tryHop(dx > 0 ? 1 : -1, 0);
        } else {
          tryHop(0, dy < 0 ? 1 : -1); // swipe up = forward
        }
        startPos = null;
      }

      // ---- hop animation ----
      if (hopActive) {
        hp += dt / 0.11;
        if (hp >= 1) {
          hp = 1;
          hopActive = false;
          // landing dust puff
          const lx = (W - COLS * tile) / 2 + (playerX + 0.5) * tile;
          const ly = 0.62 * H - (playerRow - camFollow) * tile + tile * 0.3;
          spawnParts(lx, ly, 5, "rgba(255,255,255,0.65)", tile * 0.45);
        }
      }
      squash *= Math.exp(-dt * 10);

      // ---- auto-advance ----
      if (started && !dead) {
        if (grace > 0) grace -= dt;
        else {
          const diff = clamp(score / 200, 0, 1);
          autoMin += (0.5 + diff * 1.2) * dt;
        }
      }
      const target = Math.max(playerRow, autoMin);
      camFollow = lerp(camFollow, target, 1 - Math.exp(-dt * 7));

      // visible range
      const rTop = Math.ceil(camFollow + (0.62 * H) / tile) + 2;
      const rBottom = Math.floor(camFollow - (0.38 * H) / tile) - 1;
      for (let r = Math.max(0, rBottom); r <= rTop; r++) ensureRow(r);
      // cull far rows
      for (const key of [...rows.keys()]) if (key < rBottom - 3) rows.delete(key);

      // ---- entity motion ----
      for (let r = Math.max(0, rBottom); r <= rTop; r++) {
        const row = rows.get(r);
        if (!row) continue;
        if (row.type === "road") {
          let minx = Infinity;
          let maxx = -Infinity;
          for (const v of row.vehicles) {
            v.x += row.dir * row.speed * dt;
            minx = Math.min(minx, v.x);
            maxx = Math.max(maxx, v.x + v.w);
          }
          for (const v of row.vehicles) {
            if (row.dir > 0 && v.x > COLS + 1) {
              v.x = minx - row.gap - v.w;
              minx = v.x;
            } else if (row.dir < 0 && v.x + v.w < -1) {
              v.x = maxx + row.gap;
              maxx = v.x + v.w;
            }
          }
        } else if (row.type === "water") {
          let minx = Infinity;
          let maxx = -Infinity;
          for (const l of row.logs) {
            l.x += row.dir * row.speed * dt;
            minx = Math.min(minx, l.x);
            maxx = Math.max(maxx, l.x + l.w);
          }
          for (const l of row.logs) {
            if (row.dir > 0 && l.x > COLS + 1) {
              l.x = minx - row.gap - l.w;
              minx = l.x;
            } else if (row.dir < 0 && l.x + l.w < -1) {
              l.x = maxx + row.gap;
              maxx = l.x + l.w;
            }
          }
        } else if (row.type === "rail") {
          if (!row.trainActive) {
            row.trainT -= dt;
            if (row.trainT <= 0) {
              row.trainActive = true;
              row.trainX = row.dir > 0 ? -row.trainLen - 1 : COLS + 1;
            }
          } else {
            row.trainX += row.dir * row.trainSpeed * dt;
            if ((row.dir > 0 && row.trainX > COLS + 1) || (row.dir < 0 && row.trainX + row.trainLen < -1)) {
              row.trainActive = false;
              row.trainT = rng.range(2.2, 4.8);
            }
          }
        }
      }

      // ---- hazards (only while grounded) ----
      const cx = (ctx.width - COLS * tile) / 2 + (playerX + 0.5) * tile;
      const cy = 0.62 * H - (playerRow - camFollow) * tile;
      if (!dead && !hopActive) {
        const row = rows.get(playerRow);
        if (row) {
          if (row.type === "road") {
            for (const v of row.vehicles) {
              if (playerX + 0.42 > v.x && playerX - 0.42 < v.x + v.w) {
                die("hit", tile, cx, cy);
                break;
              }
            }
          } else if (row.type === "water") {
            let on = false;
            for (const l of row.logs) {
              if (playerX + 0.32 > l.x && playerX - 0.32 < l.x + l.w) {
                on = true;
                const d = row.dir * row.speed * dt;
                playerX += d;
                hopFromX += d;
                break;
              }
            }
            if (!on) die("drown", tile, cx, cy);
            else if (playerX < -0.1 || playerX > COLS - 0.9) die("edge", tile, cx, cy);
          } else if (row.type === "rail" && row.trainActive) {
            if (playerX + 0.4 > row.trainX && playerX - 0.4 < row.trainX + row.trainLen) {
              die("train", tile, cx, cy);
            }
          }
        }
        // eagle / left-behind
        const killRow = camFollow - (0.38 * H) / tile;
        if (playerRow < killRow) die("behind", tile, cx, cy);
      }

      // particles
      for (const pa of parts) {
        pa.life -= dt;
        pa.vy += tile * 6 * dt;
        pa.x += pa.vx * dt;
        pa.y += pa.vy * dt;
      }
      parts = parts.filter((pa) => pa.life > 0);
      shake *= Math.exp(-dt * 8);
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const tile = tileSize();
      const ox = (W - COLS * tile) / 2;

      const cy = (r: number) => 0.62 * H - (r - camFollow) * tile;
      const colX = (x: number) => ox + x * tile;

      c.fillStyle = "#1b2a1e";
      c.fillRect(0, 0, W, H);

      c.save();
      if (shake > 0.2) c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

      const rTop = Math.ceil(camFollow + (0.62 * H) / tile) + 2;
      const rBottom = Math.floor(camFollow - (0.38 * H) / tile) - 1;

      for (let r = rTop; r >= rBottom; r--) {
        const row = rows.get(r);
        if (!row) continue;
        const top = cy(r) - tile / 2;
        drawBand(c, row, r, top, tile, W, ox, colX);
      }

      // player
      const ex = lerp(hopFromX, playerX, ease(hp));
      const er = lerp(hopFromRow, playerRow, ease(hp));
      const arc = hopActive ? Math.sin(hp * Math.PI) * tile * 0.55 : 0;
      const pcx = colX(ex + 0.5);
      const pcy = cy(er) - arc;
      // shadow
      c.fillStyle = "rgba(0,0,0,0.28)";
      c.beginPath();
      c.ellipse(colX(ex + 0.5), cy(er) + tile * 0.28, tile * 0.32, tile * 0.16, 0, 0, Math.PI * 2);
      c.fill();
      drawPlayer(c, pcx, pcy, tile);

      // particles
      for (const pa of parts) {
        c.globalAlpha = clamp(pa.life / pa.max, 0, 1);
        c.fillStyle = pa.col;
        c.beginPath();
        c.arc(pa.x, pa.y, pa.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;

      c.restore();

      // danger vignette near bottom
      const grad = c.createLinearGradient(0, H * 0.8, 0, H);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(120,0,0,0.35)");
      c.fillStyle = grad;
      c.fillRect(0, H * 0.8, W, H * 0.2);

      // HUD
      c.fillStyle = "rgba(0,0,0,0.4)";
      roundRect(c, W * 0.03, H * 0.03, tile * 2.6, tile * 1.0, tile * 0.18);
      c.fill();
      drawText(c, String(score), W * 0.03 + tile * 1.3, H * 0.03 + tile * 0.5, tile * 0.55, "#fff");
      drawText(c, `BEST ${Math.max(best, score)}`, W - W * 0.03, H * 0.04, tile * 0.32, "#fff", "right");

      if (!started && !dead) {
        c.fillStyle = "rgba(0,0,0,0.45)";
        roundRect(c, W * 0.1, H * 0.44, W * 0.8, tile * 1.6, tile * 0.2);
        c.fill();
        drawText(c, "HOP FORWARD!", W / 2, H * 0.44 + tile * 0.55, tile * 0.5, "#fff");
        drawText(c, "Arrows / swipe / tap", W / 2, H * 0.44 + tile * 1.15, tile * 0.34, "rgba(255,255,255,0.7)");
      }
    },

    resize() {
      /* tile + positions are derived from current size each frame */
    },
  };

  function ease(x: number): number {
    return 1 - Math.pow(1 - x, 3);
  }

  function drawBand(
    c: CanvasRenderingContext2D,
    row: Row,
    r: number,
    top: number,
    tile: number,
    W: number,
    ox: number,
    colX: (x: number) => number,
  ) {
    if (row.type === "grass") {
      c.fillStyle = row.shade ? "#7ec85a" : "#74be52";
      c.fillRect(0, top, W, tile);
      // board edge stripe
      c.fillStyle = "rgba(255,255,255,0.04)";
      c.fillRect(ox, top, COLS * tile, tile);
      for (const tc of row.trees) {
        const x = colX(tc + 0.5);
        c.fillStyle = "#6b4a2b";
        c.fillRect(x - tile * 0.08, top + tile * 0.45, tile * 0.16, tile * 0.45);
        c.fillStyle = "#2f7d3a";
        c.beginPath();
        c.arc(x, top + tile * 0.4, tile * 0.32, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#3a9446";
        c.beginPath();
        c.arc(x - tile * 0.12, top + tile * 0.34, tile * 0.18, 0, Math.PI * 2);
        c.fill();
      }
    } else if (row.type === "road") {
      c.fillStyle = "#3a3f47";
      c.fillRect(0, top, W, tile);
      c.strokeStyle = "rgba(255,255,255,0.45)";
      c.lineWidth = Math.max(1, tile * 0.04);
      c.setLineDash([tile * 0.3, tile * 0.3]);
      c.beginPath();
      c.moveTo(0, top + tile * 0.5);
      c.lineTo(W, top + tile * 0.5);
      c.stroke();
      c.setLineDash([]);
      c.save();
      c.beginPath();
      c.rect(ox, top, COLS * tile, tile);
      c.clip();
      for (const v of row.vehicles) drawVehicle(c, v, row.dir, colX, top, tile);
      c.restore();
    } else if (row.type === "water") {
      c.fillStyle = "#2f8ad6";
      c.fillRect(0, top, W, tile);
      c.fillStyle = "rgba(255,255,255,0.1)";
      for (let i = 0; i < 5; i++) {
        const wx = ((i * 0.27 * W + r * 13) % W);
        c.fillRect(wx, top + tile * (0.25 + (i % 2) * 0.4), tile * 0.5, tile * 0.06);
      }
      c.save();
      c.beginPath();
      c.rect(ox, top, COLS * tile, tile);
      c.clip();
      for (const l of row.logs) {
        const x = colX(l.x);
        c.fillStyle = "#8a5a34";
        roundRect(c, x, top + tile * 0.16, l.w * tile, tile * 0.68, tile * 0.16);
        c.fill();
        c.strokeStyle = "rgba(0,0,0,0.2)";
        c.lineWidth = Math.max(1, tile * 0.04);
        for (let k = 1; k < l.w; k++) {
          c.beginPath();
          c.moveTo(x + k * tile, top + tile * 0.16);
          c.lineTo(x + k * tile, top + tile * 0.84);
          c.stroke();
        }
      }
      c.restore();
    } else {
      // rail
      c.fillStyle = "#4a4540";
      c.fillRect(0, top, W, tile);
      c.fillStyle = "#5a544d";
      for (let i = 0; i < Math.ceil(W / (tile * 0.4)); i++) {
        c.fillRect(i * tile * 0.4, top + tile * 0.15, tile * 0.18, tile * 0.7);
      }
      c.strokeStyle = "#9aa0a6";
      c.lineWidth = Math.max(1, tile * 0.05);
      c.beginPath();
      c.moveTo(0, top + tile * 0.34);
      c.lineTo(W, top + tile * 0.34);
      c.moveTo(0, top + tile * 0.66);
      c.lineTo(W, top + tile * 0.66);
      c.stroke();
      // warning blink
      if (!row.trainActive && row.trainT < 1.2 && Math.floor(row.trainT * 8) % 2 === 0) {
        c.fillStyle = "#ff3b3b";
        c.beginPath();
        c.arc(ox + tile * 0.3, top + tile * 0.3, tile * 0.12, 0, Math.PI * 2);
        c.arc(ox + COLS * tile - tile * 0.3, top + tile * 0.3, tile * 0.12, 0, Math.PI * 2);
        c.fill();
      }
      if (row.trainActive) {
        const x = colX(row.trainX);
        c.fillStyle = "#d23b3b";
        roundRect(c, x, top + tile * 0.1, row.trainLen * tile, tile * 0.8, tile * 0.18);
        c.fill();
        c.fillStyle = "#f5d76e";
        for (let k = 0; k < row.trainLen; k++) {
          c.fillRect(x + (k + 0.2) * tile, top + tile * 0.3, tile * 0.6, tile * 0.3);
        }
      }
    }
  }

  function drawVehicle(
    c: CanvasRenderingContext2D,
    v: Vehicle,
    dir: number,
    colX: (x: number) => number,
    top: number,
    tile: number,
  ) {
    const x = colX(v.x);
    const w = v.w * tile;
    c.fillStyle = "rgba(0,0,0,0.25)";
    roundRect(c, x + tile * 0.06, top + tile * 0.74, w - tile * 0.12, tile * 0.12, tile * 0.05);
    c.fill();
    c.fillStyle = v.color;
    roundRect(c, x + tile * 0.06, top + tile * 0.18, w - tile * 0.12, tile * 0.6, tile * 0.16);
    c.fill();
    // windshield toward direction
    c.fillStyle = "rgba(255,255,255,0.8)";
    const wsX = dir > 0 ? x + w - tile * 0.42 : x + tile * 0.12;
    roundRect(c, wsX, top + tile * 0.26, tile * 0.3, tile * 0.28, tile * 0.06);
    c.fill();
    // wheels
    c.fillStyle = "#1a1a1a";
    c.beginPath();
    c.arc(x + tile * 0.28, top + tile * 0.78, tile * 0.1, 0, Math.PI * 2);
    c.arc(x + w - tile * 0.28, top + tile * 0.78, tile * 0.1, 0, Math.PI * 2);
    c.fill();
  }

  function drawPlayer(c: CanvasRenderingContext2D, x: number, y: number, tile: number) {
    const sq = 1 - squash * 0.3;
    const st = 1 + squash * 0.3;
    c.save();
    c.translate(x, y);
    c.scale(st, sq);
    // body
    c.fillStyle = "#f7f7f7";
    roundRect(c, -tile * 0.3, -tile * 0.28, tile * 0.6, tile * 0.56, tile * 0.14);
    c.fill();
    // belly
    c.fillStyle = "#ffe08a";
    roundRect(c, -tile * 0.16, -tile * 0.05, tile * 0.32, tile * 0.28, tile * 0.1);
    c.fill();
    // comb
    c.fillStyle = "#ff4d4d";
    c.beginPath();
    c.arc(0, -tile * 0.32, tile * 0.08, 0, Math.PI * 2);
    c.arc(-tile * 0.1, -tile * 0.3, tile * 0.06, 0, Math.PI * 2);
    c.arc(tile * 0.1, -tile * 0.3, tile * 0.06, 0, Math.PI * 2);
    c.fill();
    // beak
    c.fillStyle = "#ff8c2b";
    const bx = facing * tile * 0.22;
    c.beginPath();
    c.moveTo(bx, -tile * 0.05);
    c.lineTo(bx + facing * tile * 0.16, -tile * 0.02);
    c.lineTo(bx, tile * 0.06);
    c.fill();
    // eyes
    c.fillStyle = "#1a1a1a";
    c.beginPath();
    c.arc(facing * tile * 0.1 - tile * 0.08, -tile * 0.12, tile * 0.05, 0, Math.PI * 2);
    c.arc(facing * tile * 0.1 + tile * 0.08, -tile * 0.12, tile * 0.05, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}
