/**
 * Data-driven content for Nightfall Survivors: enemy, weapon (incl. evolutions)
 * and passive definitions. These only touch the `World` contract from types.ts,
 * so they stay decoupled from the main game implementation.
 */
import type {
  EnemyDef,
  PassiveDef,
  Stats,
  WeaponDef,
  WeaponState,
  World,
  Enemy,
} from "./types";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function slotOf(w: WeaponState): number {
  return w.data.slot ?? 0;
}

/** Roll final damage including damage mult + crit. */
function roll(world: World, base: number): { dmg: number; crit: boolean } {
  const s = world.player.stats;
  let dmg = base * s.damageMult;
  const crit = world.rand(0, 1) < s.critChance;
  if (crit) dmg *= s.critMult;
  return { dmg, crit };
}

function fireFrom(
  world: World,
  px: number,
  py: number,
  tx: number,
  ty: number,
): { nx: number; ny: number } {
  const dx = tx - px;
  const dy = ty - py;
  const d = Math.hypot(dx, dy) || 1;
  return { nx: dx / d, ny: dy / d };
}

// ---------------------------------------------------------------------------
// WEAPONS
// ---------------------------------------------------------------------------

// ---- Moon Shard --------------------------------------------------------
const moonShard: WeaponDef = {
  id: "shard",
  name: "Moon Shard",
  color: "#9fd2ff",
  maxLevel: 8,
  short: "Piercing bolt at nearest foe",
  describe: (lv) => {
    if (lv === 1) return "Fire a piercing shard at the nearest enemy.";
    if (lv === 3 || lv === 5 || lv === 7) return "+1 projectile, +damage.";
    return "+damage, +pierce.";
  },
  evolution: { into: "starstorm", requires: "velocity", name: "Star Storm" },
  icon: (c, x, y, s, color) => {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x, y - s * 0.4);
    c.lineTo(x + s * 0.16, y);
    c.lineTo(x, y + s * 0.4);
    c.lineTo(x - s * 0.16, y);
    c.closePath();
    c.fill();
  },
  update(world, w, dt) {
    w.timer -= dt;
    if (w.timer > 0) return;
    const s = world.player.stats;
    const cd = Math.max(0.42, 1.1 - (w.level - 1) * 0.07) * s.cooldownMult;
    w.timer = cd;
    const p = world.player;
    const target = world.nearestEnemy(p.x, p.y, 720);
    const aimX = target ? target.x : p.x + p.facingX * 100;
    const aimY = target ? target.y : p.y + p.facingY * 100;
    const base = 10 + (w.level - 1) * 5;
    const count = 1 + Math.floor((w.level - 1) / 2) + s.projCountBonus;
    const pierce = 1 + Math.floor(w.level / 3);
    const speed = 430 * s.projSpeedMult;
    const { nx, ny } = fireFrom(world, p.x, p.y, aimX, aimY);
    const baseAng = Math.atan2(ny, nx);
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 0.14;
      const a = baseAng + spread;
      world.spawnProjectile({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: 7,
        damage: base,
        pierce,
        life: 1.5,
        color: "#bfe3ff",
        kind: "shard",
        spin: a,
      });
    }
    world.audioTick(880, 0.05, 0.18);
  },
};

// ---- Star Storm (evolution of Moon Shard) ------------------------------
const starStorm: WeaponDef = {
  id: "starstorm",
  name: "Star Storm",
  color: "#ffe9a8",
  maxLevel: 8,
  short: "Storm of piercing stars",
  evolved: true,
  describe: () => "A relentless fan of fast piercing stars.",
  icon: (c, x, y, s, color) => {
    c.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      const r = i % 2 === 0 ? s * 0.42 : s * 0.18;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) c.beginPath(), c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
  },
  update(world, w, dt) {
    w.timer -= dt;
    if (w.timer > 0) return;
    const s = world.player.stats;
    w.timer = 0.42 * s.cooldownMult;
    const p = world.player;
    const target = world.nearestEnemy(p.x, p.y, 900);
    const aimX = target ? target.x : p.x + p.facingX * 100;
    const aimY = target ? target.y : p.y + p.facingY * 100;
    const base = 16 + (w.level - 1) * 7;
    const count = 3 + Math.floor(w.level / 2) + s.projCountBonus;
    const speed = 620 * s.projSpeedMult;
    const { nx, ny } = fireFrom(world, p.x, p.y, aimX, aimY);
    const baseAng = Math.atan2(ny, nx);
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 0.16;
      const a = baseAng + spread;
      world.spawnProjectile({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: 9,
        damage: base,
        pierce: 4 + w.level,
        life: 1.6,
        color: "#ffe9a8",
        kind: "star",
        spin: a,
      });
    }
    world.audioTick(1040, 0.05, 0.16);
  },
};

// ---- Orbit Blades ------------------------------------------------------
function bladeStats(w: WeaponState, s: Stats) {
  const count = 2 + Math.floor((w.level - 1) / 2);
  const damage = 8 + (w.level - 1) * 4;
  const radius = (70 + (w.level - 1) * 6) * s.areaMult;
  const rot = 2.2 + w.level * 0.15;
  const hitInterval = Math.max(0.18, 0.45 - w.level * 0.02);
  const bladeR = 16 + w.level * 1.5;
  return { count, damage, radius, rot, hitInterval, bladeR };
}

