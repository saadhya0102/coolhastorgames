/**
 * Fruit Frenzy — an original "slice the flying fruit" arcade game.
 *
 * create(ctx) returns a GameInstance. This module owns the canonical game
 * state machine (title → countdown → playing → over) and orchestrates the
 * blade, spawner, fruit physics, slice detection, combos, particles, HUD and
 * screen states. All art is procedural; all audio is synthesized. No assets.
 *
 * See PRD.md for the full design.
 */
import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, roundRect } from "@/engine";
import type {
  Fruit,
  Half,
  Mode,
  Phase,
  EndReason,
  World,
} from "./types";
import {
  MAX_DT,
  MIN_SLICE_SPEED,
  GRAVITY_K,
  FRUIT_R_K,
  COMBO_WINDOW,
  CLASSIC_LIVES,
  ZEN_TIME,
  ARCADE_TIME,
  SHAKE_DECAY,
  TAU,
  rand,
  distPointSeg,
  withAlpha,
} from "./types";
import { drawFruit, drawHalf, FRUIT_DEFS, NORMAL_FRUIT } from "./fruits";
import { Blade } from "./blade";
import { Particles } from "./particles";
import { Spawner } from "./spawner";
import { Background } from "./background";

interface ComboBanner {
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface ModeButton {
  mode: Mode;
  label: string;
  desc: string;
}

const MODES: ModeButton[] = [
  { mode: "classic", label: "CLASSIC", desc: "3 lives · bombs are deadly" },
  { mode: "zen", label: "ZEN", desc: "90s · no bombs, just slicing" },
  { mode: "arcade", label: "ARCADE", desc: "60s · power-ups & frenzy" },
];

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  // ---- persistent state -------------------------------------------------
  let mode: Mode = (storage.get<Mode>("mode", "classic"));

  // ---- mutable run state ------------------------------------------------
  let phase: Phase = "title";
  let score = 0;
  let lives = CLASSIC_LIVES;
  let elapsed = 0; // seconds in PLAYING
  let timeLeft = 0; // for timed modes
  let countdown = 0; // seconds remaining in COUNTDOWN
  let endReason: EndReason = "lives";
  let ended = false; // gameOver fired guard
  let overTimer = 0; // animation beat before handing to portal
  let lifeFlash = 0; // red flash when a life is lost

  // power-up windows
  let doubleTimer = 0;
  let freezeTimer = 0;

  // combo tracking (rolling window scoped)
  let comboCount = 0;
  let lastSliceTime = -10;
  let comboPitch = 0;

  // juice & feel
  let shake = 0;
  let bloom = 0; // full-screen white flash 0..1
  let time = 0; // total time (all phases) for animations
  let whooshCooldown = 0;
  let demoTimer = 0; // title-screen idle fruit cadence

  const banner: ComboBanner = { text: "", color: "#fff", life: 0, maxLife: 0.9 };

  const fruits: Fruit[] = [];
  const halves: Half[] = [];

  const blade = new Blade();
  const particles = new Particles();
  const bg = new Background();
  let spawner = new Spawner(mode);

  let gameOverId: ReturnType<typeof setTimeout> | null = null;

  ctx.requestControls([]);
  updateStatus();

  const world: World = { w: ctx.width, h: ctx.height, min: 0, time: 0 };
  function syncWorld(): World {
    world.w = ctx.width;
    world.h = ctx.height;
    world.min = Math.min(world.w, world.h);
    world.time = time;
    return world;
  }

  function bestScore(): number {
    return storage.get<number>(`best.${mode}`, 0);
  }

  function updateStatus(): void {
    const best = bestScore();
    if (phase === "title") {
      ctx.setStatus(`Fruit Frenzy · ${MODES.find((m) => m.mode === mode)?.label} · Best ${best}`);
    } else if (mode === "classic") {
      ctx.setStatus(`Lives ${"●".repeat(Math.max(0, lives))} · Best ${best}`);
    } else {
      ctx.setStatus(`Time ${Math.ceil(timeLeft)}s · Best ${best}`);
    }
  }

