/**
 * Neon Nexus — game orchestrator.
 *
 * Owns the state machine, scoring, combos/multiplier, multiball, the plunger and
 * all input handling, and drives the physics world + renderer. Implements the
 * engine's GameInstance contract.
 */
import type { GameContext, GameInstance } from "@/engine";
import { lerp, rng } from "@/engine";
import {
  TABLE_W,
  FIXED_DT,
  MAX_FRAME_DT,
  PLUNGER_CHARGE_TIME,
  MIN_LAUNCH,
  MAX_LAUNCH,
  START_BALLS,
  COMBO_TIMEOUT,
  MULTIPLIER_MAX,
  CORE_HITS_FOR_MB,
  HIT_DEBOUNCE,
  STUCK_SPEED,
  STUCK_TIME,
  STUCK_NUDGE,
  SCORE_BUMPER,
  SCORE_SLING,
  SCORE_STANDUP,
  SCORE_DROP,
  SCORE_DROP_BANK,
  SCORE_LANE,
  SCORE_LANE_SET,
  SCORE_CORE,
  SCORE_MULTIBALL_START,
  SCORE_JACKPOT,
  COLORS,
} from "./constants";
import { buildTable } from "./table";
import type { TableLayout } from "./table";
import { Ball } from "./ball";
import { Flipper } from "./flipper";
import { PhysicsWorld } from "./physics";
import type { HitEvent } from "./physics";
import { Effects } from "./effects";
import { Renderer, computeTransform } from "./render";
import type { GameState, PinballView } from "./render";

const BEST_KEY = "__best";

export class PinballGame implements GameInstance, PinballView {
  // ---- engine view fields (consumed by Renderer) ----
  ctx: CanvasRenderingContext2D;
  viewW = 0;
  viewH = 0;
  table: TableLayout;
  balls: Ball[] = [];
  flippers: Flipper[];
  effects = new Effects();
  t = 0;
  score = 0;
  highScore = 0;
  ballsRemaining = START_BALLS;
  multiplier = 1;
  combo = 0;
  state: GameState = "attract";
  status = "";
  banner = "";
  bannerT = 0;
  plungerPower = 0;
  ballWaiting = false;
  flash = new Map<string, number>();
  coreHits = 0;
  coreLit = false;
  multiball = false;

  // ---- internals ----
  private game: GameContext;
  private world: PhysicsWorld;
  private renderer = new Renderer();
  private accumulator = 0;
  private comboTimer = 0;
  private leftActive = false;
  private rightActive = false;
  private hitTimes = new Map<string, number>();
  private drainHold = 0;

  constructor(game: GameContext) {
    this.game = game;
    this.ctx = game.ctx;
    this.table = buildTable();
    this.flippers = this.table.flippers.map((s) => new Flipper(s));
    this.world = new PhysicsWorld(this.table, this.flippers);
    this.highScore = game.storage.get<number>(BEST_KEY, 0) ?? 0;

    game.requestControls([
      { type: "button", key: "ArrowLeft", label: "◀", id: "l" },
      { type: "button", key: "Space", label: "LAUNCH", id: "launch" },
      { type: "button", key: "ArrowRight", label: "▶", id: "r" },
    ]);

    this.enterAttract();
  }

  // ====================================================================
  // State transitions
  // ====================================================================
  private enterAttract() {
    this.state = "attract";
    this.balls = [this.makePlungerBall()];
    this.ballWaiting = true;
    this.game.setStatus("Hold LAUNCH to charge, release to fire");
    this.game.reportScore(0);
  }

  private startNewGame() {
    this.score = 0;
    this.ballsRemaining = START_BALLS;
    this.multiplier = 1;
    this.combo = 0;
    this.comboTimer = 0;
    this.multiball = false;
    this.coreHits = 0;
    this.coreLit = false;
    this.effects.clear();
    this.resetTargets();
    this.game.reportScore(0);
    this.serveBall();
  }

  private resetTargets() {
    for (const d of this.table.drops) d.dropped = false;
    for (const ln of this.table.lanes) ln.lit = false;
  }

  private makePlungerBall(): Ball {
    const p = this.table.plunger;
    const b = new Ball(p.laneCx, p.restY - 16);
    b.onPlunger = true;
    return b;
  }