const orbitBlades: WeaponDef = {
  id: "blades",
  name: "Orbit Blades",
  color: "#c7b6ff",
  maxLevel: 8,
  short: "Blades circle and slash",
  describe: (lv) =>
    lv % 2 === 0 ? "+1 blade, +damage." : "+damage, +radius & speed.",
  evolution: { into: "cyclone", requires: "might", name: "Cyclone" },
  icon: (c, x, y, s, color) => {
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.5, s * 0.08);
    c.beginPath();
    c.arc(x, y, s * 0.32, 0, TAU);
    c.stroke();
    c.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      c.beginPath();
      c.arc(x + Math.cos(a) * s * 0.32, y + Math.sin(a) * s * 0.32, s * 0.1, 0, TAU);
      c.fill();
    }
  },
  update(world, w, dt) {
    const s = world.player.stats;
    const st = bladeStats(w, s);
    w.angle += st.rot * dt;
    w.data.radius = st.radius;
    w.data.count = st.count;
    w.data.bladeR = st.bladeR;
    const slot = slotOf(w);
    const p = world.player;
    for (let i = 0; i < st.count; i++) {
      const a = w.angle + (i / st.count) * TAU;
      const bx = p.x + Math.cos(a) * st.radius;
      const by = p.y + Math.sin(a) * st.radius;
      world.forEachEnemyInRadius(bx, by, st.bladeR, (e) => {
        if (e.hitTimers[slot] > 0) return;
        e.hitTimers[slot] = st.hitInterval;
        const { dmg, crit } = roll(world, st.damage);
        world.damageEnemy(e, dmg, {
          crit,
          knockback: 70,
          dirX: e.x - p.x,
          dirY: e.y - p.y,
        });
      });
    }
  },
  render(world, w, c) {
    const p = world.player;
    const radius = w.data.radius ?? 70;
    const count = w.data.count ?? 2;
    const bladeR = w.data.bladeR ?? 16;
    for (let i = 0; i < count; i++) {
      const a = w.angle + (i / count) * TAU;
      const bx = p.x + Math.cos(a) * radius;
      const by = p.y + Math.sin(a) * radius;
      c.save();
      c.translate(bx, by);
      c.rotate(a + world.time * 6);
      c.fillStyle = "#e7deff";
      c.strokeStyle = "#7a63c7";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -bladeR);
      c.lineTo(bladeR * 0.5, 0);
      c.lineTo(0, bladeR);
      c.lineTo(-bladeR * 0.5, 0);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
  },
};

