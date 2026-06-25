import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, mulberry32, roundRect } from "@/engine";

/**
 * Hill Blazer — a Hill Climb Racing style physics driver.
 * A two-wheel sprung car drives over an infinite procedural heightfield.
 * Distance (metres) is the score. Collect fuel + coins, don't flip, don't run dry.
 */

type UpgradeKey = "engine" | "suspension" | "grip" | "fuel";

interface Upgrades {
  engine: number;
  suspension: number;
  grip: number;
  fuel: number;
}

interface Wheel {
  ax: number; // local anchor x
  ay: number; // local anchor y
  x: number; // world position
  y: number;
  vx: number;
  vy: number;
  spin: number; // visual rotation
  grounded: boolean;
}

interface Item {
  x: number;
  y: number;
  kind: "coin" | "fuel";
  got: boolean;
  bob: number;
}

const MAX_LEVEL = 5;
const VIEW_H = 380; // world units visible vertically (keeps feel consistent at any size)
const METER = 16; // world units per metre

const UPGRADE_DEFS: Array<{ key: UpgradeKey; name: string; blurb: string }> = [
  { key: "engine", name: "ENGINE", blurb: "More power" },
  { key: "suspension", name: "SUSPENSION", blurb: "Smoother ride" },
  { key: "grip", name: "TIRES", blurb: "Better grip" },
  { key: "fuel", name: "FUEL TANK", blurb: "Bigger tank" },
];

