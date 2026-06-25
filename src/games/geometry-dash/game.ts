/** Neon Dash — core game: state machine, physics, collision, modes. */
import type { GameContext } from "@/engine";
import { clamp } from "@/engine";
import {
  Cell,
  CEIL_BOTTOM_ROW,
  CHECKPOINT_INTERVAL,
  COYOTE,
  CUBE_INSET,
  DEATH_HOLD,
  EPS,
  FLOOR_TOP_ROW,
  GRAVITY,
  GRID_ROWS,
  GROUND_CUBE_ROW,
  JUMP_BUFFER,
  JUMP_VEL,
  MAX_FALL,
  MIN_VISIBLE_COLS,
  ORB_COOLDOWN,
  ORB_VEL,
  PAD_VEL,
  PLAYER_SCREEN_FRAC,
  SHIP_GRAV,
  SHIP_MAX_V,
  SHIP_THRUST,
  CELLS_PER_BEAT,
  SUBSTEP_CAP,
  SUBSTEP_MAX_MOVE,
} from "./constants";
import { cellAt, compileLevel } from "./level";
import { LEVELS } from "./levels";
import { MusicEngine } from "./music";
import { Particles } from "./particles";
import { Renderer } from "./render";
import type { CompiledLevel, Mode, Snapshot } from "./types";

export type GameState = "select" | "countdown" | "playing" | "death" | "complete";

export interface View {
  W: number;
  H: number;
  cs: number; // cell size (px)
  oy: number; // vertical origin (px)
  psx: number; // player screen x (px)
}

export interface UIRect {
  x: number;
  y: number;
  w: number;
  h: number;
  id: number;
}

const LAND_EPS = 0.12;

export class NeonDash {
  ctx: GameContext;
  renderer: Renderer;
  music: MusicEngine;
  particles = new Particles();

  // levels
  compiled: CompiledLevel[];
  levelIndex = 0;
  finishCol = 1;

  // state
  state: GameState = "select";
  selIndex = 0;
  practice = false;

  // physics (cells / seconds)
  scrollX = 0;
  py = GROUND_CUBE_ROW;
  vy = 0;
  gravDir: 1 | -1 = 1;
  mode: Mode = "cube";
  rot = 0;
  grounded = true;
  speed = 5;

  // input timers
  private jumpBufferT = 0;
  private coyoteT = 0;
  private orbCdT = 0;
  private wasGrounded = true;

  // triggers consumed
  private portalsHit = new Set<number>();
  private padsHit = new Set<number>();
  private orbsUsed = new Set<number>();

  // timing / fx
  clock = 0;
  levelTime = 0;
  countdownT = 0;
  deathT = 0;
  flash = 0;
  shake = 0;
  pulse = 0;
  private lastBeat = -1;
  beatIndex = 0;

  // progress / scoring
  progress = 0;
  attempts = 0;
  bestPct: number[] = [0, 0, 0];

  // practice checkpoints
  private snapshots: Snapshot[] = [];
  private checkpointT = 0;

  v: View = { W: 1, H: 1, cs: 1, oy: 0, psx: 0 };

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.compiled = LEVELS.map((l) => compileLevel(l));
    this.music = new MusicEngine(ctx.audio, LEVELS[0].meta.song);
    this.renderer = new Renderer();

    for (let i = 0; i < this.compiled.length; i++) {
      this.bestPct[i] = clamp(
        Math.floor(ctx.storage.get<number>("best." + this.compiled[i].meta.id, 0)),
        0,
        100,
      );
    }
    this.reportOverall();

