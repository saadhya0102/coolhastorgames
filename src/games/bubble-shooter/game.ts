/**
 * BubbleGame — the core of Bubble Pop Saga.
 *
 * Owns the state machine, the in-flight shot physics, scoring/combos, the
 * launcher + aim guide, the ceiling descent, win/lose and all rendering. Pixel
 * geometry is recomputed every frame from the live ctx size, so the game is
 * fully resolution independent and survives resizes / orientation changes.
 */

import type { GameContext } from "@/engine";
import { clamp, drawText, mulberry32, roundRect } from "@/engine";
import {
  AIM_CLAMP,
  AIM_KEY_SPEED,
  COMBO_STEPS,
  DEATH_MARGIN_ROWS,
  DESCEND_ANIM,
  DROP_BASE,
  HUD_FRACTION,
  KEY_BEST,
  LEVEL_CLEAR_BONUS,
  MATCH_MIN,
  PALETTE,
  POP_BASE,
  POP_SIZE_BONUS,
  SHOT_SPEED_FACTOR,
  SPAWN_ANIM,
  COLS,
} from "./config";
import { HexGrid, makeCell } from "./grid";
import {
  colorsForLevel,
  generateBoard,
  generateDescentRow,
  shotsPerDescent,
} from "./levelgen";
import { Particles } from "./particles";
import {
  drawBackground,
  drawBubble,
  drawDeathLine,
  drawFrame,
} from "./render";
import type {
  BubbleColor,
  CellRef,
  FallingBubble,
  GameState,
  Geometry,
  Shot,
} from "./types";

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

export class BubbleGame {
  private readonly ctx: GameContext;
  private readonly grid = new HexGrid();
  private readonly particles = new Particles();

  private geo: Geometry;
  private prevW = 0;

  private state: GameState = "aiming";
  private paused = false;

  private level = 1;
  private score = 0;
  private best = 0;

  private shot: Shot | null = null;
  private falling: FallingBubble[] = [];

  private current: BubbleColor = 0;
  private next: BubbleColor = 0;

  private aimAngle = 0;
  private usingPointer = true;
  private lastPx = -1;
  private lastPy = -1;

  private shotCount = 0;
  private comboStep = 0;
  private descendAnim = 0;
  private shake = 0;
  private fireCooldown = 0;

  private t = 0;
  private winTimer = 0;
  private loseTimer = 0;
  private gameOverSent = false;
  private flashCeiling = 0;

  private descentRng: () => number;
  private runSalt: number;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.runSalt = Math.floor(Math.random() * 1e9);
    this.descentRng = mulberry32(this.runSalt ^ 0x1234);
    this.best = ctx.storage.get<number>(KEY_BEST, 0);
    this.geo = this.computeGeometry();

    ctx.setStatus("Aim with the pointer · click / tap to fire");
    ctx.requestControls([
      { type: "button", key: "Space", label: "FIRE", id: "fire" },
      { type: "button", key: "s", label: "SWAP", id: "swap" },
    ]);