// ---- Cyclone (evolution of Orbit Blades) -------------------------------
const cyclone: WeaponDef = {
  id: "cyclone",
  name: "Cyclone",
  color: "#d8c7ff",
  maxLevel: 8,
  short: "A vortex of greatblades",
  evolved: true,
  describe: () => "More, larger blades that pull enemies in.",
  icon: orbitBlades.icon,
  update(world, w, dt) {
    const s = world.player.stats;
    const count = 4 + Math.floor(w.level / 2);
    const damage = 16 + (w.level - 1) * 6;
    const radius = (96 + (w.level - 1) * 7) * s.areaMult;
    const bladeR = 24 + w.level * 2;
    const hitInterval = Math.max(0.12, 0.3 - w.level * 0.015);
    w.angle += (3 + w.level * 0.15) * dt;
    w.data.radius = radius;
    w.data.count = count;
    w.data.bladeR = bladeR;
    const slot = slotOf(w);
    const p = world.player;
    // vortex pull
    world.forEachEnemyInRadius(p.x, p.y, radius * 1.4, (e) => {
      if (e.boss) return;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.knockX += (dx / d) * 30 * dt * 60;
      e.knockY += (dy / d) * 30 * dt * 60;
    });
    for (let i = 0; i < count; i++) {
      const a = w.angle + (i / count) * TAU;
      const bx = p.x + Math.cos(a) * radius;
      const by = p.y + Math.sin(a) * radius;
      world.forEachEnemyInRadius(bx, by, bladeR, (e) => {
        if (e.hitTimers[slot] > 0) return;
        e.hitTimers[slot] = hitInterval;
        const { dmg, crit } = roll(world, damage);
        world.damageEnemy(e, dmg, { crit, knockback: 50 });
      });
    }
  },
  render(world, w, c) {
    const p = world.player;
    const radius = w.data.radius ?? 96;
    const count = w.data.count ?? 4;
    const bladeR = w.data.bladeR ?? 24;
    c.save();
    c.globalAlpha = 0.12;
    c.fillStyle = "#b9a3ff";
    c.beginPath();
    c.arc(p.x, p.y, radius, 0, TAU);
    c.fill();
    c.restore();
    for (let i = 0; i < count; i++) {
      const a = w.angle + (i / count) * TAU;
      const bx = p.x + Math.cos(a) * radius;
      const by = p.y + Math.sin(a) * radius;
      c.save();
      c.translate(bx, by);
      c.rotate(a + world.time * 9);
      c.fillStyle = "#f0e9ff";
      c.strokeStyle = "#8a6fe0";
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(0, -bladeR);
      c.lineTo(bladeR * 0.55, 0);
      c.lineTo(0, bladeR);
      c.lineTo(-bladeR * 0.55, 0);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
  },
};

// ---- Pulse Aura --------------------------------------------------------
const pulseAura: WeaponDef = {
  id: "aura",
  name: "Pulse Aura",
  color: "#7affc4",
  maxLevel: 8,
  short: "Damaging field around you",
  describe: (lv) => (lv % 2 === 0 ? "+radius, +damage." : "+damage, faster ticks."),
  evolution: { into: "supernova", requires: "resonance", name: "Supernova" },
  icon: (c, x, y, s, color) => {
    c.strokeStyle = color;
    c.globalAlpha = 0.9;
    c.lineWidth = Math.max(1.5, s * 0.07);
    c.beginPath();
    c.arc(x, y, s * 0.36, 0, TAU);
    c.stroke();
    c.globalAlpha = 0.4;
    c.beginPath();
    c.arc(x, y, s * 0.2, 0, TAU);
    c.stroke();
    c.globalAlpha = 1;
  },
  update(world, w, dt) {
    const s = world.player.stats;
    const radius = (78 + (w.level - 1) * 9) * s.areaMult;
    w.data.radius = radius;
    w.data.pulse = (w.data.pulse ?? 0) + dt;
    w.timer -= dt;
    if (w.timer > 0) return;
    const tick = Math.max(0.25, 0.6 - w.level * 0.03) * s.cooldownMult;
    w.timer = tick;
    const damage = 6 + (w.level - 1) * 3;
    const p = world.player;
    world.forEachEnemyInRadius(p.x, p.y, radius, (e) => {
      const { dmg, crit } = roll(world, damage);
      world.damageEnemy(e, dmg, { crit });
    });
    world.addParticle({
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      life: 0.4,
      maxLife: 0.4,
      size: radius,
      color: "rgba(122,255,196,0.35)",
      shape: 2,
    });
  },
  render(world, w, c) {
    const p = world.player;
    const radius = w.data.radius ?? 78;
    const pulse = 1 + Math.sin((w.data.pulse ?? 0) * 4) * 0.03;
    const g = c.createRadialGradient(p.x, p.y, radius * 0.2, p.x, p.y, radius * pulse);
    g.addColorStop(0, "rgba(122,255,196,0.05)");
    g.addColorStop(0.7, "rgba(122,255,196,0.10)");
    g.addColorStop(1, "rgba(122,255,196,0.0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(p.x, p.y, radius * pulse, 0, TAU);
    c.fill();
  },
};

// ---- Supernova (evolution of Pulse Aura) -------------------------------
const supernova: WeaponDef = {
  id: "supernova",
  name: "Supernova",
  color: "#9bffd8",
  maxLevel: 8,
  short: "Aura with shockwave rings",
  evolved: true,
  describe: () => "A vast aura that erupts in damaging rings.",
  icon: pulseAura.icon,
  update(world, w, dt) {
    const s = world.player.stats;
    const radius = (120 + (w.level - 1) * 11) * s.areaMult;
    w.data.radius = radius;
    w.data.pulse = (w.data.pulse ?? 0) + dt;
    w.timer -= dt;
    if (w.timer > 0) return;
    w.timer = Math.max(0.18, 0.45 - w.level * 0.02) * s.cooldownMult;
    const damage = 12 + (w.level - 1) * 5;
    const p = world.player;
    world.forEachEnemyInRadius(p.x, p.y, radius, (e) => {
      const { dmg, crit } = roll(world, damage);
      world.damageEnemy(e, dmg, {
        crit,
        knockback: 40,
        dirX: e.x - p.x,
        dirY: e.y - p.y,
      });
    });
    world.addParticle({
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      life: 0.5,
      maxLife: 0.5,
      size: radius,
      color: "rgba(155,255,216,0.45)",
      shape: 2,
    });
    world.audioTick(330, 0.06, 0.12);
  },
  render(world, w, c) {
    const p = world.player;
    const radius = w.data.radius ?? 120;
    const g = c.createRadialGradient(p.x, p.y, radius * 0.15, p.x, p.y, radius);
    g.addColorStop(0, "rgba(155,255,216,0.06)");
    g.addColorStop(0.65, "rgba(120,220,255,0.12)");
    g.addColorStop(1, "rgba(155,255,216,0.0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(p.x, p.y, radius, 0, TAU);
    c.fill();
  },
};

// ---- Chain Spark -------------------------------------------------------
function doChain(
  world: World,
  damage: number,
  jumps: number,
  range: number,
  slowOnHit: number,
) {
  const p = world.player;
  let cur = world.nearestEnemy(p.x, p.y, 360);
  if (!cur) return;
  const hit: number[] = [];
  let fromX = p.x;
  let fromY = p.y;
  let dmg = damage;
  for (let j = 0; j < jumps && cur; j++) {
    hit.push(cur.id);
    world.addBeam(fromX, fromY, cur.x, cur.y, "#aee9ff", 3, 0.18);
    const r = roll(world, dmg);
    world.damageEnemy(cur, r.dmg, {
      crit: r.crit,
      slow: slowOnHit,
      slowTime: slowOnHit > 0 ? 0.8 : 0,
      color: "#aee9ff",
    });
    world.burst(cur.x, cur.y, 4, "#aee9ff", 120, 2);
    fromX = cur.x;
    fromY = cur.y;
    dmg *= 0.9;
    cur = world.nearestEnemy(fromX, fromY, range, hit);
  }
  world.audioTick(1400, 0.05, 0.12);
}

const chainSpark: WeaponDef = {
  id: "spark",
  name: "Chain Spark",
  color: "#aee9ff",
  maxLevel: 8,
  short: "Lightning that arcs between foes",
  describe: (lv) => (lv % 2 === 0 ? "+1 jump, +damage." : "+damage, +range."),
  evolution: { into: "tempest", requires: "haste", name: "Tempest" },
  icon: (c, x, y, s, color) => {
    c.strokeStyle = color;
    c.lineWidth = Math.max(2, s * 0.1);
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(x - s * 0.2, y - s * 0.4);
    c.lineTo(x + s * 0.05, y - s * 0.05);
    c.lineTo(x - s * 0.1, y + s * 0.05);
    c.lineTo(x + s * 0.2, y + s * 0.4);
    c.stroke();
  },
  update(world, w, dt) {
    w.timer -= dt;
    if (w.timer > 0) return;
    const s = world.player.stats;
    w.timer = Math.max(0.5, 1.6 - w.level * 0.12) * s.cooldownMult;
    const damage = 12 + (w.level - 1) * 5;
    const jumps = 3 + Math.floor(w.level / 2);
    const range = 200 + w.level * 12;
    doChain(world, damage, jumps, range, 0);
  },
};

// ---- Tempest (evolution of Chain Spark) --------------------------------
const tempest: WeaponDef = {
  id: "tempest",
  name: "Tempest",
  color: "#cdf3ff",
  maxLevel: 8,
  short: "Ceaseless storm of lightning",
  evolved: true,
  describe: () => "Near-instant chains that slow everything struck.",
  icon: chainSpark.icon,
  update(world, w, dt) {
    w.timer -= dt;
    if (w.timer > 0) return;
    const s = world.player.stats;
    w.timer = Math.max(0.18, 0.4 - w.level * 0.02) * s.cooldownMult;
    const damage = 18 + (w.level - 1) * 6;
    const jumps = 5 + w.level;
    const range = 240 + w.level * 14;
    doChain(world, damage, jumps, range, 0.4);
  },
};

// ---- Boomerang ---------------------------------------------------------
const boomerang: WeaponDef = {
  id: "boomerang",
  name: "Boomerang",
  color: "#ffb86b",
  maxLevel: 8,
  short: "Returns, hitting twice",
  describe: (lv) => (lv % 3 === 0 ? "+1 boomerang, +damage." : "+damage, +range."),
  icon: (c, x, y, s, color) => {
    c.strokeStyle = color;
    c.lineWidth = Math.max(2, s * 0.12);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(x - s * 0.3, y + s * 0.2);
    c.quadraticCurveTo(x, y - s * 0.4, x + s * 0.3, y + s * 0.2);
    c.stroke();
  },
  update(world, w, dt) {
    w.timer -= dt;
    if (w.timer > 0) return;
    const s = world.player.stats;
    w.timer = Math.max(0.8, 1.8 - w.level * 0.1) * s.cooldownMult;
    const damage = 14 + (w.level - 1) * 5;
    const count = 1 + Math.floor((w.level - 1) / 3) + s.projCountBonus;
    const speed = 360 * s.projSpeedMult;
    const range = 260 + w.level * 15;
    const p = world.player;
    const target = world.nearestEnemy(p.x, p.y, 600);
    let baseAng: number;
    if (target) baseAng = Math.atan2(target.y - p.y, target.x - p.x);
    else baseAng = Math.atan2(p.facingY, p.facingX);
    for (let i = 0; i < count; i++) {
      const a = baseAng + (i - (count - 1) / 2) * 0.4;
      world.spawnProjectile({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: 14,
        damage,
        pierce: 999,
        life: (range / speed) * 2.4,
        color: "#ffb86b",
        kind: "boomerang",
        spin: 0,
        knockback: 60,
        originX: p.x,
        originY: p.y,
      });
    }
    world.audioTick(520, 0.07, 0.14);
  },
};

// ---- Frost Shard -------------------------------------------------------
const frostShard: WeaponDef = {
  id: "frost",
  name: "Frost Shard",
  color: "#9fe7ff",
  maxLevel: 8,
  short: "Slows and shatters on hit",
  describe: (lv) => (lv % 3 === 0 ? "+1 shard, +slow." : "+damage, +slow."),
  icon: (c, x, y, s, color) => {
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.5, s * 0.08);
    c.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      c.beginPath();
      c.moveTo(x - Math.cos(a) * s * 0.4, y - Math.sin(a) * s * 0.4);
      c.lineTo(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4);
      c.stroke();
    }
  },
  update(world, w, dt) {
    w.timer -= dt;
    if (w.timer > 0) return;
    const s = world.player.stats;
    w.timer = Math.max(0.6, 1.5 - w.level * 0.09) * s.cooldownMult;
    const damage = 7 + (w.level - 1) * 3;
    const count = 1 + Math.floor((w.level - 1) / 3) + s.projCountBonus;
    const slow = Math.min(0.8, 0.45 + w.level * 0.03);
    const slowTime = (1.6 + w.level * 0.1) * s.durationMult;
    const speed = 360 * s.projSpeedMult;
    const p = world.player;
    const target = world.nearestEnemy(p.x, p.y, 700);
    const aimX = target ? target.x : p.x + p.facingX * 100;
    const aimY = target ? target.y : p.y + p.facingY * 100;
    const { nx, ny } = fireFrom(world, p.x, p.y, aimX, aimY);
    const baseAng = Math.atan2(ny, nx);
    for (let i = 0; i < count; i++) {
      const a = baseAng + (i - (count - 1) / 2) * 0.18;
      world.spawnProjectile({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: 8,
        damage,
        pierce: 1 + Math.floor(w.level / 4),
        life: 1.6,
        color: "#cdf3ff",
        kind: "frost",
        spin: a,
        area: 34 * s.areaMult,
        slowOnHit: slow,
        slowTime,
      });
    }
    world.audioTick(680, 0.06, 0.12);
  },
};

// ---- Ember Burst -------------------------------------------------------
const emberBurst: WeaponDef = {
  id: "ember",
  name: "Ember Burst",
  color: "#ff8a4c",
  maxLevel: 8,
  short: "Explodes on enemy clusters",
  describe: (lv) => (lv % 3 === 0 ? "+1 blast, +radius." : "+damage, +radius."),
  icon: (c, x, y, s, color) => {
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, s * 0.34, 0, TAU);
    c.fill();
    c.fillStyle = "#ffe08a";
    c.beginPath();
    c.arc(x, y, s * 0.16, 0, TAU);
    c.fill();
  },
  update(world, w, dt) {
    w.timer -= dt;
    if (w.timer > 0) return;
    const s = world.player.stats;
    w.timer = Math.max(1.0, 2.6 - w.level * 0.12) * s.cooldownMult;
    const damage = 22 + (w.level - 1) * 8;
    const radius = (70 + w.level * 6) * s.areaMult;
    const count = 1 + Math.floor((w.level - 1) / 3);
    const p = world.player;
    const used: number[] = [];
    for (let i = 0; i < count; i++) {
      let cx: number;
      let cy: number;
      const dense = world.densestPoint(p.x, p.y, 420);
      const t = world.nearestEnemy(p.x, p.y, 460, used);
      if (i === 0 && dense) {
        cx = dense.x;
        cy = dense.y;
      } else if (t) {
        used.push(t.id);
        cx = t.x;
        cy = t.y;
      } else {
        cx = p.x + world.rand(-200, 200);
        cy = p.y + world.rand(-200, 200);
      }
      // explosion
      world.forEachEnemyInRadius(cx, cy, radius, (e) => {
        const r = roll(world, damage);
        world.damageEnemy(e, r.dmg, {
          crit: r.crit,
          knockback: 120,
          dirX: e.x - cx,
          dirY: e.y - cy,
          color: "#ffb86b",
        });
      });
      world.addParticle({
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        life: 0.4,
        maxLife: 0.4,
        size: radius,
        color: "rgba(255,150,70,0.5)",
        shape: 2,
      });
      world.burst(cx, cy, 16, "#ff8a4c", 220, 3);
      world.burst(cx, cy, 8, "#ffe08a", 120, 2);
    }
    world.shake(5);
    world.audioNoise(0.22, 0.3);
  },
};

