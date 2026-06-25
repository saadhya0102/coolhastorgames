import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText } from "@/engine";

interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  invuln: number;
  thrust: boolean;
}

interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: 3 | 2 | 1;
  radius: number;
  spin: number;
  rot: number;
  shape: number[];
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  foe: boolean;
}

interface Ufo {
  x: number;
  y: number;
  vx: number;
  dir: number;
  fireT: number;
  big: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  let score = 0;
  let lives = 3;
  let wave = 1;
  let dead = false;

  let ship: Ship;
  let rocks: Rock[] = [];
  let bullets: Bullet[] = [];
  let ufo: Ufo | null = null;
  let ufoTimer = 0;
  let particles: Particle[] = [];

  let fireCd = 0;
  let shakeT = 0;
  let shakeMag = 0;
  let t = 0;

  const minSide = () => Math.min(ctx.width, ctx.height);

  const newShip = (): Ship => ({
    x: ctx.width / 2,
    y: ctx.height / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    invuln: 2.5,
    thrust: false,
  });

  const rockShape = (): number[] => {
    const pts: number[] = [];
    const n = 10;
    for (let i = 0; i < n; i++) pts.push(0.7 + Math.random() * 0.5);
    return pts;
  };

  const makeRock = (x: number, y: number, size: 3 | 2 | 1): Rock => {
    const radius = minSide() * (size === 3 ? 0.09 : size === 2 ? 0.055 : 0.03);
    const sp = minSide() * (0.05 + (3 - size) * 0.04 + wave * 0.004);
    const a = Math.random() * Math.PI * 2;
    return {
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size,
      radius,
      spin: (Math.random() - 0.5) * 2,
      rot: 0,
      shape: rockShape(),
    };
  };

  const spawnWave = () => {
    rocks = [];
    const count = 3 + wave;
    for (let i = 0; i < count; i++) {
      // spawn away from center/ship
      let x = 0;
      let y = 0;
      do {
        x = Math.random() * ctx.width;
        y = Math.random() * ctx.height;
      } while (Math.hypot(x - ctx.width / 2, y - ctx.height / 2) < minSide() * 0.28);
      rocks.push(makeRock(x, y, 3));
    }
  };