  // ---- transitions ------------------------------------------------------
  function startCountdown(): void {
    phase = "countdown";
    countdown = 3;
    score = 0;
    lives = CLASSIC_LIVES;
    elapsed = 0;
    timeLeft = mode === "zen" ? ZEN_TIME : mode === "arcade" ? ARCADE_TIME : 0;
    ended = false;
    doubleTimer = 0;
    freezeTimer = 0;
    comboCount = 0;
    fruits.length = 0;
    halves.length = 0;
    particles.clear();
    blade.reset();
    spawner = new Spawner(mode);
    spawner.reset();
    ctx.reportScore(0);
    audio.tone(440, 0.1, "triangle", 0.4);
    updateStatus();
  }

  function endGame(reason: EndReason): void {
    if (phase === "over" || ended) return;
    endReason = reason;
    phase = "over";
    overTimer = reason === "bomb" ? 1.3 : 0.9;
    finalizeCombo(true);
    if (reason === "bomb") {
      audio.explosion();
      audio.tone(70, 0.5, "sawtooth", 0.5);
      audio.sweep(400, 60, 0.5, "sawtooth", 0.4);
    } else {
      audio.lose();
    }
  }

  function commitGameOver(): void {
    if (ended) return;
    ended = true;
    const prevBest = bestScore();
    if (score > prevBest) {
      storage.set(`best.${mode}`, score);
      audio.win();
    }
    storage.submitScore(score);
    gameOverId = setTimeout(() => ctx.gameOver(score), 30);
  }

  // ---- scoring & combos -------------------------------------------------
  function addScore(n: number): void {
    const mult = doubleTimer > 0 ? 2 : 1;
    score += n * mult;
    ctx.reportScore(score);
  }

  function registerCombo(): void {
    comboCount++;
    lastSliceTime = time;
  }

  function finalizeCombo(force: boolean): void {
    if (comboCount >= 2 && (force || time - lastSliceTime > COMBO_WINDOW)) {
      const n = comboCount;
      const bonus = Math.floor((n * (n - 1)) / 2);
      addScore(bonus);
      let label: string;
      if (n === 2) label = "Double!";
      else if (n === 3) label = "Triple!";
      else if (n === 4) label = "Quad!";
      else if (n === 5) label = "Penta!";
      else label = `MEGA COMBO x${n}!`;
      banner.text = `${label}  +${bonus * (doubleTimer > 0 ? 2 : 1)}`;
      banner.color = n >= 5 ? "#ffd23f" : n >= 4 ? "#ff7be0" : "#9be8ff";
      banner.life = banner.maxLife;
      if (n >= 4) {
        bloom = Math.min(1, bloom + 0.35);
        shake = Math.max(shake, world.min * 0.012);
      }
      audio.tone(880 + n * 40, 0.18, "triangle", 0.5);
      audio.tone(1320 + n * 40, 0.14, "sine", 0.35);
    }
    if (force || time - lastSliceTime > COMBO_WINDOW) {
      comboCount = 0;
      comboPitch = 0;
    }
  }

  // ---- slicing ----------------------------------------------------------
  function trySlice(): void {
    const minSpeed = MIN_SLICE_SPEED * world.min;
    // whoosh sfx on fast blade movement
    if (blade.frameMaxSpeed > minSpeed * 1.2 && whooshCooldown <= 0) {
      audio.sweep(620, 240, 0.13, "sine", 0.18);
      whooshCooldown = 0.12;
    }
    if (blade.segments.length === 0) return;
    for (const f of fruits) {
      if (f.sliced) continue;
      for (const seg of blade.segments) {
        if (seg.speed < minSpeed) continue;
        const d = distPointSeg(f.x, f.y, seg.ax, seg.ay, seg.bx, seg.by);
        if (d <= f.radius * 0.96) {
          const angle = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
          sliceFruit(f, angle);
          break;
        }
      }
      if (phase === "over") return; // bomb sliced — stop processing
    }
  }