export const WEAPONS: Record<string, WeaponDef> = {
  shard: moonShard,
  starstorm: starStorm,
  blades: orbitBlades,
  cyclone,
  aura: pulseAura,
  supernova,
  spark: chainSpark,
  tempest,
  boomerang,
  frost: frostShard,
  ember: emberBurst,
};

/** Weapons offerable as brand-new picks (not evolution-only). */
export const NEW_WEAPON_IDS = [
  "shard",
  "blades",
  "aura",
  "spark",
  "boomerang",
  "frost",
  "ember",
];

// ---------------------------------------------------------------------------
// PASSIVES
// ---------------------------------------------------------------------------

function pIcon(glyph: (c: CanvasRenderingContext2D, x: number, y: number, s: number) => void) {
  return (c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) => {
    c.fillStyle = color;
    c.strokeStyle = color;
    glyph(c, x, y, s);
  };
}

const might: PassiveDef = {
  id: "might",
  name: "Might",
  color: "#ff7a7a",
  maxLevel: 5,
  short: "+12% damage",
  describe: () => "+12% damage to all weapons.",
  icon: pIcon((c, x, y, s) => {
    c.beginPath();
    c.moveTo(x, y - s * 0.4);
    c.lineTo(x + s * 0.12, y - s * 0.1);
    c.lineTo(x + s * 0.35, y - s * 0.1);
    c.lineTo(x + s * 0.16, y + s * 0.1);
    c.lineTo(x + s * 0.24, y + s * 0.42);
    c.lineTo(x, y + s * 0.2);
    c.lineTo(x - s * 0.24, y + s * 0.42);
    c.lineTo(x - s * 0.16, y + s * 0.1);
    c.lineTo(x - s * 0.35, y - s * 0.1);
    c.lineTo(x - s * 0.12, y - s * 0.1);
    c.closePath();
    c.fill();
  }),
  apply: (s, lv) => {
    s.damageMult *= 1 + 0.12 * lv;
    s.critChance += 0.01 * lv;
  },
};

