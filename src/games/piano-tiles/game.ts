/** Tap Cascade — core game class.
 *
 * Implements the full state machine (menu → countdown → playing → dying/complete
 * → gameover), input handling (keyboard + multi-touch), tile spawning/movement,
 * hit/miss resolution, scoring, and all rendering. See PRD.md for the design. */

import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, lerp, mulberry32, roundRect } from "@/engine";

import type {
  Beatmap,
  GameState,
  Judgment,
  Layout,
  LaneFx,
  Tile,
} from "./types";
import { SONGS, makeEndlessBeatmap, EndlessGen } from "./songs";
import { Sound } from "./sound";
import { ParticleSystem } from "./particles";
import { PALETTE, darken, lighten, rgba } from "./theme";

const LANES = 4;
const TAU = Math.PI * 2;
const COUNTDOWN_TIME = 2.2;

/** Lane key bindings (each lane accepts several keys). */
const LANE_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ["d", "a", "1", "ArrowLeft"],
  ["f", "s", "2"],
  ["j", "3", "ArrowDown"],
  ["k", "l", "4", "ArrowRight"],
];
const LANE_LABELS = ["D", "F", "J", "K"] as const;

interface Star {
  nx: number;
  ny: number;
  r: number;
  phase: number;
}

interface MenuItem {
  title: string;
  subtitle: string;
  accent: string;
  endless: boolean;
  songIndex: number;
}

interface MenuCard {
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
}

interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  label: string;
}

interface RunSummary {
  score: number;
  maxCombo: number;
  accuracy: number;
  tiles: number;
  cleared: boolean;
  best: number;
  newBest: boolean;
  title: string;
}

export class PianoTiles implements GameInstance {
  private readonly ctx: GameContext;
  private readonly sound: Sound;
  private readonly fx: ParticleSystem;

  private state: GameState = "menu";
  private t = 0; // real-time accumulator for animations
  private paused = false;

  // menu
  private readonly items: MenuItem[];
  private selIndex = 0;

  // run state
  private beatmap: Beatmap | null = null;
  private accent: string = PALETTE.great;
  private songTime = 0;
  private spb = 0.5;
  private speed = 600;
  private lead = 1.3;
  private tiles: Tile[] = [];
  private spawnIndex = 0;
  private endless: EndlessGen | null = null;
  private tileIdSeq = 0;

  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private tilesHit = 0;
  private accSum = 0;
  private comboScale = 1;

  // transition timers
  private cdInt = 99;
  private dyingT = 0;
  private completeT = 0;
  private gameOverFired = false;
  private summary: RunSummary | null = null;

  // visual fx
  private laneFx: LaneFx[] = [];
  private flashAlpha = 0;
  private flashColor = "#ffffff";
  private hitLineFlash = 0;

  // input bookkeeping
  private seenPointers = new Set<number>();

  // layout (recomputed each frame)
  private L: Layout = {
    W: 0, H: 0, fieldX: 0, fieldW: 0, laneW: 0, hitLineY: 0, tileH: 0, deckY: 0,
  };

