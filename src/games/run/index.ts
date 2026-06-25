import type { GameContext, GameInstance } from "@/engine";
import { Camera } from "./camera";
import {
  apothem,
  BIOME_LEN,
  DEATH_DELAY,
  DT_MAX,
  MILESTONE,
  N_DEFAULT,
  paletteFor,
  SEG,
  START_SAFE_RINGS,
  Z_PLAYER,
} from "./config";
import {
  drawDying,
  drawFlash,
  drawPlayingHud,
  drawReady,
} from "./hud";
import { Level, speedAtDist } from "./level";
import { Particles } from "./particles";
import { Player } from "./player";
import { Starfield } from "./starfield";
import { TunnelRenderer } from "./tunnel";
import type { GameState } from "./types";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * NEON CONDUIT — an original pseudo-3D endless tunnel runner with signature
 * wall-running (the tunnel rolls so any inner face becomes the floor).
 * See PRD.md for the full design + projection / roll math.
 */
export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  const n = N_DEFAULT;
  const ap = apothem(n);

  const cam = new Camera();
  const player = new Player();
  const particles = new Particles();
  const stars = new Starfield();
  const tunnel = new TunnelRenderer(n);

  let level = new Level(n, 0, (Date.now() ^ 0x9e3779b9) >>> 0);

  let state: GameState = "ready";
  let camZ = 0;
  let t = 0;
  let dyingT = 0;
  let gameOverSent = false;

  let best = ctx.storage.get<number>("best", 0);
  let score = 0;
  let lastMilestone = 0;

  // feel / juice
  let milestoneFlash = 0;
  let deathFlash = 0;
  let shake = 0;

  // touch swipe tracking
  let downX = 0;
  let downY = 0;
  let downMoved = false;

  const START_SCROLL = 2.4; // attract scroll speed (rings/sec)

  const reset = () => {
    level = new Level(n, 0, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    player.reset(0);
    cam.recompute(ctx.width, ctx.height);
    cam.roll = player.rollTarget(n);
    cam.rollTarget = cam.roll;
    cam.bank = 0;
    cam.rollVel = 0;
    camZ = 0;
    t = 0;
    dyingT = 0;
    gameOverSent = false;
    score = 0;
    lastMilestone = 0;
    milestoneFlash = 0;
    deathFlash = 0;
    shake = 0;
    state = "ready";
    particles.clear();
    stars.reseed();
    level.ensure(camZ);
  };

  reset();

  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "Space", label: "JUMP", id: "jump" },
  ]);
  ctx.setStatus("◀ ▶ roll the tunnel · JUMP the gaps");

  // --- input helpers -------------------------------------------------------

  const wantsLeft = () => input.pressed("ArrowLeft", "a");
  const wantsRight = () => input.pressed("ArrowRight", "d");
  const wantsJump = () => input.pressed("Space", "ArrowUp", "w");

  const beginPlay = () => {
    if (state !== "ready") return;
    state = "playing";
    audio.tone(440, 0.08, "triangle", 0.3);
    setTimeout(() => audio.tone(660, 0.1, "triangle", 0.3), 70);
  };

  const doRoll = (dir: -1 | 1) => {
    if (state !== "playing") return;
    if (dir < 0) player.rollLeft();
    else player.rollRight();
    audio.sweep(dir < 0 ? 520 : 360, dir < 0 ? 360 : 520, 0.12, "sine", 0.25);
    const cs = player.contactScreen(cam, n, ap);
    particles.rollPuff(cs.x, cs.y - cs.lift, cs.scalePx, dir, paletteFor(biome()).tile);
  };

  const doJump = () => {
    if (state !== "playing") return;
    if (player.requestJump()) audio.jump();
  };

  const biome = () => Math.floor(camZ / BIOME_LEN);

  const die = () => {
    if (state !== "playing") return;
    state = "dying";
    dyingT = 0;
    deathFlash = 1;
    shake = 1;
    audio.lose();
    audio.hit();
    const cs = player.contactScreen(cam, n, ap);
    particles.burst(cs.x, cs.y - cs.lift, cs.scalePx, paletteFor(biome()).tile, 30);
    if (score > best) {
      best = score;
      ctx.storage.set("best", best);
    }
    ctx.storage.submitScore(score);
    ctx.setStatus(`Fell at ${score} m — best ${best}`);
  };

  // --- per-frame input scan (called from update) ---------------------------

  const scanInput = () => {
    // pointer down: remember origin for swipe/tap classification
    if (input.pointer.justDown) {
      downX = input.pointer.x;
      downY = input.pointer.y;
      downMoved = false;
      if (state === "ready") {
        beginPlay();
      } else if (state === "gameover") {
        reset();
      } else if (!ctx.isTouch && state === "playing") {
        doJump(); // desktop click = jump
      }
    }
    if (input.pointer.down) {
      if (
        Math.abs(input.pointer.x - downX) > 6 ||
        Math.abs(input.pointer.y - downY) > 6
      )
        downMoved = true;
    }
    if (input.pointer.justUp && ctx.isTouch && state === "playing") {
      const dx = input.pointer.x - downX;
      const dy = input.pointer.y - downY;
      if (Math.abs(dx) > ctx.width * 0.06 && Math.abs(dx) > Math.abs(dy)) {
        doRoll(dx > 0 ? 1 : -1);
      } else if (!downMoved) {
        doJump();
      }
    }

    // keyboard / on-screen controls
    if (state === "ready") {
      if (wantsLeft() || wantsRight() || wantsJump()) {
        beginPlay();
        if (wantsJump()) doJump();
      }
      return;
    }
    if (state === "gameover") {
      if (wantsJump() || wantsLeft() || wantsRight()) reset();
      return;
    }
    if (state === "playing") {
      if (wantsLeft()) doRoll(-1);
      if (wantsRight()) doRoll(1);
      if (wantsJump()) doJump();
    }
  };

  // --- update --------------------------------------------------------------

  const update = (rawDt: number) => {
    const dt = Math.min(rawDt, DT_MAX);
    cam.recompute(ctx.width, ctx.height);
    t += dt;

    scanInput();

    // decay juice timers
    if (milestoneFlash > 0) milestoneFlash = Math.max(0, milestoneFlash - dt * 2.2);
    if (deathFlash > 0) deathFlash = Math.max(0, deathFlash - dt * 2.4);
    if (shake > 0) shake = Math.max(0, shake - dt * 2.6);

    if (state === "ready") {
      // gently scroll the attract tunnel but stay well inside the safe runway
      // so the runner never spawns onto a hole when play begins
      camZ = Math.min(camZ + START_SCROLL * dt, (START_SAFE_RINGS - 6) * SEG);
      level.ensure(camZ);
      cam.rollTarget = player.rollTarget(n);
      cam.update(dt);
      stars.update(dt, START_SCROLL, cam);
      particles.update(dt);
      return;
    }

    if (state === "gameover") {
      stars.update(dt, 1, cam);
      particles.update(dt);
      return;
    }

    if (state === "dying") {
      dyingT += dt;
      player.update(dt, speedAtDist(score));
      camZ += speedAtDist(score) * 0.35 * dt; // tunnel drifts on
      level.ensure(camZ);
      cam.update(dt);
      stars.update(dt, speedAtDist(score) * 0.4, cam);
      particles.update(dt);
      if (dyingT >= DEATH_DELAY && !gameOverSent) {
        gameOverSent = true;
        state = "gameover";
        ctx.gameOver(score);
      }
      return;
    }

    // --- PLAYING ---
    const speedRings = speedAtDist(score);
    const pal = paletteFor(biome());

    // forward motion
    camZ += speedRings * dt;
    level.ensure(camZ);

    // tile under the runner
    const rUnder = Math.floor((camZ + Z_PLAYER) / SEG);
    const face = player.faceId(n);
    const solidHere = level.solidAt(rUnder, face);

    // roll easing toward the active face
    cam.rollTarget = player.rollTarget(n);
    cam.update(dt);

    // physics; landing resolution
    const wantLand = player.update(dt, speedRings);
    if (wantLand) {
      if (solidHere) {
        const chained = player.confirmLand();
        const cs = player.contactScreen(cam, n, ap);
        particles.landingDust(cs.x, cs.y, cs.scalePx, paletteFor(biome()).tile);
        audio.tone(150, 0.07, "square", 0.25);
        shake = Math.max(shake, 0.35);
        if (chained) audio.jump();
      } else {
        player.beginFall();
        die();
      }
    }

    // ran onto a hole while grounded -> fall
    if (state === "playing" && player.grounded && !player.falling && !solidHere) {
      player.beginFall();
      die();
    }

    // running contrail
    if (state === "playing" && player.grounded && Math.random() < 0.6) {
      const cs = player.contactScreen(cam, n, ap);
      particles.trail(cs.x, cs.y - cs.scalePx * 0.35, cs.scalePx, pal.tile);
    }

    // score + milestones
    score = Math.floor(camZ / SEG);
    ctx.reportScore(score);
    if (score - lastMilestone >= MILESTONE) {
      lastMilestone = score - (score % MILESTONE);
      milestoneFlash = 1;
      audio.coin();
    }

    stars.update(dt, speedRings, cam);
    particles.update(dt);
  };

  // --- render --------------------------------------------------------------

  const render = () => {
    cam.recompute(ctx.width, ctx.height);
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;
    const pal = paletteFor(biome());

    stars.drawBackground(c, cam, pal, t);

    c.save();
    if (shake > 0.001) {
      const m = shake * shake * Math.min(W, H) * 0.02;
      c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    cam.applyBank(c);

    tunnel.draw(c, cam, level, camZ, pal, t);
    particles.draw(c);
    if (state !== "gameover") player.draw(c, cam, n, ap, pal);

    c.restore();

    // overlays (plain screen space)
    if (deathFlash > 0) drawFlash(c, W, H, "hsl(0,0%,100%)", deathFlash * 0.4);

    if (state === "ready") {
      drawReady(c, W, H, pal, best, t, ctx.isTouch);
    } else if (state === "playing") {
      drawPlayingHud(c, W, H, score, best, pal, milestoneFlash);
    } else if (state === "dying") {
      drawPlayingHud(c, W, H, score, best, pal, milestoneFlash);
      drawDying(c, W, H, pal, score, clamp(dyingT / DEATH_DELAY, 0, 1));
    }
  };

  return {
    update,
    render,
    resize() {
      cam.recompute(ctx.width, ctx.height);
      stars.reseed();
    },
    destroy() {
      particles.clear();
    },
  };
}
