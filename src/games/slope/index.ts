import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText } from "@/engine";

/** A single cross-section of the endless track. Panels are drawn between
 * consecutive rows so the surface stays continuous even as it wanders. */
interface Row {
  n: number;
  center: number;
  halfW: number;
  hazards: Hazard[];
}
interface Hazard {
  kind: "block" | "hole";
  x0: number;
  x1: number;
}
interface TrailDot {
  x: number;
  y: number;
  r: number;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  // --- perspective constants -------------------------------------------------
  const SEG = 22; // world z length of one row
  const FOCAL = 320; // depth foreshortening strength
  const MAX_Z = 1500; // furthest rendered distance
  const Z_BALL = 130; // how far ahead of the camera the ball sits

  // recomputed every frame from the live (getter) canvas size
  let cx = 0;
  let horizon = 0;
  let groundY = 0;

  const recalc = () => {
    cx = ctx.width / 2;
    horizon = ctx.height * 0.3;
    groundY = ctx.height - horizon;
  };

  const project = (x: number, z: number) => {
    const scale = FOCAL / (FOCAL + z);
    return { sx: cx + x * scale, sy: horizon + groundY * scale, scale };
  };

  // --- state -----------------------------------------------------------------
  let rows: Row[] = [];
  let nextN = 0;
  let camDist = 0;
  let speed = 0;
  let ballX = 0;
  let ballVX = 0;
  let started = false;
  let dead = false;
  let t = 0;
  let shake = 0;
  let trail: TrailDot[] = [];

  let genCenter = 0;
  let genTarget = 0;
  let cooldown = 0;
  let prevW = ctx.width;

  const best = ctx.storage.get<number>("best", 0);

  const diffAt = (dist: number) => clamp(dist / 9000, 0, 1);

  const genRow = (): Row => {
    const n = nextN++;
    const dist = n * SEG;
    const diff = diffAt(dist);

    if (Math.abs(genCenter - genTarget) < 6) {
      // keep the wander reachable: the ball can out-steer this drift rate.
      const range = ctx.width * (0.1 + diff * 0.12);
      genTarget = (Math.random() * 2 - 1) * range;
    }
    genCenter += (genTarget - genCenter) * 0.05;

    const halfW = ctx.width * (0.34 - diff * 0.15);

    const hazards: Hazard[] = [];
    if (n > 14 && cooldown <= 0 && Math.random() < 0.05 + diff * 0.16) {
      const w = halfW * (0.26 + Math.random() * 0.34);
      const hx = genCenter + (Math.random() * 2 - 1) * (halfW - w);
      hazards.push({
        kind: Math.random() < 0.4 ? "hole" : "block",
        x0: hx - w,
        x1: hx + w,
      });
      cooldown = 2;
    } else {
      cooldown--;
    }
    return { n, center: genCenter, halfW, hazards };
  };

  const ensureRows = () => {
    while ((nextN - 1) * SEG - camDist < MAX_Z) rows.push(genRow());
    while (rows.length > 0 && rows[0].n * SEG - camDist < -SEG * 2) rows.shift();
  };

  const reset = () => {
    rows = [];
    nextN = 0;
    camDist = 0;
    speed = 0;
    ballX = 0;
    ballVX = 0;
    started = false;
    dead = false;
    t = 0;
    shake = 0;
    trail = [];
    genCenter = 0;
    genTarget = 0;
    cooldown = 0;
    recalc();
    ensureRows();
  };
  reset();

  ctx.requestControls([{ type: "dpad" }]);
  ctx.setStatus("Steer LEFT / RIGHT — stay on the neon track");

  const rowAt = (idx: number): Row | undefined =>
    rows.find((r) => r.n === idx);

  const die = (reason: string) => {
    if (dead) return;
    dead = true;
    shake = 18;
    audio.explosion();
    ctx.setStatus(reason);
    const score = Math.floor(camDist / 10);
    setTimeout(() => ctx.gameOver(score), 600);
  };