  private stars: Star[] = [];
  private timers: number[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.sound = new Sound(ctx.audio);
    this.fx = new ParticleSystem();

    for (let i = 0; i < LANES; i++) {
      this.laneFx.push({ glow: 0, danger: 0, press: 0 });
    }

    this.items = SONGS.map((s, i) => ({
      title: s.title,
      subtitle: s.subtitle,
      accent: s.accent,
      endless: false,
      songIndex: i,
    }));
    const endlessShell = makeEndlessBeatmap();
    this.items.push({
      title: endlessShell.title,
      subtitle: endlessShell.subtitle,
      accent: endlessShell.accent,
      endless: true,
      songIndex: -1,
    });

    // starfield (normalized positions, deterministic)
    const rand = mulberry32(0x5eed1234);
    for (let i = 0; i < 80; i++) {
      this.stars.push({
        nx: rand(),
        ny: rand(),
        r: 0.4 + rand() * 1.8,
        phase: rand() * TAU,
      });
    }

    ctx.requestControls([]);
    this.setMenuStatus();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  onPause(): void {
    this.paused = true;
  }
  onResume(): void {
    this.paused = false;
  }
  resize(): void {
    /* layout is recomputed every frame from the size getters */
  }
  destroy(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(fn, ms);
    this.timers.push(id);
  }

  // =========================================================================
  // Layout
  // =========================================================================

  private computeLayout(): void {
    const W = this.ctx.width;
    const H = this.ctx.height;
    const fieldW = Math.min(W, H * 0.78);
    const fieldX = (W - fieldW) / 2;
    const laneW = fieldW / LANES;
    const hitLineY = H * 0.82;
    this.L = {
      W,
      H,
      fieldX,
      fieldW,
      laneW,
      hitLineY,
      tileH: H * 0.16,
      deckY: hitLineY,
    };
  }

  private laneCenterX(lane: number): number {
    return this.L.fieldX + this.L.laneW * (lane + 0.5);
  }

  private laneAtX(x: number): number {
    if (x < this.L.fieldX || x > this.L.fieldX + this.L.fieldW) return -1;
    const lane = Math.floor((x - this.L.fieldX) / this.L.laneW);
    return clamp(lane, 0, LANES - 1);
  }

  // =========================================================================
  // Speed model
  // =========================================================================

  private updateSpeed(): void {
    const H = this.L.H;
    const hitLineY = this.L.hitLineY;
    if (!this.beatmap) {
      this.speed = H * 0.7;
      this.lead = 1.3;
      return;
    }
    let lead: number;
    if (this.beatmap.endless) {
      const elapsed = Math.max(0, this.songTime);
      lead = clamp(1.45 - elapsed * 0.012, 0.62, 1.45);
    } else {
      const progress = clamp(this.songTime / this.beatmap.length, 0, 1);
      lead = lerp(1.45, 0.95, progress);
    }
    this.lead = lead;
    this.speed = hitLineY / lead;
  }

  private get difficulty(): number {
    return clamp((1.45 - this.lead) / 0.83, 0, 1.2);
  }

  // =========================================================================
  // Update
  // =========================================================================

  update(dt: number): void {
    if (this.paused) return;
    const d = Math.min(dt, 0.05); // clamp big frame gaps
    this.t += d;
    this.computeLayout();
    this.updateSpeed();

    // decay lane fx
    for (const lf of this.laneFx) {
      lf.glow = Math.max(0, lf.glow - d * 3.5);
      lf.danger = Math.max(0, lf.danger - d * 1.8);
      lf.press = Math.max(0, lf.press - d * 6);
    }
    this.flashAlpha = Math.max(0, this.flashAlpha - d * 2.6);
    this.hitLineFlash = Math.max(0, this.hitLineFlash - d * 3);
    this.comboScale = lerp(this.comboScale, 1, Math.min(1, d * 10));
    this.fx.update(d);

    const taps = this.collectTaps();

    switch (this.state) {
      case "menu":
        this.updateMenu(taps);
        break;
      case "countdown":
        this.updateCountdown(d, taps);
        break;
      case "playing":
        this.updatePlaying(d, taps);
        break;
      case "dying":
        this.updateDying(d);
        break;
      case "complete":
        this.updateComplete(d);
        break;
      case "gameover":
        this.updateGameOver(taps);
        break;
    }

    this.ctx.input.endFrame();
  }

  /** Detect fresh pointer presses this frame (mouse + multi-touch). */
  private collectTaps(): Array<{ x: number; y: number }> {
    const taps: Array<{ x: number; y: number }> = [];
    const current = this.ctx.input.pointers;
    for (const [id, pos] of current) {
      if (!this.seenPointers.has(id)) {
        taps.push({ x: pos.x, y: pos.y });
      }
    }
    // refresh the seen set to exactly the currently-down pointers
    this.seenPointers.clear();
    for (const id of current.keys()) this.seenPointers.add(id);
    return taps;
  }

  // -------------------------------------------------------------- menu
  private updateMenu(taps: Array<{ x: number; y: number }>): void {
    const inp = this.ctx.input;
    if (inp.pressed("ArrowDown", "s")) {
      this.selIndex = (this.selIndex + 1) % this.items.length;
      this.sound.uiTick();
    }
    if (inp.pressed("ArrowUp", "w")) {
      this.selIndex = (this.selIndex - 1 + this.items.length) % this.items.length;
      this.sound.uiTick();
    }
    if (inp.pressed("Enter", "Space")) {
      this.startItem(this.selIndex);
      return;
    }
    const cards = this.menuCards();
    for (const tap of taps) {
      for (const card of cards) {
        if (inRect(tap.x, tap.y, card)) {
          this.selIndex = card.index;
          this.startItem(card.index);
          return;
        }
      }
    }
  }

  // -------------------------------------------------------------- countdown
  private updateCountdown(d: number, taps: Array<{ x: number; y: number }>): void {
    if (this.ctx.input.pressed("Escape")) {
      this.toMenu();
      return;
    }
    this.songTime += d;
    this.spawnTiles();
    this.advanceTiles(d, false);

    const remaining = -this.songTime; // counts down to 0
    const n = Math.ceil(remaining / (COUNTDOWN_TIME / 3));
    if (this.songTime < 0) {
      if (n !== this.cdInt) {
        this.cdInt = n;
        this.sound.countdown(false);
      }
    } else {
      // GO!
      this.sound.countdown(true);
      this.hitLineFlash = 1;
      this.state = "playing";
      this.ctx.setStatus(this.beatmap ? this.beatmap.title : "");
    }
    // ignore taps during countdown (avoid premature death)
    void taps;
  }

  // -------------------------------------------------------------- playing
  private updatePlaying(d: number, taps: Array<{ x: number; y: number }>): void {
    if (this.ctx.input.pressed("Escape")) {
      this.toMenu();
      return;
    }
    this.songTime += d;
    this.spawnTiles();
    this.advanceTiles(d, true);

    // keyboard lane taps
    for (let lane = 0; lane < LANES; lane++) {
      if (this.ctx.input.pressed(...LANE_KEYS[lane])) {
        this.tapLane(lane);
      }
    }
    // pointer lane taps
    for (const tap of taps) {
      const lane = this.laneAtX(tap.x);
      if (lane >= 0) this.tapLane(lane);
    }

    if (this.state !== "playing") return;

    // song completion: all notes spawned and no live tiles remain
    if (
      this.beatmap &&
      !this.beatmap.endless &&
      this.spawnIndex >= this.beatmap.notes.length &&
      !this.tiles.some((t) => t.state === "live")
    ) {
      this.onComplete();
    }
  }

  // -------------------------------------------------------------- dying
  private updateDying(d: number): void {
    this.dyingT += d;
    this.advanceTiles(d, false); // keep fading but don't move/kill
    if (this.dyingT > 0.6) {
      this.finalizeGameOver(false);
    }
  }

  // -------------------------------------------------------------- complete
  private updateComplete(d: number): void {
    this.completeT += d;
    this.advanceTiles(d, false);
    if (Math.random() < d * 6) {
      this.fx.fountain(
        this.L.fieldX + Math.random() * this.L.fieldW,
        this.L.hitLineY,
        this.accent,
        6,
        this.L.H * 0.9,
      );
    }
    if (this.completeT > 1.7) {
      this.finalizeGameOver(true);
    }
  }

  // -------------------------------------------------------------- gameover
  private updateGameOver(taps: Array<{ x: number; y: number }>): void {
    const inp = this.ctx.input;
    if (inp.pressed("Escape")) {
      this.toMenu();
      return;
    }
    if (inp.pressed("Space", "Enter", "r")) {
      this.retry();
      return;
    }
    const btns = this.gameOverButtons();
    for (const tap of taps) {
      for (const b of btns) {
        if (inRect(tap.x, tap.y, b)) {
          if (b.id === "retry") this.retry();
          else this.toMenu();
          return;
        }
      }
    }
  }

  // =========================================================================
  // Tile spawning / movement
  // =========================================================================

  private spawnTiles(): void {
    if (!this.beatmap) return;
    const aheadSec = this.lead + 0.5;

    if (this.beatmap.endless && this.endless) {
      while (this.endless.nextTime - this.songTime <= aheadSec) {
        const group = this.endless.next(this.difficulty);
        for (const note of group) this.pushTile(note);
      }
      return;
    }

    const notes = this.beatmap.notes;
    while (
      this.spawnIndex < notes.length &&
      notes[this.spawnIndex].time - this.songTime <= aheadSec
    ) {
      this.pushTile(notes[this.spawnIndex]);
      this.spawnIndex++;
    }
  }

  private pushTile(note: { time: number; lane: number; freq: number; dur: number }): void {
    const height = clamp(note.dur * this.speed * 0.62, this.L.H * 0.085, this.L.H * 0.3);
    const y = this.L.hitLineY - (note.time - this.songTime) * this.speed;
    this.tiles.push({
      note,
      y,
      height,
      state: "live",
      fade: 1,
      judge: null,
      id: this.tileIdSeq++,
    });
  }

  private advanceTiles(d: number, allowMiss: boolean): void {
    const missPx = this.catchBelowPx();
    const H = this.L.H;
    for (const tile of this.tiles) {
      if (tile.state === "live") {
        tile.y = this.L.hitLineY - (tile.note.time - this.songTime) * this.speed;
        if (allowMiss && tile.y > this.L.hitLineY + missPx) {
          tile.state = "missed";
          tile.fade = 1;
          this.laneFx[tile.note.lane].danger = 1;
          this.die();
        }
      } else {
        tile.fade -= d * 4;
      }
    }
    // cull
    this.tiles = this.tiles.filter(
      (t) => (t.state === "live" ? t.y - t.height < H + 40 : t.fade > 0),
    );
  }

  private catchAbovePx(): number {
    return Math.max(this.speed * 0.6, this.L.H * 0.5);
  }
  private catchBelowPx(): number {
    return Math.max(this.speed * 0.2, this.L.H * 0.05);
  }

  // =========================================================================
  // Hit resolution
  // =========================================================================

  private tapLane(lane: number): void {
    if (this.state !== "playing") return;
    this.laneFx[lane].press = 1;

    // find the lowest hittable un-hit tile in this lane
    const above = this.catchAbovePx();
    const below = this.catchBelowPx();
    let best: Tile | null = null;
    for (const tile of this.tiles) {
      if (tile.state !== "live" || tile.note.lane !== lane) continue;
      if (tile.y < this.L.hitLineY - above) continue; // too far up
      if (tile.y > this.L.hitLineY + below) continue; // already past
      if (!best || tile.y > best.y) best = tile;
    }

    if (!best) {
      // tapped an empty lane -> game over
      this.laneFx[lane].danger = 1;
      this.die();
      return;
    }

    this.hitTile(best, lane);
  }

  private hitTile(tile: Tile, lane: number): void {
    const errPx = tile.y - this.L.hitLineY;
    const perfectPx = Math.max(this.speed * 0.06, this.L.H * 0.018);
    const greatPx = Math.max(this.speed * 0.11, this.L.H * 0.04);
    const absErr = Math.abs(errPx);

    let judge: Judgment;
    let base: number;
    let weight: number;
    if (absErr <= perfectPx) {
      judge = "perfect";
      base = 100;
      weight = 1;
    } else if (absErr <= greatPx) {
      judge = "great";
      base = 70;
      weight = 0.8;
    } else {
      judge = "good";
      base = 40;
      weight = 0.55;
    }

    tile.state = "hit";
    tile.fade = 1;
    tile.judge = judge;

    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.tilesHit++;
    this.accSum += weight;
    const comboBonus = Math.floor(this.combo / 10) * 5;
    this.score += base + comboBonus;
    this.comboScale = 1.55;
    this.ctx.reportScore(this.score);

    // audio: play the tile's note
    const strength = judge === "perfect" ? 1 : judge === "great" ? 0.75 : 0.5;
    this.sound.note(tile.note.freq, tile.note.dur * (this.beatmap?.bpm ?? 120) / 60, strength);

    // visual feedback
    const cx = this.laneCenterX(lane);
    const cy = this.L.hitLineY;
    this.laneFx[lane].glow = 1;
    this.hitLineFlash = Math.max(this.hitLineFlash, 0.6);
    const judgeColor =
      judge === "perfect" ? PALETTE.perfect : judge === "great" ? PALETTE.great : PALETTE.good;
    this.fx.burst(cx, cy, this.accent, judge === "perfect" ? 14 : 9, this.L.H * 0.9);
    this.fx.ripple(cx, cy, this.L.laneW * 0.9, judgeColor);
    this.fx.floatText(cx, cy - this.L.H * 0.05, judge.toUpperCase(), judgeColor, this.L.H * 0.03);

    // combo milestones
    if (this.combo > 0 && this.combo % 25 === 0) {
      this.sound.comboFlourish();
      this.fx.fountain(this.L.W / 2, this.L.hitLineY, this.accent, 26, this.L.H * 1.1);
      this.flashAlpha = 0.35;
      this.flashColor = this.accent;
    }
  }

  // =========================================================================
  // State transitions
  // =========================================================================

  private startItem(index: number): void {
    const item = this.items[index];
    if (item.endless) {
      this.beatmap = makeEndlessBeatmap();
      this.endless = new EndlessGen(this.beatmap.bpm);
    } else {
      this.beatmap = SONGS[item.songIndex];
      this.endless = null;
    }
    this.accent = this.beatmap.accent;
    this.spb = 60 / this.beatmap.bpm;

    // reset run
    this.songTime = -COUNTDOWN_TIME;
    this.tiles = [];
    this.spawnIndex = 0;
    this.tileIdSeq = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.tilesHit = 0;
    this.accSum = 0;
    this.comboScale = 1;
    this.dyingT = 0;
    this.completeT = 0;
    this.gameOverFired = false;
    this.summary = null;
    this.cdInt = 99;
    this.flashAlpha = 0;
    for (const lf of this.laneFx) {
      lf.glow = 0;
      lf.danger = 0;
      lf.press = 0;
    }
    this.fx.clear();
    this.ctx.reportScore(0);

    this.state = "countdown";
    this.ctx.setStatus(`${this.beatmap.title} — get ready!`);
  }

  private retry(): void {
    if (this.beatmap) {
      // re-derive the current item index (endless vs song)
      const idx = this.beatmap.endless
        ? this.items.length - 1
        : this.items.findIndex((it) => !it.endless && SONGS[it.songIndex].id === this.beatmap!.id);
      this.startItem(idx >= 0 ? idx : this.selIndex);
    } else {
      this.startItem(this.selIndex);
    }
  }

  private toMenu(): void {
    this.state = "menu";
    this.beatmap = null;
    this.endless = null;
    this.tiles = [];
    this.fx.clear();
    this.setMenuStatus();
  }

  private die(): void {
    if (this.state !== "playing") return;
    this.state = "dying";
    this.dyingT = 0;
    this.flashAlpha = 0.6;
    this.flashColor = PALETTE.danger;
    this.sound.miss();
  }

  private onComplete(): void {
    this.state = "complete";
    this.completeT = 0;
    this.flashAlpha = 0.4;
    this.flashColor = this.accent;
    this.sound.complete();
  }

  private finalizeGameOver(cleared: boolean): void {
    const accuracy = this.tilesHit > 0 ? this.accSum / this.tilesHit : 0;
    const songId = this.beatmap ? this.beatmap.id : "unknown";
    const bestKey = `best.${songId}`;
    const comboKey = `combo.${songId}`;
    const prevBest = this.ctx.storage.get<number>(bestKey, 0);
    const newBest = this.score > prevBest;
    if (newBest) this.ctx.storage.set(bestKey, this.score);
    const prevCombo = this.ctx.storage.get<number>(comboKey, 0);
    if (this.maxCombo > prevCombo) this.ctx.storage.set(comboKey, this.maxCombo);

    this.summary = {
      score: this.score,
      maxCombo: this.maxCombo,
      accuracy,
      tiles: this.tilesHit,
      cleared,
      best: Math.max(prevBest, this.score),
      newBest,
      title: this.beatmap ? this.beatmap.title : "",
    };

    this.state = "gameover";
    if (!this.gameOverFired) {
      this.gameOverFired = true;
      this.ctx.gameOver(this.score);
    }
    this.ctx.setStatus(cleared ? "Song cleared!" : "Game over");
  }

  private setMenuStatus(): void {
    this.ctx.setStatus(
      this.ctx.isTouch ? "Tap a song to play" : "Pick a song — D F J K to play",
    );
  }

  // =========================================================================
  // Menu / button geometry (shared by update + render)
  // =========================================================================

  private menuCards(): MenuCard[] {
    const { W, H } = this.L;
    const n = this.items.length;
    const top = H * 0.27;
    const bottom = H * 0.93;
    const gap = H * 0.018;
    const cardH = (bottom - top - gap * (n - 1)) / n;
    const w = Math.min(W * 0.88, 560);
    const x = (W - w) / 2;
    const cards: MenuCard[] = [];
    for (let i = 0; i < n; i++) {
      cards.push({ x, y: top + i * (cardH + gap), w, h: cardH, index: i });
    }
    return cards;
  }

  private gameOverButtons(): Button[] {
    const { W, H } = this.L;
    const w = Math.min(W * 0.38, 220);
    const h = Math.max(H * 0.07, 46);
    const gap = W * 0.04;
    const totalW = w * 2 + gap;
    const x = (W - totalW) / 2;
    const y = H * 0.74;
    return [
      { x, y, w, h, id: "retry", label: "RETRY" },
      { x: x + w + gap, y, w, h, id: "menu", label: "MENU" },
    ];
  }

  // =========================================================================
  // Render
  // =========================================================================

  render(): void {
    const c = this.ctx.ctx;
    this.computeLayout();
    this.drawBackground(c);

    if (this.state === "menu") {
      this.drawMenu(c);
    } else {
      this.drawField(c);
      this.drawTiles(c);
      this.drawHitLine(c);
      this.drawDeck(c);
      this.fx.render(c);
      this.drawHud(c);
      this.fx.renderTexts(c);

      if (this.state === "countdown") this.drawCountdown(c);
      if (this.state === "complete") this.drawCompleteBanner(c);
      if (this.state === "gameover") this.drawGameOver(c);
    }

    // global flash overlay
    if (this.flashAlpha > 0.001) {
      c.fillStyle = rgba(this.flashColor, this.flashAlpha);
      c.fillRect(0, 0, this.L.W, this.L.H);
    }
  }

  private drawBackground(c: CanvasRenderingContext2D): void {
    const { W, H } = this.L;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PALETTE.bgTop);
    g.addColorStop(1, PALETTE.bgBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // twinkling stars / dust
    for (const s of this.stars) {
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 1.5 + s.phase));
      c.fillStyle = rgba(this.accent, 0.05 + tw * 0.06);
      c.beginPath();
      c.arc(s.nx * W, s.ny * H, s.r, 0, TAU);
      c.fill();
    }