  function sliceFruit(f: Fruit, cutAngle: number): void {
    f.sliced = true;
    const scale = f.radius / (world.min * 0.066);

    if (f.def.kind === "bomb") {
      particles.explosion(f.x, f.y, scale * 1.4);
      shake = Math.max(shake, world.min * 0.05);
      bloom = 1;
      endGame("bomb");
      return;
    }

    // juice + splat + halves
    particles.juiceBurst(f.x, f.y, f.def.juice, cutAngle, scale, 1);
    spawnHalves(f, cutAngle);

    // power-ups
    if (f.def.kind === "freeze") {
      freezeTimer = 4.5;
      bloom = Math.min(1, bloom + 0.25);
      audio.sweep(300, 1200, 0.4, "sine", 0.4);
    } else if (f.def.kind === "double") {
      doubleTimer = 7;
      audio.tone(660, 0.1, "square", 0.4);
      audio.tone(990, 0.12, "square", 0.4);
    } else if (f.def.kind === "frenzy") {
      spawner.startFrenzy(6);
      audio.tone(523, 0.1, "triangle", 0.4);
      audio.tone(784, 0.12, "triangle", 0.4);
    }

    // scoring
    const pts = f.def.special ? f.def.points : f.golden ? f.def.points + 4 : f.def.points;
    addScore(pts);
    registerCombo();

    // floating popup
    const popColor = f.golden ? "#ffe27a" : f.def.special ? "#bfefff" : "#ffffff";
    const shown = pts * (doubleTimer > 0 ? 2 : 1);
    particles.floatingText(f.x, f.y - f.radius * 0.4, `+${shown}`, popColor, world.min * 0.05);

    // slice sfx — rising combo ladder
    const base = f.golden ? 900 : 520;
    audio.tone(base * Math.pow(2, comboPitch / 12), 0.07, "triangle", 0.4);
    audio.noise(0.06, 0.18);
    comboPitch = Math.min(24, comboPitch + 1);
    if (f.golden) {
      audio.tone(1320, 0.1, "sine", 0.3);
      bloom = Math.min(1, bloom + 0.12);
    }
  }

  function spawnHalves(f: Fruit, cutAngle: number): void {
    const perpX = Math.cos(cutAngle + Math.PI / 2);
    const perpY = Math.sin(cutAngle + Math.PI / 2);
    const push = world.min * 0.18 + Math.abs(f.vx) * 0.1;
    for (const side of [-1, 1] as const) {
      halves.push({
        def: f.def,
        x: f.x + perpX * side * f.radius * 0.15,
        y: f.y + perpY * side * f.radius * 0.15,
        vx: f.vx + perpX * side * push + rand(-30, 30),
        vy: f.vy + perpY * side * push * 0.5 - rand(20, 80),
        radius: f.radius,
        angle: 0,
        spin: f.spin + side * rand(1, 4),
        side,
        cutAngle,
        golden: f.golden,
        seed: f.seed,
        life: 3,
      });
    }
  }

  // ---- physics ----------------------------------------------------------
  function stepFruit(dt: number): void {
    const g = GRAVITY_K * world.h;
    const fts = freezeTimer > 0 ? 0.45 : 1; // fruit time scale (slow-mo)
    const fdt = dt * fts;

    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i];
      f.vy += g * fdt;
      f.x += f.vx * fdt;
      f.y += f.vy * fdt;
      f.angle += f.spin * fdt;
      f.wobble += fdt;
      if (f.vy > 0) f.pastApex = true;