const haste: PassiveDef = {
  id: "haste",
  name: "Haste",
  color: "#ffe07a",
  maxLevel: 5,
  short: "-8% cooldown",
  describe: () => "-8% weapon cooldown.",
  icon: pIcon((c, x, y, s) => {
    c.lineWidth = Math.max(1.5, s * 0.08);
    c.beginPath();
    c.arc(x, y, s * 0.36, -0.4, TAU - 0.4);
    c.stroke();
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x, y - s * 0.28);
    c.moveTo(x, y);
    c.lineTo(x + s * 0.2, y + s * 0.05);
    c.stroke();
  }),
  apply: (s, lv) => {
    s.cooldownMult *= Math.pow(0.92, lv);
    if (s.cooldownMult < 0.4) s.cooldownMult = 0.4;
  },
};

const velocity: PassiveDef = {
  id: "velocity",
  name: "Velocity",
  color: "#7affd2",
  maxLevel: 5,
  short: "+14% projectile speed",
  describe: () => "+14% projectile speed, +4% area.",
  icon: pIcon((c, x, y, s) => {
    c.lineWidth = Math.max(1.5, s * 0.09);
    c.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(x - s * 0.35, y + i * s * 0.18);
      c.lineTo(x + s * 0.1 + i * 0.0, y + i * s * 0.18);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(x + s * 0.05, y - s * 0.18);
    c.lineTo(x + s * 0.35, y);
    c.lineTo(x + s * 0.05, y + s * 0.18);
    c.stroke();
  }),
  apply: (s, lv) => {
    s.projSpeedMult *= 1 + 0.14 * lv;
    s.areaMult *= 1 + 0.04 * lv;
  },
};

