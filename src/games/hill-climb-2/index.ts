/**
 * Hill Climb 2 — an original Hill Climb Racing-style physics driver.
 * See PRD.md for the full design. This file is the orchestrator: it owns the
 * phase state machine, camera, run statistics and wires together the physics,
 * terrain, particles, renderer and garage modules.
 */
import type { GameContext, GameInstance, Rect } from "@/engine";
import { clamp, drawText, pointInRect, roundRect } from "@/engine";
import {
  AIRTIME_CAP,
  AIRTIME_COINS,
  CAN_REFILL,
  FLIP_COINS,
  GAS_DRAIN,
  G_BASE,
  IDLE_DRAIN,
  LOOKAHEAD,
  METER,
  OUT_OF_FUEL_STOP,
  START_X,
  STAGES,
  VEHICLES,
  VIEW_H,
  deriveStats,
} from "./config";
import { Garage } from "./garage";
import { ParticleSystem } from "./particles";
import { Car } from "./physics";
import { Renderer, project as projectView } from "./render";
import type { View } from "./render";
import { loadSave, writeSave } from "./save";
import { Terrain } from "./terrain";
import type { Phase, RunResult, SaveState } from "./types";

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  const save: SaveState = loadSave(storage);
  const renderer = new Renderer();
  const particles = new ParticleSystem();
  const garage = new Garage({ input, audio, storage, save });

  let phase: Phase = "garage";
  let t = 0;

  // --- run-scoped state (created on startRun) ---
  let terrain: Terrain | null = null;
  let car: Car | null = null;
  let gravity = G_BASE;
  let fuel = 0;
  let maxFuel = 0;
  let metres = 0;
  let pickupCoins = 0;
  let flipBonus = 0;
  let airBonus = 0;
  let prevAirborne = false;
  let coastTimer = 0;
  let countdown = 0;
  let crashTimer = 0;
  let engineSndT = 0;
  let result: RunResult | null = null;

  // --- camera ---
  let camX = START_X;
  let camY = 200;
  let zoom = 1;
  let shake = 0;

  // --- control mode bookkeeping (avoid spamming requestControls) ---
  let controlMode: "menu" | "drive" | "" = "";
  const setControls = (mode: "menu" | "drive") => {
    if (controlMode === mode) return;
    controlMode = mode;
    if (mode === "drive") {
      ctx.requestControls([
        { type: "button", key: "ArrowLeft", label: "BRAKE", id: "brake" },
        { type: "button", key: "ArrowRight", label: "GAS", id: "gas" },
      ]);
      ctx.setStatus("GAS: \u2192 / Space   \u2022   BRAKE: \u2190   \u2022   flip in the air!");
    } else {
      ctx.requestControls([]);
      ctx.setStatus("Tune your ride, pick a world, then GO!");
    }
  };
  setControls("menu");

  // =====================================================================
  //  Run lifecycle
  // =====================================================================
  function startRun(): void {
    const vDef = VEHICLES[save.selectedVehicle];
    const sDef = STAGES[save.selectedStage];
    const stats = deriveStats(save.selectedVehicle, save.upgrades[save.selectedVehicle]);
    gravity = G_BASE * sDef.gravityScale;
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    terrain = new Terrain(sDef, seed);
    car = new Car(stats, terrain, gravity);
    maxFuel = stats.maxFuel;
    fuel = maxFuel;
    metres = 0;
    pickupCoins = 0;
    flipBonus = 0;
    airBonus = 0;
    prevAirborne = false;
    coastTimer = 0;
    crashTimer = 0;
    result = null;
    particles.clear();
    terrain.ensurePickups(START_X + LOOKAHEAD);
    terrain.ensureDecor(START_X + LOOKAHEAD);
    camX = car.cx;
    camY = car.cy;
    zoom = ctx.height / VIEW_H;
    shake = 0;
    countdown = 2.4;
    phase = "countdown";
    void vDef;
    setControls("drive");
  }

  function endRun(reason: "crash" | "fuel"): void {
    if (phase !== "run" || !car) return;
    phase = "crashed";
    crashTimer = 0;
    const total = pickupCoins + flipBonus + airBonus;
    save.coins += total;
    save.totalDistance += Math.floor(metres);
    const prevBest = save.bestByStage[save.selectedStage] ?? 0;
    const newBest = Math.floor(metres) > prevBest;
    if (newBest) save.bestByStage[save.selectedStage] = Math.floor(metres);
    writeSave(storage, save);
    storage.submitScore(Math.floor(metres));
    result = {
      metres: Math.floor(metres),
      coins: total,
      flipBonus,
      airBonus,
      pickupCoins,
      newBest,
      reason,
    };
    if (reason === "crash") {
      audio.explosion();
      shake = 16;
      // debris burst
      const p = car.localToWorld(0, 0);
      particles.burstDebris(p.x, p.y, VEHICLES[save.selectedVehicle].color, 18);
      particles.burstDebris(p.x, p.y, "#333", 10);
    } else {
      audio.lose();
    }
  }

  // =====================================================================
  //  Update
  // =====================================================================
  function updateCountdown(dt: number): void {
    if (!car || !terrain) return;
    countdown -= dt;
    // let the car settle on its suspension (no driving input)
    const steps = 6;
    const h = Math.min(dt, 1 / 30) / steps;
    for (let i = 0; i < steps; i++) car.step(h, false, false);
    followCamera(dt, true);
    if (countdown <= 0) {
      phase = "run";
      audio.sweep(200, 520, 0.2, "sawtooth", 0.3);
    }
  }

  function updateRun(dt: number): void {
    if (!car || !terrain) return;
    const gas = input.isDown("ArrowRight", "Space", "d", "w", "ArrowUp");
    const brake = input.isDown("ArrowLeft", "a", "ArrowDown", "s");

    car.engineOn = fuel > 0;

    // fixed-timestep substeps
    const dtc = Math.min(dt, 1 / 30);
    const steps = clamp(Math.ceil(dtc * 240), 4, 12);
    const h = dtc / steps;
    for (let i = 0; i < steps; i++) {
      car.step(h, gas && car.engineOn, brake);
      if (car.crashed) break;
    }

    if (car.crashed) {
      endRun("crash");
      return;
    }

    // distance / score
    const m = Math.max(0, (car.cx - START_X) / METER);
    if (m > metres) {
      metres = m;
      ctx.reportScore(Math.floor(metres));
    }

    // fuel
    const moving = Math.abs(car.vx) > 5;
    const drain =
      IDLE_DRAIN + (gas && car.engineOn && moving ? GAS_DRAIN : 0);
    fuel = Math.max(0, fuel - drain * deriveFuelUse() * dt);

    // landing fx
    const imp = car.takeLandImpact();
    if (imp > 200 && terrain) {
      const n = clamp(Math.floor(imp / 120), 1, 10);
      const gy = terrain.height(car.cx);
      for (let i = 0; i < n; i++) {
        particles.dust(
          car.cx + (Math.random() - 0.5) * 40,
          gy,
          (Math.random() - 0.5) * 120,
          -40 - Math.random() * 60,
          STAGES[save.selectedStage].palette.dust,
          5,
        );
      }
      if (imp > 420) audio.tone(90, 0.12, "sine", 0.25);
    }

    // wheel dust while driving / slipping
    for (const w of car.wheels) {
      if (w.grounded && (w.slip > 0.15 || (gas && car.engineOn && Math.abs(car.vx) > 30))) {
        if (Math.random() < 0.5) {
          particles.dust(
            w.x,
            w.y + 6,
            -car.vx * 0.2 - (Math.random() * 30),
            -Math.random() * 30,
            STAGES[save.selectedStage].palette.dust,
            4,
          );
        }
      }
    }

    // exhaust when gassing
    if (gas && car.engineOn && Math.random() < 0.4) {
      const pipe = car.localToWorld(-VEHICLES[save.selectedVehicle].bodyW * 0.5, 0);
      particles.exhaust(pipe.x, pipe.y, -car.vx * 0.1, 0);
    }

    // flips / air-time bonus on a clean landing
    const airborneNow = car.airborne;
    if (prevAirborne && !airborneNow && !car.crashed) {
      const flips = Math.floor(Math.abs(car.airRotation) / (Math.PI * 2));
      if (car.airTime > 0.4 && (flips >= 1 || car.airTime > 0.9)) {
        const fb = flips * FLIP_COINS;
        const ab = clamp(Math.floor(car.airTime / 0.5) * AIRTIME_COINS, 0, AIRTIME_CAP);
        flipBonus += fb;
        airBonus += ab;
        const total = fb + ab;
        if (total > 0) {
          const p = car.localToWorld(0, -30);
          particles.coinPop(p.x, p.y, `+${total}`, "#ffd23f");
          particles.burstSparkle(p.x, p.y, "#fff3b0", 12);
          particles.burstSparkle(p.x, p.y, STAGES[save.selectedStage].palette.hudAccent, 8);
          if (flips >= 1) {
            [523, 659, 784, 1047].forEach((f, i) =>
              audio.tone(f, 0.1, "triangle", 0.3 * (1 + 0.1 * i)),
            );
          } else {
            audio.coin();
          }
        }
      }
    }
    prevAirborne = airborneNow;

    // pickups
    terrain.ensurePickups(car.cx + LOOKAHEAD);
    terrain.ensureDecor(car.cx + LOOKAHEAD);
    const grab = 2.8 * METER;
    for (const it of terrain.pickups) {
      if (it.got) continue;
      if (Math.hypot(it.x - car.cx, it.y - car.cy) < grab) {
        it.got = true;
        if (it.kind === "coin") {
          pickupCoins += 1;
          particles.coinPop(it.x, it.y - 8, "+1", "#ffd23f");
          audio.coin();
        } else {
          fuel = Math.min(maxFuel, fuel + CAN_REFILL);
          particles.coinPop(it.x, it.y - 8, "FUEL", "#43d17a");
          audio.sweep(400, 800, 0.18, "sine", 0.4);
        }
      }
    }
    terrain.cull(camX - ctx.width);

    // engine sound modulated by speed
    if (car.engineOn && (gas || car.speed > 40)) {
      engineSndT -= dt;
      if (engineSndT <= 0) {
        engineSndT = gas ? 0.08 : 0.16;
        const hz = 60 + clamp(car.speed * 0.42, 0, 320) + (gas ? 30 : 0);
        audio.tone(hz, gas ? 0.1 : 0.14, "sawtooth", gas ? 0.14 : 0.07);
      }
    }

    // crash by running out of fuel (coast to a stop) or watchdog
    if (fuel <= 0) {
      ctx.setStatus("OUT OF FUEL!");
      if (Math.abs(car.vx) < OUT_OF_FUEL_STOP && (car.wheels[0].grounded || car.wheels[1].grounded)) {
        coastTimer += dt;
        if (coastTimer > 0.6) endRun("fuel");
      } else {
        coastTimer = 0;
      }
    }

    followCamera(dt, false);
  }

  function deriveFuelUse(): number {
    return VEHICLES[save.selectedVehicle].fuelUse;
  }

  function followCamera(dt: number, settle: boolean): void {
    if (!car) return;
    const lead = clamp(car.vx * 0.18, -140, 240);
    const targetX = car.cx + lead;
    const targetY = car.cy - 20;
    const rate = settle ? 6 : 4.5;
    const k = 1 - Math.exp(-rate * dt);
    camX += (targetX - camX) * k;
    camY += (targetY - camY) * k;
    // speed zoom (zoom out when fast / in big air)
    const base = ctx.height / VIEW_H;
    const speedF = clamp(car.speed / 1400, 0, 1);
    const airF = clamp(car.airTime / 1.5, 0, 1) * 0.08;
    const targetZoom = base * (1 - 0.18 * speedF - airF);
    zoom += (targetZoom - zoom) * (1 - Math.exp(-3 * dt));
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
  }

  function updateCrashed(dt: number): void {
    crashTimer += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    followCamera(dt, false);
    if (crashTimer > 1.1) phase = "results";
  }

  // results buttons (rebuilt each render, tested on click)
  let retryRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let garageRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  function updateResults(): void {
    const goRetry =
      input.pressed("Enter", "Space", "ArrowRight") ||
      (input.pointer.justDown && pointInRect(input.pointer.x, input.pointer.y, retryRect));
    const goGarage =
      input.pressed("Escape", "g") ||
      (input.pointer.justDown && pointInRect(input.pointer.x, input.pointer.y, garageRect));
    if (goRetry) {
      startRun();
    } else if (goGarage) {
      phase = "garage";
      setControls("menu");
    }
  }

  // =====================================================================
  //  Render
  // =====================================================================
  function makeView(): View {
    return {
      W: ctx.width,
      H: ctx.height,
      camX,
      camY,
      zoom,
      anchorX: 0.32,
      anchorY: 0.58,
    };
  }

  function drawWorld(): void {
    if (!terrain || !car) return;
    const c = ctx.ctx;
    const v = makeView();
    const stage = STAGES[save.selectedStage];

    c.save();
    if (shake > 0) {
      c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    renderer.drawSky(c, v, stage, t);
    renderer.drawParallax(c, v, stage);
    renderer.drawTerrain(c, v, terrain);
    renderer.drawDecor(c, v, terrain);
    renderer.drawPickups(c, v, terrain, t);
    const proj = (wx: number, wy: number) => projectView(v, wx, wy);
    particles.draw(c, proj, v.zoom, false);
    renderer.drawCar(c, v, car, VEHICLES[save.selectedVehicle]);
    particles.draw(c, proj, v.zoom, true);
    c.restore();
  }

  function drawHud(): void {
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;
    const stage = STAGES[save.selectedStage];
    const pad = Math.min(W, H) * 0.03;

    // fuel gauge
    const barW = Math.min(W * 0.34, 280);
    const barH = clamp(H * 0.032, 14, 24);
    const bx = pad;
    const by = pad;
    c.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(c, bx - 4, by - 4, barW + 8, barH + 8, 8);
    c.fill();
    const fr = maxFuel > 0 ? fuel / maxFuel : 0;
    const low = fr < 0.25;
    const pulse = low ? 0.6 + 0.4 * Math.abs(Math.sin(t * 8)) : 1;
    c.fillStyle = fr > 0.5 ? "#43d17a" : fr > 0.25 ? "#ffd23f" : "#e23b3b";
    c.globalAlpha = pulse;
    roundRect(c, bx, by, Math.max(0, barW * fr), barH, 6);
    c.fill();
    c.globalAlpha = 1;
    drawText(c, "FUEL", bx + barW / 2, by + barH / 2, barH * 0.62, "#fff");

    // distance + stage
    const distSize = clamp(H * 0.07, 22, 40);
    drawText(c, `${Math.floor(metres)} m`, W - pad, by + distSize * 0.5, distSize, "#fff", "right", "800");
    drawText(
      c,
      stage.name,
      W - pad,
      by + distSize + 6,
      clamp(H * 0.03, 12, 18),
      stage.palette.hudAccent,
      "right",
    );
    const best = save.bestByStage[save.selectedStage] ?? 0;
    drawText(c, `best ${best} m`, W - pad, by + distSize + 26, clamp(H * 0.026, 11, 15), "#9fc6e8", "right");

    // coins this run
    const runCoins = pickupCoins + flipBonus + airBonus;
    drawText(
      c,
      `\u25C9 ${runCoins}`,
      bx,
      by + barH + 22,
      clamp(H * 0.04, 16, 24),
      "#ffd95c",
      "left",
      "800",
    );

    // speedometer arc (bottom-left)
    if (car) {
      const sR = clamp(H * 0.07, 28, 54);
      const sx = pad + sR;
      const sy = H - pad - sR;
      c.strokeStyle = "rgba(0,0,0,0.35)";
      c.lineWidth = 6;
      c.beginPath();
      c.arc(sx, sy, sR, Math.PI * 0.8, Math.PI * 2.2);
      c.stroke();
      const spd = clamp(car.speed / 1400, 0, 1);
      c.strokeStyle = stage.palette.hudAccent;
      c.beginPath();
      c.arc(sx, sy, sR, Math.PI * 0.8, Math.PI * 0.8 + spd * Math.PI * 1.4);
      c.stroke();
      drawText(c, `${Math.round(car.speed / 16)}`, sx, sy, sR * 0.5, "#fff", "center", "800");
    }

    if (phase === "countdown") {
      const n = Math.ceil(countdown);
      drawText(c, n > 0 ? String(n) : "GO!", W / 2, H * 0.42, clamp(H * 0.2, 60, 140), "#ffd23f", "center", "800");
    }
  }

  function drawResults(): void {
    if (!result) return;
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;
    c.fillStyle = "rgba(8,12,24,0.72)";
    c.fillRect(0, 0, W, H);

    const cardW = Math.min(W * 0.8, 460);
    const cardH = Math.min(H * 0.7, 420);
    const cardX = (W - cardW) / 2;
    const cardY = (H - cardH) / 2;
    c.fillStyle = "#16223e";
    roundRect(c, cardX, cardY, cardW, cardH, 18);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.12)";
    c.lineWidth = 2;
    roundRect(c, cardX, cardY, cardW, cardH, 18);
    c.stroke();

    const title = result.reason === "crash" ? "WRECKED!" : "OUT OF FUEL";
    drawText(c, title, W / 2, cardY + cardH * 0.12, clamp(W * 0.07, 30, 46), "#ff6b5c", "center", "800");
    if (result.newBest) {
      drawText(c, "\u2605 NEW BEST!", W / 2, cardY + cardH * 0.21, clamp(W * 0.035, 16, 22), "#ffd23f");
    }
    drawText(c, `${result.metres} m`, W / 2, cardY + cardH * 0.34, clamp(W * 0.1, 40, 64), "#fff", "center", "800");

    // coin breakdown
    const lines: Array<[string, string]> = [
      ["Coins collected", `\u25C9 ${result.pickupCoins}`],
      ["Flip bonus", `\u25C9 ${result.flipBonus}`],
      ["Air-time bonus", `\u25C9 ${result.airBonus}`],
    ];
    let ly = cardY + cardH * 0.46;
    const lx = cardX + cardW * 0.12;
    const rx = cardX + cardW * 0.88;
    for (const [label, val] of lines) {
      drawText(c, label, lx, ly, clamp(W * 0.03, 13, 18), "#9fc6e8", "left");
      drawText(c, val, rx, ly, clamp(W * 0.03, 13, 18), "#ffd95c", "right");
      ly += clamp(cardH * 0.06, 22, 32);
    }
    c.strokeStyle = "rgba(255,255,255,0.1)";
    c.beginPath();
    c.moveTo(lx, ly - 6);
    c.lineTo(rx, ly - 6);
    c.stroke();
    drawText(c, "Total earned", lx, ly + 14, clamp(W * 0.034, 14, 20), "#fff", "left", "800");
    drawText(c, `\u25C9 ${result.coins}`, rx, ly + 14, clamp(W * 0.04, 16, 24), "#ffd23f", "right", "800");

    // buttons
    const bw = cardW * 0.4;
    const bh = clamp(cardH * 0.12, 40, 54);
    const gap = cardW * 0.06;
    const by = cardY + cardH - bh - cardH * 0.06;
    retryRect = { x: cardX + cardW * 0.07, y: by, w: bw, h: bh };
    garageRect = { x: cardX + cardW * 0.07 + bw + gap, y: by, w: bw, h: bh };
    c.fillStyle = "#43d17a";
    roundRect(c, retryRect.x, retryRect.y, bw, bh, 10);
    c.fill();
    drawText(c, "RETRY", retryRect.x + bw / 2, by + bh / 2, bh * 0.4, "#0a2417", "center", "800");
    c.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(c, garageRect.x, garageRect.y, bw, bh, 10);
    c.fill();
    drawText(c, "GARAGE", garageRect.x + bw / 2, by + bh / 2, bh * 0.4, "#fff", "center", "800");
  }

  // =====================================================================
  return {
    update(dt: number) {
      const d = clamp(dt, 0, 0.05);
      t += d;
      particles.update(d);
      switch (phase) {
        case "garage":
          if (garage.update()) startRun();
          break;
        case "countdown":
          updateCountdown(d);
          break;
        case "run":
          updateRun(d);
          break;
        case "crashed":
          updateCrashed(d);
          break;
        case "results":
          updateResults();
          break;
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      if (phase === "garage") {
        garage.draw(c, W, H, t);
        return;
      }
      // world phases
      drawWorld();
      drawHud();
      if (phase === "results") drawResults();
    },

    resize() {
      if (phase !== "garage") zoom = ctx.height / VIEW_H;
    },

    destroy() {
      // no external timers/listeners held; nothing to release
    },
  };
}