const upgradeCost = (level: number) => 60 + level * 55;

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  // ---- persistent data -------------------------------------------------
  let coins = storage.get<number>("coins", 0);
  const upgrades = storage.get<Upgrades>("upg", {
    engine: 0,
    suspension: 0,
    grip: 0,
    fuel: 0,
  });

  // ---- tuning derived from upgrades ------------------------------------
  let driveAccel = 0;
  let brakeAccel = 0;
  let springK = 0;
  let springC = 0;
  let restLen = 0;
  let maxFuel = 0;

  const applyUpgrades = () => {
    driveAccel = 760 * (1 + 0.16 * upgrades.engine) * (1 + 0.07 * upgrades.grip);
    brakeAccel = 620 * (1 + 0.08 * upgrades.grip);
    springK = 620 * (1 + 0.12 * upgrades.suspension);
    springC = 30 * (1 + 0.14 * upgrades.suspension);
    restLen = 24 * (1 + 0.05 * upgrades.suspension);
    maxFuel = 100 * (1 + 0.3 * upgrades.fuel);
  };
  applyUpgrades();

  // ---- physics constants ----------------------------------------------
  const G = 900; // world gravity (units/s^2)
  const Mc = 4; // chassis mass
  const Ic = Mc * 720; // chassis moment of inertia
  const MW = 1; // wheel mass
  const WHEEL_R = 15;
  const AXLE_X = 32;
  const AXLE_Y = 8;
  const CHASSIS_W = 96;
  const CHASSIS_H = 30;
  // Rider lean / air-control torque (rad/s^2). Gas pops a wheelie (nose up),
  // brake noses the car down. Strong in the air so a jump can be rotated to
  // land flat instead of flipping helplessly; gentle on the ground for feel.
  const AIR_LEAN = 6;
  const GROUND_LEAN = 1.6;
  const MAX_ANG_VEL = 14;

  // ---- terrain ---------------------------------------------------------
  const startX = 240;
  let terrainLayers: Array<{ a: number; w: number; p: number }> = [];
  let baseY = 220;

  const buildTerrain = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const rnd = mulberry32(seed);
    const amps = [62, 30, 15, 8];
    const waves = [520, 250, 130, 68];
    terrainLayers = amps.map((a, i) => ({
      a,
      w: (Math.PI * 2) / (waves[i] * (0.85 + rnd() * 0.3)),
      p: rnd() * Math.PI * 2,
    }));
    baseY = 220;
  };

  const terrain = (x: number): number => {
    let sum = 0;
    for (const l of terrainLayers) sum += l.a * Math.sin(x * l.w + l.p);
    const flat = clamp((x - startX) / 760, 0, 1); // ease out the flat launch pad
    const diff = 0.5 + 0.65 * clamp((x - startX) / 5200, 0, 1); // ramp difficulty
    return baseY + sum * flat * diff;
  };

  const slopeAt = (x: number): number => (terrain(x + 1.2) - terrain(x - 1.2)) / 2.4;

  // ---- world state -----------------------------------------------------
  type Phase = "garage" | "run" | "crashed";
  let phase: Phase = "garage";

  let cx = 0;
  let cy = 0;
  let vx = 0;
  let vy = 0;
  let ang = 0;
  let angVel = 0;
  const wheels: Wheel[] = [
    { ax: -AXLE_X, ay: AXLE_Y, x: 0, y: 0, vx: 0, vy: 0, spin: 0, grounded: false },
    { ax: AXLE_X, ay: AXLE_Y, x: 0, y: 0, vx: 0, vy: 0, spin: 0, grounded: false },
  ];
  let fuel = 0;
  let meters = 0;
  let runCoins = 0;
  let camY = 0;
  let t = 0;
  let engineSndT = 0;
  let crashTimer = 0;

  let items: Item[] = [];
  let spawnX = 0;

  const localToWorld = (lx: number, ly: number) => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    return { x: cx + lx * ca - ly * sa, y: cy + lx * sa + ly * ca };
  };

  const ensureItems = (uptoX: number) => {
    while (spawnX < uptoX) {
      spawnX += 130 + Math.random() * 150;
      const gy = terrain(spawnX);
      const isFuel = Math.random() < 0.22;
      items.push({ x: spawnX, y: gy - 28, kind: isFuel ? "fuel" : "coin", got: false, bob: Math.random() * 6.28 });
    }
  };

  const startRun = () => {
    applyUpgrades();
    buildTerrain();
    cx = startX;
    cy = terrain(startX) - (CHASSIS_H / 2 + restLen + WHEEL_R + 4);
    vx = 0;
    vy = 0;
    ang = 0;
    angVel = 0;
    for (const w of wheels) {
      const wp = localToWorld(w.ax, w.ay);
      w.x = wp.x;
      w.y = wp.y + restLen;
      w.vx = 0;
      w.vy = 0;
      w.spin = 0;
      w.grounded = false;
    }
    fuel = maxFuel;
    meters = 0;
    runCoins = 0;
    camY = cy;
    crashTimer = 0;
    items = [];
    spawnX = startX + 360;
    ensureItems(cx + 2400);
    phase = "run";
    ctx.requestControls([
      { type: "button", key: "ArrowLeft", label: "BRAKE", id: "brake" },
      { type: "button", key: "ArrowRight", label: "GAS", id: "gas" },
    ]);
    ctx.setStatus("Gas: → / Space   Brake: ←   (lean in the air to land flat!)");
  };

  ctx.requestControls([]);
  ctx.setStatus("Tune your ride, then GO");

  // =====================================================================
  //  UPDATE
  // =====================================================================
  const updateGarage = () => {
    // handled by pointer in handleGarageInput (called from update)
    if (input.pressed("Space", "Enter", "ArrowRight")) startRun();
  };

  const handleGaragePointer = () => {
    if (!input.pointer.justDown) return;
    const W = ctx.width;
    const H = ctx.height;
    const px = input.pointer.x;
    const py = input.pointer.y;

    const panelW = Math.min(W * 0.86, 720);
    const panelX = (W - panelW) / 2;
    const rowH = Math.min(H * 0.12, 76);
    const top = H * 0.26;
    for (let i = 0; i < UPGRADE_DEFS.length; i++) {
      const def = UPGRADE_DEFS[i];
      const y = top + i * (rowH + 12);
      const btnW = Math.min(panelW * 0.26, 150);
      const btnX = panelX + panelW - btnW - 14;
      const lvl = upgrades[def.key];
      const cost = upgradeCost(lvl);
      if (
        lvl < MAX_LEVEL &&
        coins >= cost &&
        px >= btnX &&
        px <= btnX + btnW &&
        py >= y + rowH * 0.18 &&
        py <= y + rowH * 0.82
      ) {
        coins -= cost;
        upgrades[def.key] = lvl + 1;
        storage.set("coins", coins);
        storage.set("upg", upgrades);
        applyUpgrades();
        audio.coin();
      }
    }

    // GO button
    const goW = Math.min(panelW * 0.5, 320);
    const goX = (W - goW) / 2;
    const goY = top + UPGRADE_DEFS.length * (rowH + 12) + 14;
    const goH = Math.min(H * 0.12, 64);
    if (px >= goX && px <= goX + goW && py >= goY && py <= goY + goH) {
      startRun();
    }
  };

  const physicsStep = (h: number, gas: boolean, brake: boolean) => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const downX = -sa;
    const downY = ca;

    let fx = 0;
    let fy = G * Mc;
    let torque = 0;

    for (const w of wheels) {
      const axw = cx + (w.ax * ca - w.ay * sa);
      const ayw = cy + (w.ax * sa + w.ay * ca);
      const rx = axw - cx;
      const ry = ayw - cy;
      const avx = vx - angVel * ry;
      const avy = vy + angVel * rx;
      const tx = axw + downX * restLen;
      const ty = ayw + downY * restLen;
      const ddx = tx - w.x;
      const ddy = ty - w.y;
      const rvx = w.vx - avx;
      const rvy = w.vy - avy;
      const sfx = springK * ddx - springC * rvx;
      const sfy = springK * ddy - springC * rvy;
      w.vx += (sfx / MW) * h;
      w.vy += (sfy / MW + G) * h;
      fx += -sfx;
      fy += -sfy;
      torque += rx * -sfy - ry * -sfx;
    }

    vx += (fx / Mc) * h;
    vy += (fy / Mc) * h;
    angVel += (torque / Ic) * h;
    angVel *= 0.999;

    vx = clamp(vx, -1400, 1400);
    vy = clamp(vy, -1600, 1600);
    angVel = clamp(angVel, -MAX_ANG_VEL, MAX_ANG_VEL);

    cx += vx * h;
    cy += vy * h;
    ang += angVel * h;

    for (const w of wheels) {
      w.x += w.vx * h;
      w.y += w.vy * h;
      const gy = terrain(w.x);
      const pen = w.y + WHEEL_R - gy;
      w.grounded = false;
      if (pen > 0) {
        w.grounded = true;
        w.y = gy - WHEEL_R;
        const slope = slopeAt(w.x);
        const tl = Math.hypot(1, slope);
        const tnx = 1 / tl;
        const tny = slope / tl;
        const nx = slope / tl; // up-ish normal
        const ny = -1 / tl;
        let vn = w.vx * nx + w.vy * ny;
        let vt = w.vx * tnx + w.vy * tny;
        if (vn < 0) vn = -vn * 0.08; // tiny bounce
        if (gas && fuel > 0) vt += driveAccel * h;
        if (brake) vt -= brakeAccel * h;
        vt *= 1 - 0.9 * h; // rolling resistance
        vt = clamp(vt, -700, 900);
        w.vx = nx * vn + tnx * vt;
        w.vy = ny * vn + tny * vt;
        w.spin += (vt / WHEEL_R) * h;
        // pull chassis slightly toward grounded wheel to keep it lively
      } else {
        w.spin += (w.vx / WHEEL_R) * h * 0.4;
      }
      const sp = Math.hypot(w.vx, w.vy);
      if (sp > 1500) {
        w.vx *= 1500 / sp;
        w.vy *= 1500 / sp;
      }
    }

    // rider lean / air control. +ang noses the car down, so gas (wheelie) pushes
    // angVel negative and brake pushes it positive. Lets the player rotate in the
    // air to land flat rather than flipping uncontrollably on every jump.
    const airborne = !wheels[0].grounded && !wheels[1].grounded;
    const leanAccel = airborne ? AIR_LEAN : GROUND_LEAN;
    if (gas && fuel > 0) angVel -= leanAccel * h;
    else if (brake) angVel += leanAccel * h;
    angVel = clamp(angVel, -MAX_ANG_VEL, MAX_ANG_VEL);
  };

  const updateRun = (dt: number) => {
    const gas = input.isDown("ArrowRight", "Space", "d", "w", "ArrowUp");
    const brake = input.isDown("ArrowLeft", "a", "ArrowDown", "s");

    const dtc = Math.min(dt, 1 / 30);
    const steps = 6;
    const h = dtc / steps;
    for (let i = 0; i < steps; i++) physicsStep(h, gas, brake);

    // distance / score
    const m = Math.max(0, (cx - startX) / METER);
    if (m > meters) {
      meters = m;
      ctx.reportScore(Math.floor(meters));
    }

    // fuel drain
    const drain = 4 + (gas && Math.abs(vx) > 5 ? 9 : 0);
    fuel = Math.max(0, fuel - drain * dt);

    // items
    ensureItems(cx + 2400);
    for (const it of items) {
      if (it.got) continue;
      if (Math.hypot(it.x - cx, it.y - cy) < 46) {
        it.got = true;
        if (it.kind === "coin") {
          runCoins += 1;
          audio.coin();
        } else {
          fuel = Math.min(maxFuel, fuel + 38);
          audio.blip();
        }
      }
    }
    items = items.filter((it) => it.x > cx - 400 && !it.got);

    // camera
    camY += (cy - camY) * Math.min(1, dt * 5);

    // engine sound modulated by speed
    if (gas && fuel > 0) {
      engineSndT -= dt;
      if (engineSndT <= 0) {
        engineSndT = 0.1;
        audio.tone(70 + Math.min(260, Math.abs(vx) * 0.55), 0.09, "sawtooth", 0.12);
      }
    }

    // crash: driver head touches the ground
    const head = localToWorld(6, -(CHASSIS_H / 2) - 14);
    if (head.y + 4 >= terrain(head.x)) {
      endRun(true);
      return;
    }
    if (fuel <= 0 && Math.abs(vx) < 6 && wheels[0].grounded && wheels[1].grounded) {
      ctx.setStatus("Out of fuel!");
      endRun(false);
    }
  };

  const endRun = (flip: boolean) => {
    if (phase !== "run") return;
    phase = "crashed";
    crashTimer = 0;
    coins += runCoins;
    storage.set("coins", coins);
    if (flip) audio.explosion();
    else audio.lose();
  };

  // =====================================================================
  //  RENDER HELPERS
  // =====================================================================
  const sx = (wx: number, zoom: number, W: number) => (wx - cx) * zoom + W * 0.32;
  const sy = (wy: number, zoom: number, H: number) => (wy - camY) * zoom + H * 0.56;

  const drawSky = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1e2f57");
    g.addColorStop(0.55, "#3f6db0");
    g.addColorStop(1, "#9fc6e8");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // distant hills (parallax)
    c.fillStyle = "rgba(255,255,255,0.10)";
    const off = (cx * 0.15) % 360;
    for (let i = -1; i < W / 180 + 2; i++) {
      const bx = i * 180 - off;
      c.beginPath();
      c.ellipse(bx, H * 0.62, 150, 70, 0, Math.PI, 0);
      c.fill();
    }
  };

  const drawTerrain = (c: CanvasRenderingContext2D, W: number, H: number, zoom: number) => {
    c.beginPath();
    const step = 6;
    let first = true;
    for (let px = -step; px <= W + step; px += step) {
      const wx = cx + (px - W * 0.32) / zoom;
      const py = sy(terrain(wx), zoom, H);
      if (first) {
        c.moveTo(px, py);
        first = false;
      } else c.lineTo(px, py);
    }
    c.lineTo(W + step, H + step);
    c.lineTo(-step, H + step);
    c.closePath();
    const g = c.createLinearGradient(0, H * 0.3, 0, H);
    g.addColorStop(0, "#5a9e3a");
    g.addColorStop(0.08, "#3f7a28");
    g.addColorStop(1, "#274d1a");
    c.fillStyle = g;
    c.fill();
    // grass line
    c.lineWidth = Math.max(2, zoom * 5);
    c.strokeStyle = "#74c043";
    c.beginPath();
    first = true;
    for (let px = -step; px <= W + step; px += step) {
      const wx = cx + (px - W * 0.32) / zoom;
      const py = sy(terrain(wx), zoom, H);
      if (first) {
        c.moveTo(px, py);
        first = false;
      } else c.lineTo(px, py);
    }
    c.stroke();
  };

  const drawCar = (c: CanvasRenderingContext2D, zoom: number, W: number, H: number) => {
    // wheels first
    for (const w of wheels) {
      const wxp = sx(w.x, zoom, W);
      const wyp = sy(w.y, zoom, H);
      const r = WHEEL_R * zoom;
      c.fillStyle = "#1a1a1a";
      c.beginPath();
      c.arc(wxp, wyp, r, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#444";
      c.beginPath();
      c.arc(wxp, wyp, r * 0.55, 0, Math.PI * 2);
      c.fill();
      // spokes
      c.strokeStyle = "#888";
      c.lineWidth = Math.max(1, zoom * 1.5);
      for (let i = 0; i < 4; i++) {
        const a = w.spin + (i * Math.PI) / 2;
        c.beginPath();
        c.moveTo(wxp, wyp);
        c.lineTo(wxp + Math.cos(a) * r * 0.5, wyp + Math.sin(a) * r * 0.5);
        c.stroke();
      }
    }

    // chassis
    const ctr = { x: sx(cx, zoom, W), y: sy(cy, zoom, H) };
    c.save();
    c.translate(ctr.x, ctr.y);
    c.rotate(ang);
    const bw = CHASSIS_W * zoom;
    const bh = CHASSIS_H * zoom;
    // body
    c.fillStyle = "#e8413c";
    roundRect(c, -bw / 2, -bh / 2, bw, bh, bh * 0.35);
    c.fill();
    // cabin
    c.fillStyle = "#2c3e50";
    roundRect(c, -bw * 0.05, -bh * 1.05, bw * 0.42, bh * 0.7, bh * 0.25);
    c.fill();
    // window
    c.fillStyle = "#8fd3ff";
    roundRect(c, 0, -bh * 0.95, bw * 0.28, bh * 0.5, bh * 0.2);
    c.fill();
    // driver head
    c.fillStyle = "#f1c27d";
    c.beginPath();
    c.arc(bw * 0.12, -bh * 0.7, bh * 0.28, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };

  const drawItems = (c: CanvasRenderingContext2D, zoom: number, W: number, H: number) => {
    for (const it of items) {
      if (it.got) continue;
      const px = sx(it.x, zoom, W);
      const py = sy(it.y, zoom, H) + Math.sin(t * 4 + it.bob) * 4;
      if (px < -40 || px > W + 40) continue;
      if (it.kind === "coin") {
        c.fillStyle = "#ffd23f";
        c.strokeStyle = "#e0a000";
        c.lineWidth = Math.max(1, zoom * 1.5);
        c.beginPath();
        c.arc(px, py, 10 * zoom, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        drawText(c, "$", px, py, 11 * zoom, "#a06b00");
      } else {
        c.fillStyle = "#e23b3b";
        roundRect(c, px - 9 * zoom, py - 11 * zoom, 18 * zoom, 22 * zoom, 3 * zoom);
        c.fill();
        drawText(c, "F", px, py, 12 * zoom, "#fff");
      }
    }
  };

  const drawHud = (c: CanvasRenderingContext2D, W: number, H: number) => {
    // fuel bar
    const barW = Math.min(W * 0.32, 260);
    const barH = Math.max(14, H * 0.03);
    const bx = 16;
    const by = 16;
    c.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(c, bx - 4, by - 4, barW + 8, barH + 8, 8);
    c.fill();
    const fr = maxFuel > 0 ? fuel / maxFuel : 0;
    c.fillStyle = fr > 0.25 ? "#43d17a" : "#e23b3b";
    roundRect(c, bx, by, barW * fr, barH, 6);
    c.fill();
    drawText(c, "FUEL", bx + barW / 2, by + barH / 2, barH * 0.7, "#fff");

    drawText(c, `${Math.floor(meters)} m`, W - 16, 26, Math.min(34, H * 0.07), "#fff", "right");
    drawText(c, `$ ${coins + runCoins}`, W - 16, 26 + Math.min(34, H * 0.07), Math.min(22, H * 0.045), "#ffd23f", "right");
  };

  const drawGarage = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#13203c");
    g.addColorStop(1, "#24406e");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    drawText(c, "HILL BLAZER", W / 2, H * 0.12, Math.min(48, W * 0.07), "#ffd23f");
    drawText(c, `Coins: ${coins}`, W / 2, H * 0.19, Math.min(24, W * 0.04), "#9fc6e8");

    const panelW = Math.min(W * 0.86, 720);
    const panelX = (W - panelW) / 2;
    const rowH = Math.min(H * 0.12, 76);
    const top = H * 0.26;
    for (let i = 0; i < UPGRADE_DEFS.length; i++) {
      const def = UPGRADE_DEFS[i];
      const y = top + i * (rowH + 12);
      c.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(c, panelX, y, panelW, rowH, 12);
      c.fill();
      const lvl = upgrades[def.key];
      drawText(c, def.name, panelX + 18, y + rowH * 0.36, rowH * 0.3, "#fff", "left");
      drawText(c, def.blurb, panelX + 18, y + rowH * 0.72, rowH * 0.22, "#9fc6e8", "left");
      // level pips
      const pipR = rowH * 0.09;
      for (let p = 0; p < MAX_LEVEL; p++) {
        c.fillStyle = p < lvl ? "#ffd23f" : "rgba(255,255,255,0.18)";
        c.beginPath();
        c.arc(panelX + panelW * 0.46 + p * pipR * 2.6, y + rowH / 2, pipR, 0, Math.PI * 2);
        c.fill();
      }
      // buy button
      const btnW = Math.min(panelW * 0.26, 150);
      const btnX = panelX + panelW - btnW - 14;
      const maxed = lvl >= MAX_LEVEL;
      const cost = upgradeCost(lvl);
      const afford = coins >= cost;
      c.fillStyle = maxed ? "rgba(255,255,255,0.12)" : afford ? "#43d17a" : "rgba(226,59,59,0.5)";
      roundRect(c, btnX, y + rowH * 0.18, btnW, rowH * 0.64, 10);
      c.fill();
      drawText(
        c,
        maxed ? "MAX" : `$ ${cost}`,
        btnX + btnW / 2,
        y + rowH / 2,
        rowH * 0.28,
        "#0d1b2a",
      );
    }

    const goW = Math.min(panelW * 0.5, 320);
    const goX = (W - goW) / 2;
    const goY = top + UPGRADE_DEFS.length * (rowH + 12) + 14;
    const goH = Math.min(H * 0.12, 64);
    c.fillStyle = "#ffd23f";
    roundRect(c, goX, goY, goW, goH, 14);
    c.fill();
    drawText(c, "GO!  (Space)", W / 2, goY + goH / 2, goH * 0.4, "#0d1b2a");
  };

  // =====================================================================
  return {
    update(dt: number) {
      t += dt;
      if (phase === "garage") {
        handleGaragePointer();
        updateGarage();
      } else if (phase === "run") {
        updateRun(dt);
      } else if (phase === "crashed") {
        crashTimer += dt;
        if (crashTimer > 1.1) ctx.gameOver(Math.floor(meters));
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      if (phase === "garage") {
        drawGarage(c, W, H);
        return;
      }
      const zoom = H / VIEW_H;
      drawSky(c, W, H);
      drawTerrain(c, W, H, zoom);
      drawItems(c, zoom, W, H);
      drawCar(c, zoom, W, H);
      drawHud(c, W, H);

      if (phase === "crashed") {
        c.fillStyle = "rgba(0,0,0,0.45)";
        c.fillRect(0, 0, W, H);
        drawText(c, "WRECKED!", W / 2, H * 0.42, Math.min(54, W * 0.09), "#ffd23f");
        drawText(c, `${Math.floor(meters)} m  •  +${runCoins} coins`, W / 2, H * 0.54, Math.min(26, W * 0.045), "#fff");
      }
    },
  };
}