const resonance: PassiveDef = {
  id: "resonance",
  name: "Resonance",
  color: "#b07aff",
  maxLevel: 5,
  short: "+13% area",
  describe: () => "+13% area, +8% effect duration.",
  icon: pIcon((c, x, y, s) => {
    c.lineWidth = Math.max(1.5, s * 0.07);
    for (let i = 1; i <= 3; i++) {
      c.globalAlpha = 1 - i * 0.22;
      c.beginPath();
      c.arc(x, y, s * 0.12 * i, 0, TAU);
      c.stroke();
    }
    c.globalAlpha = 1;
  }),
  apply: (s, lv) => {
    s.areaMult *= 1 + 0.13 * lv;
    s.durationMult *= 1 + 0.08 * lv;
  },
};

const boots: PassiveDef = {
  id: "boots",
  name: "Swift Boots",
  color: "#7ac4ff",
  maxLevel: 5,
  short: "+9% move speed",
  describe: () => "+9% movement speed.",
  icon: pIcon((c, x, y, s) => {
    c.beginPath();
    c.moveTo(x - s * 0.3, y - s * 0.3);
    c.lineTo(x - s * 0.05, y - s * 0.3);
    c.lineTo(x - s * 0.05, y + s * 0.1);
    c.lineTo(x + s * 0.35, y + s * 0.1);
    c.lineTo(x + s * 0.35, y + s * 0.34);
    c.lineTo(x - s * 0.3, y + s * 0.34);
    c.closePath();
    c.fill();
  }),
  apply: (s, lv) => {
    s.moveMult *= 1 + 0.09 * lv;
  },
};

const vitality: PassiveDef = {
  id: "vitality",
  name: "Vitality",
  color: "#ff6a8c",
  maxLevel: 5,
  short: "+18% max HP",
  describe: () => "+18% max HP (and heal the gain).",
  icon: pIcon((c, x, y, s) => {
    c.beginPath();
    c.moveTo(x, y + s * 0.34);
    c.bezierCurveTo(x - s * 0.5, y - s * 0.05, x - s * 0.18, y - s * 0.38, x, y - s * 0.12);
    c.bezierCurveTo(x + s * 0.18, y - s * 0.38, x + s * 0.5, y - s * 0.05, x, y + s * 0.34);
    c.fill();
  }),
  apply: () => {
    /* handled specially in index (needs to heal) */
  },
};

const lodestone: PassiveDef = {
  id: "lodestone",
  name: "Lodestone",
  color: "#9affe0",
  maxLevel: 5,
  short: "+28% pickup range",
  describe: () => "+28% gem pickup radius.",
  icon: pIcon((c, x, y, s) => {
    c.lineWidth = Math.max(2, s * 0.16);
    c.beginPath();
    c.arc(x, y + s * 0.05, s * 0.3, Math.PI, TAU);
    c.stroke();
    c.beginPath();
    c.moveTo(x - s * 0.3, y + s * 0.05);
    c.lineTo(x - s * 0.3, y + s * 0.3);
    c.moveTo(x + s * 0.3, y + s * 0.05);
    c.lineTo(x + s * 0.3, y + s * 0.3);
    c.stroke();
  }),
  apply: (s, lv) => {
    s.magnet *= 1 + 0.28 * lv;
  },
};

const wisdom: PassiveDef = {
  id: "wisdom",
  name: "Wisdom",
  color: "#c0ff7a",
  maxLevel: 5,
  short: "+12% XP gain",
  describe: () => "+12% XP from gems.",
  icon: pIcon((c, x, y, s) => {
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      const r = i % 2 === 0 ? s * 0.4 : s * 0.18;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
      const a2 = ((i + 0.5) / 5) * TAU - Math.PI / 2;
      c.lineTo(x + Math.cos(a2) * s * 0.18, y + Math.sin(a2) * s * 0.18);
    }
    c.closePath();
    c.fill();
  }),
  apply: (s, lv) => {
    s.xpMult *= 1 + 0.12 * lv;
  },
};

const regrowth: PassiveDef = {
  id: "regrowth",
  name: "Regrowth",
  color: "#7aff9a",
  maxLevel: 5,
  short: "+0.6 HP/s regen",
  describe: () => "Regenerate +0.6 HP per second.",
  icon: pIcon((c, x, y, s) => {
    c.beginPath();
    c.moveTo(x, y + s * 0.36);
    c.lineTo(x, y - s * 0.1);
    c.stroke();
    c.lineWidth = Math.max(1.5, s * 0.07);
    c.beginPath();
    c.ellipse(x - s * 0.15, y - s * 0.05, s * 0.16, s * 0.28, -0.6, 0, TAU);
    c.fill();
    c.beginPath();
    c.ellipse(x + s * 0.15, y - s * 0.2, s * 0.16, s * 0.28, 0.6, 0, TAU);
    c.fill();
  }),
  apply: (s, lv) => {
    s.regen += 0.6 * lv;
  },
};

