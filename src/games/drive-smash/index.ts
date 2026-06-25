import type { GameContext, GameInstance, TouchControl, Rect } from "@/engine";
import { drawText, clamp, roundRect } from "@/engine";

/* ------------------------------------------------------------------ *
 * drive-smash — a stubby two-car physics battle ("Drive Ahead" clone)
 *
 * Simple, stable impulse-based rigid body: each car is a box with two
 * wheels. Buttons spin the wheels (drive + flip) and give air control.
 * Flip the OPPONENT so their driver head touches the ground / hazard
 * to score. First to 5 wins.
 * ------------------------------------------------------------------ */

type State = "menu" | "countdown" | "play" | "roundover" | "matchover";

interface Node {
  lx: number;
  ly: number;
  r: number;
  wheel: boolean;
}

interface Body {
  cx: number;
  cy: number;
  a: number;
  vx: number;
  vy: number;
  w: number;
  hw: number;
  hh: number;
  wheelR: number;
  wheelX: number;
  wheelY: number;
  headLen: number;
  headR: number;
  headLocalY: number;
  cornerR: number;
  invM: number;
  invI: number;
  nodes: Node[];
  color: string;
  accent: string;
  trim: string;
  facing: number;
  wheelSpin: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Layout {
  floorTop: number;
  floor: Rect;
  leftWall: Rect;
  rightWall: Rect;
  ceiling: Rect;
  platLeft: Rect;
  platRight: Rect;
  hazard: Rect;
  statics: Rect[];
}

// ---- dimensionless tunables ----------------------------------------
const G_K = 2.45; // gravity (× H per s²)
const DRIVE_K = 9; // chassis drive accel (× H)
const VMAX_K = 1.45; // horizontal drive speed cap (× H)
const GROUND_LEAN = 2.6; // gentle lean torque while driving on the ground
const AIR_SPIN = 15; // air-control angular accel (rad/s²)
const WMAX = 18; // angular speed cap (rad/s)
const VFALL_K = 3.2; // linear speed clamp (× H)
const E_STATIC = 0.16;
const MU_STATIC = 0.85;
const E_CAR = 0.22;
const MU_CAR = 0.45;
const POS_CORR = 0.8;
const SLOP_K = 0.002;
const ANG_DAMP = 0.7;
const LIN_DAMP = 0.12;
const ITER = 5;
const ITER_CC = 4;
const WIN_SCORE = 5;

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  let W = ctx.width;
  let H = ctx.height;
  let curW = W;
  let curH = H;

  let state: State = "menu";
  let mode = 1; // 1 = vs AI, 2 = local 2P
  const scores: [number, number] = [0, 0];
  let roundActive = false;
  let invulnT = 0;
  let roundTimer = 0;
  let matchTimer = 0;
  let cdT = 0;
  let winner = 0; // 1 or 2
  let lastStatus = "";
  let t = 0;

  // AI state
  let aiTimer = 0;
  let aiDrive = 0;

  const particles: Particle[] = [];

  // ---- bodies ------------------------------------------------------
  const makeBody = (color: string, accent: string, trim: string, facing: number): Body => ({
    cx: 0,
    cy: 0,
    a: 0,
    vx: 0,
    vy: 0,
    w: 0,
    hw: 1,
    hh: 1,
    wheelR: 1,
    wheelX: 1,
    wheelY: 1,
    headLen: 1,
    headR: 1,
    headLocalY: -1,
    cornerR: 1,
    invM: 1,
    invI: 1,
    nodes: [],
    color,
    accent,
    trim,
    facing,
    wheelSpin: 0,
  });

  const p1 = makeBody("#ff5a4d", "#ffd23f", "#7a1c14", 1);
  const p2 = makeBody("#39b6ff", "#b6f3ff", "#0f3b63", -1);

