/**
 * Putt Park — an original top-down mini-golf game.
 *
 * Entry point: `create(ctx)` returns the GameInstance the portal drives. This
 * module owns the finite-state machine, input handling, scoring, particles and
 * transitions; it delegates physics to `physics.ts`, drawing to `render.ts`,
 * sound to `audio.ts` and hole data to `courses.ts`. See PRD.md for the design.
 */

import type { GameContext, GameInstance } from "@/engine";
import { clamp } from "@/engine";

import { CONST } from "./types";
import type { Hole, HoleScore, Phase, Wall } from "./types";
import { COURSE, TOTAL_PAR } from "./courses";
import { buildWalls, previewPath, stepBall } from "./physics";
import type { Ball, PhysicsEvents } from "./physics";
import { Sfx } from "./audio";
import { Renderer, computeTransform } from "./render";
import type { Particle, Scene } from "./render";

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;
  const sfx = new Sfx(audio);
  const renderer = new Renderer(ctx.ctx);

  // ---- persistent best ----
  let bestTotal = storage.get<number | null>("bestTotal", null);
  let bestRelative = storage.get<number | null>("bestRelative", null);

  // ---- run state ----
  let phase: Phase = "title";
  let holeIndex = 0;
  let hole: Hole = COURSE[0];
  let walls: Wall[] = buildWalls(hole);

  const ball: Ball = { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0, moving: false, spin: 0 };
  let preShot = { x: hole.tee.x, y: hole.tee.y };

  let strokes = 0;
  let completedStrokes = 0;
  let completedPar = 0;
  const scores: (HoleScore | null)[] = COURSE.map(() => null);

  let time = 0;
  let introT = 0;
  let introHold = 0;

  // sinking animation
  let sinkT = 0;
  let sinkFrom = { x: 0, y: 0 };

  // aiming
  let aiming = false;
  let aimDirX = 0;
  let aimDirY = -1;
  let power = 0;
  let preview: { x: number; y: number }[] = [];

  // hole-complete result
  let resultLabel = "";
  let resultStrokes = 0;
  let resultRelative = 0;

  // misc
  let wasInSand = false;
  let finished = false;
  let message = "";
  const particles: Particle[] = [];

  ctx.requestControls([{ type: "button", key: "r", label: "RESET", id: "reset" }]);
  ctx.setStatus("Tap to start");

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  const runningTotal = () => completedStrokes + strokes;

  const report = () => ctx.reportScore(runningTotal());

  const loadHole = (index: number) => {
    holeIndex = index;
    hole = COURSE[index];
    walls = buildWalls(hole);
    ball.x = hole.tee.x;
    ball.y = hole.tee.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.moving = false;
    ball.spin = 0;
    preShot = { x: hole.tee.x, y: hole.tee.y };
    strokes = 0;
    aiming = false;
    power = 0;
    preview = [];
    wasInSand = false;
    phase = "intro";
    introT = 0;
    introHold = 0;
    ctx.setStatus(`Hole ${hole.id} — ${hole.name}`);
    report();
  };

  const labelFor = (st: number, par: number): string => {
    if (st === 1) return "Hole in One!";
    const d = st - par;
    if (d <= -3) return "Albatross!";
    if (d === -2) return "Eagle!";
    if (d === -1) return "Birdie!";
    if (d === 0) return "Par";
    if (d === 1) return "Bogey";
    if (d === 2) return "Double Bogey";
    return `+${d}`;
  };

  const toWorld = (px: number, py: number) => {
    const t = computeTransform(ctx.width, ctx.height, hole);
    return { x: (px - t.offX) / t.scale, y: (py - t.offY) / t.scale };
  };

  // ---- particles ----
  const spawn = (p: Particle) => {
    if (particles.length < 240) particles.push(p);
  };
  const splash = (x: number, y: number) => {
    spawn({ x, y, vx: 0, vy: 0, life: 0.6, maxLife: 0.6, size: 14, color: "rgba(150,210,240,ALPHA)", kind: "ring" });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 220;
      spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 0.5 + Math.random() * 0.3, maxLife: 0.8, size: 2 + Math.random() * 3, color: "#bfe6f5", kind: "drop" });
    }
  };
  const sandPuff = (x: number, y: number) => {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.3, maxLife: 0.7, size: 2 + Math.random() * 2.5, color: "#e6d29a", kind: "puff" });
    }
  };
  const sparks = (x: number, y: number, color: string) => {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 180;
      spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.25, maxLife: 0.55, size: 2 + Math.random() * 2, color, kind: "spark" });
    }
  };
  const sinkBurst = (x: number, y: number, great: boolean) => {
    spawn({ x, y, vx: 0, vy: 0, life: 0.7, maxLife: 0.7, size: 16, color: "rgba(255,230,140,ALPHA)", kind: "ring" });
    const n = great ? 26 : 14;
    const cols = great ? ["#ffe48a", "#9cff9c", "#ff9cc7", "#9cd2ff"] : ["#ffffff", "#ffe48a"];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 100 + Math.random() * 260;
      spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.6 + Math.random() * 0.5, maxLife: 1.1, size: 2 + Math.random() * 3, color: cols[i % cols.length], kind: "drop" });
    }
  };

  const updateParticles = (dt: number) => {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "drop") {
        p.vy += 1400 * dt;
      } else if (p.kind === "puff" || p.kind === "spark") {
        p.vx *= 1 - 2.5 * dt;
        p.vy *= 1 - 2.5 * dt;
      }
    }
  };

  // ---- physics event hooks ----
  const events: PhysicsEvents = {
    onWall: (impact) => {
      sfx.wall(impact);
    },
    onBumper: (b, impact) => {
      sfx.bumper(impact);
      sparks(b.x, b.y, "#ffd0d8");
    },
    onMover: (impact, x, y) => {
      sfx.mover(impact);
      if (impact > 120) sparks(x, y, "#ffe08a");
    },
  };

  // ---- shooting ----
  const doPutt = () => {
    preShot = { x: ball.x, y: ball.y };
    strokes++;
    const speed = Math.max(CONST.MIN_PUTT_SPEED, power * CONST.MAX_BALL_SPEED);
    ball.vx = aimDirX * speed;
    ball.vy = aimDirY * speed;
    ball.moving = true;
    aiming = false;
    phase = "rolling";
    sfx.putt(power);
    power = 0;
    preview = [];
    report();
    ctx.setStatus("");
  };

  const finalizeHole = () => {
    scores[holeIndex] = { strokes, par: hole.par };
    completedStrokes += strokes;
    completedPar += hole.par;
    resultStrokes = strokes;
    resultRelative = strokes - hole.par;
    resultLabel = labelFor(strokes, hole.par);
    strokes = 0; // counted into completedStrokes now; avoid double counting live total
    sfx.sink(resultRelative);
    sinkBurst(hole.cup.x, hole.cup.y, resultRelative <= 0);
    phase = "holeComplete";
    report();
  };

  const advance = () => {
    if (holeIndex + 1 < COURSE.length) {
      loadHole(holeIndex + 1);
      sfx.ui();
    } else {
      phase = "scorecard";
      ctx.setStatus("Final scorecard");
      sfx.finish(runningTotal() <= TOTAL_PAR);
    }
  };

  const finishRun = () => {
    if (finished) return;
    finished = true;
    const total = runningTotal();
    const rel = total - TOTAL_PAR;
    if (bestTotal == null || total < bestTotal) {
      bestTotal = total;
      bestRelative = rel;
      storage.set("bestTotal", bestTotal);
      storage.set("bestRelative", bestRelative);
    }
    storage.submitScore(total, true);
    phase = "done";
    ctx.setStatus("Round complete!");
    ctx.gameOver(total);
  };

  const startRound = () => {
    completedStrokes = 0;
    completedPar = 0;
    for (let i = 0; i < scores.length; i++) scores[i] = null;
    finished = false;
    sfx.start();
    loadHole(0);
  };

  // primary-pointer / key "confirm" used to advance menus
  const confirmPressed = () =>
    input.pointer.justDown || input.pressed("Space", "Enter");

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  const update = (rawDt: number) => {
    const dt = Math.min(rawDt, CONST.MAX_DT);
    time += dt;
    sfx.tick(dt);
    updateParticles(dt);

    switch (phase) {
      case "title": {
        if (confirmPressed()) startRound();
        break;
      }

      case "intro": {
        introT = clamp(introT + dt * 2.2, 0, 1);
        introHold += dt;
        if (input.pointer.justDown || input.pressed("Space", "Enter") || introHold > 1.9) {
          phase = "aim";
          ctx.setStatus(ctx.isTouch ? "Drag back to aim, release to putt" : "Drag back to aim • release to putt");
        }
        break;
      }

      case "aim": {
        if (input.pressed("r")) {
          ball.x = preShot.x;
          ball.y = preShot.y;
          ball.vx = 0;
          ball.vy = 0;
          aiming = false;
          power = 0;
        }
        if (input.pointer.justDown) aiming = true;
        if (aiming && input.pointer.down) {
          const w = toWorld(input.pointer.x, input.pointer.y);
          const dx = ball.x - w.x;
          const dy = ball.y - w.y;
          const d = Math.hypot(dx, dy);
          power = clamp(d / CONST.MAX_DRAG, 0, 1);
          if (d > 1) {
            aimDirX = dx / d;
            aimDirY = dy / d;
          }
          preview = previewPath(ball, aimDirX, aimDirY, power, walls, hole);
        }
        if (aiming && input.pointer.justUp) {
          if (power > 0.05) doPutt();
          else {
            aiming = false;
            power = 0;
            preview = [];
          }
        }
        break;
      }

      case "rolling": {
        const res = stepBall(ball, dt, walls, hole, time, events);
        if (res.inSand && !wasInSand) {
          sfx.sand();
          sandPuff(ball.x, ball.y);
        }
        wasInSand = res.inSand;

        if (res.sunk) {
          phase = "sinking";
          sinkT = 0;
          sinkFrom = { x: ball.x, y: ball.y };
        } else if (res.inWater) {
          strokes++; // penalty stroke
          ball.x = preShot.x;
          ball.y = preShot.y;
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          wasInSand = false;
          splash(preShot.x, preShot.y);
          sfx.water();
          phase = "aim";
          ctx.setStatus("Splash! +1 penalty stroke");
          report();
        } else if (!ball.moving) {
          phase = "aim";
          ctx.setStatus(ctx.isTouch ? "Drag back to aim, release to putt" : "Drag back to aim • release to putt");
        }
        break;
      }

      case "sinking": {
        sinkT = clamp(sinkT + dt / 0.45, 0, 1);
        const e = sinkT * sinkT * (3 - 2 * sinkT); // smoothstep
        ball.x = sinkFrom.x + (hole.cup.x - sinkFrom.x) * e;
        ball.y = sinkFrom.y + (hole.cup.y - sinkFrom.y) * e;
        if (sinkT >= 1) finalizeHole();
        break;
      }

      case "holeComplete": {
        if (confirmPressed()) advance();
        break;
      }

      case "scorecard": {
        if (confirmPressed()) finishRun();
        break;
      }

      case "done":
        break;
    }
  };

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------
  const render = () => {
    const ballScale = phase === "sinking" ? 1 - sinkT * 0.9 : 1;
    const ballVisible = !(phase === "holeComplete" || (phase === "sinking" && sinkT >= 1));
    const scene: Scene = {
      phase,
      hole,
      holeIndex,
      walls,
      ball,
      ballScale,
      ballVisible,
      time,
      aiming,
      aimDirX,
      aimDirY,
      power,
      preview,
      strokes,
      totalStrokes: runningTotal(),
      totalPar: TOTAL_PAR,
      relScore: completedStrokes - completedPar,
      holesDone: scores.filter((sc) => sc != null).length,
      scores,
      bestTotal,
      bestRelative,
      introT,
      resultLabel,
      resultStrokes,
      resultRelative,
      particles,
      message,
      isTouch: ctx.isTouch,
    };
    renderer.frame(ctx.width, ctx.height, scene);
  };

  return {
    update,
    render,
    destroy() {
      particles.length = 0;
    },
  };
}