const aegis: PassiveDef = {
  id: "aegis",
  name: "Aegis",
  color: "#9fb8ff",
  maxLevel: 5,
  short: "-7% damage taken",
  describe: () => "Take 7% less damage.",
  icon: pIcon((c, x, y, s) => {
    c.beginPath();
    c.moveTo(x, y - s * 0.4);
    c.lineTo(x + s * 0.36, y - s * 0.22);
    c.lineTo(x + s * 0.3, y + s * 0.18);
    c.lineTo(x, y + s * 0.42);
    c.lineTo(x - s * 0.3, y + s * 0.18);
    c.lineTo(x - s * 0.36, y - s * 0.22);
    c.closePath();
    c.fill();
  }),
  apply: (s, lv) => {
    s.armorMult *= Math.pow(0.93, lv);
  },
};

export const PASSIVES: Record<string, PassiveDef> = {
  might,
  haste,
  velocity,
  resonance,
  boots,
  vitality,
  lodestone,
  wisdom,
  regrowth,
  aegis,
};

export const PASSIVE_IDS = Object.keys(PASSIVES);

// ---------------------------------------------------------------------------
// ENEMIES
// ---------------------------------------------------------------------------

function eyeGlow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

const bat: EnemyDef = {
  id: "bat",
  name: "Bat",
  kind: "chase",
  hp: 8,
  speed: 96,
  radius: 11,
  damage: 6,
  xp: 1,
  color: "#6b4a8f",
  kbResist: 0,
  draw(c, e, t) {
    const flap = Math.sin(t * 16 + e.anim) * 0.5;
    c.fillStyle = "#3a2a52";
    c.beginPath();
    c.moveTo(e.x, e.y);
    c.lineTo(e.x - e.radius * 1.6, e.y - e.radius * (0.4 + flap));
    c.lineTo(e.x - e.radius * 0.6, e.y + e.radius * 0.3);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(e.x, e.y);
    c.lineTo(e.x + e.radius * 1.6, e.y - e.radius * (0.4 + flap));
    c.lineTo(e.x + e.radius * 0.6, e.y + e.radius * 0.3);
    c.closePath();
    c.fill();
    c.fillStyle = "#6b4a8f";
    c.beginPath();
    c.arc(e.x, e.y, e.radius, 0, TAU);
    c.fill();
    eyeGlow(c, e.x - 3, e.y - 2, 2, "#ff5d6c");
    eyeGlow(c, e.x + 3, e.y - 2, 2, "#ff5d6c");
  },
};

const husk: EnemyDef = {
  id: "husk",
  name: "Husk",
  kind: "chase",
  hp: 22,
  speed: 52,
  radius: 16,
  damage: 10,
  xp: 2,
  color: "#5a7d4f",
  kbResist: 0.1,
  draw(c, e, t) {
    const tilt = Math.sin(t * 4 + e.anim) * 0.12;
    c.save();
    c.translate(e.x, e.y);
    c.rotate(tilt);
    c.fillStyle = "#3d5736";
    c.beginPath();
    c.ellipse(0, e.radius * 0.2, e.radius * 0.9, e.radius * 1.05, 0, 0, TAU);
    c.fill();
    c.fillStyle = "#5a7d4f";
    c.beginPath();
    c.arc(0, -e.radius * 0.4, e.radius * 0.7, 0, TAU);
    c.fill();
    eyeGlow(c, -4, -e.radius * 0.45, 2.4, "#d8ff7a");
    eyeGlow(c, 4, -e.radius * 0.45, 2.4, "#d8ff7a");
    c.restore();
  },
};

const skitter: EnemyDef = {
  id: "skitter",
  name: "Skitter",
  kind: "chase",
  hp: 14,
  speed: 78,
  radius: 12,
  damage: 8,
  xp: 2,
  color: "#b06a3f",
  kbResist: 0,
  draw(c, e, t) {
    const legs = Math.sin(t * 22 + e.anim) * e.radius * 0.5;
    c.strokeStyle = "#7a4022";
    c.lineWidth = 2;
    for (let i = -1; i <= 1; i += 2) {
      c.beginPath();
      c.moveTo(e.x, e.y);
      c.lineTo(e.x + i * e.radius, e.y + legs);
      c.moveTo(e.x, e.y);
      c.lineTo(e.x + i * e.radius, e.y - legs);
      c.stroke();
    }
    c.fillStyle = "#b06a3f";
    c.beginPath();
    c.moveTo(e.x, e.y - e.radius);
    c.lineTo(e.x + e.radius, e.y);
    c.lineTo(e.x, e.y + e.radius);
    c.lineTo(e.x - e.radius, e.y);
    c.closePath();
    c.fill();
    eyeGlow(c, e.x, e.y - 2, 2.2, "#ffd24a");
  },
};

const stalker: EnemyDef = {
  id: "stalker",
  name: "Stalker",
  kind: "charger",
  hp: 18,
  speed: 70,
  radius: 13,
  damage: 11,
  xp: 4,
  color: "#8f4ad0",
  kbResist: 0.2,
  draw(c, e, t) {
    const charging = e.windup > 0 || e.dashTime > 0;
    c.save();
    c.translate(e.x, e.y);
    const ang = Math.atan2(e.vy, e.vx);
    c.rotate(ang);
    c.fillStyle = charging ? "#c77bff" : "#5e2e8f";
    c.beginPath();
    c.moveTo(e.radius * 1.4, 0);
    c.lineTo(-e.radius, -e.radius * 0.8);
    c.lineTo(-e.radius * 0.5, 0);
    c.lineTo(-e.radius, e.radius * 0.8);
    c.closePath();
    c.fill();
    if (charging) {
      c.globalAlpha = 0.5 + Math.sin(t * 30) * 0.3;
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(e.radius * 0.3, 0, e.radius * 0.4, 0, TAU);
      c.fill();
    }
    c.restore();
  },
};