  ship = newShip();
  spawnWave();
  ufoTimer = 14 + Math.random() * 10;

  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "Space", label: "FIRE", id: "fire" },
  ]);
  ctx.setStatus("◀ ▶ rotate · ▲ thrust · Space fire");

  const wrap = (o: { x: number; y: number }) => {
    const W = ctx.width;
    const H = ctx.height;
    if (o.x < 0) o.x += W;
    else if (o.x > W) o.x -= W;
    if (o.y < 0) o.y += H;
    else if (o.y > H) o.y -= H;
  };

  // Draw an object at its position plus any edge-wrapped copies, so objects that
  // straddle a screen edge are fully visible on both sides.
  const drawWrapped = (
    px: number,
    py: number,
    r: number,
    draw: (x: number, y: number) => void,
  ) => {
    const W = ctx.width;
    const H = ctx.height;
    const xs = px < r ? [px, px + W] : px > W - r ? [px, px - W] : [px];
    const ys = py < r ? [py, py + H] : py > H - r ? [py, py - H] : [py];
    for (const x of xs) for (const y of ys) draw(x, y);
  };

  const shake = (m: number) => {
    shakeMag = Math.max(shakeMag, m);
    shakeT = Math.max(shakeT, 0.3);
  };

  const burst = (x: number, y: number, n: number, color: string, speed: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.4 + Math.random() * 0.5,
        color,
      });
    }
  };

  const fire = () => {
    if (fireCd > 0) return;
    fireCd = 0.22;
    const sp = minSide() * 0.95;
    bullets.push({
      x: ship.x + Math.cos(ship.angle) * 16,
      y: ship.y + Math.sin(ship.angle) * 16,
      vx: ship.vx + Math.cos(ship.angle) * sp,
      vy: ship.vy + Math.sin(ship.angle) * sp,
      life: 0.9,
      foe: false,
    });
    audio.tone(720, 0.05, "square", 0.25);
  };

  const splitRock = (r: Rock) => {
    score += r.size === 3 ? 20 : r.size === 2 ? 50 : 100;
    ctx.reportScore(score);
    burst(r.x, r.y, 12, "#cfe8ff", minSide() * 0.5);
    shake(r.size * 2.5);
    audio.explosion();
    if (r.size > 1) {
      const ns = (r.size - 1) as 2 | 1;
      for (let i = 0; i < 2; i++) rocks.push(makeRock(r.x, r.y, ns));
    }
    rocks = rocks.filter((x) => x !== r);
    if (rocks.length === 0) {
      wave++;
      audio.win();
      spawnWave();
    }
  };

  const hitShip = () => {
    if (ship.invuln > 0 || dead) return;
    lives--;
    burst(ship.x, ship.y, 24, "#ff9f1c", minSide() * 0.7);
    shake(10);
    audio.explosion();
    if (lives <= 0) {
      dead = true;
      setTimeout(() => ctx.gameOver(score), 700);
      return;
    }
    ship = newShip();
  };

  const spawnUfo = () => {
    const fromLeft = Math.random() < 0.5;
    const big = Math.random() < 0.5;
    ufo = {
      x: fromLeft ? -30 : ctx.width + 30,
      y: ctx.height * (0.2 + Math.random() * 0.6),
      vx: (fromLeft ? 1 : -1) * minSide() * 0.18,
      dir: fromLeft ? 1 : -1,
      fireT: 1.2,
      big,
    };
    audio.sweep(200, 400, 0.3, "sawtooth", 0.2);
  };

  return {
    update(dt) {
      t += dt;
      const W = ctx.width;
      const H = ctx.height;
      if (shakeT > 0) shakeT -= dt;
      if (fireCd > 0) fireCd -= dt;

      stepParticles(dt);

      if (dead) return;

      // controls
      const rotSpeed = 3.4;
      if (input.isDown("ArrowLeft", "a")) ship.angle -= rotSpeed * dt;
      if (input.isDown("ArrowRight", "d")) ship.angle += rotSpeed * dt;
      ship.thrust = input.isDown("ArrowUp", "w");
      if (ship.thrust) {
        const acc = minSide() * 0.9;
        ship.vx += Math.cos(ship.angle) * acc * dt;
        ship.vy += Math.sin(ship.angle) * acc * dt;
        if (Math.random() < 0.7) {
          const ba = ship.angle + Math.PI + (Math.random() - 0.5) * 0.5;
          particles.push({
            x: ship.x + Math.cos(ship.angle + Math.PI) * 14,
            y: ship.y + Math.sin(ship.angle + Math.PI) * 14,
            vx: Math.cos(ba) * minSide() * 0.3,
            vy: Math.sin(ba) * minSide() * 0.3,
            life: 0,
            max: 0.3,
            color: Math.random() < 0.5 ? "#ffd23f" : "#ff7b00",
          });
        }
      }
      if (input.pressed("Space") || input.pointer.justDown) fire();
      if (input.isDown("Space")) fire();

      // ship physics (drift + light damping)
      const maxV = minSide() * 0.75;
      const v = Math.hypot(ship.vx, ship.vy);
      if (v > maxV) {
        ship.vx = (ship.vx / v) * maxV;
        ship.vy = (ship.vy / v) * maxV;
      }
      ship.vx *= 1 - 0.18 * dt;
      ship.vy *= 1 - 0.18 * dt;
      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;
      wrap(ship);
      if (ship.invuln > 0) ship.invuln -= dt;

      // rocks
      for (const r of rocks) {
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.rot += r.spin * dt;
        wrap(r);
        if (ship.invuln <= 0 && Math.hypot(r.x - ship.x, r.y - ship.y) < r.radius + minSide() * 0.02) {
          hitShip();
        }
      }

      // bullets
      for (const b of bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        wrap(b);
        if (b.foe) {
          if (ship.invuln <= 0 && Math.hypot(b.x - ship.x, b.y - ship.y) < minSide() * 0.02) {
            b.life = 0;
            hitShip();
          }
          continue;
        }
        for (const r of rocks) {
          if (Math.hypot(b.x - r.x, b.y - r.y) < r.radius) {
            b.life = 0;
            splitRock(r);
            break;
          }
        }
        if (ufo && b.life > 0) {
          const ur = minSide() * (ufo.big ? 0.045 : 0.03);
          if (Math.hypot(b.x - ufo.x, b.y - ufo.y) < ur) {
            b.life = 0;
            score += ufo.big ? 200 : 500;
            ctx.reportScore(score);
            burst(ufo.x, ufo.y, 20, "#ff5c8a", minSide() * 0.6);
            shake(8);
            audio.explosion();
            ufo = null;
          }
        }
      }
      bullets = bullets.filter((b) => b.life > 0);

      // ufo
      if (!ufo) {
        ufoTimer -= dt;
        if (ufoTimer <= 0) {
          spawnUfo();
          ufoTimer = 18 + Math.random() * 14;
        }
      } else {
        ufo.x += ufo.vx * dt;
        ufo.y += Math.sin(t * 2) * minSide() * 0.06 * dt;
        ufo.fireT -= dt;
        if (ufo.fireT <= 0) {
          ufo.fireT = ufo.big ? 1.4 : 0.9;
          const aim = ufo.big
            ? Math.random() * Math.PI * 2
            : Math.atan2(ship.y - ufo.y, ship.x - ufo.x) + (Math.random() - 0.5) * 0.3;
          const sp = minSide() * 0.5;
          bullets.push({ x: ufo.x, y: ufo.y, vx: Math.cos(aim) * sp, vy: Math.sin(aim) * sp, life: 2, foe: true });
          audio.tone(300, 0.08, "sawtooth", 0.2);
        }
        const ur = minSide() * (ufo.big ? 0.045 : 0.03);
        if (ship.invuln <= 0 && Math.hypot(ufo.x - ship.x, ufo.y - ship.y) < ur + minSide() * 0.02) {
          burst(ufo.x, ufo.y, 16, "#ff5c8a", minSide() * 0.5);
          ufo = null;
          hitShip();
        }
        if (ufo && (ufo.x < -50 || ufo.x > W + 50)) ufo = null;
        void H;
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#04060f");
      bg.addColorStop(1, "#0a0820");
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);

      // starfield
      c.fillStyle = "rgba(255,255,255,0.6)";
      for (let i = 0; i < 60; i++) {
        const sx = (i * 6263) % W;
        const sy = (i * 9973) % H;
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
        c.globalAlpha = 0.2 + tw * 0.5;
        c.fillRect(sx, sy, 2, 2);
      }
      c.globalAlpha = 1;

      c.save();
      if (shakeT > 0) {
        const m = shakeMag * (shakeT / 0.3);
        c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      }

      // particles
      for (const p of particles) {
        c.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
        c.fillStyle = p.color;
        c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      c.globalAlpha = 1;

      // rocks
      c.strokeStyle = "#b9c7e0";
      c.lineWidth = 2;
      for (const r of rocks) {
        drawWrapped(r.x, r.y, r.radius, (ox, oy) => {
          c.save();
          c.translate(ox, oy);
          c.rotate(r.rot);
          c.beginPath();
          for (let i = 0; i < r.shape.length; i++) {
            const a = (i / r.shape.length) * Math.PI * 2;
            const rad = r.radius * r.shape[i];
            const px = Math.cos(a) * rad;
            const py = Math.sin(a) * rad;
            if (i === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
          }
          c.closePath();
          c.fillStyle = "rgba(120,140,180,0.25)";
          c.fill();
          c.stroke();
          c.restore();
        });
      }

      // bullets
      for (const b of bullets) {
        c.fillStyle = b.foe ? "#ff5c8a" : "#9bf6ff";
        c.beginPath();
        c.arc(b.x, b.y, b.foe ? 4 : 3, 0, Math.PI * 2);
        c.fill();
      }

      // ufo
      if (ufo) {
        const ur = minSide() * (ufo.big ? 0.045 : 0.03);
        c.fillStyle = "#46e0a0";
        c.beginPath();
        c.ellipse(ufo.x, ufo.y, ur * 1.6, ur * 0.7, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#9bf6ff";
        c.beginPath();
        c.ellipse(ufo.x, ufo.y - ur * 0.3, ur * 0.8, ur * 0.6, 0, Math.PI, 0);
        c.fill();
      }

      // ship
      if (!dead && !(ship.invuln > 0 && Math.floor(t * 12) % 2 === 0)) {
        drawWrapped(ship.x, ship.y, 24, (ox, oy) => {
          c.save();
          c.translate(ox, oy);
          c.rotate(ship.angle);
          if (ship.thrust) {
            c.fillStyle = Math.random() < 0.5 ? "#ffd23f" : "#ff7b00";
            c.beginPath();
            c.moveTo(-12, -5);
            c.lineTo(-12 - 10 - Math.random() * 8, 0);
            c.lineTo(-12, 5);
            c.closePath();
            c.fill();
          }
          c.strokeStyle = "#fff";
          c.fillStyle = "rgba(103,232,255,0.25)";
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(16, 0);
          c.lineTo(-12, -11);
          c.lineTo(-6, 0);
          c.lineTo(-12, 11);
          c.closePath();
          c.fill();
          c.stroke();
          c.restore();
        });
      }

      c.restore();

      // HUD
      drawText(c, `SCORE ${score}`, W * 0.04, H * 0.06, H * 0.04, "#fff", "left");
      drawText(c, `WAVE ${wave}`, W / 2, H * 0.06, H * 0.04, "#9bf6ff");
      // life icons
      for (let i = 0; i < lives; i++) {
        const lx = W - W * 0.04 - i * H * 0.045;
        c.save();
        c.translate(lx, H * 0.06);
        c.rotate(-Math.PI / 2);
        c.strokeStyle = "#fff";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(10, 0);
        c.lineTo(-8, -7);
        c.lineTo(-4, 0);
        c.lineTo(-8, 7);
        c.closePath();
        c.stroke();
        c.restore();
      }
    },

    resize(w, h) {
      ship.x = clamp(ship.x, 0, w);
      ship.y = clamp(ship.y, 0, h);
    },
  };

  function stepParticles(dt: number) {
    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.life < p.max);
  }
}
