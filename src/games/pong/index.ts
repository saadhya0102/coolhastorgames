import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, roundRect } from "@/engine";

type Mode = "ai" | "two";
type Phase = "menu" | "serve" | "play" | "over";

interface Btn {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  id: Mode;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  const WIN_SCORE = 7;

  let phase: Phase = "menu";
  let mode: Mode = "ai";

  // logical paddle centers (CSS px)
  let lY = 0;
  let rY = 0;
  let scoreL = 0;
  let scoreR = 0;

  // ball
  let bx = 0;
  let by = 0;
  let bvx = 0;
  let bvy = 0;
  let baseSpeed = 0;
  let trail: Array<{ x: number; y: number }> = [];

  let serveTimer = 0;
  let serveDir = 1; // direction ball heads after serve
  let overTimer = 0;
  let winner = "";
  let aiBias = 0;
  let aiRetargetT = 0;

  // tracks which pointer (if any) is controlling each half this frame
  const menuButtons = (): Btn[] => {
    const W = ctx.width;
    const H = ctx.height;
    const bw = Math.min(W * 0.34, 320);
    const bh = Math.min(H * 0.22, 110);
    const gap = bw * 0.16;
    const cy = H * 0.6;
    return [
      { x: W / 2 - bw - gap / 2, y: cy - bh / 2, w: bw, h: bh, label: "1 Player", id: "ai" },
      { x: W / 2 + gap / 2, y: cy - bh / 2, w: bw, h: bh, label: "2 Players", id: "two" },
    ];
  };

  const paddleH = () => clamp(ctx.height * 0.18, 40, ctx.height * 0.4);
  const paddleW = () => clamp(ctx.width * 0.016, 8, 18);
  const ballR = () => clamp(ctx.height * 0.022, 6, 18);
  const margin = () => clamp(ctx.width * 0.04, 16, 60);

  const resetPositions = () => {
    lY = ctx.height / 2;
    rY = ctx.height / 2;
  };

  const serveBall = (dir: number) => {
    bx = ctx.width / 2;
    by = ctx.height / 2;
    baseSpeed = ctx.width * 0.5;
    const ang = (Math.random() * 0.6 - 0.3); // shallow launch
    bvx = Math.cos(ang) * baseSpeed * dir;
    bvy = Math.sin(ang) * baseSpeed;
    serveDir = dir;
    serveTimer = 0.7;
    phase = "serve";
    trail = [];
  };

  const startGame = (m: Mode) => {
    mode = m;
    scoreL = 0;
    scoreR = 0;
    resetPositions();
    aiBias = 0;
    aiRetargetT = 0;
    audio.blip();
    serveBall(Math.random() < 0.5 ? 1 : -1);
    updateStatus();
  };

  const updateStatus = () => {
    if (phase === "menu") ctx.setStatus("Pong Arena — pick a mode");
    else ctx.setStatus(`${scoreL}  :  ${scoreR}   (first to ${WIN_SCORE})`);
  };

  ctx.requestControls([]);
  updateStatus();

  // ---- input helpers ----
  const halfPointers = (): { left: number | null; right: number | null } => {
    let left: number | null = null;
    let right: number | null = null;
    const mid = ctx.width / 2;
    for (const p of input.pointers.values()) {
      if (p.x < mid) {
        if (left === null) left = p.y;
      } else if (right === null) {
        right = p.y;
      }
    }
    return { left, right };
  };

  const movePaddleKeys = (cur: number, up: boolean, down: boolean, dt: number): number => {
    const spd = ctx.height * 1.25;
    let y = cur;
    if (up) y -= spd * dt;
    if (down) y += spd * dt;
    return y;
  };

  const clampPaddle = (y: number): number => {
    const half = paddleH() / 2;
    return clamp(y, half, ctx.height - half);
  };