  private serveBall() {
    this.balls = [this.makePlungerBall()];
    this.plungerPower = 0;
    this.ballWaiting = true;
    this.multiplier = 1;
    this.combo = 0;
    this.multiball = false;
    this.coreHits = 0;
    this.coreLit = false;
    this.state = "ready";
    const ballNo = START_BALLS - this.ballsRemaining + 1;
    this.game.setStatus(`Ball ${ballNo} of ${START_BALLS} — hold LAUNCH, release to fire`);
  }

  private launch() {
    const ball = this.balls.find((b) => b.onPlunger);
    if (!ball) return;
    const speed = lerp(MIN_LAUNCH, MAX_LAUNCH, this.plungerPower);
    ball.onPlunger = false;
    ball.vel.x = rng.range(-40, 10);
    ball.vel.y = -speed;
    this.plungerPower = 0;
    this.ballWaiting = false;
    this.state = "playing";
    this.game.audio.sweep(220, 760, 0.22, "sawtooth", 0.4);
    this.game.setStatus("");
  }

  private startMultiball() {
    this.multiball = true;
    this.coreLit = false;
    this.coreHits = 0;
    const core = this.table.core;
    for (let i = 0; i < 2; i++) {
      const a = -Math.PI / 2 + rng.range(-0.7, 0.7);
      const sp = rng.range(900, 1300);
      this.balls.push(new Ball(core.x, core.y - 30, Math.cos(a) * sp, Math.sin(a) * sp));
    }
    this.addScore(SCORE_MULTIBALL_START, core.x, core.y, "MULTIBALL!");
    this.setBanner("MULTIBALL!", 2.4);
    this.game.audio.win();
  }

  private gameOver() {
    this.state = "gameover";
    const isBest = this.game.storage.submitScore(this.score);
    if (isBest) this.highScore = this.score;
    else this.highScore = this.game.storage.get<number>(BEST_KEY, this.highScore) ?? this.highScore;
    this.game.audio.lose();
    this.game.setStatus("");
    this.game.gameOver(this.score);
  }

  // ====================================================================
  // Update
  // ====================================================================
  update(dt: number) {
    const d = Math.min(dt, MAX_FRAME_DT);
    this.t += dt;
    this.viewW = this.game.width;
    this.viewH = this.game.height;

    this.handleInput(d);
    this.effects.update(d);
    this.decayTimers(d);

    if (this.state === "playing") {
      this.accumulator += d;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 240) {
        for (const f of this.flippers) {
          f.update(FIXED_DT, f.spec.id === "L" ? this.leftActive : this.rightActive);
        }
        const events = this.world.step(this.balls, FIXED_DT);
        this.processEvents(events);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      for (const b of this.balls) b.recordTrail(d);
      this.checkLanes();
      this.checkStuck(d);
      this.checkDrains();
    } else {
      // keep flippers responsive/animated outside active play
      for (const f of this.flippers) {
        f.update(d, f.spec.id === "L" ? this.leftActive : this.rightActive);
      }
      if (this.state === "ready") this.pinPlungerBall();
      if (this.state === "drain") {
        this.drainHold -= d;
        if (this.drainHold <= 0) {
          if (this.ballsRemaining <= 0) this.gameOver();
          else this.serveBall();
        }
      }
    }
  }