    this.startLevel(1);
  }

  // ---------------------------------------------------------------- geometry

  private computeGeometry(): Geometry {
    const W = this.ctx.width;
    const H = this.ctx.height;
    const pad = Math.max(6, W * 0.018);
    const boardLeft = pad;
    const boardRight = W - pad;
    const playW = boardRight - boardLeft;
    const R = playW / (COLS * 2);
    const rowH = R * Math.sqrt(3);
    const hudBottom = Math.max(H * HUD_FRACTION, R * 1.4);
    const ceilingY = hudBottom + R * 0.9;
    const launcherY = H - Math.max(R * 1.7, H * 0.055);
    const launcherX = W / 2;
    const deathY = launcherY - R * (DEATH_MARGIN_ROWS + 1.4);
    return {
      W,
      H,
      R,
      rowH,
      boardLeft,
      boardRight,
      ceilingY,
      launcherX,
      launcherY,
      deathY,
      hudBottom,
    };
  }

  // ----------------------------------------------------------------- levels

  private startLevel(level: number): void {
    this.level = level;
    this.grid.board = generateBoard(level, this.runSalt + level);
    this.falling = [];
    this.shot = null;
    this.descendAnim = 0;
    this.comboStep = 0;
    this.state = "aiming";
    this.descentRng = mulberry32((this.runSalt ^ (level * 7919)) >>> 0);
    this.current = this.pickColorFromBoard();
    this.next = this.pickColorFromBoard();
    this.fireCooldown = 0;
  }

  /** Pick a launcher color biased toward colors currently on the board. */
  private pickColorFromBoard(): BubbleColor {
    const active = colorsForLevel(this.level);
    const present = [...this.grid.colorsPresent()].filter((c) => c < active);
    const pool = present.length ? present : range(active);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ----------------------------------------------------------------- update

  update(dt: number): void {
    // clamp dt for stability on slow frames / tab switches
    if (dt > 0.05) dt = 0.05;
    this.t += dt;
    this.geo = this.computeGeometry();
    this.handleResizeRescale();

    const { input } = this.ctx;

    // global pause toggle
    if (input.pressed("p", "Escape")) {
      if (this.state === "aiming" || this.state === "firing") {
        this.paused = !this.paused;
      }
    }

    // animations that always run
    this.animateCells(dt);
    this.particles.update(dt, this.geo.H * 0.6);
    this.updateFalling(dt);
    if (this.descendAnim > 0) {
      this.descendAnim = Math.max(0, this.descendAnim - (this.geo.rowH / DESCEND_ANIM) * dt);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    if (this.flashCeiling > 0) this.flashCeiling = Math.max(0, this.flashCeiling - dt * 3);
    if (this.fireCooldown > 0) this.fireCooldown -= dt;

    if (this.paused) {
      if (input.pointer.justDown) this.paused = false;
      return;
    }

    switch (this.state) {
      case "aiming":
        this.updateAim(dt);
        this.maybeFire();
        break;
      case "firing":
        this.updateAim(dt);
        this.updateShot(dt);
        break;
      case "win":
        this.winTimer -= dt;
        if (this.winTimer <= 0 || input.pressed("Space", "Enter") || input.pointer.justDown) {
          this.startLevel(this.level + 1);
        }
        break;
      case "lose":
        this.loseTimer -= dt;
        if (this.loseTimer <= 0 && !this.gameOverSent) {
          this.gameOverSent = true;
          this.ctx.gameOver(this.score);
        }
        break;
      default:
        break;
    }
  }

  /** If the canvas width changed materially, remap the in-flight shot. */
  private handleResizeRescale(): void {
    if (this.prevW === 0) {
      this.prevW = this.geo.W;
      return;
    }
    if (Math.abs(this.geo.W - this.prevW) > 0.5 && this.shot) {
      const ratio = this.geo.W / this.prevW;
      this.shot.x *= ratio;
      this.shot.y *= ratio;
      const speed = SHOT_SPEED_FACTOR * this.geo.H;
      const mag = Math.hypot(this.shot.vx, this.shot.vy) || 1;
      this.shot.vx = (this.shot.vx / mag) * speed;
      this.shot.vy = (this.shot.vy / mag) * speed;
      this.shot.r = this.geo.R;
    }
    this.prevW = this.geo.W;
  }

  private animateCells(dt: number): void {
    for (const row of this.grid.board) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.spawnT < 1) cell.spawnT = Math.min(1, cell.spawnT + dt / SPAWN_ANIM);
        if (cell.wobble > 0) cell.wobble = Math.max(0, cell.wobble - dt * 2.6);
        if (cell.hitFlash > 0) cell.hitFlash = Math.max(0, cell.hitFlash - dt * 4);
      }
    }
  }

  private updateFalling(dt: number): void {
    const g = this.geo.H * 1.9;
    const remain: FallingBubble[] = [];
    for (const f of this.falling) {
      f.vy += g * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.spin += f.spinV * dt;
      f.life -= dt;
      if (f.y - f.r > this.geo.H) {
        const pal = PALETTE[f.color] ?? PALETTE[0];
        this.particles.splash(f.x, this.geo.H - 2, pal.base, this.geo.R * 0.5);
        continue;
      }
      if (f.life > 0) remain.push(f);
    }
    this.falling = remain;
  }

  // -------------------------------------------------------------------- aim

  private updateAim(dt: number): void {
    const { input } = this.ctx;
    const px = input.pointer.x;
    const py = input.pointer.y;
    const moved = px !== this.lastPx || py !== this.lastPy;
    this.lastPx = px;
    this.lastPy = py;

    if (input.isDown("ArrowLeft", "a")) {
      this.aimAngle -= AIM_KEY_SPEED * dt;
      this.usingPointer = false;
    } else if (input.isDown("ArrowRight", "d")) {
      this.aimAngle += AIM_KEY_SPEED * dt;
      this.usingPointer = false;
    }

    if ((moved || input.pointer.down) && py < this.geo.launcherY) {
      this.usingPointer = true;
    }

    if (this.usingPointer) {
      const dx = px - this.geo.launcherX;
      const dy = py - this.geo.launcherY;
      this.aimAngle = Math.atan2(dx, -dy);
    }
    this.aimAngle = clamp(this.aimAngle, -AIM_CLAMP, AIM_CLAMP);

    // swap current <-> next
    if (input.pressed("s") || input.pressed("Shift")) {
      const tmp = this.current;
      this.current = this.next;
      this.next = tmp;
      this.ctx.audio.tone(360, 0.06, "sine", 0.2);
    }
  }

  private maybeFire(): void {
    const { input } = this.ctx;
    if (this.fireCooldown > 0) return;
    const fireKey = input.pressed("Space", "Enter", "ArrowUp", "w");
    const fireTap =
      input.pointer.justDown && input.pointer.y < this.geo.launcherY + this.geo.R;
    if (fireKey || fireTap) this.fire();
  }

  private fire(): void {
    const speed = SHOT_SPEED_FACTOR * this.geo.H;
    const dirx = Math.sin(this.aimAngle);
    const diry = -Math.cos(this.aimAngle);
    this.shot = {
      x: this.geo.launcherX,
      y: this.geo.launcherY,
      vx: dirx * speed,
      vy: diry * speed,
      color: this.current,
      r: this.geo.R,
    };
    this.state = "firing";
    this.fireCooldown = 0.08;
    this.ctx.audio.sweep(300, 660, 0.12, "sine", 0.32);
  }

  // ------------------------------------------------------------- shot physics

  private updateShot(dt: number): void {
    const s = this.shot;
    if (!s) return;
    const geo = this.geo;
    const minX = geo.boardLeft + geo.R;
    const maxX = geo.boardRight - geo.R;
    const dist = Math.hypot(s.vx, s.vy) * dt;
    const sub = Math.max(1, Math.ceil(dist / (geo.R * 0.45)));
    const ddt = dt / sub;
    for (let i = 0; i < sub; i++) {
      s.x += s.vx * ddt;
      s.y += s.vy * ddt;
      if (s.x < minX) {
        s.x = minX;
        s.vx = -s.vx;
        this.bounceSfx();
      } else if (s.x > maxX) {
        s.x = maxX;
        s.vx = -s.vx;
        this.bounceSfx();
      }
      if (s.y <= geo.ceilingY + geo.R || this.collidesAt(s.x, s.y)) {
        this.snapAndResolve(s);
        return;
      }
    }
  }

  private bounceSfx(): void {
    this.ctx.audio.tone(380, 0.04, "square", 0.12);
  }

  /** True if a bubble of radius R at (x,y) overlaps any placed cell. */
  private collidesAt(x: number, y: number): boolean {
    const geo = this.geo;
    const thresh = (geo.R * 2 * 0.9) ** 2;
    const board = this.grid.board;
    // limit row scan to a band around y for efficiency
    const approxRow = Math.floor((y - geo.ceilingY - geo.R + this.descendAnim) / geo.rowH);
    const r0 = Math.max(0, approxRow - 2);
    const r1 = Math.min(board.length - 1, approxRow + 2);
    for (let r = r0; r <= r1; r++) {
      const rowArr = board[r];
      if (!rowArr) continue;
      for (let c = 0; c < rowArr.length; c++) {
        if (!rowArr[c]) continue;
        const ctr = this.grid.cellCenter(r, c, geo, this.descendAnim);
        const dx = ctr.x - x;
        const dy = ctr.y - y;
        if (dx * dx + dy * dy < thresh) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- resolve

  private snapAndResolve(s: Shot): void {
    const geo = this.geo;
    const target = this.grid.findSnapCell(s.x, s.y, geo, this.descendAnim);
    this.grid.set(target.row, target.col, makeCell(s.color));
    // nudge neighbors for tactile feel
    for (const n of this.grid.neighbors(target.row, target.col)) {
      const cell = this.grid.get(n.row, n.col);
      if (cell) cell.wobble = 0.7;
    }
    this.shot = null;
    this.state = "aiming";

    const cluster = this.grid.matchCluster(target.row, target.col);

    if (cluster.length >= MATCH_MIN) {
      this.comboStep = Math.min(this.comboStep + 1, COMBO_STEPS.length - 1);
      const mult = COMBO_STEPS[this.comboStep];

      let cx = 0;
      let cy = 0;
      for (const cc of cluster) {
        const ctr = this.grid.cellCenter(cc.row, cc.col, geo, this.descendAnim);
        const cell = this.grid.get(cc.row, cc.col);
        const pal = PALETTE[cell ? cell.color : s.color] ?? PALETTE[0];
        this.particles.pop(ctr.x, ctr.y, pal.base, geo.R * 0.5, 1 + this.comboStep * 0.15);
        cx += ctr.x;
        cy += ctr.y;
        this.grid.set(cc.row, cc.col, null);
      }
      cx /= cluster.length;
      cy /= cluster.length;

      const popPts = Math.round(
        (cluster.length * POP_BASE +
          Math.max(0, cluster.length - MATCH_MIN) * POP_SIZE_BONUS) *
          mult,
      );
      this.addScore(popPts);
      this.particles.ping(cx, cy, `+${popPts}`, "#fff", geo.R * 1.1);
      this.popSfx(cluster.length);

      // disconnected bubbles drop for escalating bonus
      const floaters = this.grid.floatingCells();
      if (floaters.length) {
        let k = 1;
        let dropPts = 0;
        let fx = 0;
        let fy = 0;
        for (const f of floaters) {
          const ctr = this.grid.cellCenter(f.row, f.col, geo, this.descendAnim);
          const cell = this.grid.get(f.row, f.col);
          if (cell) {
            this.falling.push({
              x: ctr.x,
              y: ctr.y,
              vx: (Math.random() - 0.5) * geo.R * 4,
              vy: -geo.R * (1 + Math.random() * 2),
              color: cell.color,
              spin: 0,
              spinV: (Math.random() - 0.5) * 8,
              r: geo.R,
              life: 2.5,
            });
          }
          this.grid.set(f.row, f.col, null);
          dropPts += DROP_BASE * k;
          k++;
          fx += ctr.x;
          fy += ctr.y;
        }
        dropPts = Math.round(dropPts * Math.min(mult, 3));
        this.addScore(dropPts);
        this.particles.ping(
          fx / floaters.length,
          fy / floaters.length,
          `DROP +${dropPts}`,
          "#ffd95c",
          geo.R * 1.2,
        );
        this.dropSfx(floaters.length);
        this.shake = Math.min(18, 6 + floaters.length * 1.5);
        this.particles.shock(cx, cy, geo.R * 8, "#ffd95c");
      }

      if (this.comboStep >= 1) {
        this.shake = Math.max(this.shake, 4 + this.comboStep * 1.2);
        this.comboSfx(this.comboStep);
      }
    } else {
      this.comboStep = 0;
      this.ctx.audio.tone(210, 0.08, "sine", 0.22);
    }

    this.shotCount++;

    if (this.grid.isEmpty()) {
      this.triggerWin();
      return;
    }

    // ceiling descent on cadence (skip immediately after a clearing pop chain
    // so the player gets a beat)
    if (this.shotCount % shotsPerDescent(this.level) === 0) {
      this.descend();
    }

    if (this.checkLose()) {
      this.triggerLose();
      return;
    }

    this.loadNext();
  }

  private loadNext(): void {
    this.current = this.next;
    this.next = this.pickColorFromBoard();
  }

  private descend(): void {
    const top = this.grid.board[0];
    const newRow = generateDescentRow(top, 0, this.level, this.descentRng);
    this.grid.unshiftRow(newRow);
    this.descendAnim = this.geo.rowH;
    this.flashCeiling = 1;
    this.shake = Math.max(this.shake, 5);
    this.ctx.audio.tone(95, 0.18, "sawtooth", 0.3);
    this.ctx.audio.tone(70, 0.22, "square", 0.18);
  }

  private checkLose(): boolean {
    const geo = this.geo;
    const lowest = this.grid.lowestOccupiedRow();
    if (lowest < 0) return false;
    const y = geo.ceilingY + geo.R + lowest * geo.rowH;
    return y >= geo.deathY;
  }

  private triggerWin(): void {
    this.state = "win";
    this.winTimer = 2.4;
    const bonus = LEVEL_CLEAR_BONUS * this.level;
    this.addScore(bonus);
    this.particles.ping(
      this.geo.W / 2,
      this.geo.H * 0.4,
      `LEVEL CLEAR +${bonus}`,
      "#9ff4ec",
      this.geo.R * 1.6,
    );
    this.ctx.audio.win();
    for (let i = 0; i < 4; i++) {
      this.particles.shock(
        this.geo.W * (0.3 + Math.random() * 0.4),
        this.geo.H * (0.3 + Math.random() * 0.3),
        this.geo.R * 12,
        PALETTE[i % PALETTE.length].base,
      );
    }
  }

  private triggerLose(): void {
    this.state = "lose";
    this.loseTimer = 1.6;
    this.shake = 16;
    this.ctx.audio.lose();
  }

  private addScore(n: number): void {
    this.score += n;
    if (this.score > this.best) {
      this.best = this.score;
      this.ctx.storage.set(KEY_BEST, this.best);
    }
    this.ctx.reportScore(this.score);
  }

  // ------------------------------------------------------------------ audio

  private popSfx(size: number): void {
    const base = 440 * Math.pow(2, this.comboStep / 5);
    this.ctx.audio.tone(base, 0.09, "triangle", 0.3);
    this.ctx.audio.tone(base * 1.5, 0.07, "sine", 0.18);
    this.ctx.audio.noise(0.1, 0.12 + Math.min(0.2, size * 0.02));
  }

  private dropSfx(n: number): void {
    this.ctx.audio.sweep(560, 120, 0.32, "sine", 0.3);
    this.ctx.audio.noise(0.18, Math.min(0.4, 0.1 + n * 0.03));
  }

  private comboSfx(step: number): void {
    const f = 520 + step * 90;
    this.ctx.audio.tone(f, 0.07, "square", 0.18);
  }

  // ----------------------------------------------------------------- render

  render(): void {
    const c = this.ctx.ctx;
    const geo = this.geo;
    c.save();
    if (this.shake > 0) {
      const m = this.shake;
      c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    drawBackground(c, geo.W, geo.H, this.t);
    drawFrame(c, geo.boardLeft, geo.boardRight, geo.ceilingY, geo.H, geo.R);
    if (this.flashCeiling > 0) {
      c.save();
      c.globalAlpha = this.flashCeiling * 0.5;
      c.fillStyle = "#ffffff";
      c.fillRect(geo.boardLeft, geo.ceilingY - geo.R, geo.boardRight - geo.boardLeft, geo.rowH);
      c.restore();
    }

    this.renderBubbles();
    this.renderFalling();

    const danger = this.dangerLevel();
    if (this.state === "aiming") this.renderAimGuide();
    drawDeathLine(c, geo.boardLeft, geo.boardRight, geo.deathY, danger);
    this.renderLauncher();
    this.particles.render(c);

    c.restore(); // shake

    this.renderHud(danger);
    if (this.paused) this.renderPanel("PAUSED", "Tap or P to resume", "#9ff4ec");
    if (this.state === "win")
      this.renderPanel(`LEVEL ${this.level} CLEAR!`, "Tap to continue", "#9ff4ec");
    if (this.state === "lose")
      this.renderPanel("GAME OVER", `Score ${this.score}`, "#ff5c8a");
  }

  private dangerLevel(): number {
    const geo = this.geo;
    const lowest = this.grid.lowestOccupiedRow();
    if (lowest < 0) return 0;
    const y = geo.ceilingY + geo.R + lowest * geo.rowH;
    const span = geo.deathY - geo.ceilingY;
    return clamp((y - geo.ceilingY) / Math.max(1, span), 0, 1);
  }

  private renderBubbles(): void {
    const c = this.ctx.ctx;
    const geo = this.geo;
    const board = this.grid.board;
    for (let r = 0; r < board.length; r++) {
      const rowArr = board[r];
      for (let col = 0; col < rowArr.length; col++) {
        const cell = rowArr[col];
        if (!cell) continue;
        const ctr = this.grid.cellCenter(r, col, geo, this.descendAnim);
        if (ctr.y - geo.R > geo.H + geo.R) continue;
        const sp = easeOutBack(clamp(cell.spawnT, 0, 1));
        const wob = cell.wobble > 0 ? 1 + Math.sin(this.t * 28) * cell.wobble * 0.12 : 1;
        const r2 = geo.R * 0.97 * sp * wob;
        drawBubble(c, ctr.x, ctr.y, r2, cell.color, { flash: cell.hitFlash });
      }
    }
  }

  private renderFalling(): void {
    const c = this.ctx.ctx;
    for (const f of this.falling) {
      const alpha = clamp(f.life, 0, 1);
      c.save();
      c.translate(f.x, f.y);
      c.rotate(f.spin);
      drawBubble(c, 0, 0, f.r * 0.97, f.color, { alpha });
      c.restore();
    }
  }

  private renderLauncher(): void {
    const c = this.ctx.ctx;
    const geo = this.geo;
    const R = geo.R;

    // base pedestal
    c.save();
    const bg = c.createRadialGradient(
      geo.launcherX,
      geo.launcherY,
      R * 0.3,
      geo.launcherX,
      geo.launcherY,
      R * 1.9,
    );
    bg.addColorStop(0, "#4a3a78");
    bg.addColorStop(1, "#2a2048");
    c.fillStyle = bg;
    c.beginPath();
    c.arc(geo.launcherX, geo.launcherY, R * 1.7, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#7c5cff";
    c.lineWidth = Math.max(2, R * 0.12);
    c.stroke();
    c.restore();

    // barrel
    c.save();
    c.translate(geo.launcherX, geo.launcherY);
    c.rotate(this.aimAngle);
    const bw = R * 0.95;
    const bl = R * 2.1;
    const grd = c.createLinearGradient(-bw, 0, bw, 0);
    grd.addColorStop(0, "#5a4a8a");
    grd.addColorStop(0.5, "#8a7ad0");
    grd.addColorStop(1, "#5a4a8a");
    c.fillStyle = grd;
    roundRect(c, -bw / 2, -bl, bw, bl, bw * 0.4);
    c.fill();
    c.strokeStyle = "#2a2048";
    c.lineWidth = Math.max(1.5, R * 0.08);
    c.stroke();
    c.restore();

    // loaded bubble seated at the pivot
    drawBubble(c, geo.launcherX, geo.launcherY, R * 0.95, this.current, {});

    // next bubble tray
    const nx = geo.launcherX + R * 3.0;
    const ny = geo.launcherY;
    if (nx + R < geo.W) {
      c.save();
      c.globalAlpha = 0.85;
      c.fillStyle = "rgba(255,255,255,0.08)";
      c.beginPath();
      c.arc(nx, ny, R * 0.85, 0, Math.PI * 2);
      c.fill();
      c.restore();
      drawBubble(c, nx, ny, R * 0.62, this.next, {});
      drawText(c, "NEXT", nx, ny - R * 1.1, R * 0.5, "rgba(255,255,255,0.6)");
    }
  }

  private renderAimGuide(): void {
    const c = this.ctx.ctx;
    const geo = this.geo;
    const sim = this.simulateTrajectory(this.aimAngle);

    // dotted poly-line
    c.save();
    c.lineCap = "round";
    c.setLineDash([Math.max(3, geo.R * 0.2), Math.max(6, geo.R * 0.5)]);
    c.lineWidth = Math.max(2, geo.R * 0.22);
    const pal = PALETTE[this.current] ?? PALETTE[0];
    c.strokeStyle = hexWithAlpha(pal.base, 0.7);
    c.beginPath();
    c.moveTo(sim.pts[0].x, sim.pts[0].y);
    for (let i = 1; i < sim.pts.length; i++) c.lineTo(sim.pts[i].x, sim.pts[i].y);
    c.stroke();
    c.restore();

    // bounce markers
    for (let i = 1; i < sim.pts.length - 1; i++) {
      c.save();
      c.globalAlpha = 0.6;
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(sim.pts[i].x, sim.pts[i].y, geo.R * 0.16, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // ghost landing bubble
    if (sim.land) {
      const ctr = this.grid.cellCenter(sim.land.row, sim.land.col, geo, this.descendAnim);
      c.save();
      c.globalAlpha = 0.35 + Math.sin(this.t * 6) * 0.12;
      drawBubble(c, ctr.x, ctr.y, geo.R * 0.92, this.current, { glyph: false });
      c.restore();
      c.save();
      c.strokeStyle = "rgba(255,255,255,0.7)";
      c.lineWidth = Math.max(1.5, geo.R * 0.1);
      c.beginPath();
      c.arc(ctr.x, ctr.y, geo.R * 0.96, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
  }

  /** March a virtual shot to preview the path + landing cell. */
  private simulateTrajectory(angle: number): {
    pts: { x: number; y: number }[];
    land: CellRef | null;
  } {
    const geo = this.geo;
    let x = geo.launcherX;
    let y = geo.launcherY;
    let dx = Math.sin(angle);
    let dy = -Math.cos(angle);
    const step = geo.R * 0.5;
    const minX = geo.boardLeft + geo.R;
    const maxX = geo.boardRight - geo.R;
    const pts: { x: number; y: number }[] = [{ x, y }];
    let bounces = 0;
    for (let i = 0; i < 4000; i++) {
      x += dx * step;
      y += dy * step;
      if (x < minX) {
        x = minX;
        dx = -dx;
        pts.push({ x, y });
        if (++bounces > 6) break;
      } else if (x > maxX) {
        x = maxX;
        dx = -dx;
        pts.push({ x, y });
        if (++bounces > 6) break;
      }
      if (y <= geo.ceilingY + geo.R || this.collidesAt(x, y)) {
        pts.push({ x, y });
        return { pts, land: this.grid.findSnapCell(x, y, geo, this.descendAnim) };
      }
      if (y > geo.launcherY + geo.R) break;
    }
    pts.push({ x, y });
    return { pts, land: null };
  }

  // -------------------------------------------------------------------- HUD

  private renderHud(danger: number): void {
    const c = this.ctx.ctx;
    const geo = this.geo;
    const W = geo.W;
    const band = geo.hudBottom;
    const fs = Math.min(W * 0.05, band * 0.42);

    // translucent HUD strip
    c.save();
    const g = c.createLinearGradient(0, 0, 0, band);
    g.addColorStop(0, "rgba(10,6,22,0.85)");
    g.addColorStop(1, "rgba(10,6,22,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, W, band);
    c.restore();

    const cy = band * 0.42;
    drawText(c, `${this.score}`, W * 0.03, cy, fs, "#ffffff", "left", "800");
    drawText(c, "SCORE", W * 0.03, cy + fs * 0.72, fs * 0.42, "rgba(255,255,255,0.55)", "left");

    drawText(c, `LV ${this.level}`, W * 0.5, cy, fs * 0.92, "#9ff4ec");

    drawText(c, `${this.best}`, W * 0.97, cy, fs, "#ffd95c", "right", "800");
    drawText(c, "BEST", W * 0.97, cy + fs * 0.72, fs * 0.42, "rgba(255,255,255,0.55)", "right");

    // combo badge
    if (this.comboStep >= 1) {
      const mult = COMBO_STEPS[this.comboStep];
      const pulse = 1 + Math.sin(this.t * 10) * 0.06;
      drawText(
        c,
        `COMBO x${mult}`,
        W * 0.5,
        cy + fs * 0.9,
        fs * 0.5 * pulse,
        "#ff9f1c",
      );
    }

    // shots-until-descend pips
    const per = shotsPerDescent(this.level);
    const remain = per - (this.shotCount % per);
    const pips = per;
    const pr = Math.max(3, geo.R * 0.18);
    const totalW = pips * (pr * 2 + pr) - pr;
    let sx = W * 0.5 - totalW / 2;
    const sy = band * 0.86;
    for (let i = 0; i < pips; i++) {
      c.beginPath();
      c.arc(sx + pr, sy, pr, 0, Math.PI * 2);
      c.fillStyle = i < remain ? "#7c5cff" : "rgba(255,255,255,0.18)";
      c.fill();
      sx += pr * 3;
    }

    // danger warning
    if (danger > 0.7) {
      const a = (danger - 0.7) / 0.3;
      c.save();
      c.globalAlpha = a * (0.5 + Math.sin(this.t * 12) * 0.5);
      drawText(c, "DANGER!", W * 0.5, geo.deathY - geo.R, geo.R * 1.1, "#ff5c6c");
      c.restore();
    }
  }

  private renderPanel(title: string, subtitle: string, accent: string): void {
    const c = this.ctx.ctx;
    const geo = this.geo;
    c.save();
    c.fillStyle = "rgba(8,4,18,0.72)";
    c.fillRect(0, 0, geo.W, geo.H);
    const pw = Math.min(geo.W * 0.8, geo.R * 16);
    const ph = Math.min(geo.H * 0.42, geo.R * 9);
    const px = (geo.W - pw) / 2;
    const py = (geo.H - ph) / 2;
    c.fillStyle = "rgba(30,20,55,0.95)";
    roundRect(c, px, py, pw, ph, geo.R * 0.8);
    c.fill();
    c.strokeStyle = accent;
    c.lineWidth = Math.max(2, geo.R * 0.14);
    c.stroke();
    drawText(c, title, geo.W / 2, py + ph * 0.36, Math.min(geo.W * 0.08, geo.R * 1.8), accent);
    drawText(
      c,
      subtitle,
      geo.W / 2,
      py + ph * 0.64,
      Math.min(geo.W * 0.045, geo.R * 1.0),
      "rgba(255,255,255,0.8)",
      "center",
      "600",
    );
    c.restore();
  }

  // --------------------------------------------------------------- lifecycle

  resize(): void {
    this.geo = this.computeGeometry();
  }

  destroy(): void {
    this.particles.clear();
    this.grid.clear();
    this.falling = [];
    this.shot = null;
  }
}

// ------------------------------------------------------------------ helpers

function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

function hexWithAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