    // side vignette when the field is narrower than the screen
    if (this.L.fieldW < W - 1) {
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.fillRect(0, 0, this.L.fieldX, H);
      c.fillRect(this.L.fieldX + this.L.fieldW, 0, this.L.fieldX, H);
    }
  }

  private drawField(c: CanvasRenderingContext2D): void {
    const { fieldX, fieldW, laneW, H } = this.L;
    // lane panels
    for (let i = 0; i < LANES; i++) {
      const x = fieldX + i * laneW;
      c.fillStyle = i % 2 === 0 ? PALETTE.laneA : PALETTE.laneB;
      c.fillRect(x, 0, laneW, H);
      // lane glow
      const lf = this.laneFx[i];
      if (lf.glow > 0.001) {
        const grad = c.createLinearGradient(0, 0, 0, this.L.hitLineY);
        grad.addColorStop(0, rgba(this.accent, 0));
        grad.addColorStop(1, rgba(this.accent, 0.22 * lf.glow));
        c.fillStyle = grad;
        c.fillRect(x, 0, laneW, this.L.hitLineY);
      }
      if (lf.danger > 0.001) {
        c.fillStyle = rgba(PALETTE.danger, 0.3 * lf.danger);
        c.fillRect(x, 0, laneW, H);
      }
    }
    // separators
    c.strokeStyle = PALETTE.laneSep;
    c.lineWidth = 1.5;
    for (let i = 0; i <= LANES; i++) {
      const x = fieldX + i * laneW;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
  }

  private drawTiles(c: CanvasRenderingContext2D): void {
    const { laneW } = this.L;
    const pad = laneW * 0.06;
    const w = laneW - pad * 2;
    for (const tile of this.tiles) {
      const x = this.laneCenterX(tile.note.lane) - w / 2;
      const top = tile.y - tile.height;
      const r = Math.min(w, tile.height) * 0.16;

      c.save();
      if (tile.state === "hit") {
        // flash + shrink as it fades
        const f = clamp(tile.fade, 0, 1);
        c.globalAlpha = f;
        const grow = (1 - f) * tile.height * 0.3;
        roundRect(c, x - grow, top - grow, w + grow * 2, tile.height + grow * 2, r);
        const grad = c.createLinearGradient(0, top, 0, tile.y);
        grad.addColorStop(0, lighten(this.accent, 0.3));
        grad.addColorStop(1, this.accent);
        c.fillStyle = grad;
        c.fill();
        c.restore();
        continue;
      }

      const isMiss = tile.state === "missed";
      // body gradient
      const grad = c.createLinearGradient(0, top, 0, tile.y);
      grad.addColorStop(0, isMiss ? darken(PALETTE.danger, 0.2) : PALETTE.tileBodyTop);
      grad.addColorStop(1, isMiss ? darken(PALETTE.danger, 0.5) : PALETTE.tileBody);
      roundRect(c, x, top, w, tile.height, r);
      c.fillStyle = grad;
      c.fill();
      // glossy top edge
      c.fillStyle = rgba(isMiss ? PALETTE.danger : this.accent, isMiss ? 0.6 : 0.5);
      roundRect(c, x, top, w, Math.max(3, tile.height * 0.07), r);
      c.fill();
      // subtle inner highlight
      c.strokeStyle = rgba("#ffffff", 0.06);
      c.lineWidth = 1;
      roundRect(c, x + 1.5, top + 1.5, w - 3, tile.height - 3, r);
      c.stroke();
      // edge outline
      c.strokeStyle = rgba(this.accent, 0.18);
      c.lineWidth = 1.5;
      roundRect(c, x, top, w, tile.height, r);
      c.stroke();
      c.restore();
    }
  }

  private drawHitLine(c: CanvasRenderingContext2D): void {
    const { fieldX, fieldW, hitLineY } = this.L;
    const bob = Math.sin(this.t * 2.2) * this.L.H * 0.004;
    const y = hitLineY + bob;
    // beat pulse
    const beatPos = this.songTime / this.spb;
    const frac = beatPos - Math.floor(beatPos);
    const beatPulse = this.state === "playing" ? Math.pow(1 - frac, 2) : 0;
    const glow = clamp(0.35 + beatPulse * 0.4 + this.hitLineFlash * 0.5, 0, 1);

    c.save();
    // glow band
    const grad = c.createLinearGradient(0, y - this.L.H * 0.05, 0, y + this.L.H * 0.05);
    grad.addColorStop(0, rgba(this.accent, 0));
    grad.addColorStop(0.5, rgba(this.accent, 0.16 * glow));
    grad.addColorStop(1, rgba(this.accent, 0));
    c.fillStyle = grad;
    c.fillRect(fieldX, y - this.L.H * 0.05, fieldW, this.L.H * 0.1);

    // the line itself
    c.shadowColor = this.accent;
    c.shadowBlur = 18 * glow;
    c.strokeStyle = lighten(this.accent, 0.25);
    c.lineWidth = 3 + beatPulse * 2;
    c.beginPath();
    c.moveTo(fieldX, y);
    c.lineTo(fieldX + fieldW, y);
    c.stroke();

    // moving sheen
    c.shadowBlur = 0;
    const sheenX = fieldX + ((this.t * 0.25) % 1) * fieldW;
    const sg = c.createLinearGradient(sheenX - 40, 0, sheenX + 40, 0);
    sg.addColorStop(0, rgba("#ffffff", 0));
    sg.addColorStop(0.5, rgba("#ffffff", 0.5 * glow));
    sg.addColorStop(1, rgba("#ffffff", 0));
    c.fillStyle = sg;
    c.fillRect(sheenX - 40, y - 2, 80, 4);
    c.restore();
  }

  private drawDeck(c: CanvasRenderingContext2D): void {
    const { fieldX, fieldW, laneW, hitLineY, H } = this.L;
    const deckTop = hitLineY + H * 0.01;
    const deckH = H - deckTop;
    // deck base
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.fillRect(fieldX, deckTop, fieldW, deckH);
    for (let i = 0; i < LANES; i++) {
      const x = fieldX + i * laneW;
      const lf = this.laneFx[i];
      // pad
      const padPad = laneW * 0.12;
      c.fillStyle = rgba(this.accent, 0.08 + lf.press * 0.5);
      roundRect(c, x + padPad, deckTop + deckH * 0.18, laneW - padPad * 2, deckH * 0.6, 8);
      c.fill();
      // key label
      const label = this.ctx.isTouch ? "" : LANE_LABELS[i];
      if (label) {
        drawText(
          c,
          label,
          x + laneW / 2,
          deckTop + deckH * 0.48,
          Math.min(deckH * 0.42, laneW * 0.4),
          rgba(PALETTE.text, 0.5 + lf.press * 0.5),
        );
      } else {
        // touch dot
        c.fillStyle = rgba(PALETTE.text, 0.35 + lf.press * 0.5);
        c.beginPath();
        c.arc(x + laneW / 2, deckTop + deckH * 0.48, Math.min(deckH * 0.16, laneW * 0.12), 0, TAU);
        c.fill();
      }
    }
  }

  private drawHud(c: CanvasRenderingContext2D): void {
    const { W, H } = this.L;
    // score top-left
    drawText(c, "SCORE", W * 0.06, H * 0.05, H * 0.022, PALETTE.textDim, "left");
    drawText(c, String(this.score), W * 0.06, H * 0.085, H * 0.045, PALETTE.text, "left");
    // title top-right
    if (this.beatmap) {
      drawText(c, this.beatmap.title, W * 0.94, H * 0.05, H * 0.026, this.accent, "right");
      if (this.beatmap.endless) {
        drawText(c, `x${(this.speed / (H * 0.7)).toFixed(2)} speed`, W * 0.94, H * 0.085, H * 0.022, PALETTE.textDim, "right");
      }
    }
    // combo center
    if (this.combo >= 2 && (this.state === "playing" || this.state === "complete")) {
      const cy = H * 0.34;
      c.save();
      c.translate(W / 2, cy);
      c.scale(this.comboScale, this.comboScale);
      drawText(c, String(this.combo), 0, 0, H * 0.085, rgba(this.accent, 0.92));
      drawText(c, "COMBO", 0, H * 0.06, H * 0.022, rgba(PALETTE.text, 0.55));
      c.restore();
    }
  }

  // -------------------------------------------------------------- menu render
  private drawMenu(c: CanvasRenderingContext2D): void {
    const { W, H } = this.L;
    // title
    drawText(c, "TAP CASCADE", W / 2, H * 0.12, Math.min(H * 0.06, W * 0.11), PALETTE.text);
    drawText(
      c,
      "tap the falling tiles in time",
      W / 2,
      H * 0.18,
      H * 0.026,
      PALETTE.textDim,
    );

    const cards = this.menuCards();
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const item = this.items[i];
      const selected = i === this.selIndex;
      const accent = item.accent;

      // card background
      c.save();
      roundRect(c, card.x, card.y, card.w, card.h, card.h * 0.18);
      const grad = c.createLinearGradient(card.x, card.y, card.x + card.w, card.y);
      grad.addColorStop(0, selected ? darken(accent, 0.45) : "rgba(255,255,255,0.04)");
      grad.addColorStop(1, selected ? darken(accent, 0.7) : "rgba(255,255,255,0.02)");
      c.fillStyle = grad;
      c.fill();
      c.lineWidth = selected ? 3 : 1.5;
      c.strokeStyle = selected ? lighten(accent, 0.2) : "rgba(255,255,255,0.1)";
      if (selected) {
        c.shadowColor = accent;
        c.shadowBlur = 18;
      }
      c.stroke();
      c.restore();

      // accent chip
      c.fillStyle = accent;
      roundRect(c, card.x + card.w * 0.04, card.y + card.h * 0.28, card.w * 0.02, card.h * 0.44, 3);
      c.fill();

      // text
      const tx = card.x + card.w * 0.1;
      drawText(c, item.title, tx, card.y + card.h * 0.38, card.h * 0.28, PALETTE.text, "left");
      drawText(
        c,
        item.subtitle,
        tx,
        card.y + card.h * 0.7,
        card.h * 0.17,
        PALETTE.textDim,
        "left",
        "500",
      );

      // best score
      const songId = item.endless ? "endless" : SONGS[item.songIndex].id;
      const best = this.ctx.storage.get<number>(`best.${songId}`, 0);
      const bestCombo = this.ctx.storage.get<number>(`combo.${songId}`, 0);
      drawText(
        c,
        best > 0 ? `BEST ${best}` : "NEW",
        card.x + card.w * 0.96,
        card.y + card.h * 0.38,
        card.h * 0.2,
        accent,
        "right",
      );
      if (bestCombo > 0) {
        drawText(
          c,
          `combo ${bestCombo}`,
          card.x + card.w * 0.96,
          card.y + card.h * 0.7,
          card.h * 0.16,
          PALETTE.textDim,
          "right",
          "500",
        );
      }
    }
  }

  // ---------------------------------------------------------- countdown render
  private drawCountdown(c: CanvasRenderingContext2D): void {
    const { W, H } = this.L;
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.fillRect(0, 0, W, H);
    const remaining = -this.songTime;
    const n = Math.max(1, Math.ceil(remaining / (COUNTDOWN_TIME / 3)));
    const seg = COUNTDOWN_TIME / 3;
    const within = 1 - ((remaining % seg) / seg); // 0..1 progress through current count
    const scale = 0.7 + within * 0.5;
    c.save();
    c.translate(W / 2, H * 0.42);
    c.scale(scale, scale);
    drawText(c, String(n), 0, 0, H * 0.18, this.accent);
    c.restore();
    drawText(c, this.beatmap ? this.beatmap.title : "", W / 2, H * 0.6, H * 0.04, PALETTE.text);
    drawText(
      c,
      this.ctx.isTouch ? "tap the lanes!" : "keys: D  F  J  K",
      W / 2,
      H * 0.66,
      H * 0.028,
      PALETTE.textDim,
    );
  }

  // ---------------------------------------------------------- complete banner
  private drawCompleteBanner(c: CanvasRenderingContext2D): void {
    const { W, H } = this.L;
    drawText(c, "CLEARED!", W / 2, H * 0.42, Math.min(H * 0.09, W * 0.16), this.accent);
  }

  // ---------------------------------------------------------- game over render
  private drawGameOver(c: CanvasRenderingContext2D): void {
    const { W, H } = this.L;
    const s = this.summary;
    if (!s) return;
    c.fillStyle = "rgba(5,8,16,0.78)";
    c.fillRect(0, 0, W, H);

    const titleY = H * 0.2;
    drawText(
      c,
      s.cleared ? "SONG CLEARED!" : "GAME OVER",
      W / 2,
      titleY,
      Math.min(H * 0.06, W * 0.1),
      s.cleared ? this.accent : PALETTE.danger,
    );
    drawText(c, s.title, W / 2, titleY + H * 0.05, H * 0.028, PALETTE.textDim);

    // stats panel
    const rows: Array<[string, string]> = [
      ["Score", String(s.score)],
      ["Max Combo", String(s.maxCombo)],
      ["Accuracy", `${Math.round(s.accuracy * 100)}%`],
      ["Tiles Hit", String(s.tiles)],
      ["Best", String(s.best)],
    ];
    const startY = H * 0.34;
    const rowH = Math.min(H * 0.06, 44);
    const panelW = Math.min(W * 0.7, 380);
    const px = (W - panelW) / 2;
    for (let i = 0; i < rows.length; i++) {
      const y = startY + i * rowH;
      drawText(c, rows[i][0], px, y, H * 0.026, PALETTE.textDim, "left");
      const isScore = i === 0;
      drawText(
        c,
        rows[i][1],
        px + panelW,
        y,
        isScore ? H * 0.038 : H * 0.03,
        isScore ? PALETTE.text : PALETTE.text,
        "right",
      );
    }

    if (s.newBest) {
      drawText(c, "★ NEW BEST ★", W / 2, startY + rows.length * rowH + H * 0.02, H * 0.03, PALETTE.gold);
    }

    // buttons
    const btns = this.gameOverButtons();
    for (const b of btns) {
      c.save();
      roundRect(c, b.x, b.y, b.w, b.h, b.h * 0.28);
      c.fillStyle = b.id === "retry" ? this.accent : "rgba(255,255,255,0.1)";
      c.fill();
      c.restore();
      drawText(
        c,
        b.label,
        b.x + b.w / 2,
        b.y + b.h / 2,
        b.h * 0.4,
        b.id === "retry" ? "#08101e" : PALETTE.text,
      );
    }

    drawText(
      c,
      this.ctx.isTouch ? "Tap Retry or Menu" : "Space = Retry · Esc = Menu",
      W / 2,
      H * 0.86,
      H * 0.024,
      PALETTE.textDim,
    );
  }
}

function inRect(
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