  const applyCarSizes = (b: Body) => {
    b.hw = curH * 0.072;
    b.hh = curH * 0.042;
    b.wheelR = curH * 0.034;
    b.wheelX = b.hw * 0.95;
    b.wheelY = b.hh;
    b.headLen = curH * 0.05;
    b.headR = curH * 0.02;
    b.headLocalY = -(b.hh + b.headLen);
    b.cornerR = curH * 0.012;
    const I = ((2 * b.hw) * (2 * b.hw) + (2 * b.hh) * (2 * b.hh)) / 12; // mass = 1
    b.invI = 1 / I;
    b.nodes = [
      { lx: -b.wheelX, ly: b.wheelY, r: b.wheelR, wheel: true },
      { lx: b.wheelX, ly: b.wheelY, r: b.wheelR, wheel: true },
      { lx: -b.hw, ly: -b.hh, r: b.cornerR, wheel: false },
      { lx: b.hw, ly: -b.hh, r: b.cornerR, wheel: false },
      { lx: -b.hw, ly: b.hh, r: b.cornerR, wheel: false },
      { lx: b.hw, ly: b.hh, r: b.cornerR, wheel: false },
    ];
  };

  // ---- geometry ----------------------------------------------------
  const layout = (): Layout => {
    const w = curW;
    const h = curH;
    const floorTop = h * 0.86;
    const wallT = Math.max(8, w * 0.025);
    const floor: Rect = { x: 0, y: floorTop, w, h: h - floorTop };
    const leftWall: Rect = { x: 0, y: 0, w: wallT, h };
    const rightWall: Rect = { x: w - wallT, y: 0, w: wallT, h };
    const ceiling: Rect = { x: 0, y: -h, w, h };
    const platLeft: Rect = { x: w * 0.1, y: h * 0.58, w: w * 0.17, h: h * 0.028 };
    const platRight: Rect = { x: w * 0.73, y: h * 0.58, w: w * 0.17, h: h * 0.028 };
    const hazard: Rect = { x: w * 0.42, y: floorTop - h * 0.04, w: w * 0.16, h: h * 0.04 };
    return {
      floorTop,
      floor,
      leftWall,
      rightWall,
      ceiling,
      platLeft,
      platRight,
      hazard,
      statics: [floor, leftWall, rightWall, ceiling, platLeft, platRight],
    };
  };

  // ---- math helpers ------------------------------------------------
  const l2w = (b: Body, lx: number, ly: number) => {
    const c = Math.cos(b.a);
    const s = Math.sin(b.a);
    return { x: b.cx + lx * c - ly * s, y: b.cy + lx * s + ly * c };
  };

  const velAt = (b: Body, px: number, py: number) => {
    const rx = px - b.cx;
    const ry = py - b.cy;
    return { x: b.vx - b.w * ry, y: b.vy + b.w * rx };
  };

  const applyImp = (b: Body, px: number, py: number, jx: number, jy: number) => {
    b.vx += jx * b.invM;
    b.vy += jy * b.invM;
    const rx = px - b.cx;
    const ry = py - b.cy;
    b.w += b.invI * (rx * jy - ry * jx);
  };