      // miss: dropped below the bottom after apex
      if (f.pastApex && f.y - f.radius > world.h) {
        const wasNormal = !f.def.special && !f.golden;
        fruits.splice(i, 1);
        if (phase === "playing" && wasNormal && mode === "classic") {
          loseLife();
        }
        continue;
      }
      // cull if drifted far off the sides
      if (f.x < -world.w * 0.4 || f.x > world.w * 1.4) {
        fruits.splice(i, 1);
      }
    }

    for (let i = halves.length - 1; i >= 0; i--) {
      const hf = halves[i];
      hf.vy += g * fdt;
      hf.x += hf.vx * fdt;
      hf.y += hf.vy * fdt;
      hf.angle += hf.spin * fdt;
      hf.life -= dt;
      if (hf.y - hf.radius > world.h || hf.life <= 0) halves.splice(i, 1);
    }
  }

  function loseLife(): void {
    lives--;
    lifeFlash = 1;
    shake = Math.max(shake, world.min * 0.02);
    audio.tone(180, 0.18, "sawtooth", 0.35);
    updateStatus();
    if (lives <= 0) endGame("lives");
  }

  // ---- title interaction ------------------------------------------------
  function modeButtonRects(): Array<{ m: Mode; x: number; y: number; w: number; h: number }> {
    const W = world.w;
    const H = world.h;
    const bw = Math.min(W * 0.26, H * 0.34);
    const bh = bw * 0.5;
    const gap = bw * 0.12;
    const total = bw * 3 + gap * 2;
    const x0 = (W - total) / 2;
    const y = H * 0.62;
    return MODES.map((mb, i) => ({
      m: mb.mode,
      x: x0 + i * (bw + gap),
      y,
      w: bw,
      h: bh,
    }));
  }

  function handleTitleTap(): void {
    const px = input.pointer.x;
    const py = input.pointer.y;
    const rects = modeButtonRects();
    for (const r of rects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        if (r.m !== mode) {
          mode = r.m;
          storage.set("mode", mode);
          audio.tone(660, 0.06, "square", 0.3);
          updateStatus();
        } else {
          startCountdown();
        }
        return;
      }
    }
    // tap anywhere else starts with current mode
    startCountdown();
  }

  // =======================================================================
  // GameInstance
  // =======================================================================
  return {
    update(dtRaw: number) {
      const dt = clamp(dtRaw, 0, MAX_DT);
      time += dt;
      syncWorld();

      if (whooshCooldown > 0) whooshCooldown -= dt;
      if (shake > 0) shake = Math.max(0, shake - SHAKE_DECAY * dt * world.min * 0.02 - shake * dt * 4);
      if (bloom > 0) bloom = Math.max(0, bloom - dt * 2.2);
      if (lifeFlash > 0) lifeFlash = Math.max(0, lifeFlash - dt * 2.5);
      if (banner.life > 0) banner.life -= dt;

      // blade trail always tracked (so title-screen slicing works too)
      blade.update(input, world, dt);

      if (phase === "title") {
        if (input.pointer.justDown) handleTitleTap();
        demoSpawn(dt);
        stepFruit(dt);
        trySliceTitle();
        particles.update(dt);
        return;
      }

      if (phase === "countdown") {
        countdown -= dt;
        stepFruit(dt);
        particles.update(dt);
        if (countdown <= 0) {
          phase = "playing";
          updateStatus();
        }
        return;
      }

      if (phase === "over") {
        overTimer -= dt;
        stepFruit(dt);
        particles.update(dt);
        if (overTimer <= 0) commitGameOver();
        return;
      }

      // ---- PLAYING ----
      elapsed += dt;
      if (doubleTimer > 0) doubleTimer -= dt;
      if (freezeTimer > 0) freezeTimer -= dt;
      bg.freezeTint = clamp(freezeTimer / 1.5, 0, 1);

      if (mode !== "classic") {
        timeLeft -= dt;
        if (Math.ceil(timeLeft) !== Math.ceil(timeLeft + dt)) updateStatus();
        if (timeLeft <= 0) {
          timeLeft = 0;
          endGame("time");
          return;
        }
      }

      // spawn waves
      const fresh = spawner.update(dt, world, elapsed, fruits.length);
      for (const f of fresh) fruits.push(f);

      // physics + slicing
      stepFruit(dt);
      trySlice();
      finalizeCombo(false);
      particles.update(dt);
    },

    render() {
      const c = ctx.ctx;
      syncWorld();
      const W = world.w;
      const H = world.h;

      c.save();
      // screen shake
      if (shake > 0.1) {
        c.translate(rand(-shake, shake), rand(-shake, shake));
      }

      bg.render(c, world);
      particles.renderSplats(c);

      // halves behind whole fruit
      for (const hf of halves) drawHalf(c, hf);
      for (const f of fruits) drawFruit(c, f);

      particles.render(c);
      blade.render(c, world);

      c.restore();

      // bloom flash (over shake, under HUD)
      if (bloom > 0.01) {
        c.fillStyle = `rgba(255,255,255,${bloom * 0.5})`;
        c.fillRect(0, 0, W, H);
      }
      if (lifeFlash > 0.01) {
        c.fillStyle = `rgba(255,40,40,${lifeFlash * 0.28})`;
        c.fillRect(0, 0, W, H);
      }

      // HUD + overlays
      if (phase === "title") renderTitle(c);
      else renderHUD(c);
      if (phase === "countdown") renderCountdown(c);
      if (phase === "over") renderOver(c);

      if (banner.life > 0 && phase !== "title") renderBanner(c);
      particles.renderText(c);
    },

    resize() {
      // background caches rebuild lazily on size change; nothing else to do.
      bg.ensure(syncWorld());
    },

    onPause() {
      // nothing persistent to stop; dt is clamped on resume anyway.
    },

    destroy() {
      if (gameOverId !== null) clearTimeout(gameOverId);
      gameOverId = null;
      fruits.length = 0;
      halves.length = 0;
      particles.clear();
      blade.reset();
    },
  };

  // ---- title demo helpers ----------------------------------------------
  function demoSpawn(dt: number): void {
    demoTimer -= dt;
    if (demoTimer <= 0 && fruits.length < 4) {
      fruits.push(launchDemoFruit());
      demoTimer = rand(0.7, 1.4);
    }
  }

  /** A simple, bomb-free fruit toss used only on the title screen. */
  function launchDemoFruit(): Fruit {
    const kind = NORMAL_FRUIT[Math.floor(Math.random() * NORMAL_FRUIT.length)];
    const def = FRUIT_DEFS[kind];
    const g = GRAVITY_K * world.h;
    const radius = FRUIT_R_K * world.min * def.sizeMul;
    const apexY = rand(0.18, 0.34) * world.h;
    const startY = world.h + radius;
    const vy = -Math.sqrt(2 * g * (startY - apexY));
    const timeToApex = -vy / g;
    const x = rand(world.w * 0.15, world.w * 0.85);
    const targetX = world.w * rand(0.35, 0.65);
    const vx = clamp((targetX - x) / Math.max(0.3, timeToApex), -world.w * 0.4, world.w * 0.4);
    return {
      def,
      x,
      y: startY,
      vx,
      vy,
      radius,
      angle: rand(0, TAU),
      spin: rand(-3, 3),
      sliced: false,
      golden: Math.random() < 0.12,
      pastApex: false,
      wobble: rand(0, 10),
      seed: (Math.random() * 1e9) | 0,
    };
  }

  function trySliceTitle(): void {
    const minSpeed = MIN_SLICE_SPEED * world.min;
    for (const f of fruits) {
      if (f.sliced) continue;
      for (const seg of blade.segments) {
        if (seg.speed < minSpeed) continue;
        const d = distPointSeg(f.x, f.y, seg.ax, seg.ay, seg.bx, seg.by);
        if (d <= f.radius * 0.96) {
          f.sliced = true;
          const angle = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
          particles.juiceBurst(f.x, f.y, f.def.juice, angle, f.radius / (world.min * 0.066), 1);
          spawnHalves(f, angle);
          audio.tone(520, 0.07, "triangle", 0.35);
          audio.noise(0.05, 0.15);
          break;
        }
      }
    }
    for (let i = fruits.length - 1; i >= 0; i--) if (fruits[i].sliced) fruits.splice(i, 1);
  }

  // ---- HUD / overlay rendering -----------------------------------------
  function renderHUD(c: CanvasRenderingContext2D): void {
    const W = world.w;
    const H = world.h;
    const s = world.min;

    // score (top center)
    c.save();
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    drawText(c, String(score), W / 2, H * 0.1, s * 0.085, "#ffffff");
    c.font = `700 ${s * 0.03}px "Baloo 2", system-ui, sans-serif`;
    c.fillStyle = "rgba(255,255,255,0.7)";
    c.textBaseline = "middle";
    c.fillText(`BEST ${bestScore()}`, W / 2, H * 0.14);
    c.restore();

    if (mode === "classic") {
      // lives pips top-right
      const r = s * 0.022;
      for (let i = 0; i < CLASSIC_LIVES; i++) {
        const x = W - (i + 1) * r * 3;
        const y = H * 0.06;
        const alive = i < lives;
        drawLifePip(c, x, y, r, alive);
      }
    } else {
      // timer bar top
      const total = mode === "zen" ? ZEN_TIME : ARCADE_TIME;
      const frac = clamp(timeLeft / total, 0, 1);
      const bw = W * 0.4;
      const bx = (W - bw) / 2;
      const by = H * 0.18;
      c.fillStyle = "rgba(0,0,0,0.3)";
      roundRect(c, bx, by, bw, s * 0.018, s * 0.01);
      c.fill();
      c.fillStyle = frac > 0.25 ? "#7be0a0" : "#ff6b6b";
      roundRect(c, bx, by, bw * frac, s * 0.018, s * 0.01);
      c.fill();
    }

    // power-up badges
    const badges: Array<{ t: string; col: string; frac: number }> = [];
    if (doubleTimer > 0) badges.push({ t: "2X", col: "#ffd23f", frac: doubleTimer / 7 });
    if (freezeTimer > 0) badges.push({ t: "SLOW", col: "#7fdcff", frac: freezeTimer / 4.5 });
    if (spawner.frenzyActive) badges.push({ t: "FRENZY", col: "#ff7be0", frac: 1 });
    badges.forEach((b, i) => {
      const bx = s * 0.04;
      const by = H * 0.24 + i * s * 0.075;
      const bw = s * 0.16;
      c.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(c, bx, by, bw, s * 0.05, s * 0.012);
      c.fill();
      c.fillStyle = b.col;
      roundRect(c, bx, by + s * 0.046, bw * clamp(b.frac, 0, 1), s * 0.006, s * 0.003);
      c.fill();
      drawText(c, b.t, bx + bw / 2, by + s * 0.028, s * 0.03, b.col);
    });
  }

  function drawLifePip(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    alive: boolean,
  ): void {
    c.save();
    c.translate(x, y);
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    if (alive) {
      const g = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      g.addColorStop(0, "#ff8aa0");
      g.addColorStop(1, "#e83352");
      c.fillStyle = g;
    } else {
      c.fillStyle = "rgba(120,120,130,0.4)";
    }
    c.fill();
    if (alive) {
      c.fillStyle = "#3fa850";
      c.fillRect(-r * 0.08, -r * 1.1, r * 0.16, r * 0.4);
    }
    c.restore();
  }

  function renderBanner(c: CanvasRenderingContext2D): void {
    const W = world.w;
    const H = world.h;
    const k = banner.life / banner.maxLife;
    const pop = k > 0.75 ? 1 + (k - 0.75) * 2.4 : 1;
    c.save();
    c.globalAlpha = clamp(k * 1.6, 0, 1);
    c.translate(W / 2, H * 0.32);
    c.scale(pop, pop);
    c.font = `900 ${world.min * 0.07}px "Baloo 2", system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineWidth = world.min * 0.012;
    c.strokeStyle = "rgba(0,0,0,0.55)";
    c.strokeText(banner.text, 0, 0);
    c.fillStyle = banner.color;
    c.fillText(banner.text, 0, 0);
    c.restore();
  }

  function renderTitle(c: CanvasRenderingContext2D): void {
    const W = world.w;
    const H = world.h;
    const s = world.min;

    c.fillStyle = "rgba(10,4,20,0.35)";
    c.fillRect(0, 0, W, H);

    // wordmark
    c.save();
    c.textAlign = "center";
    c.textBaseline = "middle";
    const bob = Math.sin(time * 1.5) * s * 0.01;
    const titleY = H * 0.26 + bob;
    c.font = `900 ${s * 0.13}px "Baloo 2", system-ui, sans-serif`;
    c.lineWidth = s * 0.02;
    c.strokeStyle = "rgba(0,0,0,0.5)";
    c.strokeText("FRUIT", W / 2, titleY);
    const g1 = c.createLinearGradient(0, titleY - s * 0.08, 0, titleY + s * 0.08);
    g1.addColorStop(0, "#ff8a5b");
    g1.addColorStop(1, "#ff4d6d");
    c.fillStyle = g1;
    c.fillText("FRUIT", W / 2, titleY);

    const t2 = titleY + s * 0.14;
    c.strokeText("FRENZY", W / 2, t2);
    const g2 = c.createLinearGradient(0, t2 - s * 0.08, 0, t2 + s * 0.08);
    g2.addColorStop(0, "#7be0a0");
    g2.addColorStop(1, "#19c3a0");
    c.fillStyle = g2;
    c.fillText("FRENZY", W / 2, t2);
    c.restore();

    // best
    drawText(
      c,
      `Best (${MODES.find((m) => m.mode === mode)?.label}): ${bestScore()}`,
      W / 2,
      H * 0.5,
      s * 0.04,
      "rgba(255,255,255,0.85)",
    );

    // mode buttons
    const rects = modeButtonRects();
    rects.forEach((r, i) => {
      const active = r.m === mode;
      c.save();
      c.fillStyle = active ? "rgba(255,210,90,0.95)" : "rgba(255,255,255,0.14)";
      roundRect(c, r.x, r.y, r.w, r.h, r.h * 0.22);
      c.fill();
      if (active) {
        c.lineWidth = s * 0.006;
        c.strokeStyle = "rgba(255,255,255,0.9)";
        c.stroke();
      }
      drawText(
        c,
        MODES[i].label,
        r.x + r.w / 2,
        r.y + r.h * 0.36,
        s * 0.04,
        active ? "#3a1a00" : "#ffffff",
      );
      drawText(
        c,
        MODES[i].desc,
        r.x + r.w / 2,
        r.y + r.h * 0.72,
        s * 0.022,
        active ? "rgba(60,26,0,0.8)" : "rgba(255,255,255,0.7)",
      );
      c.restore();
    });

    // hint
    const pulse = 0.6 + 0.4 * Math.sin(time * 3);
    drawText(
      c,
      ctx.isTouch ? "Swipe to slice — tap a mode to begin" : "Drag to slice — click a mode to begin",
      W / 2,
      H * 0.88,
      s * 0.032,
      withAlpha("#ffffff", pulse),
    );
  }

  function renderCountdown(c: CanvasRenderingContext2D): void {
    const W = world.w;
    const H = world.h;
    const s = world.min;
    const n = Math.ceil(countdown);
    const label = n > 0 ? String(n) : "SLICE!";
    const frac = countdown - Math.floor(countdown);
    const pop = 1 + (1 - frac) * 0.6;
    c.save();
    c.globalAlpha = clamp(frac * 1.5 + 0.2, 0, 1);
    c.translate(W / 2, H * 0.42);
    c.scale(pop, pop);
    drawText(c, label, 0, 0, s * 0.16, "#ffffff");
    c.restore();
  }

  function renderOver(c: CanvasRenderingContext2D): void {
    const W = world.w;
    const H = world.h;
    const s = world.min;
    const a = clamp(1 - overTimer / (endReason === "bomb" ? 1.3 : 0.9), 0, 1);
    c.fillStyle = `rgba(8,3,16,${a * 0.55})`;
    c.fillRect(0, 0, W, H);
    let head = "GAME OVER";
    if (endReason === "bomb") head = "BOOM!";
    else if (endReason === "time") head = "TIME!";
    drawText(c, head, W / 2, H * 0.38, s * 0.11, endReason === "bomb" ? "#ff6b4d" : "#ffffff");
    drawText(c, `Score ${score}`, W / 2, H * 0.5, s * 0.06, "#ffe27a");
    drawText(c, `Best ${Math.max(score, bestScore())}`, W / 2, H * 0.57, s * 0.04, "rgba(255,255,255,0.8)");
  }
}