  return {
    update(dt) {
      recalc();
      t += dt;
      if (shake > 0) shake = Math.max(0, shake - dt * 40);
      if (dead) return;

      const steer =
        (input.isDown("ArrowRight", "d") ? 1 : 0) -
        (input.isDown("ArrowLeft", "a") ? 1 : 0);

      if (steer !== 0 || input.pointer.down) started = true;

      // steering: responsive keyboard accel + optional finger drag toward the
      // touch point. Tuned so the ball can always out-steer the track wander.
      ballVX += steer * ctx.width * 4.6 * dt;
      if (input.pointer.down) {
        const targetX = input.pointer.x - cx;
        ballVX += (targetX - ballX) * 13 * dt;
      }
      ballVX *= Math.pow(0.0016, dt);
      const maxVX = ctx.width * 0.85;
      ballVX = clamp(ballVX, -maxVX, maxVX);
      ballX += ballVX * dt;
      ballX = clamp(ballX, -ctx.width, ctx.width);

      if (started) {
        speed = 260 + Math.min(camDist / 11, 620);
        camDist += speed * dt;
        ensureRows();
        ctx.reportScore(Math.floor(camDist / 10));
      }

      // collision against the row currently under the ball — only once the
      // run has actually begun, so a wandering opening row can never insta-kill.
      if (started) {
        const idx = Math.floor((camDist + Z_BALL) / SEG);
        const row = rowAt(idx);
        if (row) {
          if (ballX < row.center - row.halfW || ballX > row.center + row.halfW) {
            die("Fell off the edge!");
            return;
          }
          const r = ctx.width * 0.03;
          for (const h of row.hazards) {
            if (ballX + r > h.x0 && ballX - r < h.x1) {
              die(h.kind === "hole" ? "Dropped into a gap!" : "Hit an obstacle!");
              return;
            }
          }
        }
      }

      // trail (screen-space, only while moving)
      if (started) {
        const p = project(ballX, Z_BALL);
        trail.push({ x: p.sx, y: p.sy, r: ctx.width * 0.05 * p.scale });
        if (trail.length > 16) trail.shift();
      }
    },

    render() {
      recalc();
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      c.save();
      if (shake > 0) {
        c.translate(
          (Math.random() * 2 - 1) * shake,
          (Math.random() * 2 - 1) * shake,
        );
      }

      // background
      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#05030f");
      bg.addColorStop(0.45, "#0a0a24");
      bg.addColorStop(1, "#02030a");
      c.fillStyle = bg;
      c.fillRect(-40, -40, W + 80, H + 80);

      // horizon glow
      const glow = c.createLinearGradient(0, horizon - H * 0.18, 0, horizon + H * 0.05);
      glow.addColorStop(0, "rgba(20,200,255,0)");
      glow.addColorStop(1, "rgba(40,150,255,0.22)");
      c.fillStyle = glow;
      c.fillRect(0, horizon - H * 0.18, W, H * 0.23);

      // distant sun line (gentle neon pulse)
      const pulse = 0.3 + Math.sin(t * 2) * 0.12;
      c.strokeStyle = `rgba(255,80,200,${pulse})`;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, horizon);
      c.lineTo(W, horizon);
      c.stroke();

      // visible rows, projected
      const vis = rows.filter((r) => r.n * SEG - camDist > -SEG);

      // fill panels far -> near
      for (let i = vis.length - 1; i >= 1; i--) {
        const rf = vis[i];
        const rn = vis[i - 1];
        const zf = Math.max(0.5, rf.n * SEG - camDist);
        const zn = Math.max(0.5, rn.n * SEG - camDist);
        const fl = project(rf.center - rf.halfW, zf);
        const fr = project(rf.center + rf.halfW, zf);
        const nl = project(rn.center - rn.halfW, zn);
        const nr = project(rn.center + rn.halfW, zn);

        const fade = clamp(1 - zf / MAX_Z, 0.12, 1);
        const stripe = rf.n % 2 === 0;
        const base = stripe ? 30 : 16;
        c.fillStyle = `rgba(${base}, ${Math.round(90 * fade + 20)}, ${Math.round(150 * fade + 40)}, ${0.55 * fade + 0.25})`;
        c.beginPath();
        c.moveTo(nl.sx, nl.sy);
        c.lineTo(nr.sx, nr.sy);
        c.lineTo(fr.sx, fr.sy);
        c.lineTo(fl.sx, fl.sy);
        c.closePath();
        c.fill();

        // lateral rung
        c.strokeStyle = `rgba(0, 240, 255, ${0.25 * fade})`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(nl.sx, nl.sy);
        c.lineTo(nr.sx, nr.sy);
        c.stroke();

        // hazards live on the near edge of this panel band
        for (const h of rn.hazards) {
          drawHazard(c, h, zn, zf, fade);
        }
      }

      // glowing rails (single continuous strokes)
      c.save();
      c.shadowBlur = 18;
      const drawRail = (side: -1 | 1, color: string) => {
        c.strokeStyle = color;
        c.shadowColor = color;
        c.lineWidth = 3;
        c.beginPath();
        let first = true;
        for (let i = vis.length - 1; i >= 0; i--) {
          const r = vis[i];
          const z = Math.max(0.5, r.n * SEG - camDist);
          const p = project(r.center + side * r.halfW, z);
          if (first) {
            c.moveTo(p.sx, p.sy);
            first = false;
          } else c.lineTo(p.sx, p.sy);
        }
        c.stroke();
      };
      drawRail(-1, "#00f0ff");
      drawRail(1, "#ff3cf0");
      c.restore();

      // ball trail
      for (let i = 0; i < trail.length; i++) {
        const d = trail[i];
        const a = (i / trail.length) * 0.5;
        c.fillStyle = `rgba(120, 255, 240, ${a})`;
        c.beginPath();
        c.arc(d.x, d.y, d.r * (0.4 + (i / trail.length) * 0.6), 0, Math.PI * 2);
        c.fill();
      }

      // the ball
      const bp = project(ballX, Z_BALL);
      const br = ctx.width * 0.05 * bp.scale;
      // shadow on track
      c.fillStyle = "rgba(0,0,0,0.4)";
      c.beginPath();
      c.ellipse(bp.sx, bp.sy + br * 0.35, br * 1.05, br * 0.4, 0, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.shadowBlur = 26;
      c.shadowColor = "#9bffea";
      const grad = c.createRadialGradient(
        bp.sx - br * 0.3,
        bp.sy - br * 0.4,
        br * 0.1,
        bp.sx,
        bp.sy,
        br,
      );
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.4, "#7dffe6");
      grad.addColorStop(1, "#16b39c");
      c.fillStyle = grad;
      c.beginPath();
      c.arc(bp.sx, bp.sy, br, 0, Math.PI * 2);
      c.fill();
      c.restore();

      c.restore(); // shake

      // HUD
      const score = Math.floor(camDist / 10);
      drawText(c, String(score), W / 2, H * 0.12, H * 0.085, "#eaffff");
      drawText(
        c,
        `BEST ${Math.max(best, score)}`,
        W / 2,
        H * 0.12 + H * 0.07,
        H * 0.03,
        "rgba(180,240,255,0.65)",
      );
      if (!started) {
        drawText(
          c,
          "STEER TO START",
          W / 2,
          H * 0.6,
          H * 0.05,
          "rgba(255,255,255,0.8)",
        );
        drawText(
          c,
          "◀  ▶  /  drag",
          W / 2,
          H * 0.6 + H * 0.07,
          H * 0.035,
          "rgba(180,240,255,0.6)",
        );
      }
    },