  private decayTimers(d: number) {
    if (this.bannerT > 0) this.bannerT -= d;
    if (this.comboTimer > 0) {
      this.comboTimer -= d;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    for (const [k, val] of this.flash) {
      const nv = val - d * 4;
      if (nv <= 0) this.flash.delete(k);
      else this.flash.set(k, nv);
    }
  }

  // ====================================================================
  // Input
  // ====================================================================
  private handleInput(d: number) {
    const input = this.game.input;
    const launchPressed = input.pressed("Space", "ArrowDown");
    const launchDown = input.isDown("Space", "ArrowDown");
    const launchReleased = input.released("Space", "ArrowDown");
    const tapDown = input.pointer.justDown;

    if (this.state === "attract") {
      this.computeFlipperFlags();
      if (launchPressed || tapDown) {
        this.startNewGame();
        if (launchDown) this.plungerPower = Math.min(1, d / PLUNGER_CHARGE_TIME);
      }
      return;
    }

    if (this.state === "gameover") {
      this.leftActive = false;
      this.rightActive = false;
      if (launchPressed || tapDown) this.startNewGame();
      return;
    }

    if (this.state === "drain") {
      this.leftActive = false;
      this.rightActive = false;
      return;
    }

    // ready / playing
    this.computeFlipperFlags();

    if (this.state === "ready") {
      if (launchDown) {
        this.plungerPower = Math.min(1, this.plungerPower + d / PLUNGER_CHARGE_TIME);
      }
      if (launchReleased) this.launch();
    }
  }

  private computeFlipperFlags() {
    const input = this.game.input;
    let l = input.isDown("ArrowLeft", "a");
    let r = input.isDown("ArrowRight", "d");
    const tf = computeTransform(this.game.width, this.game.height);
    for (const p of input.pointers.values()) {
      const tx = (p.x - tf.ox) / tf.scale;
      if (tx < TABLE_W / 2) l = true;
      else r = true;
    }
    this.leftActive = l;
    this.rightActive = r;
  }

  private pinPlungerBall() {
    const ball = this.balls.find((b) => b.onPlunger);
    if (!ball) return;
    const p = this.table.plunger;
    ball.pos.x = p.laneCx;
    ball.pos.y = p.restY - 16 + this.plungerPower * 40;
    ball.vel.x = 0;
    ball.vel.y = 0;
    ball.trail.length = 0;
  }

  // ====================================================================
  // Event processing / scoring
  // ====================================================================
  private canHit(id: string): boolean {
    const last = this.hitTimes.get(id) ?? -1;
    if (this.t - last < HIT_DEBOUNCE) return false;
    this.hitTimes.set(id, this.t);
    return true;
  }

  private processEvents(events: HitEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case "bumper": {
          if (!this.canHit("bm:" + e.id)) break;
          this.flash.set(e.id ?? "", 1);
          this.effects.ring(e.px, e.py, COLORS.bumper, 12, 320);
          this.effects.shake(4);
          const pitch = 620 + Math.min(8, this.combo) * 40;
          this.game.audio.tone(pitch, 0.07, "square", 0.32);
          if (this.multiball) this.addScore(SCORE_JACKPOT, e.px, e.py, "JACKPOT");
          else this.addScore(SCORE_BUMPER, e.px, e.py);
          break;
        }
        case "sling": {
          if (!this.canHit("sl:" + e.id)) break;
          this.flash.set(e.id ?? "", 1);
          this.effects.burst(e.px, e.py, COLORS.sling, 8, 360);
          this.game.audio.blip();
          this.addScore(SCORE_SLING, e.px, e.py);
          break;
        }
        case "drop": {
          if (!this.canHit("dr:" + e.id)) break;
          const drop = this.table.drops.find((x) => x.id === e.id);
          if (drop && !drop.dropped) {
            drop.dropped = true;
            this.flash.set(e.id ?? "", 1);
            this.effects.burst(e.px, e.py, COLORS.drop, 10, 340);
            this.game.audio.coin();
            this.addScore(SCORE_DROP, e.px, e.py);
            if (this.table.drops.every((x) => x.dropped)) this.completeDropBank();
          }
          break;
        }
        case "standup": {
          if (!this.canHit("su:" + e.id)) break;
          this.flash.set(e.id ?? "", 1);
          this.effects.burst(e.px, e.py, COLORS.standup, 8, 320);
          this.game.audio.coin();
          this.addScore(SCORE_STANDUP, e.px, e.py);
          break;
        }
        case "core": {
          if (!this.canHit("core")) break;
          this.flash.set("core", 1);
          this.effects.ring(e.px, e.py, COLORS.core, 14, 300);
          this.addScore(SCORE_CORE, e.px, e.py);
          if (this.coreLit) {
            this.startMultiball();
          } else {
            this.coreHits++;
            this.game.audio.tone(440 + this.coreHits * 90, 0.1, "triangle", 0.35);
            if (this.coreHits >= CORE_HITS_FOR_MB) {
              this.coreLit = true;
              this.setBanner("MULTIBALL LIT — HIT CORE", 2.2);
            }
          }
          break;
        }
        case "flipper": {
          if (!this.canHit("fl:" + e.id)) break;
          if (e.speed > 200) this.game.audio.tone(150, 0.05, "square", 0.22);
          break;
        }
        case "wall":
        default:
          break;
      }
    }
  }

  private addScore(base: number, x: number, y: number, label?: string) {
    this.combo++;
    this.comboTimer = COMBO_TIMEOUT;
    const mb = this.multiball ? 2 : 1;
    const comboBonus = this.combo > 1 ? this.combo * 10 : 0;
    const pts = Math.round(base * this.multiplier * mb) + comboBonus;
    this.score += pts;
    this.game.reportScore(this.score);
    const col = label ? COLORS.core : COLORS.text;
    this.effects.popup(x, y, label ?? `+${pts.toLocaleString()}`, col);
  }

  private raiseMultiplier() {
    if (this.multiplier < MULTIPLIER_MAX) this.multiplier++;
  }

  private completeDropBank() {
    this.addScore(SCORE_DROP_BANK, this.table.core.x, 300, "BANK!");
    this.raiseMultiplier();
    this.setBanner(`MULTIPLIER ×${this.multiplier}`, 1.8);
    this.game.audio.win();
    this.effects.shake(6);
    // re-pop the bank for continuous play
    for (const d of this.table.drops) d.dropped = false;
  }

  private checkLanes() {
    for (const ln of this.table.lanes) {
      if (ln.lit) continue;
      for (const b of this.balls) {
        if (!b.alive || b.onPlunger) continue;
        const dx = b.pos.x - ln.x;
        const dy = b.pos.y - ln.y;
        if (dx * dx + dy * dy < ln.r * ln.r) {
          ln.lit = true;
          this.effects.burst(ln.x, ln.y, COLORS.lane, 8, 260);
          this.game.audio.tone(700, 0.06, "triangle", 0.3);
          this.addScore(SCORE_LANE, ln.x, ln.y);
          break;
        }
      }
    }
    if (this.table.lanes.every((l) => l.lit)) {
      this.addScore(SCORE_LANE_SET, TABLE_W / 2, 150, "N-E-X!");
      this.raiseMultiplier();
      this.setBanner("NEXUS BONUS", 1.8);
      this.game.audio.win();
      for (const l of this.table.lanes) l.lit = false;
    }
  }

  private checkStuck(d: number) {
    for (const b of this.balls) {
      if (!b.alive || b.onPlunger) continue;
      if (b.speed() < STUCK_SPEED) {
        b.stuckTimer += d;
        if (b.stuckTimer > STUCK_TIME) {
          const dir = b.pos.x < TABLE_W / 2 ? 1 : -1;
          b.vel.x += dir * STUCK_NUDGE;
          b.vel.y -= STUCK_NUDGE * 0.6;
          b.stuckTimer = 0;
        }
      } else {
        b.stuckTimer = 0;
      }
    }
  }

  private checkDrains() {
    const drainY = this.table.drainY;
    let drainedAny = false;
    for (const b of this.balls) {
      if (b.alive && !b.onPlunger && b.pos.y > drainY) {
        b.alive = false;
        drainedAny = true;
        this.effects.burst(b.pos.x, Math.min(b.pos.y, drainY + 10), "#ff6a8a", 10, 300);
      }
    }
    if (!drainedAny) return;
    this.balls = this.balls.filter((b) => b.alive);
    const inPlay = this.balls.filter((b) => !b.onPlunger).length;
    if (inPlay <= 1 && this.multiball) {
      this.multiball = false;
      this.setBanner("", 0);
    }
    if (inPlay === 0) this.loseBall();
  }

  private loseBall() {
    this.ballsRemaining--;
    this.multiball = false;
    this.multiplier = 1;
    this.combo = 0;
    this.balls = [];
    this.game.audio.tone(200, 0.25, "sawtooth", 0.3);
    this.effects.shake(8);
    this.state = "drain";
    this.drainHold = 1.1;
  }

  private setBanner(text: string, dur: number) {
    this.banner = text;
    this.bannerT = dur;
  }

  // ====================================================================
  // Render / lifecycle
  // ====================================================================
  render() {
    this.viewW = this.game.width;
    this.viewH = this.game.height;
    this.renderer.render(this);
  }

  resize() {
    this.viewW = this.game.width;
    this.viewH = this.game.height;
  }

  destroy() {
    this.effects.clear();
  }
}