    ctx.requestControls([{ type: "button", key: "Space", label: "JUMP", id: "jump" }]);
    ctx.setStatus("Tap / Space to jump · pick a level");
  }

  // ---- projection -------------------------------------------------------
  private project(): void {
    const W = this.ctx.width;
    const H = this.ctx.height;
    const cs = Math.min(H / GRID_ROWS, W / MIN_VISIBLE_COLS);
    const oy = (H - GRID_ROWS * cs) / 2;
    const psx = W * PLAYER_SCREEN_FRAC;
    this.v = { W, H, cs, oy, psx };
  }

  sx(col: number): number {
    return this.v.psx + (col - this.scrollX) * this.v.cs;
  }
  sy(row: number): number {
    return this.v.oy + row * this.v.cs;
  }

  cubeCenterPx(): { x: number; y: number } {
    return { x: this.sx(this.scrollX + 0.5), y: this.sy(this.py + 0.5) };
  }
  cubeFeetPx(): { x: number; y: number } {
    const feetRow = this.gravDir === 1 ? this.py + 1 : this.py;
    return { x: this.sx(this.scrollX + 0.5), y: this.sy(feetRow) };
  }

  get level(): CompiledLevel {
    return this.compiled[this.levelIndex];
  }

  // ---- lifecycle --------------------------------------------------------
  startLevel(index: number): void {
    this.levelIndex = index;
    this.finishCol = Math.max(1, this.level.cols - 6);
    this.music.setSong(this.level.meta.song);
    this.speed = (CELLS_PER_BEAT * this.level.meta.song.bpm) / 60;
    this.attempts = 1;
    this.snapshots = [];
    this.resetRun(null);
    this.state = "countdown";
    this.countdownT = 1.7;
    this.ctx.setStatus(this.level.meta.name + " — hold to jump");
  }

  private resetRun(snap: Snapshot | null): void {
    this.particles.clear();
    this.flash = 0;
    this.shake = 0;
    this.checkpointT = 0;
    this.orbCdT = 0;
    this.jumpBufferT = 0;
    this.coyoteT = 0;
    this.lastBeat = -1;
    if (snap) {
      this.scrollX = snap.scrollX;
      this.py = snap.py;
      this.vy = snap.vy;
      this.gravDir = snap.gravDir;
      this.mode = snap.mode;
      this.levelTime = snap.levelTime;
      this.rot = snap.rot;
      // re-arm triggers that are still ahead of us
      this.portalsHit = new Set(
        this.level.portals.map((p, i) => (p.col + 0.5 < snap.scrollX + 0.5 ? i : -1)).filter((i) => i >= 0),
      );
      this.padsHit = new Set();
      this.orbsUsed = new Set();
    } else {
      this.scrollX = 0;
      this.py = GROUND_CUBE_ROW;
      this.vy = 0;
      this.gravDir = 1;
      this.mode = "cube";
      this.levelTime = 0;
      this.rot = 0;
      this.portalsHit.clear();
      this.padsHit.clear();
      this.orbsUsed.clear();
    }
    this.grounded = true;
    this.wasGrounded = true;
    this.progress = clamp(this.scrollX / this.finishCol, 0, 1);
    this.music.reset();
  }

  private die(): void {
    if (this.state !== "playing") return;
    this.state = "death";
    this.deathT = DEATH_HOLD;
    this.flash = 1;
    this.shake = 1;
    const p = this.cubeCenterPx();
    this.particles.shatter(p.x, p.y, this.level.meta.accent, this.v.cs);
    this.particles.shatter(p.x, p.y, "#ffffff", this.v.cs * 0.7);
    this.music.death();
    this.recordProgress();
  }

  private win(): void {
    this.state = "complete";
    this.progress = 1;
    this.flash = 0.6;
    const p = this.cubeCenterPx();
    this.particles.burst(p.x, p.y, 40, this.level.meta.accent, 520, { upBias: 120, size: 5 });
    this.particles.burst(p.x, p.y, 30, this.level.meta.glow, 380, { upBias: 90, size: 4 });
    this.music.win();
    this.bestPct[this.levelIndex] = 100;
    this.ctx.storage.set("best." + this.level.meta.id, 100);
    this.reportOverall();
  }

  private recordProgress(): void {
    if (this.practice) return; // practice runs don't count
    const pct = Math.floor(this.progress * 100);
    if (pct > this.bestPct[this.levelIndex]) {
      this.bestPct[this.levelIndex] = pct;
      this.ctx.storage.set("best." + this.level.meta.id, pct);
    }
    this.reportOverall();
  }

  private reportOverall(): void {
    const overall = Math.max(0, ...this.bestPct);
    this.ctx.reportScore(overall);
    try {
      this.ctx.storage.submitScore(overall, false);
    } catch {
      /* ignore */
    }
  }

  // ---- input helpers ----------------------------------------------------
  private jumpPressed(): boolean {
    return this.ctx.input.pressed("Space", "ArrowUp", "w") || this.ctx.input.pointer.justDown;
  }
  private jumpHeld(): boolean {
    return this.ctx.input.isDown("Space", "ArrowUp", "w") || this.ctx.input.pointer.down;
  }

  // ---- collision queries ------------------------------------------------
  private worldFloorAt(col: number): boolean {
    return col >= 0 && col < this.level.cols && this.level.floor[col];
  }

  private isSolidBlock(col: number, row: number): boolean {
    return cellAt(this.level, col, row) === Cell.BLOCK;
  }

  /** grounded test: a solid just on the gravity side of the cube's feet. */
  private computeGrounded(): boolean {
    const cL = Math.floor(this.scrollX + 0.001);
    const cR = Math.floor(this.scrollX + 1 - 0.001);
    if (this.gravDir === 1) {
      const probe = this.py + 1 + 0.06;
      const pr = Math.floor(probe);
      for (let col = cL; col <= cR; col++) {
        if (this.isSolidBlock(col, pr) && pr < FLOOR_TOP_ROW) {
          if (this.py + 1 >= pr - 0.1) return true;
        }
        if (pr >= FLOOR_TOP_ROW && this.worldFloorAt(col)) return true;
      }
    } else {
      const probe = this.py - 0.06;
      const pr = Math.floor(probe);
      for (let col = cL; col <= cR; col++) {
        if (this.isSolidBlock(col, pr) && pr >= CEIL_BOTTOM_ROW) {
          if (this.py <= pr + 1 + 0.1) return true;
        }
        if (pr < CEIL_BOTTOM_ROW) return true;
      }
    }
    return false;
  }

  // ---- main update ------------------------------------------------------
  update(dt: number): void {
    this.project();
    if (this.v.W <= 0 || this.v.H <= 0) return;
    this.clock += dt;

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.orbCdT > 0) this.orbCdT -= dt;
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.4);
    this.particles.update(dt);

    switch (this.state) {
      case "select":
        this.updateSelect();
        break;
      case "countdown":
        this.countdownT -= dt;
        if (this.countdownT <= 0) {
          this.state = "playing";
          this.levelTime = 0;
        }
        break;
      case "playing":
        this.updatePlaying(dt);
        break;
      case "death":
        this.deathT -= dt;
        if (this.deathT <= 0) {
          const snap = this.practice && this.snapshots.length > 0
            ? this.snapshots[this.snapshots.length - 1]
            : null;
          this.resetRun(snap);
          this.state = "playing";
          this.attempts++;
        }
        break;
      case "complete":
        this.updateComplete();
        break;
    }
  }

  private updatePlaying(dt: number): void {
    this.levelTime += dt;
    this.music.update(this.levelTime);

    // beat pulse
    const beatDur = 60 / this.level.meta.song.bpm;
    const beat = Math.floor(this.levelTime / beatDur);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.beatIndex = beat;
      this.pulse = 1;
    }

    // frame-level input
    if (this.jumpPressed()) this.jumpBufferT = JUMP_BUFFER;
    else this.jumpBufferT = Math.max(0, this.jumpBufferT - dt);
    const held = this.jumpHeld();
    const orbInput = this.jumpPressed() || this.jumpBufferT > 0;

    // sub-stepped physics
    const maxMove = Math.max(Math.abs(this.speed), Math.abs(this.vy)) * dt;
    const steps = clamp(Math.ceil(maxMove / SUBSTEP_MAX_MOVE), 1, SUBSTEP_CAP);
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      if (this.simSubstep(sdt, held, orbInput)) {
        this.die();
        return;
      }
    }

    // trail + running particles
    const c = this.cubeCenterPx();
    this.particles.pushTrail(c.x, c.y, this.rot);
    if (this.grounded && this.mode === "cube" && Math.random() < 0.5) {
      const f = this.cubeFeetPx();
      this.particles.burst(f.x - this.v.cs * 0.3, f.y, 1, this.level.meta.glow, 40, {
        grav: 200,
        size: this.v.cs * 0.08,
      });
    }

    // checkpoints (practice)
    if (this.practice) {
      this.checkpointT += dt;
      if (this.checkpointT >= CHECKPOINT_INTERVAL && this.grounded && this.mode === "cube") {
        this.checkpointT = 0;
        this.snapshots.push({
          scrollX: this.scrollX,
          py: this.py,
          vy: this.vy,
          gravDir: this.gravDir,
          mode: this.mode,
          levelTime: this.levelTime,
          rot: this.rot,
        });
        const cp = this.cubeCenterPx();
        this.particles.ring(cp.x, cp.y, "#5cff9e", this.v.cs * 1.2);
        this.music.checkpoint();
      }
    }

    this.progress = clamp(this.scrollX / this.finishCol, 0, 1);
    if (this.scrollX >= this.finishCol) {
      this.win();
      return;
    }
  }

  /** One physics sub-step. Returns true if the cube died. */
  private simSubstep(sdt: number, held: boolean, allowFreshPress: boolean): boolean {
    const prevPy = this.py;

    // integrate
    this.scrollX += this.speed * sdt;
    if (this.mode === "cube") {
      this.vy += GRAVITY * this.gravDir * sdt;
      this.vy = clamp(this.vy, -MAX_FALL, MAX_FALL);
    } else {
      this.vy += SHIP_GRAV * this.gravDir * sdt;
      if (held) this.vy += -SHIP_THRUST * this.gravDir * sdt;
      this.vy = clamp(this.vy, -SHIP_MAX_V, SHIP_MAX_V);
    }
    this.py += this.vy * sdt;

    // portals
    this.checkPortals();

    // resolve solids (blocks + world floor/ceiling)
    if (this.resolveSolids(prevPy)) return true;

    // grounded
    this.grounded = this.computeGrounded();
    if (this.grounded) this.coyoteT = COYOTE;
    else this.coyoteT = Math.max(0, this.coyoteT - sdt);

    // pads (auto) + orbs (press)
    this.checkPadsOrbs(allowFreshPress);

    // jump (cube mode)
    if (this.mode === "cube") {
      const canJump = this.grounded || this.coyoteT > 0;
      const wantHold = this.grounded && held;
      const wantBuffered = this.jumpBufferT > 0 && canJump;
      if (wantHold || wantBuffered) {
        this.doJump();
        this.jumpBufferT = 0;
        this.coyoteT = 0;
      }
    }

    // rotation
    if (this.mode === "cube") {
      if (this.grounded) {
        const q = Math.PI / 2;
        const target = Math.round(this.rot / q) * q;
        this.rot += (target - this.rot) * Math.min(1, sdt * 22);
      } else {
        this.rot += sdt * 6.2 * this.gravDir;
      }
    } else {
      const tilt = clamp((this.vy / SHIP_MAX_V) * 0.5, -0.6, 0.6) * this.gravDir;
      this.rot += (tilt - this.rot) * Math.min(1, sdt * 12);
    }

    // spikes
    if (this.hitSpike()) return true;

    // pit / out of bounds
    if (this.py > FLOOR_TOP_ROW + 1.6 || this.py < CEIL_BOTTOM_ROW - 3.6) return true;

    this.wasGrounded = this.grounded;
    return false;
  }

  private doJump(): void {
    this.vy = -JUMP_VEL * this.gravDir;
    this.grounded = false;
    const f = this.cubeFeetPx();
    this.particles.burst(f.x, f.y, 6, this.level.meta.glow, 120, { grav: 500, size: this.v.cs * 0.12 });
    this.music.jump();
  }

  private checkPortals(): void {
    const cx = this.scrollX + 0.5;
    const portals = this.level.portals;
    for (let i = 0; i < portals.length; i++) {
      if (this.portalsHit.has(i)) continue;
      if (cx >= portals[i].col + 0.5) {
        this.portalsHit.add(i);
        const t = portals[i].type;
        if (t === Cell.PORTAL_FLIP) {
          this.gravDir = this.gravDir === 1 ? -1 : 1;
        } else if (t === Cell.PORTAL_SHIP) {
          this.mode = "ship";
        } else if (t === Cell.PORTAL_CUBE) {
          this.mode = "cube";
        }
        const p = this.cubeCenterPx();
        this.particles.ring(p.x, p.y, this.level.meta.accent, this.v.cs * 1.6);
        this.music.portal();
      }
    }
  }

  private checkPadsOrbs(allowFreshPress: boolean): void {
    const cL = Math.floor(this.scrollX + 0.001);
    const cR = Math.floor(this.scrollX + 1 - 0.001);
    const cby0 = this.py + CUBE_INSET;
    const cby1 = this.py + 1 - CUBE_INSET;
    for (let col = cL; col <= cR; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const cell = cellAt(this.level, col, row);
        if (cell === Cell.PAD) {
          if (this.padsHit.has(col * GRID_ROWS + row)) continue;
          if (cby1 > row + 0.1 && cby0 < row + 1) {
            this.padsHit.add(col * GRID_ROWS + row);
            this.vy = -PAD_VEL * this.gravDir;
            this.grounded = false;
            const p = this.cubeCenterPx();
            this.particles.ring(p.x, p.y, "#ffe14a", this.v.cs * 1.4);
            this.particles.burst(p.x, p.y, 10, "#ffe14a", 240, { grav: 300, size: this.v.cs * 0.12 });
            this.music.pad();
          }
        } else if (cell === Cell.ORB) {
          if (!allowFreshPress) continue;
          if (this.orbCdT > 0) continue;
          const key = col * GRID_ROWS + row;
          if (this.orbsUsed.has(key)) continue;
          if (cby1 > row && cby0 < row + 1) {
            this.orbsUsed.add(key);
            this.orbCdT = ORB_COOLDOWN;
            this.vy = -ORB_VEL * this.gravDir;
            this.grounded = false;
            const p = this.cubeCenterPx();
            this.particles.ring(p.x, p.y, "#ff5cc8", this.v.cs * 1.3);
            this.particles.burst(p.x, p.y, 8, "#ff5cc8", 200, { grav: 200, size: this.v.cs * 0.1 });
            this.music.orb();
          }
        }
      }
    }
  }

  /** Resolve blocks + world floor/ceiling. Returns true on death. */
  private resolveSolids(prevPy: number): boolean {
    const bx0 = this.scrollX;
    const bx1 = this.scrollX + 1;
    let by0 = this.py;
    let by1 = this.py + 1;
    const pby0 = prevPy;
    const pby1 = prevPy + 1;
    const cL = Math.floor(bx0 - 0.001);
    const cR = Math.floor(bx1 + 0.001);

    for (let col = cL; col <= cR; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        // 0 = none, 1 = block (lethal), 2 = world floor, 3 = world ceiling
        let kind = 0;
        if (this.isSolidBlock(col, row)) kind = 1;
        else if (row >= FLOOR_TOP_ROW && this.worldFloorAt(col)) kind = 2;
        else if (row < CEIL_BOTTOM_ROW) kind = 3;
        if (kind === 0) continue;

        const cx0 = col;
        const cx1 = col + 1;
        const cy0 = row;
        const cy1 = row + 1;
        const ox = Math.min(bx1, cx1) - Math.max(bx0, cx0);
        const oy = Math.min(by1, cy1) - Math.max(by0, cy0);
        if (ox <= EPS || oy <= EPS) continue;

        const fromTop = pby1 <= cy0 + LAND_EPS && this.vy >= -EPS;
        const fromBot = pby0 >= cy1 - LAND_EPS && this.vy <= EPS;

        if (kind === 2) {
          if (fromTop) {
            this.py = cy0 - 1;
            this.vy = 0;
            if (this.gravDir === 1) this.grounded = true;
            by0 = this.py;
            by1 = this.py + 1;
          }
          continue;
        }
        if (kind === 3) {
          if (fromBot) {
            this.py = cy1;
            this.vy = 0;
            if (this.gravDir === -1) this.grounded = true;
            by0 = this.py;
            by1 = this.py + 1;
          }
          continue;
        }
        // kind === 1: lethal block
        if (fromTop && this.gravDir === 1) {
          this.py = cy0 - 1;
          this.vy = 0;
          this.grounded = true;
          by0 = this.py;
          by1 = this.py + 1;
          continue;
        }
        if (fromBot && this.gravDir === -1) {
          this.py = cy1;
          this.vy = 0;
          this.grounded = true;
          by0 = this.py;
          by1 = this.py + 1;
          continue;
        }
        return true; // genuine side / wrong-face contact
      }
    }
    return false;
  }

  private hitSpike(): boolean {
    const cbx0 = this.scrollX + CUBE_INSET;
    const cbx1 = this.scrollX + 1 - CUBE_INSET;
    const cby0 = this.py + CUBE_INSET;
    const cby1 = this.py + 1 - CUBE_INSET;
    const cL = Math.floor(this.scrollX - 0.001);
    const cR = Math.floor(this.scrollX + 1 + 0.001);
    for (let col = cL; col <= cR; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const cell = cellAt(this.level, col, row);
        if (cell !== Cell.SPIKE_UP && cell !== Cell.SPIKE_DOWN) continue;
        const sx0 = col + 0.28;
        const sx1 = col + 1 - 0.28;
        let sy0: number;
        let sy1: number;
        if (cell === Cell.SPIKE_UP) {
          sy0 = row + 0.34;
          sy1 = row + 1;
        } else {
          sy0 = row;
          sy1 = row + 1 - 0.34;
        }
        if (cbx0 < sx1 && cbx1 > sx0 && cby0 < sy1 && cby1 > sy0) return true;
      }
    }
    return false;
  }

  // ---- select / complete UI --------------------------------------------
  selectLayout(): UIRect[] {
    const { W, H } = this.v;
    const n = this.compiled.length;
    const cardW = Math.min(W * 0.26, H * 0.42);
    const cardH = cardW * 1.28;
    const gap = cardW * 0.16;
    const totalW = n * cardW + (n - 1) * gap;
    const x0 = (W - totalW) / 2;
    const y = H * 0.34;
    const rects: UIRect[] = [];
    for (let i = 0; i < n; i++) {
      rects.push({ x: x0 + i * (cardW + gap), y, w: cardW, h: cardH, id: i });
    }
    return rects;
  }

  practiceToggleRect(): UIRect {
    const { W, H } = this.v;
    const w = Math.min(W * 0.34, 280);
    const h = H * 0.08;
    return { x: (W - w) / 2, y: H * 0.84, w, h, id: 100 };
  }

  completeButtons(): UIRect[] {
    const { W, H } = this.v;
    const bw = Math.min(W * 0.24, 200);
    const bh = H * 0.11;
    const gap = bw * 0.18;
    const total = 3 * bw + 2 * gap;
    const x0 = (W - total) / 2;
    const y = H * 0.62;
    return [
      { x: x0, y, w: bw, h: bh, id: 0 }, // next
      { x: x0 + bw + gap, y, w: bw, h: bh, id: 1 }, // retry
      { x: x0 + 2 * (bw + gap), y, w: bw, h: bh, id: 2 }, // menu
    ];
  }

  private pointerHit(r: UIRect): boolean {
    const p = this.ctx.input.pointer;
    return (
      p.justDown && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    );
  }

  private updateSelect(): void {
    const input = this.ctx.input;
    const n = this.compiled.length;
    if (input.pressed("ArrowRight", "d")) this.selIndex = (this.selIndex + 1) % n;
    if (input.pressed("ArrowLeft", "a")) this.selIndex = (this.selIndex - 1 + n) % n;
    if (input.pressed("p")) this.practice = !this.practice;
    if (input.pressed("Space", "Enter", "ArrowUp", "w")) {
      this.startLevel(this.selIndex);
      return;
    }
    for (const r of this.selectLayout()) {
      if (this.pointerHit(r)) {
        this.selIndex = r.id;
        this.startLevel(r.id);
        return;
      }
    }
    if (this.pointerHit(this.practiceToggleRect())) this.practice = !this.practice;
  }

  private updateComplete(): void {
    const input = this.ctx.input;
    const btns = this.completeButtons();
    const next = () => {
      const ni = (this.levelIndex + 1) % this.compiled.length;
      this.startLevel(ni);
    };
    if (input.pressed("Enter", "Space")) {
      this.startLevel(this.levelIndex);
      return;
    }
    if (input.pressed("ArrowRight", "d")) {
      next();
      return;
    }
    if (input.pressed("Escape", "m")) {
      this.state = "select";
      return;
    }
    for (const b of btns) {
      if (this.pointerHit(b)) {
        if (b.id === 0) next();
        else if (b.id === 1) this.startLevel(this.levelIndex);
        else this.state = "select";
        return;
      }
    }
  }

  // ---- render -----------------------------------------------------------
  render(): void {
    this.project();
    if (this.v.W <= 0 || this.v.H <= 0) return;
    this.renderer.render(this);
  }

  resize(): void {
    this.project();
  }
}