    resize(w) {
      // world X is stored in CSS px around the centerline; rescale so the track
      // + ball keep their proportions through aspect / size changes.
      const r = prevW > 0 ? w / prevW : 1;
      if (r !== 1) {
        ballX *= r;
        ballVX *= r;
        genCenter *= r;
        genTarget *= r;
        for (const row of rows) {
          row.center *= r;
          row.halfW *= r;
          for (const h of row.hazards) {
            h.x0 *= r;
            h.x1 *= r;
          }
        }
        trail = [];
      }
      prevW = w;
    },

    destroy() {
      trail = [];
      rows = [];
    },
  };

  function drawHazard(
    c: CanvasRenderingContext2D,
    h: Hazard,
    zn: number,
    zf: number,
    fade: number,
  ) {
    const bl = project(h.x0, zn);
    const br = project(h.x1, zn);
    const fl = project(h.x0, zf);
    const fr = project(h.x1, zf);

    if (h.kind === "hole") {
      c.fillStyle = `rgba(2,2,10,${0.85 * fade + 0.1})`;
      c.beginPath();
      c.moveTo(bl.sx, bl.sy);
      c.lineTo(br.sx, br.sy);
      c.lineTo(fr.sx, fr.sy);
      c.lineTo(fl.sx, fl.sy);
      c.closePath();
      c.fill();
      c.strokeStyle = `rgba(0,255,255,${0.4 * fade})`;
      c.lineWidth = 1.5;
      c.stroke();
      return;
    }

    // red obstacle block: footprint + raised top + front face
    const hgt = ctx.height * 0.12;
    const tbl = { sx: bl.sx, sy: bl.sy - hgt * bl.scale };
    const tbr = { sx: br.sx, sy: br.sy - hgt * br.scale };
    const tfl = { sx: fl.sx, sy: fl.sy - hgt * fl.scale };
    const tfr = { sx: fr.sx, sy: fr.sy - hgt * fr.scale };

    c.save();
    c.shadowBlur = 16;
    c.shadowColor = "#ff2a4d";
    // top
    c.fillStyle = `rgba(255,90,110,${0.95})`;
    c.beginPath();
    c.moveTo(tbl.sx, tbl.sy);
    c.lineTo(tbr.sx, tbr.sy);
    c.lineTo(tfr.sx, tfr.sy);
    c.lineTo(tfl.sx, tfl.sy);
    c.closePath();
    c.fill();
    // front (near) face
    c.fillStyle = "#d0203a";
    c.beginPath();
    c.moveTo(bl.sx, bl.sy);
    c.lineTo(br.sx, br.sy);
    c.lineTo(tbr.sx, tbr.sy);
    c.lineTo(tbl.sx, tbl.sy);
    c.closePath();
    c.fill();
    c.restore();
  }
}