  const scorePoint = (who: "L" | "R") => {
    if (who === "L") scoreL++;
    else scoreR++;
    audio.coin();
    updateStatus();
    if (scoreL >= WIN_SCORE || scoreR >= WIN_SCORE) {
      phase = "over";
      overTimer = 2.2;
      winner =
        scoreL > scoreR
          ? mode === "ai"
            ? "YOU WIN!"
            : "PLAYER 1 WINS"
          : mode === "ai"
            ? "CPU WINS"
            : "PLAYER 2 WINS";
      audio.win();
    } else {
      // serve toward the player who just conceded
      serveBall(who === "L" ? 1 : -1);
    }
  };

  const bounceOffPaddle = (paddleCenter: number, dir: number) => {
    const off = clamp((by - paddleCenter) / (paddleH() / 2), -1, 1);
    baseSpeed = Math.min(baseSpeed * 1.07, ctx.width * 1.4);
    const maxAng = 0.9; // ~52deg
    const ang = off * maxAng;
    bvx = Math.cos(ang) * baseSpeed * dir;
    bvy = Math.sin(ang) * baseSpeed;
    audio.blip();
  };

  return {
    update(dt) {
      const W = ctx.width;
      const H = ctx.height;
      const r = ballR();
      const pw = paddleW();
      const m = margin();

      if (phase === "menu") {
        const tapped =
          input.pointer.justDown ? { x: input.pointer.x, y: input.pointer.y } : null;
        if (tapped) {
          for (const b of menuButtons()) {
            if (
              tapped.x >= b.x &&
              tapped.x <= b.x + b.w &&
              tapped.y >= b.y &&
              tapped.y <= b.y + b.h
            ) {
              startGame(b.id);
              return;
            }
          }
        }
        if (input.pressed("1")) startGame("ai");
        if (input.pressed("2")) startGame("two");
        return;
      }

      if (phase === "over") {
        overTimer -= dt;
        if (overTimer <= 0) {
          ctx.gameOver();
          phase = "menu";
        }
        return;
      }

      // ----- paddle control (serve + play) -----
      const { left, right } = halfPointers();

      // Left paddle: drag in left half OR W/S (and arrows too in 1P, where the
      // right paddle is the CPU and arrows are otherwise unused).
      if (left !== null) lY = left;
      else {
        const up = input.isDown("w") || (mode === "ai" && input.isDown("ArrowUp"));
        const down = input.isDown("s") || (mode === "ai" && input.isDown("ArrowDown"));
        lY = movePaddleKeys(lY, up, down, dt);
      }
      lY = clampPaddle(lY);

      // Right paddle
      if (mode === "two") {
        if (right !== null) rY = right;
        else rY = movePaddleKeys(rY, input.isDown("ArrowUp"), input.isDown("ArrowDown"), dt);
      } else {
        // AI: track ball when it heads right; competent but imperfect.
        aiRetargetT -= dt;
        if (aiRetargetT <= 0) {
          aiRetargetT = 0.18;
          aiBias = (Math.random() * 2 - 1) * paddleH() * 0.55;
        }
        const aiSpeed = H * 0.95;
        let target = H / 2;
        if (bvx > 0) target = by + aiBias;
        const diff = target - rY;
        const step = clamp(diff, -aiSpeed * dt, aiSpeed * dt);
        rY += step;
      }
      rY = clampPaddle(rY);

      if (phase === "serve") {
        serveTimer -= dt;
        // ball waits at center, gently following nothing; keep it centered
        bx = W / 2;
        by = H / 2;
        if (serveTimer <= 0) {
          phase = "play";
          // re-launch with current baseSpeed in serveDir
          const ang = Math.random() * 0.6 - 0.3;
          bvx = Math.cos(ang) * baseSpeed * serveDir;
          bvy = Math.sin(ang) * baseSpeed;
        }
        return;
      }

      // ----- ball physics -----
      const prevBx = bx;
      bx += bvx * dt;
      by += bvy * dt;

      if (by - r < 0) {
        by = r;
        bvy = Math.abs(bvy);
        audio.tone(440, 0.04, "square", 0.2);
      } else if (by + r > H) {
        by = H - r;
        bvy = -Math.abs(bvy);
        audio.tone(440, 0.04, "square", 0.2);
      }

      const ph = paddleH();
      // Swept collisions: react on the frame the ball crosses the paddle's
      // face, so a fast ball can never tunnel straight through a paddle.
      const lFace = m + pw;
      if (
        bvx < 0 &&
        prevBx - r > lFace &&
        bx - r <= lFace &&
        by >= lY - ph / 2 - r &&
        by <= lY + ph / 2 + r
      ) {
        bx = lFace + r;
        bounceOffPaddle(lY, 1);
      }
      const rFace = W - m - pw;
      if (
        bvx > 0 &&
        prevBx + r < rFace &&
        bx + r >= rFace &&
        by >= rY - ph / 2 - r &&
        by <= rY + ph / 2 + r
      ) {
        bx = rFace - r;
        bounceOffPaddle(rY, -1);
      }

      // ball trail (juice)
      trail.push({ x: bx, y: by });
      if (trail.length > 12) trail.shift();

      // scoring
      if (bx + r < 0) scorePoint("R");
      else if (bx - r > W) scorePoint("L");
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      // background
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#05070f");
      g.addColorStop(1, "#0b1024");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);

      if (phase === "menu") {
        drawText(c, "PONG ARENA", W / 2, H * 0.3, Math.min(H * 0.12, W * 0.1), "#e8f0ff");
        drawText(
          c,
          "Left: W / S or drag left half",
          W / 2,
          H * 0.42,
          Math.min(H * 0.04, 22),
          "rgba(160,190,255,0.7)",
        );
        drawText(
          c,
          "Right: \u2191 / \u2193 or drag right half",
          W / 2,
          H * 0.47,
          Math.min(H * 0.04, 22),
          "rgba(160,190,255,0.7)",
        );
        for (const b of menuButtons()) {
          c.fillStyle = b.id === "ai" ? "#3b82f6" : "#22c55e";
          roundRect(c, b.x, b.y, b.w, b.h, 14);
          c.fill();
          c.fillStyle = "rgba(255,255,255,0.15)";
          roundRect(c, b.x, b.y, b.w, b.h * 0.4, 14);
          c.fill();
          drawText(c, b.label, b.x + b.w / 2, b.y + b.h / 2, Math.min(b.h * 0.32, 34), "#fff");
        }
        return;
      }

      // center dashed line
      c.strokeStyle = "rgba(255,255,255,0.25)";
      c.lineWidth = Math.max(2, W * 0.004);
      c.setLineDash([H * 0.03, H * 0.025]);
      c.beginPath();
      c.moveTo(W / 2, 0);
      c.lineTo(W / 2, H);
      c.stroke();
      c.setLineDash([]);

      // scores
      const sf = Math.min(H * 0.2, W * 0.12);
      drawText(c, String(scoreL), W * 0.25, H * 0.16, sf, "rgba(255,255,255,0.5)");
      drawText(c, String(scoreR), W * 0.75, H * 0.16, sf, "rgba(255,255,255,0.5)");

      const pw = paddleW();
      const ph = paddleH();
      const m = margin();

      // paddles
      c.fillStyle = "#5fd0ff";
      roundRect(c, m, lY - ph / 2, pw, ph, pw / 2);
      c.fill();
      c.fillStyle = mode === "ai" ? "#ff8a5f" : "#a78bfa";
      roundRect(c, W - m - pw, rY - ph / 2, pw, ph, pw / 2);
      c.fill();

      // ball trail
      const r = ballR();
      for (let i = 0; i < trail.length; i++) {
        const t = trail[i];
        const a = (i / trail.length) * 0.35;
        c.fillStyle = `rgba(255,255,255,${a})`;
        c.beginPath();
        c.arc(t.x, t.y, r * (0.4 + (i / trail.length) * 0.6), 0, Math.PI * 2);
        c.fill();
      }

      // ball
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(bx, by, r, 0, Math.PI * 2);
      c.fill();

      if (phase === "over") {
        c.fillStyle = "rgba(3,5,12,0.55)";
        c.fillRect(0, 0, W, H);
        drawText(c, winner, W / 2, H / 2, Math.min(H * 0.12, W * 0.09), "#ffe27a");
      }
    },

    resize() {
      lY = clampPaddle(lY);
      rY = clampPaddle(rY);
      if (phase === "menu") resetPositions();
    },
  };
}
