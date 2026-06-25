import type { GameContext, GameInstance, Rect } from "@/engine";
import { drawText, roundRect, pointInRect, clamp } from "@/engine";
import {
  SPECIES,
  STARTER_KEYS,
  SKILLS,
  speciesByKey,
  makeMonster,
  maxHpFor,
  atkFor,
  spdFor,
  drawCreature,
  type Species,
  type Monster,
} from "./creatures";

type Mode = "team" | "battle" | "reward" | "target";
type Phase = "intro" | "fight" | "victory" | "defeat";

type Reward =
  | { kind: "recruit"; sp: Species; level: number }
  | { kind: "levelup" }
  | { kind: "heal" }
  | { kind: "item"; stat: "hp" | "atk" | "spd"; amount: number };

interface Float {
  x: number;
  y: number;
  vy: number;
  t: number;
  text: string;
  color: string;
  big: boolean;
}

const BG = "#0d1322";

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  let best = storage.get<number>("bestFloor", 0);
  let unlocked = storage.get<string[]>("unlocked", STARTER_KEYS.slice());
  // sanity: ensure unlocked keys are valid + non-empty
  unlocked = unlocked.filter((k) => SPECIES.some((s) => s.key === k));
  if (unlocked.length === 0) unlocked = STARTER_KEYS.slice();

  let mode: Mode = "team";

  // ---- team select state ----
  const selected: string[] = [];
  const previews = new Map<string, Monster>();
  for (const sp of SPECIES) previews.set(sp.key, makeMonster(sp, 1, "ally"));

  // ---- run state ----
  let team: Monster[] = [];
  let floor = 1;
  let cleared = 0;

  // ---- battle state ----
  let enemies: Monster[] = [];
  let order: Monster[] = [];
  let turnIdx = 0;
  let actTimer = 0;
  let phase: Phase = "intro";
  let timer = 0;
  let banner = "";
  let floats: Float[] = [];
  let ended = false;
  const ACT_DELAY = 0.62;

  // ---- reward state ----
  let rewards: Reward[] = [];
  let pendingReward: Reward | null = null;
  let nextFloor = 1;

  ctx.requestControls([]);

  // ----------------------------------------------------------------- helpers
  const tapped = (r: Rect): boolean =>
    input.pointer.justUp && pointInRect(input.pointer.x, input.pointer.y, r);

  const W = () => ctx.width;
  const H = () => ctx.height;

  const spawnFloat = (m: Monster, text: string, color: string, big = false) => {
    floats.push({
      x: m.x + (Math.random() - 0.5) * m.size,
      y: m.y - m.size * 0.7,
      vy: -42,
      t: 1,
      text,
      color,
      big,
    });
  };

  const updateStatus = () => {
    if (mode === "team") ctx.setStatus(`Best floor: ${best}`);
    else ctx.setStatus(`Floor ${floor}  -  Cleared ${cleared}  -  Best ${best}`);
  };
  updateStatus();

  // ----------------------------------------------------------------- combat
  const applyDamage = (m: Monster, dmg: number, color: string, big: boolean) => {
    m.hp -= dmg;
    m.hitFlash = 1;
    spawnFloat(m, `-${dmg}`, color, big);
    if (m.hp <= 0) {
      m.hp = 0;
      m.alive = false;
      audio.explosion();
    } else {
      audio.tone(200 + Math.random() * 80, 0.05, "square", 0.22);
    }
  };

  const takeTurn = (actor: Monster) => {
    if (!actor.alive) return;
    const allies = (actor.side === "ally" ? team : enemies).filter((a) => a.alive);
    const foes = (actor.side === "ally" ? enemies : team).filter((a) => a.alive);

    // burn tick
    if (actor.burn > 0) {
      const d = Math.round(actor.maxHp * 0.06) + 1;
      actor.burn--;
      applyDamage(actor, d, "#ff9a3d", false);
      if (!actor.alive) return;
    }

    const skill = actor.species.skill;

    if (skill === "rally" && !actor.rallied) {
      actor.rallied = true;
      for (const a of allies) a.battleAtk = Math.round(a.battleAtk * 1.25);
      spawnFloat(actor, "RALLY!", "#ffd23a");
    }

    if (skill === "heal") {
      const hurt = allies
        .filter((a) => a.hp < a.maxHp)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (hurt) {
        const h = Math.round(actor.battleAtk * 0.9) + 2;
        hurt.hp = Math.min(hurt.maxHp, hurt.hp + h);
        spawnFloat(hurt, `+${h}`, "#5dff9a");
        audio.coin();
      }
    }

    if (foes.length === 0) return;
    const target = foes.slice().sort((a, b) => a.hp - b.hp)[0];
    actor.lunge = 1;
    actor.lungeTx = target.x - actor.x;
    actor.lungeTy = target.y - actor.y;

    const hits = skill === "double" ? 2 : 1;
    for (let i = 0; i < hits; i++) {
      if (!target.alive) break;
      let base = actor.battleAtk * (0.85 + Math.random() * 0.3);
      let crit = false;
      if (skill === "crit" && Math.random() < 0.35) {
        base *= 2;
        crit = true;
      }
      if (target.species.skill === "shield") base *= 0.6;
      const dmg = Math.max(1, Math.round(base));
      applyDamage(target, dmg, crit ? "#ffd23a" : "#ffffff", crit);
      if (skill === "burn" && target.alive) target.burn = 3;
    }
  };

  const startRound = () => {
    order = [...team, ...enemies]
      .filter((m) => m.alive)
      .sort((a, b) => b.spd - a.spd || Math.random() - 0.5);
    turnIdx = 0;
  };

  const checkEnd = (): boolean => {
    const alliesAlive = team.some((m) => m.alive);
    const foesAlive = enemies.some((m) => m.alive);
    if (!foesAlive) {
      phase = "victory";
      cleared = floor;
      ctx.reportScore(cleared);
      if (cleared > best) {
        best = cleared;
        storage.set("bestFloor", best);
      }
      banner = "FLOOR CLEARED!";
      timer = 1.2;
      audio.win();
      updateStatus();
      return true;
    }
    if (!alliesAlive) {
      phase = "defeat";
      banner = "DEFEATED";
      timer = 1.6;
      audio.lose();
      return true;
    }
    return false;
  };

  const doNextAction = () => {
    while (turnIdx < order.length && !order[turnIdx].alive) turnIdx++;
    if (turnIdx >= order.length) {
      startRound();
      return;
    }
    const actor = order[turnIdx];
    turnIdx++;
    takeTurn(actor);
    actTimer = ACT_DELAY;
    checkEnd();
  };

  const genEnemies = (f: number): Monster[] => {
    const boss = f % 5 === 0;
    const lvl = 1 + Math.floor((f - 1) * 0.7);
    const list: Monster[] = [];
    if (boss) {
      const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)];
      const m = makeMonster(sp, lvl + 3, "enemy");
      m.maxHp = Math.round(m.maxHp * 1.8);
      m.hp = m.maxHp;
      m.atk = Math.round(m.atk * 1.3);
      m.battleAtk = m.atk;
      list.push(m);
    } else {
      const count = f <= 1 ? 1 : f <= 3 ? 2 : 3;
      for (let i = 0; i < count; i++) {
        const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)];
        const m = makeMonster(sp, lvl, "enemy");
        const scale = 1 + f * 0.05;
        m.maxHp = Math.round(m.maxHp * scale);
        m.hp = m.maxHp;
        list.push(m);
      }
    }
    return list;
  };

  const startBattle = (f: number) => {
    floor = f;
    enemies = genEnemies(f);
    for (const m of team) {
      m.rallied = false;
      m.burn = 0;
      m.battleAtk = m.atk;
      m.lunge = 0;
      m.hitFlash = 0;
    }
    floats = [];
    phase = "intro";
    timer = 0.85;
    banner = `FLOOR ${f}`;
    mode = "battle";
    updateStatus();
  };

  // ----------------------------------------------------------------- rewards
  const openRewards = () => {
    nextFloor = floor + 1;
    const avg = Math.max(
      1,
      Math.round(team.reduce((s, m) => s + m.level, 0) / Math.max(1, team.length)),
    );
    const pool: Reward[] = [];
    if (team.length < 3) {
      const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)];
      pool.push({ kind: "recruit", sp, level: avg });
    }
    const others: Reward[] = [
      { kind: "levelup" },
      { kind: "heal" },
      { kind: "item", stat: "hp", amount: 10 + floor * 3 },
      { kind: "item", stat: "atk", amount: 3 + floor },
      { kind: "item", stat: "spd", amount: 2 + Math.floor(floor / 2) },
    ];
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    while (pool.length < 3 && others.length) pool.push(others.shift() as Reward);
    rewards = pool;
    mode = "reward";
  };

  const applyToTarget = (mon: Monster, r: Reward) => {
    if (r.kind === "levelup") {
      mon.level++;
      const sp = mon.species;
      const newMax = maxHpFor(sp, mon.level);
      mon.hp += newMax - mon.maxHp;
      mon.maxHp = newMax;
      mon.atk = atkFor(sp, mon.level);
      mon.spd = spdFor(sp, mon.level);
      audio.win();
    } else if (r.kind === "item") {
      if (r.stat === "hp") {
        mon.maxHp += r.amount;
        mon.hp += r.amount;
      } else if (r.stat === "atk") mon.atk += r.amount;
      else mon.spd += r.amount;
      audio.coin();
    }
  };

  const chooseReward = (r: Reward) => {
    if (r.kind === "recruit") {
      team.push(makeMonster(r.sp, r.level, "ally"));
      if (!unlocked.includes(r.sp.key)) {
        unlocked.push(r.sp.key);
        storage.set("unlocked", unlocked);
      }
      audio.coin();
      startBattle(nextFloor);
    } else if (r.kind === "heal") {
      for (const m of team) {
        m.hp = m.maxHp;
        m.burn = 0;
      }
      audio.coin();
      startBattle(nextFloor);
    } else {
      pendingReward = r;
      mode = "target";
    }
  };

  // ----------------------------------------------------------------- run init
  const startRun = () => {
    team = selected.map((k) => makeMonster(speciesByKey(k), 1, "ally"));
    if (team.length === 0) return;
    cleared = 0;
    ctx.reportScore(0);
    startBattle(1);
  };

  // ----------------------------------------------------------------- layouts
  const layoutTeam = () => {
    const w = W();
    const h = H();
    const slotsY = h * 0.16;
    const slotSize = Math.min(w * 0.2, h * 0.13);
    const slots: Rect[] = [];
    const gap = slotSize * 0.4;
    const totalW = slotSize * 3 + gap * 2;
    const sx = w / 2 - totalW / 2;
    for (let i = 0; i < 3; i++)
      slots.push({ x: sx + i * (slotSize + gap), y: slotsY, w: slotSize, h: slotSize });

    const cols = w < h ? 2 : 4;
    const gridTop = slotsY + slotSize + h * 0.06;
    const gridBottom = h * 0.86;
    const gridH = gridBottom - gridTop;
    const cardGap = Math.min(w, h) * 0.025;
    const rows = Math.ceil(SPECIES.length / cols);
    const cardW = (w * 0.92 - cardGap * (cols - 1)) / cols;
    const cardH = Math.min((gridH - cardGap * (rows - 1)) / rows, cardW * 1.1);
    const gx = (w - (cardW * cols + cardGap * (cols - 1))) / 2;
    const cards: { rect: Rect; key: string }[] = [];
    SPECIES.forEach((sp, i) => {
      const cr = Math.floor(i / cols);
      const cc = i % cols;
      cards.push({
        rect: {
          x: gx + cc * (cardW + cardGap),
          y: gridTop + cr * (cardH + cardGap),
          w: cardW,
          h: cardH,
        },
        key: sp.key,
      });
    });

    const btnW = Math.min(w * 0.6, 280);
    const btnH = h * 0.08;
    const start: Rect = { x: w / 2 - btnW / 2, y: h * 0.9, w: btnW, h: btnH };
    return { slots, cards, start, slotSize };
  };

  const layoutRewards = (): Rect[] => {
    const w = W();
    const h = H();
    const n = rewards.length;
    const cardW = Math.min(w * 0.82, 260);
    const cardH = Math.min(h * 0.2, 120);
    const gap = h * 0.03;
    const totalH = cardH * n + gap * (n - 1);
    const top = h / 2 - totalH / 2 + h * 0.04;
    const out: Rect[] = [];
    for (let i = 0; i < n; i++)
      out.push({ x: w / 2 - cardW / 2, y: top + i * (cardH + gap), w: cardW, h: cardH });
    return out;
  };

  const layoutTargets = (): Rect[] => {
    const w = W();
    const h = H();
    const n = team.length;
    const cardW = Math.min((w * 0.9 - (n - 1) * w * 0.03) / n, w * 0.42);
    const cardH = Math.min(h * 0.34, cardW * 1.3);
    const gap = w * 0.03;
    const totalW = cardW * n + gap * (n - 1);
    const sx = w / 2 - totalW / 2;
    const out: Rect[] = [];
    for (let i = 0; i < n; i++)
      out.push({ x: sx + i * (cardW + gap), y: h * 0.42, w: cardW, h: cardH });
    return out;
  };

  // ----------------------------------------------------------------- updates
  const updateTeam = () => {
    const { cards, start } = layoutTeam();
    for (const c of cards) {
      if (tapped(c.rect)) {
        const idx = selected.indexOf(c.key);
        if (idx >= 0) selected.splice(idx, 1);
        else if (selected.length < 3) selected.push(c.key);
        audio.blip();
      }
    }
    const canStart = selected.length > 0;
    if (canStart && (tapped(start) || input.pressed("Space", "Enter"))) startRun();
  };

  const updateBattle = (dt: number) => {
    for (const m of [...team, ...enemies]) {
      if (m.lunge > 0) m.lunge = Math.max(0, m.lunge - dt * 3.2);
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt * 4);
      m.phase += dt;
    }
    for (const f of floats) {
      f.t -= dt / 0.9;
      f.y += f.vy * dt;
    }
    floats = floats.filter((f) => f.t > 0);

    if (phase === "intro") {
      timer -= dt;
      if (timer <= 0) {
        startRound();
        phase = "fight";
        actTimer = 0.25;
      }
      return;
    }
    if (phase === "fight") {
      const fast = input.pointer.down || input.isDown("Space");
      actTimer -= dt * (fast ? 2.4 : 1);
      if (actTimer <= 0) doNextAction();
      return;
    }
    if (phase === "victory") {
      timer -= dt;
      if (timer <= 0) openRewards();
      return;
    }
    // defeat
    timer -= dt;
    if (timer <= 0 && !ended) {
      ended = true;
      ctx.gameOver(cleared);
    }
  };

  const updateReward = () => {
    const rects = layoutRewards();
    for (let i = 0; i < rewards.length; i++) {
      if (tapped(rects[i]) || input.pressed(String(i + 1))) {
        chooseReward(rewards[i]);
        return;
      }
    }
  };

  const updateTarget = () => {
    if (!pendingReward) {
      mode = "reward";
      return;
    }
    const rects = layoutTargets();
    for (let i = 0; i < team.length; i++) {
      if (tapped(rects[i]) || input.pressed(String(i + 1))) {
        applyToTarget(team[i], pendingReward);
        pendingReward = null;
        startBattle(nextFloor);
        return;
      }
    }
  };

  // ----------------------------------------------------------------- drawing
  const c = ctx.ctx;

  const drawBackground = () => {
    const w = W();
    const h = H();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#141d35");
    g.addColorStop(1, BG);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };

  const hpBar = (m: Monster, w: number) => {
    const bh = Math.max(4, m.size * 0.16);
    const x = m.x - w / 2;
    const y = m.y - m.size * 1.55;
    c.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(c, x, y, w, bh, bh / 2);
    c.fill();
    const frac = clamp(m.hp / m.maxHp, 0, 1);
    c.fillStyle = frac > 0.5 ? "#4be08a" : frac > 0.25 ? "#ffd23a" : "#ff5b6e";
    roundRect(c, x, y, Math.max(0, w * frac), bh, bh / 2);
    c.fill();
  };

  const drawMonster = (m: Monster) => {
    const facing = m.side === "ally" ? 1 : -1;
    const s = Math.sin((1 - m.lunge) * Math.PI);
    const len = Math.hypot(m.lungeTx, m.lungeTy) || 1;
    const ox = (m.lungeTx / len) * m.size * 0.9 * s;
    const oy = (m.lungeTy / len) * m.size * 0.9 * s;
    const bob = Math.sin(m.phase * 2) * m.size * 0.05;
    const cx = m.x + ox;
    const cy = m.y + oy + bob;
    c.save();
    if (!m.alive) c.globalAlpha = 0.25;
    drawCreature(c, m, cx, cy, m.size, facing);
    c.restore();
    if (m.alive) {
      hpBar(m, m.size * 2.1);
      drawText(
        c,
        `${m.species.name} L${m.level}`,
        m.x,
        m.y + m.size * 1.5,
        Math.max(9, m.size * 0.32),
        "#dfe7ff",
      );
      if (m.burn > 0)
        drawText(c, "BURN", m.x, m.y - m.size * 1.85, Math.max(8, m.size * 0.28), "#ff9a3d");
    }
  };

  const placeRow = (arr: Monster[], y: number) => {
    const w = W();
    const n = arr.length;
    const span = Math.min(w * 0.84, w * 0.26 * n + w * 0.1);
    const gap = n > 1 ? span / (n - 1) : 0;
    const startX = n > 1 ? w / 2 - span / 2 : w / 2;
    const size = clamp(Math.min(W(), H()) * 0.085, 16, H() * 0.11);
    arr.forEach((m, i) => {
      m.x = n > 1 ? startX + i * gap : startX;
      m.y = y;
      m.size = size;
    });
  };

  const renderBattle = () => {
    const w = W();
    const h = H();
    placeRow(enemies, h * 0.3);
    placeRow(team, h * 0.66);

    drawText(c, `FLOOR ${floor}`, w / 2, h * 0.06, Math.min(w, h) * 0.06, "#ffd23a");
    drawText(
      c,
      "hold / Space to speed up",
      w / 2,
      h * 0.11,
      Math.min(w, h) * 0.03,
      "rgba(255,255,255,0.45)",
    );

    for (const m of enemies) drawMonster(m);
    for (const m of team) drawMonster(m);

    for (const f of floats) {
      c.globalAlpha = clamp(f.t, 0, 1);
      drawText(
        c,
        f.text,
        f.x,
        f.y,
        (f.big ? 0.06 : 0.045) * Math.min(w, h) + (f.big ? 4 : 0),
        f.color,
      );
      c.globalAlpha = 1;
    }

    if (phase === "intro" || phase === "victory" || phase === "defeat") {
      c.fillStyle = "rgba(8,12,22,0.55)";
      c.fillRect(0, h * 0.4, w, h * 0.2);
      const col =
        phase === "victory" ? "#4be08a" : phase === "defeat" ? "#ff5b6e" : "#ffd23a";
      drawText(c, banner, w / 2, h * 0.5, Math.min(w, h) * 0.09, col);
    }
  };

  const drawMiniCreature = (sp: Species, cx: number, cy: number, r: number) => {
    const prev = previews.get(sp.key);
    if (prev) {
      prev.size = r;
      drawCreature(c, prev, cx, cy, r, 1);
    }
  };

  const renderTeam = () => {
    const w = W();
    const h = H();
    const { slots, cards, start, slotSize } = layoutTeam();

    drawText(c, "BEAST BRAWL", w / 2, h * 0.06, Math.min(w, h) * 0.085, "#ffd23a");
    drawText(
      c,
      `Build a team of up to 3  -  Best floor ${best}`,
      w / 2,
      h * 0.115,
      Math.min(w, h) * 0.034,
      "#9fb0e0",
    );

    slots.forEach((r, i) => {
      c.fillStyle = "rgba(255,255,255,0.05)";
      roundRect(c, r.x, r.y, r.w, r.h, 12);
      c.fill();
      c.strokeStyle = "rgba(255,255,255,0.18)";
      c.lineWidth = 2;
      roundRect(c, r.x, r.y, r.w, r.h, 12);
      c.stroke();
      const key = selected[i];
      if (key) {
        drawMiniCreature(speciesByKey(key), r.x + r.w / 2, r.y + r.h * 0.46, slotSize * 0.3);
      } else {
        drawText(c, "+", r.x + r.w / 2, r.y + r.h / 2, slotSize * 0.4, "rgba(255,255,255,0.3)");
      }
    });

    for (const card of cards) {
      const sp = speciesByKey(card.key);
      const r = card.rect;
      const sel = selected.includes(card.key);
      c.fillStyle = sel ? "rgba(255,210,58,0.16)" : "rgba(255,255,255,0.05)";
      roundRect(c, r.x, r.y, r.w, r.h, 12);
      c.fill();
      c.strokeStyle = sel ? "#ffd23a" : "rgba(255,255,255,0.12)";
      c.lineWidth = sel ? 3 : 1.5;
      roundRect(c, r.x, r.y, r.w, r.h, 12);
      c.stroke();
      const cr = Math.min(r.w, r.h) * 0.2;
      drawMiniCreature(sp, r.x + r.w * 0.26, r.y + r.h * 0.4, cr);
      const tx = r.x + r.w * 0.5;
      const fs = r.h * 0.13;
      drawText(c, sp.name, tx, r.y + r.h * 0.18, fs, "#fff", "left");
      drawText(
        c,
        `HP ${maxHpFor(sp, 1)}`,
        tx,
        r.y + r.h * 0.38,
        fs * 0.82,
        "#9fb0e0",
        "left",
      );
      drawText(
        c,
        `ATK ${atkFor(sp, 1)}  SPD ${spdFor(sp, 1)}`,
        tx,
        r.y + r.h * 0.55,
        fs * 0.82,
        "#9fb0e0",
        "left",
      );
      drawText(c, SKILLS[sp.skill].name, tx, r.y + r.h * 0.74, fs * 0.82, sp.color, "left");
    }

    const canStart = selected.length > 0;
    c.fillStyle = canStart ? "#ffd23a" : "rgba(255,255,255,0.12)";
    roundRect(c, start.x, start.y, start.w, start.h, start.h / 2);
    c.fill();
    drawText(
      c,
      canStart ? "START RUN" : "PICK A MONSTER",
      start.x + start.w / 2,
      start.y + start.h / 2,
      start.h * 0.42,
      canStart ? "#1a1300" : "rgba(255,255,255,0.5)",
    );
  };

  const rewardLabel = (r: Reward): { title: string; sub: string; color: string } => {
    switch (r.kind) {
      case "recruit":
        return {
          title: `Recruit ${r.sp.name}`,
          sub: `Lv ${r.level} - ${SKILLS[r.sp.skill].name}`,
          color: r.sp.color,
        };
      case "levelup":
        return { title: "Level Up", sub: "Pick a monster to level up", color: "#4be08a" };
      case "heal":
        return { title: "Full Heal", sub: "Restore the whole team", color: "#5dff9a" };
      case "item":
        return {
          title:
            r.stat === "hp"
              ? `+${r.amount} Max HP`
              : r.stat === "atk"
                ? `+${r.amount} ATK`
                : `+${r.amount} SPD`,
          sub: "Pick a monster",
          color: "#7fc4ff",
        };
    }
  };

  const renderReward = () => {
    const w = W();
    const h = H();
    drawText(c, "VICTORY!", w / 2, h * 0.12, Math.min(w, h) * 0.08, "#4be08a");
    drawText(
      c,
      "Choose a reward",
      w / 2,
      h * 0.18,
      Math.min(w, h) * 0.04,
      "#9fb0e0",
    );
    const rects = layoutRewards();
    rewards.forEach((r, i) => {
      const rc = rects[i];
      const info = rewardLabel(r);
      c.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(c, rc.x, rc.y, rc.w, rc.h, 14);
      c.fill();
      c.strokeStyle = info.color;
      c.lineWidth = 2.5;
      roundRect(c, rc.x, rc.y, rc.w, rc.h, 14);
      c.stroke();
      if (r.kind === "recruit")
        drawMiniCreature(r.sp, rc.x + rc.w * 0.16, rc.y + rc.h / 2, rc.h * 0.28);
      const tx = r.kind === "recruit" ? rc.x + rc.w * 0.34 : rc.x + rc.w * 0.5;
      const al: CanvasTextAlign = r.kind === "recruit" ? "left" : "center";
      drawText(c, `${i + 1}. ${info.title}`, tx, rc.y + rc.h * 0.4, rc.h * 0.2, "#fff", al);
      drawText(c, info.sub, tx, rc.y + rc.h * 0.66, rc.h * 0.15, "#9fb0e0", al);
    });
  };

  const renderTarget = () => {
    const w = W();
    const h = H();
    if (!pendingReward) return;
    const info = rewardLabel(pendingReward);
    drawText(c, info.title, w / 2, h * 0.16, Math.min(w, h) * 0.06, info.color);
    drawText(c, "Tap a monster", w / 2, h * 0.24, Math.min(w, h) * 0.04, "#9fb0e0");
    const rects = layoutTargets();
    team.forEach((m, i) => {
      const rc = rects[i];
      c.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(c, rc.x, rc.y, rc.w, rc.h, 14);
      c.fill();
      c.strokeStyle = m.species.color;
      c.lineWidth = 2.5;
      roundRect(c, rc.x, rc.y, rc.w, rc.h, 14);
      c.stroke();
      m.size = rc.w * 0.22;
      drawCreature(c, m, rc.x + rc.w / 2, rc.y + rc.h * 0.34, m.size, 1);
      drawText(
        c,
        `${i + 1}. ${m.species.name}`,
        rc.x + rc.w / 2,
        rc.y + rc.h * 0.66,
        rc.h * 0.1,
        "#fff",
      );
      drawText(
        c,
        `L${m.level} HP ${m.hp}/${m.maxHp}`,
        rc.x + rc.w / 2,
        rc.y + rc.h * 0.78,
        rc.h * 0.085,
        "#9fb0e0",
      );
      drawText(
        c,
        `ATK ${m.atk} SPD ${m.spd}`,
        rc.x + rc.w / 2,
        rc.y + rc.h * 0.9,
        rc.h * 0.085,
        "#9fb0e0",
      );
    });
  };

  return {
    update(dt) {
      const d = Math.min(dt, 0.05);
      if (mode === "team") updateTeam();
      else if (mode === "battle") updateBattle(d);
      else if (mode === "reward") updateReward();
      else updateTarget();
    },
    render() {
      drawBackground();
      if (mode === "team") renderTeam();
      else if (mode === "battle") renderBattle();
      else if (mode === "reward") renderReward();
      else renderTarget();
    },
  };
}
