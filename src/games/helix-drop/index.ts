import type { GameContext, GameInstance } from "@/engine";
import { drawText, lerp, rng } from "@/engine";

/**
 * Helix Jump. A ball auto-bounces down a stack of flat perspective discs.
 * Rotate the whole tower (drag / arrow keys) so the gap in the next disc lines
 * up with the ball, which always sits at the FRONT of the tower (screen-bottom
 * of each ellipse). Landing on a coloured danger wedge ends the run; building
 * up enough fall speed smashes straight through a disc.
 *
 * The world is measured in "level units" (1 unit = one disc spacing) so the sim
 * is resize-independent. The front of the tower on screen is ellipse-param
 * angle PI/2 (largest screen-y), so the disc segment under the ball has the
 * intrinsic angle (PI/2 - towerRot) - used identically for collision + drawing.
 */
export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;
  const TAU = Math.PI * 2;

  interface Danger {
    c: number;
    h: number;
  }
  interface Ring {
    level: number;
    gapC: number;
    gapH: number;
    dangers: Danger[];
    hue: number;
    broken: boolean;
  }
  interface P {
    x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string;
  }

  const G = 9;
  const TERMINAL = 16;
  const BOUNCE = Math.sqrt(2 * G * 0.62);
  const SMASH = Math.sqrt(2 * G * 1.9);

  let rings: Ring[] = [];
  let nextIdx = 0;
  let topLevel = 0;
  let towerRot = 0;
  let by = 0;
  let ballVy = 0;
  let camLevel = 0;
  let levels = 0;
  let combo = 0;
  let started = false;
  let dead = false;
  let shake = 0;
  let squash = 0;
  let parts: P[] = [];
  let lastPx: number | null = null;

  const best = ctx.storage.get<number>("helixdrop.best", 0);

  const angDist = (a: number, b: number): number => {
    let d = Math.abs((((a - b) % TAU) + TAU) % TAU);
    if (d > Math.PI) d = TAU - d;
    return d;
  };

  function makeRing(level: number): Ring {
    const diff = Math.min(1, level / 45);
    const gapH = lerp(0.62, 0.4, diff);
    const gapC = Math.random() * TAU;
    const dangers: Danger[] = [];
    const count = Math.min(3, Math.floor(level / 7));
    for (let i = 0; i < count; i++) {
      let c = 0;
      for (let tries = 0; tries < 16; tries++) {
        c = Math.random() * TAU;
        let ok = angDist(c, gapC) > gapH + 0.45;
        for (const d of dangers) if (angDist(c, d.c) < 0.7) ok = false;
        if (ok) break;
      }
      dangers.push({ c, h: rng.range(0.3, 0.5) });
    }
    return { level, gapC, gapH, dangers, hue: (level * 28) % 360, broken: false };
  }

  function ensureRings() {
    while (rings.length < nextIdx + 12) rings.push(makeRing(++topLevel));
  }

  const reset = () => {
    rings = [];
    nextIdx = 0;
    topLevel = 0;
    towerRot = 0;
    by = 0;
    ballVy = 0;
    levels = 0;
    combo = 0;
    started = false;
    dead = false;
    shake = 0;
    squash = 0;
    parts = [];
    lastPx = null;
    camLevel = 0;
    ensureRings();
  };
  reset();

  ctx.requestControls([{ type: "dpad" }]);
  ctx.setStatus("Drag or arrows to spin the tower");

  type Seg = "gap" | "danger" | "safe";
  const classify = (ring: Ring, local: number): Seg => {
    if (angDist(local, ring.gapC) <= ring.gapH) return "gap";
    for (const d of ring.dangers) if (angDist(local, d.c) <= d.h) return "danger";
    return "safe";
  };

  function spawn(x: number, y: number, n: number, color: string, spread: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = Math.random() * spread + 20;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0, max: rng.range(0.3, 0.7), size: rng.range(2, 6), color });
    }
  }

  const die = (x: number, y: number) => {
    if (dead) return;
    dead = true;
    shake = 1;
    audio.hit();
    audio.lose();
    spawn(x, y, 30, "#ff4d6d", 90);
    if (levels > best) ctx.storage.set("helixdrop.best", levels);
    setTimeout(() => ctx.gameOver(levels), 650);
  };

  // geometry helpers shared by update + render
  const geom = () => {
    const W = ctx.width;
    const H = ctx.height;
    const spacing = H * 0.28;
    return {
      W, H, spacing,
      cx: W / 2,
      anchorY: H * 0.34,
      rx: W * 0.33,
      ry: W * 0.33 * 0.36,
      ballR: Math.min(W, H) * 0.036,
    };
  };

  return {
    update(dt) {
      const g = geom();
      const ballRlev = g.ballR / g.spacing;

      if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
      if (squash > 0) squash = Math.max(0, squash - dt * 6);

      const rotSpeed = 3.6;
      if (input.isDown("ArrowLeft", "a")) { towerRot -= rotSpeed * dt; started = true; }
      if (input.isDown("ArrowRight", "d")) { towerRot += rotSpeed * dt; started = true; }
      if (input.pointer.down) {
        if (lastPx !== null) {
          towerRot += ((input.pointer.x - lastPx) / g.W) * 6;
          if (Math.abs(input.pointer.x - lastPx) > 0.5) started = true;
        }
        lastPx = input.pointer.x;
      } else lastPx = null;
      if (input.pressed("Space")) started = true;

      for (const p of parts) {
        p.life += dt;
        p.vy += 240 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      parts = parts.filter((p) => p.life < p.max);

      if (!started || dead) {
        camLevel = lerp(camLevel, by, 0.14);
        return;
      }

      ballVy = Math.min(TERMINAL, ballVy + G * dt);
      by += ballVy * dt;

      const ring = rings[nextIdx];
      if (ring && ballVy > 0 && by + ballRlev >= ring.level) {
        const local = (((Math.PI / 2 - towerRot) % TAU) + TAU) % TAU;
        const seg = classify(ring, local);
        const sx = g.cx;
        const sy = g.anchorY + (ring.level - camLevel) * g.spacing;
        if (seg === "gap") {
          passRing(ring, true);
        } else if (ballVy >= SMASH) {
          ring.broken = true;
          shake = Math.max(shake, 0.85);
          spawn(sx, sy, 22, `hsl(${ring.hue},70%,60%)`, 110);
          audio.explosion();
          passRing(ring, true);
        } else if (seg === "danger") {
          die(sx, sy);
        } else {
          by = ring.level - ballRlev;
          ballVy = -BOUNCE;
          squash = 1;
          combo = 0;
          audio.tone(320 + Math.min(levels, 30) * 8, 0.07, "square", 0.22);
          spawn(sx, sy + g.ry * 0.5, 6, "#ffffff", 30);
        }
      }

      ensureRings();
      while (rings.length > 0 && rings[0].level < camLevel - 3) {
        rings.shift();
        if (nextIdx > 0) nextIdx--;
      }
      camLevel = lerp(camLevel, by - 0.15, 0.14);

      function passRing(r: Ring, scored: boolean) {
        if (scored) {
          levels++;
          combo++;
          ctx.reportScore(levels);
          if (!r.broken) {
            audio.coin();
            spawn(g.cx, g.anchorY + (r.level - camLevel) * g.spacing, 6, `hsl(${r.hue},70%,65%)`, 50);
          }
        }
        nextIdx++;
      }
    },

    render() {
      const c = ctx.ctx;
      const { W, H, spacing, cx, anchorY, rx, ry, ballR } = geom();
      const rxIn = rx * 0.32;
      const ryIn = ry * 0.32;
      const extrude = Math.max(7, ry * 0.55);

      c.save();
      if (shake > 0) {
        const s = shake * 10;
        c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      }

      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0d1530");
      bg.addColorStop(1, "#241753");
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);
      const glow = c.createRadialGradient(cx, H * 0.4, 0, cx, H * 0.4, W * 0.65);
      glow.addColorStop(0, "rgba(120,90,220,0.22)");
      glow.addColorStop(1, "rgba(120,90,220,0)");
      c.fillStyle = glow;
      c.fillRect(0, 0, W, H);

      const poleW = rxIn * 1.2;
      c.fillStyle = "#160f36";
      c.fillRect(cx - poleW / 2, 0, poleW, H);
      c.fillStyle = "rgba(255,255,255,0.05)";
      c.fillRect(cx - poleW / 2, 0, poleW * 0.35, H);

      const N = 80;
      const step = TAU / N;

      const fillSector = (sy: number, wa0: number, wa1: number, color: string) => {
        c.beginPath();
        for (let t = wa0; t <= wa1 + 1e-4; t += step) {
          c.lineTo(cx + rx * Math.cos(t), sy + ry * Math.sin(t));
        }
        for (let t = wa1; t >= wa0 - 1e-4; t -= step) {
          c.lineTo(cx + rxIn * Math.cos(t), sy + ryIn * Math.sin(t));
        }
        c.closePath();
        c.fillStyle = color;
        c.fill();
      };

      // draw far rings first (higher up) so nearer ones overlap correctly
      const visible = rings.filter((r) => !r.broken);
      for (const ring of visible) {
        const sy = anchorY + (ring.level - camLevel) * spacing;
        if (sy < -ry - extrude - 20 || sy > H + ry + extrude + 20) continue;

        // group consecutive same-type segments into sectors
        type Run = { a0: number; a1: number; color: string | null };
        const runs: Run[] = [];
        for (let k = 0; k < N; k++) {
          const wa = k * step;
          const intrinsic = (((wa - towerRot) % TAU) + TAU) % TAU;
          const seg = classify(ring, intrinsic);
          const color = seg === "gap" ? null : seg === "danger" ? "#ff4d6d" : `hsl(${ring.hue},62%,55%)`;
          const last = runs[runs.length - 1];
          if (last && last.color === color) last.a1 = wa + step;
          else runs.push({ a0: wa, a1: wa + step, color });
        }
        // extruded side (depth)
        for (const r of runs) {
          if (!r.color) continue;
          fillSector(sy + extrude, r.a0, r.a1, shade(r.color, -0.35));
        }
        // top face
        for (const r of runs) {
          if (!r.color) continue;
          fillSector(sy, r.a0, r.a1, r.color);
        }
      }

      // ball
      const bsy = anchorY + (by - camLevel) * spacing;
      const sq = 1 + squash * 0.45;
      const stretch = 1 - squash * 0.32;
      // shadow on next disc
      const nring = rings[nextIdx];
      if (nring && !nring.broken) {
        const ny = anchorY + (nring.level - camLevel) * spacing;
        const t = Math.max(0, 1 - (nring.level - by) / 1.5);
        c.globalAlpha = 0.25 * t;
        c.fillStyle = "#000";
        c.beginPath();
        c.ellipse(cx, ny, ballR * 1.1, ballR * 0.4, 0, 0, TAU);
        c.fill();
        c.globalAlpha = 1;
      }
      c.save();
      c.translate(cx, bsy);
      c.fillStyle = "rgba(255,210,80,0.16)";
      c.beginPath();
      c.ellipse(0, -ballR * 1.5, ballR * 0.7, ballR * 1.4, 0, 0, TAU);
      c.fill();
      const grad = c.createRadialGradient(-ballR * 0.3, -ballR * 0.4, ballR * 0.2, 0, 0, ballR);
      grad.addColorStop(0, "#fff3c0");
      grad.addColorStop(1, "#ff9f1c");
      c.fillStyle = grad;
      c.beginPath();
      c.ellipse(0, 0, ballR * sq, ballR * stretch, 0, 0, TAU);
      c.fill();
      c.restore();

      for (const p of parts) {
        c.globalAlpha = Math.max(0, 1 - p.life / p.max);
        c.fillStyle = p.color;
        c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      c.globalAlpha = 1;
      c.restore();

      drawText(c, String(levels), W / 2, H * 0.12, Math.min(W, H) * 0.1, "#fff");
      drawText(c, `BEST ${Math.max(best, levels)}`, W / 2, H * 0.19, Math.min(W, H) * 0.038, "rgba(255,255,255,0.7)");

      if (!started) {
        c.fillStyle = "rgba(8,6,24,0.55)";
        c.fillRect(0, 0, W, H);
        drawText(c, "HELIX JUMP", W / 2, H * 0.42, Math.min(W, H) * 0.085, "#ffd23f");
        drawText(c, "Drag or arrows to spin", W / 2, H * 0.52, Math.min(W, H) * 0.04, "#fff");
        drawText(c, "drop the ball through the gap", W / 2, H * 0.57, Math.min(W, H) * 0.032, "rgba(255,255,255,0.75)");
      }
    },
  };

  function shade(hslOrHex: string, amt: number): string {
    // darken an hsl(...) string by reducing lightness; fall back for hex
    const m = hslOrHex.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (m) {
      const h = +m[1];
      const s = +m[2];
      const l = Math.max(0, Math.min(100, +m[3] + amt * 100));
      return `hsl(${h},${s}%,${l}%)`;
    }
    return amt < 0 ? "#a8324a" : hslOrHex;
  }
}