const brute: EnemyDef = {
  id: "brute",
  name: "Brute",
  kind: "chase",
  hp: 95,
  speed: 40,
  radius: 25,
  damage: 18,
  xp: 7,
  color: "#7a5a3a",
  kbResist: 0.55,
  draw(c, e, t) {
    const breathe = 1 + Math.sin(t * 3 + e.anim) * 0.03;
    c.save();
    c.translate(e.x, e.y);
    c.scale(breathe, 1 / breathe);
    c.fillStyle = "#4a3522";
    c.beginPath();
    c.arc(0, 0, e.radius, 0, TAU);
    c.fill();
    c.fillStyle = "#7a5a3a";
    c.beginPath();
    c.arc(0, 0, e.radius * 0.78, 0, TAU);
    c.fill();
    // cracks
    c.strokeStyle = "#ff7a4a";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-e.radius * 0.4, -e.radius * 0.3);
    c.lineTo(0, 0);
    c.lineTo(e.radius * 0.35, -e.radius * 0.4);
    c.moveTo(0, 0);
    c.lineTo(e.radius * 0.2, e.radius * 0.45);
    c.stroke();
    eyeGlow(c, -e.radius * 0.3, -e.radius * 0.2, 3.4, "#ff5d2a");
    eyeGlow(c, e.radius * 0.3, -e.radius * 0.2, 3.4, "#ff5d2a");
    c.restore();
  },
};

const hexer: EnemyDef = {
  id: "hexer",
  name: "Hexer",
  kind: "shooter",
  hp: 20,
  speed: 46,
  radius: 14,
  damage: 8,
  xp: 5,
  color: "#4a6fd0",
  kbResist: 0.15,
  draw(c, e, t) {
    const bob = Math.sin(t * 3 + e.anim) * 3;
    c.save();
    c.translate(e.x, e.y + bob);
    c.fillStyle = "#2a3f7a";
    c.beginPath();
    c.moveTo(0, -e.radius);
    c.quadraticCurveTo(e.radius, 0, e.radius * 0.5, e.radius);
    c.lineTo(-e.radius * 0.5, e.radius);
    c.quadraticCurveTo(-e.radius, 0, 0, -e.radius);
    c.fill();
    const flare = e.windup > 0 ? 0.6 + Math.sin(t * 40) * 0.4 : 0.4;
    c.fillStyle = `rgba(120,200,255,${flare})`;
    c.beginPath();
    c.arc(0, -e.radius * 0.2, e.radius * 0.4, 0, TAU);
    c.fill();
    eyeGlow(c, 0, -e.radius * 0.2, 2.5, "#ffffff");
    c.restore();
  },
};

const reaper: EnemyDef = {
  id: "reaper",
  name: "Reaper",
  kind: "boss",
  hp: 600,
  speed: 52,
  radius: 46,
  damage: 30,
  xp: 80,
  color: "#ff4d6d",
  kbResist: 0.85,
  boss: true,
  draw(c, e, t) {
    const pulse = 1 + Math.sin(t * 4) * 0.05;
    c.save();
    c.translate(e.x, e.y);
    // aura
    c.globalAlpha = 0.25;
    const g = c.createRadialGradient(0, 0, e.radius * 0.4, 0, 0, e.radius * 1.6 * pulse);
    g.addColorStop(0, "rgba(255,77,109,0.5)");
    g.addColorStop(1, "rgba(255,77,109,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, e.radius * 1.6 * pulse, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
    // hood
    c.fillStyle = "#2a0f1a";
    c.beginPath();
    c.moveTo(0, -e.radius);
    c.quadraticCurveTo(e.radius, -e.radius * 0.4, e.radius * 0.7, e.radius);
    c.lineTo(-e.radius * 0.7, e.radius);
    c.quadraticCurveTo(-e.radius, -e.radius * 0.4, 0, -e.radius);
    c.fill();
    c.fillStyle = "#5a1a2a";
    c.beginPath();
    c.arc(0, -e.radius * 0.1, e.radius * 0.55, 0, TAU);
    c.fill();
    eyeGlow(c, -e.radius * 0.22, -e.radius * 0.1, 5, "#ff2a4a");
    eyeGlow(c, e.radius * 0.22, -e.radius * 0.1, 5, "#ff2a4a");
    // scythe arc
    c.strokeStyle = "#ffd24a";
    c.lineWidth = 4;
    c.beginPath();
    c.arc(e.radius * 0.9, 0, e.radius * 0.8, -1.2 + Math.sin(t * 2) * 0.3, 0.4 + Math.sin(t * 2) * 0.3);
    c.stroke();
    c.restore();
  },
};

export const ENEMIES: Record<string, EnemyDef> = {
  bat,
  husk,
  skitter,
  stalker,
  brute,
  hexer,
  reaper,
};

/** Returns the weighted set of spawnable enemy type ids at time t (seconds). */
export function spawnPool(t: number): string[] {
  const pool: string[] = ["bat", "bat", "husk"];
  if (t > 35) pool.push("skitter", "skitter");
  if (t > 75) pool.push("stalker", "husk");
  if (t > 130) pool.push("brute", "hexer");
  if (t > 200) pool.push("brute", "hexer", "stalker");
  if (t > 300) pool.push("brute", "skitter", "stalker", "hexer");
  return pool;
}

/** Boss id used at boss-index n (escalates). */
export function bossId(): string {
  return "reaper";
}

export type EnemyMap = typeof ENEMIES;