  const collide = (
    px: number,
    py: number,
    rad: number,
    r: Rect,
  ): { nx: number; ny: number; depth: number } | null => {
    const cx = clamp(px, r.x, r.x + r.w);
    const cy = clamp(py, r.y, r.y + r.h);
    const dx = px - cx;
    const dy = py - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > rad * rad) return null;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      return { nx: dx / d, ny: dy / d, depth: rad - d };
    }
    // center inside the rect -> push out the nearest face
    const left = px - r.x;
    const right = r.x + r.w - px;
    const top = py - r.y;
    const bottom = r.y + r.h - py;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { nx: -1, ny: 0, depth: left + rad };
    if (m === right) return { nx: 1, ny: 0, depth: right + rad };
    if (m === top) return { nx: 0, ny: -1, depth: top + rad };
    return { nx: 0, ny: 1, depth: bottom + rad };
  };

  const resolveStatic = (
    b: Body,
    px: number,
    py: number,
    nx: number,
    ny: number,
    depth: number,
    e: number,
    mu: number,
  ) => {
    const corr = Math.max(0, depth - curH * SLOP_K) * POS_CORR;
    b.cx += nx * corr;
    b.cy += ny * corr;
    const v = velAt(b, px, py);
    const vn = v.x * nx + v.y * ny;
    if (vn >= 0) return;
    const rx = px - b.cx;
    const ry = py - b.cy;
    const rn = rx * ny - ry * nx;
    const denom = b.invM + b.invI * rn * rn;
    const j = (-(1 + e) * vn) / denom;
    applyImp(b, px, py, j * nx, j * ny);
    // friction
    const v2 = velAt(b, px, py);
    const tx = -ny;
    const ty = nx;
    const vt = v2.x * tx + v2.y * ty;
    const rt = rx * ty - ry * tx;
    const denomT = b.invM + b.invI * rt * rt;
    let jt = -vt / denomT;
    const max = mu * j;
    jt = clamp(jt, -max, max);
    applyImp(b, px, py, jt * tx, jt * ty);
  };

  const resolvePair = (
    A: Body,
    px: number,
    py: number,
    B: Body,
    nx: number,
    ny: number,
    depth: number,
    e: number,
    mu: number,
  ) => {
    const totInv = A.invM + B.invM;
    const corr = (Math.max(0, depth - curH * SLOP_K) * POS_CORR) / totInv;
    A.cx += nx * corr * A.invM;
    A.cy += ny * corr * A.invM;
    B.cx -= nx * corr * B.invM;
    B.cy -= ny * corr * B.invM;
    const vA = velAt(A, px, py);
    const vB = velAt(B, px, py);
    const rvx = vA.x - vB.x;
    const rvy = vA.y - vB.y;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const rAx = px - A.cx;
    const rAy = py - A.cy;
    const rBx = px - B.cx;
    const rBy = py - B.cy;
    const rnA = rAx * ny - rAy * nx;
    const rnB = rBx * ny - rBy * nx;
    const denom = A.invM + B.invM + A.invI * rnA * rnA + B.invI * rnB * rnB;
    const j = (-(1 + e) * vn) / denom;
    applyImp(A, px, py, j * nx, j * ny);
    applyImp(B, px, py, -j * nx, -j * ny);
    const vA2 = velAt(A, px, py);
    const vB2 = velAt(B, px, py);
    const tx = -ny;
    const ty = nx;
    const vt = (vA2.x - vB2.x) * tx + (vA2.y - vB2.y) * ty;
    const rtA = rAx * ty - rAy * tx;
    const rtB = rBx * ty - rBy * tx;
    const denomT = A.invM + B.invM + A.invI * rtA * rtA + B.invI * rtB * rtB;
    let jt = -vt / denomT;
    const max = mu * Math.abs(j);
    jt = clamp(jt, -max, max);
    applyImp(A, px, py, jt * tx, jt * ty);
    applyImp(B, px, py, -jt * tx, -jt * ty);
  };

  const clampVel = (b: Body) => {
    const vm = curH * VFALL_K;
    if (!isFinite(b.cx) || !isFinite(b.cy) || !isFinite(b.a)) {
      // safety: something went wrong, drop the car at its spawn
      b.cx = clamp(b.cx, 0, curW) || curW * 0.5;
      b.cy = curH * 0.4;
      b.vx = 0;
      b.vy = 0;
      b.w = 0;
      b.a = 0;
    }
    b.vx = clamp(b.vx, -vm, vm);
    b.vy = clamp(b.vy, -vm, vm);
    b.w = clamp(b.w, -WMAX, WMAX);
  };

  const integrate = (b: Body, h: number) => {
    b.vy += curH * G_K * h;
    b.cx += b.vx * h;
    b.cy += b.vy * h;
    b.a += b.w * h;
    b.wheelSpin += b.vx * h * 0.12;
  };

  const resolveStaticAll = (b: Body, drive: number, h: number, lay: Layout) => {
    let grounded = false;
    for (let it = 0; it < ITER; it++) {
      for (const nd of b.nodes) {
        const wp = l2w(b, nd.lx, nd.ly);
        for (const r of lay.statics) {
          const col = collide(wp.x, wp.y, nd.r, r);
          if (col) {
            resolveStatic(b, wp.x, wp.y, col.nx, col.ny, col.depth, E_STATIC, MU_STATIC);
            if (nd.wheel && col.ny < -0.5) grounded = true;
          }
        }
      }
    }
    if (drive !== 0) {
      if (grounded) {
        // Drive the chassis directly (no big wheel-contact torque, so the car
        // can't flip itself onto its own head just by accelerating) plus a
        // gentle lean into the travel direction for that tippy feel.
        const max = curH * VMAX_K;
        if ((drive > 0 && b.vx < max) || (drive < 0 && b.vx > -max)) {
          b.vx += drive * curH * DRIVE_K * h;
        }
        b.w += drive * GROUND_LEAN * h;
      } else {
        b.w += drive * AIR_SPIN * h;
      }
    }
  };

  const pairPass = (P: Body, Q: Body) => {
    const c = Math.cos(Q.a);
    const s = Math.sin(Q.a);
    const rect: Rect = { x: -Q.hw, y: -Q.hh, w: 2 * Q.hw, h: 2 * Q.hh };
    for (const nd of P.nodes) {
      const wp = l2w(P, nd.lx, nd.ly);
      const dx = wp.x - Q.cx;
      const dy = wp.y - Q.cy;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const col = collide(lx, ly, nd.r, rect);
      if (col) {
        const nx = col.nx * c - col.ny * s;
        const ny = col.nx * s + col.ny * c;
        resolvePair(P, wp.x, wp.y, Q, nx, ny, col.depth, E_CAR, MU_CAR);
      }
    }
  };

  const resolveCarCar = () => {
    for (let it = 0; it < ITER_CC; it++) {
      pairPass(p1, p2);
      pairPass(p2, p1);
    }
  };

  const headWorld = (b: Body) => l2w(b, 0, b.headLocalY);

  const isKilled = (b: Body, lay: Layout) => {
    const hp = headWorld(b);
    return (
      collide(hp.x, hp.y, b.headR, lay.floor) !== null ||
      collide(hp.x, hp.y, b.headR, lay.platLeft) !== null ||
      collide(hp.x, hp.y, b.headR, lay.platRight) !== null ||
      collide(hp.x, hp.y, b.headR, lay.hazard) !== null
    );
  };

  // ---- spawning ----------------------------------------------------
  const spawnCar = (b: Body, x: number, floorTop: number) => {
    b.cx = x;
    b.cy = floorTop - (b.hh + b.wheelR) - curH * 0.002;
    b.a = 0;
    b.vx = 0;
    b.vy = 0;
    b.w = 0;
    b.wheelSpin = 0;
  };

  const resetRound = () => {
    const lay = layout();
    applyCarSizes(p1);
    applyCarSizes(p2);
    spawnCar(p1, curW * 0.25, lay.floorTop);
    spawnCar(p2, curW * 0.75, lay.floorTop);
    invulnT = 0.6;
    roundActive = true;
  };

  const resetMatch = () => {
    scores[0] = 0;
    scores[1] = 0;
    resetRound();
  };

  const spawnExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = curH * (0.4 + Math.random() * 1.2);
      particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - curH * 0.3,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1,
        size: curH * (0.006 + Math.random() * 0.014),
        color: Math.random() < 0.5 ? color : "#ffce4a",
      });
    }
  };

  const updateParticles = (dt: number) => {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += curH * G_K * 0.35 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  };

  // ---- controls / status ------------------------------------------
  const requestModeControls = () => {
    const base: TouchControl[] = [
      { type: "button", key: "a", label: "◀", id: "p1l" },
      { type: "button", key: "d", label: "▶", id: "p1r" },
    ];
    if (mode === 2) {
      base.push(
        { type: "button", key: "ArrowLeft", label: "◀", id: "p2l" },
        { type: "button", key: "ArrowRight", label: "▶", id: "p2r" },
      );
    }
    ctx.requestControls(base);
  };

  const setStatusIfChanged = (s: string) => {
    if (s !== lastStatus) {
      lastStatus = s;
      ctx.setStatus(s);
    }
  };

  const menuButtons = (): { one: Rect; two: Rect } => {
    const bw = Math.min(curW * 0.34, curH * 0.55);
    const bh = curH * 0.16;
    const gap = curW * 0.04;
    const cy = curH * 0.62;
    const one: Rect = { x: curW * 0.5 - bw - gap / 2, y: cy, w: bw, h: bh };
    const two: Rect = { x: curW * 0.5 + gap / 2, y: cy, w: bw, h: bh };
    return { one, two };
  };

  const startMatch = (m: number) => {
    mode = m;
    requestModeControls();
    resetMatch();
    state = "countdown";
    cdT = 2.4;
    audio.blip();
  };

  // ---- AI ----------------------------------------------------------
  const normAngle = (a: number) => {
    let x = a % (Math.PI * 2);
    if (x > Math.PI) x -= Math.PI * 2;
    if (x < -Math.PI) x += Math.PI * 2;
    return x;
  };

  const updateAI = (dt: number) => {
    aiTimer -= dt;
    if (aiTimer > 0) return;
    aiTimer = 0.1 + Math.random() * 0.12;
    const me = p2;
    const foe = p1;
    const ang = normAngle(me.a);
    if (Math.abs(ang) > 1.7) {
      // tipped over: keep rolling the same way to try to recover
      aiDrive = me.w >= 0 ? 1 : -1;
      if (Math.abs(me.w) < 1) aiDrive = ang > 0 ? -1 : 1;
    } else {
      const dx = foe.cx - me.cx;
      aiDrive = dx > 0 ? 1 : -1;
      // hesitate sometimes so the AI is beatable
      if (Math.random() < 0.14) aiDrive = 0;
    }
    // avoid burying itself into the side walls
    if (me.cx < curW * 0.12) aiDrive = 1;
    else if (me.cx > curW * 0.88) aiDrive = -1;
  };

  const driveFor = (b: Body, left: boolean, right: boolean) => {
    let d = 0;
    if (left) d -= 1;
    if (right) d += 1;
    void b;
    return d;
  };

  // ---- physics tick ------------------------------------------------
  const physicsTick = (dt: number, d1: number, d2: number) => {
    const lay = layout();
    const clamped = Math.min(dt, 0.05);
    const steps = clamp(Math.ceil(clamped / (1 / 120)), 1, 8);
    const h = clamped / steps;
    for (let i = 0; i < steps; i++) {
      integrate(p1, h);
      integrate(p2, h);
      resolveStaticAll(p1, d1, h, lay);
      resolveStaticAll(p2, d2, h, lay);
      resolveCarCar();
      p1.w *= 1 - ANG_DAMP * h;
      p2.w *= 1 - ANG_DAMP * h;
      p1.vx *= 1 - LIN_DAMP * h;
      p2.vx *= 1 - LIN_DAMP * h;
      clampVel(p1);
      clampVel(p2);
    }
    return lay;
  };

  // ---- round resolution -------------------------------------------
  const handleKill = (loserIdx: number) => {
    const loser = loserIdx === 0 ? p1 : p2;
    const winnerIdx = loserIdx === 0 ? 1 : 0;
    scores[winnerIdx] += 1;
    roundActive = false;
    const hp = headWorld(loser);
    spawnExplosion(hp.x, hp.y, loser.color);
    audio.explosion();
    if (scores[winnerIdx] >= WIN_SCORE) {
      winner = winnerIdx + 1;
      state = "matchover";
      matchTimer = 2.8;
      audio.win();
    } else {
      state = "roundover";
      roundTimer = 1.1;
    }
  };

  // ---- init --------------------------------------------------------
  applyCarSizes(p1);
  applyCarSizes(p2);
  resetRound();
  state = "menu";
  ctx.requestControls([]);
  ctx.setStatus("Tap 1 Player or 2 Players");
  lastStatus = "Tap 1 Player or 2 Players";

  // =================================================================
  // UPDATE
  // =================================================================
  const update = (dt: number) => {
    W = ctx.width;
    H = ctx.height;
    curW = W;
    curH = H;
    t += dt;
    updateParticles(dt);

    if (state === "menu") {
      const { one, two } = menuButtons();
      const px = input.pointer.x;
      const py = input.pointer.y;
      const tapped = input.pointer.justDown;
      if ((tapped && hit(px, py, one)) || input.pressed("1")) startMatch(1);
      else if ((tapped && hit(px, py, two)) || input.pressed("2")) startMatch(2);
      setStatusIfChanged("Tap 1 Player or 2 Players");
      return;
    }

    if (state === "countdown") {
      cdT -= dt;
      physicsTick(dt, 0, 0); // let cars settle
      setStatusIfChanged(`P1  ${scores[0]} - ${scores[1]}  P2`);
      if (cdT <= 0) {
        state = "play";
        audio.coin();
      }
      return;
    }

    if (state === "play") {
      const d1 = driveFor(p1, input.isDown("a"), input.isDown("d"));
      let d2: number;
      if (mode === 1) {
        updateAI(dt);
        d2 = aiDrive;
      } else {
        d2 = driveFor(p2, input.isDown("ArrowLeft"), input.isDown("ArrowRight"));
      }
      const lay = physicsTick(dt, d1, d2);
      if (invulnT > 0) invulnT -= dt;
      if (roundActive && invulnT <= 0) {
        if (isKilled(p1, lay)) handleKill(0);
        else if (isKilled(p2, lay)) handleKill(1);
      }
      setStatusIfChanged(`P1  ${scores[0]} - ${scores[1]}  P2`);
      return;
    }

    if (state === "roundover") {
      roundTimer -= dt;
      physicsTick(dt, 0, 0);
      if (roundTimer <= 0) {
        resetRound();
        state = "countdown";
        cdT = 1.4;
      }
      return;
    }

    if (state === "matchover") {
      matchTimer -= dt;
      physicsTick(dt, 0, 0);
      if (matchTimer <= 0) {
        ctx.gameOver();
        state = "menu";
      }
      return;
    }
  };

  const hit = (px: number, py: number, r: Rect) =>
    px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

  // =================================================================
  // RENDER
  // =================================================================
  const c = ctx.ctx;

  const drawArena = (lay: Layout) => {
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1b2a4a");
    sky.addColorStop(0.6, "#27406b");
    sky.addColorStop(1, "#16233d");
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);

    // distant stars / bokeh
    c.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 24; i++) {
      const sx = ((i * 97.3) % W);
      const sy = (i * 53.7) % (H * 0.5);
      c.beginPath();
      c.arc(sx, sy, 2 + (i % 3), 0, Math.PI * 2);
      c.fill();
    }

    // platforms
    for (const p of [lay.platLeft, lay.platRight]) {
      c.fillStyle = "#3d5070";
      roundRect(c, p.x, p.y, p.w, p.h, p.h * 0.4);
      c.fill();
      c.fillStyle = "#5a73a0";
      c.fillRect(p.x, p.y, p.w, p.h * 0.35);
    }

    // floor
    c.fillStyle = "#2a2f3d";
    c.fillRect(lay.floor.x, lay.floor.y, lay.floor.w, lay.floor.h);
    c.fillStyle = "#3a4256";
    c.fillRect(lay.floor.x, lay.floor.y, lay.floor.w, Math.max(4, H * 0.012));

    // walls
    c.fillStyle = "#202634";
    c.fillRect(lay.leftWall.x, lay.leftWall.y, lay.leftWall.w, lay.leftWall.h);
    c.fillRect(lay.rightWall.x, lay.rightWall.y, lay.rightWall.w, lay.rightWall.h);

    // hazard spikes
    const hz = lay.hazard;
    c.fillStyle = "#c9d2e0";
    const teeth = Math.max(4, Math.round(hz.w / (H * 0.03)));
    const tw = hz.w / teeth;
    for (let i = 0; i < teeth; i++) {
      const x0 = hz.x + i * tw;
      c.beginPath();
      c.moveTo(x0, hz.y + hz.h);
      c.lineTo(x0 + tw / 2, hz.y - H * 0.005);
      c.lineTo(x0 + tw, hz.y + hz.h);
      c.closePath();
      c.fill();
    }
    c.fillStyle = "#8a93a6";
    c.fillRect(hz.x, hz.y + hz.h - H * 0.006, hz.w, H * 0.006);
  };

  const drawCar = (b: Body) => {
    c.save();
    c.translate(b.cx, b.cy);
    c.rotate(b.a);

    // wheels
    for (const sx of [-1, 1]) {
      const wx = sx * b.wheelX;
      const wy = b.wheelY;
      c.fillStyle = "#15171d";
      c.beginPath();
      c.arc(wx, wy, b.wheelR, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#3a4150";
      c.beginPath();
      c.arc(wx, wy, b.wheelR * 0.55, 0, Math.PI * 2);
      c.fill();
      // spokes
      c.strokeStyle = "#6b7488";
      c.lineWidth = Math.max(1, b.wheelR * 0.12);
      for (let k = 0; k < 4; k++) {
        const ang = b.wheelSpin + (k * Math.PI) / 2;
        c.beginPath();
        c.moveTo(wx, wy);
        c.lineTo(wx + Math.cos(ang) * b.wheelR * 0.5, wy + Math.sin(ang) * b.wheelR * 0.5);
        c.stroke();
      }
    }

    // body
    c.fillStyle = b.color;
    c.strokeStyle = b.trim;
    c.lineWidth = Math.max(2, b.hh * 0.18);
    roundRect(c, -b.hw, -b.hh, b.hw * 2, b.hh * 2, b.hh * 0.5);
    c.fill();
    c.stroke();

    // cabin
    c.fillStyle = b.accent;
    roundRect(c, -b.hw * 0.45, -b.hh * 1.05, b.hw * 0.9, b.hh * 0.95, b.hh * 0.4);
    c.fill();

    // facing headlight
    c.fillStyle = "#fff6c2";
    c.beginPath();
    c.arc(b.facing * b.hw * 0.78, 0, b.hh * 0.28, 0, Math.PI * 2);
    c.fill();

    // driver head marker (the target)
    c.strokeStyle = b.trim;
    c.lineWidth = Math.max(2, b.headR * 0.5);
    c.beginPath();
    c.moveTo(0, -b.hh);
    c.lineTo(0, b.headLocalY + b.headR * 0.6);
    c.stroke();

    c.fillStyle = "#fdfdff";
    c.beginPath();
    c.arc(0, b.headLocalY, b.headR, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = b.color;
    c.beginPath();
    c.arc(0, b.headLocalY - b.headR * 0.25, b.headR * 0.78, Math.PI, Math.PI * 2);
    c.fill();
    // eyes
    c.fillStyle = "#1a1a22";
    c.beginPath();
    c.arc(b.facing * b.headR * 0.35, b.headLocalY + b.headR * 0.15, b.headR * 0.18, 0, Math.PI * 2);
    c.fill();

    c.restore();
  };

  const drawParticles = () => {
    for (const p of particles) {
      c.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  };

  const drawScore = (lay: Layout) => {
    void lay;
    const y = H * 0.085;
    const big = H * 0.085;
    c.save();
    // p1 marker
    c.fillStyle = p1.color;
    c.beginPath();
    c.arc(W * 0.5 - big * 1.7, y, big * 0.32, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = p2.color;
    c.beginPath();
    c.arc(W * 0.5 + big * 1.7, y, big * 0.32, 0, Math.PI * 2);
    c.fill();
    drawText(c, `${scores[0]}`, W * 0.5 - big * 0.75, y, big, "#fff", "center");
    drawText(c, "-", W * 0.5, y, big, "rgba(255,255,255,0.5)", "center");
    drawText(c, `${scores[1]}`, W * 0.5 + big * 0.75, y, big, "#fff", "center");
    c.restore();
  };

  const drawButton = (r: Rect, label: string, sub: string, accent: string, hot: boolean) => {
    c.fillStyle = hot ? accent : "rgba(255,255,255,0.08)";
    roundRect(c, r.x, r.y, r.w, r.h, r.h * 0.22);
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = accent;
    roundRect(c, r.x, r.y, r.w, r.h, r.h * 0.22);
    c.stroke();
    drawText(c, label, r.x + r.w / 2, r.y + r.h * 0.4, r.h * 0.34, hot ? "#10131c" : "#fff");
    drawText(
      c,
      sub,
      r.x + r.w / 2,
      r.y + r.h * 0.74,
      r.h * 0.17,
      hot ? "rgba(16,19,28,0.8)" : "rgba(255,255,255,0.65)",
    );
  };

  const drawMenu = () => {
    drawText(c, "DRIVE SMASH", W / 2, H * 0.26, H * 0.12, "#ffd23f");
    drawText(c, "Flip your rival's driver into the dirt!", W / 2, H * 0.38, H * 0.04, "rgba(255,255,255,0.75)");
    const { one, two } = menuButtons();
    const px = input.pointer.x;
    const py = input.pointer.y;
    const down = input.pointer.down;
    drawButton(one, "1 PLAYER", "vs CPU", p1.color, down && hit(px, py, one));
    drawButton(two, "2 PLAYERS", "local versus", p2.color, down && hit(px, py, two));
    drawText(
      c,
      "P1: A / D     P2: ← / →     First to 5 wins",
      W / 2,
      H * 0.86,
      H * 0.032,
      "rgba(255,255,255,0.6)",
    );
  };

  const drawCenterBanner = (title: string, sub: string, color: string) => {
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.fillRect(0, H * 0.34, W, H * 0.26);
    drawText(c, title, W / 2, H * 0.45, H * 0.1, color);
    if (sub) drawText(c, sub, W / 2, H * 0.55, H * 0.04, "rgba(255,255,255,0.8)");
  };

  const render = () => {
    W = ctx.width;
    H = ctx.height;
    curW = W;
    curH = H;
    const lay = layout();
    drawArena(lay);

    if (state === "menu") {
      drawMenu();
      return;
    }

    drawCar(p1);
    drawCar(p2);
    drawParticles();
    drawScore(lay);

    if (state === "countdown") {
      const n = Math.ceil(cdT);
      const label = n > 0 ? String(n) : "GO!";
      drawText(c, label, W / 2, H * 0.46, H * 0.16, "#ffd23f");
    } else if (state === "roundover") {
      drawText(c, "SMASH!", W / 2, H * 0.42, H * 0.09, "#ff8a3d");
    } else if (state === "matchover") {
      const col = winner === 1 ? p1.color : p2.color;
      drawCenterBanner(`PLAYER ${winner} WINS!`, mode === 1 && winner === 2 ? "CPU takes it" : "", col);
    }
  };

  // =================================================================
  return {
    update,
    render,
    resize(w: number, h: number) {
      if (W > 0 && H > 0) {
        const rx = w / W;
        const ry = h / H;
        for (const b of [p1, p2]) {
          b.cx *= rx;
          b.cy *= ry;
          b.vx *= rx;
          b.vy *= ry;
        }
      }
      W = w;
      H = h;
      curW = w;
      curH = h;
      applyCarSizes(p1);
      applyCarSizes(p2);
    },
  };
}
