/**
 * Putt Park — the hand-designed 12-hole course (pure data).
 *
 * All geometry is in world units (see PRD §3). Each hole's `green` polygon is
 * listed clockwise; boundary walls + felt fill are derived from it. Tees and
 * cups are placed clear of walls and hazards. Difficulty escalates and each hole
 * introduces or combines a mechanic.
 */

import type { Course, Hole, Vec } from "./types";

const P = (x: number, y: number): Vec => ({ x, y });

/** Rectangular outline polygon (clockwise). */
function rectPoly(x: number, y: number, w: number, h: number): Vec[] {
  return [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
}

// ---------------------------------------------------------------------------
// Hole 1 — Warm-Up: a simple straight putt to get the feel.
// ---------------------------------------------------------------------------
const hole1: Hole = {
  id: 1,
  name: "Warm-Up",
  par: 2,
  bounds: { w: 760, h: 1040 },
  green: rectPoly(80, 80, 600, 880),
  tee: P(380, 840),
  cup: P(380, 220),
  hint: "Drag back from the ball, then release to putt. Straight ahead!",
};

// ---------------------------------------------------------------------------
// Hole 2 — The Bend: an L-shaped dog-leg. Bank off the walls around the corner.
// ---------------------------------------------------------------------------
const hole2: Hole = {
  id: 2,
  name: "The Bend",
  par: 3,
  bounds: { w: 900, h: 1000 },
  green: [
    P(80, 80),
    P(520, 80),
    P(520, 520),
    P(820, 520),
    P(820, 920),
    P(80, 920),
  ],
  tee: P(700, 820),
  cup: P(300, 200),
  bumpers: [{ x: 470, y: 470, r: 30 }],
  hint: "Dog-leg left — bank the ball around the inside corner.",
};

// ---------------------------------------------------------------------------
// Hole 3 — Sandy Straits: thread the lane between two sand traps.
// ---------------------------------------------------------------------------
const hole3: Hole = {
  id: 3,
  name: "Sandy Straits",
  par: 3,
  bounds: { w: 760, h: 1080 },
  green: rectPoly(80, 80, 600, 920),
  tee: P(380, 900),
  cup: P(380, 200),
  sand: [
    { type: "rect", x: 120, y: 430, w: 180, h: 280 },
    { type: "rect", x: 460, y: 430, w: 180, h: 280 },
  ],
  hint: "Sand saps your speed. Keep it in the central lane.",
};

// ---------------------------------------------------------------------------
// Hole 4 — Bumper Alley: use the elastic bumpers to your advantage.
// ---------------------------------------------------------------------------
const hole4: Hole = {
  id: 4,
  name: "Bumper Alley",
  par: 3,
  bounds: { w: 840, h: 1040 },
  green: rectPoly(80, 80, 680, 880),
  tee: P(420, 860),
  cup: P(420, 220),
  bumpers: [
    { x: 260, y: 560, r: 34 },
    { x: 580, y: 560, r: 34 },
    { x: 420, y: 400, r: 38 },
  ],
  hint: "Bumpers kick back hard — ricochet around them to the cup.",
};

// ---------------------------------------------------------------------------
// Hole 5 — The Moat: a water band you must cross on the central bridge.
// ---------------------------------------------------------------------------
const hole5: Hole = {
  id: 5,
  name: "The Moat",
  par: 3,
  bounds: { w: 840, h: 1100 },
  green: rectPoly(80, 80, 680, 940),
  tee: P(420, 940),
  cup: P(420, 220),
  water: [
    { type: "rect", x: 80, y: 470, w: 280, h: 160 },
    { type: "rect", x: 480, y: 470, w: 280, h: 160 },
  ],
  hint: "Find the bridge — water costs you a penalty stroke.",
};

// ---------------------------------------------------------------------------
// Hole 6 — Pinwheel: time your putt through the sliding gate block.
// ---------------------------------------------------------------------------
const hole6: Hole = {
  id: 6,
  name: "Pinwheel",
  par: 4,
  bounds: { w: 860, h: 1040 },
  green: rectPoly(80, 80, 700, 880),
  tee: P(430, 860),
  cup: P(430, 200),
  walls: [
    { a: P(80, 520), b: P(330, 520), kind: "inner" },
    { a: P(530, 520), b: P(780, 520), kind: "inner" },
  ],
  movers: [
    {
      w: 150,
      h: 44,
      path: [P(250, 520), P(610, 520)],
      speed: 230,
      pingpong: true,
    },
  ],
  hint: "A block slides across the gap. Wait for your window, then go.",
};

// ---------------------------------------------------------------------------
// Hole 7 — Switchbacks: weave through staggered dividers (a Z route).
// ---------------------------------------------------------------------------
const hole7: Hole = {
  id: 7,
  name: "Switchbacks",
  par: 4,
  bounds: { w: 900, h: 1020 },
  green: rectPoly(80, 80, 740, 860),
  tee: P(180, 840),
  cup: P(720, 200),
  walls: [
    { a: P(80, 620), b: P(620, 620), kind: "inner" },
    { a: P(280, 360), b: P(820, 360), kind: "inner" },
  ],
  bumpers: [{ x: 720, y: 740, r: 26 }],
  hint: "Slalom through the gaps — right, then left, then home.",
};

// ---------------------------------------------------------------------------
// Hole 8 — Rampart: a slope pushes the ball back. Power through it.
// ---------------------------------------------------------------------------
const hole8: Hole = {
  id: 8,
  name: "Rampart",
  par: 3,
  bounds: { w: 800, h: 1120 },
  green: rectPoly(80, 80, 640, 960),
  tee: P(400, 980),
  cup: P(400, 200),
  slopes: [
    {
      shape: { type: "rect", x: 80, y: 420, w: 640, h: 320 },
      dir: P(0, 1),
      strength: 760,
    },
    {
      shape: { type: "circle", x: 400, y: 280, r: 150 },
      dir: P(0, -1),
      strength: 420,
    },
  ],
  hint: "The ramp rolls you back. Hit it firm; the green up top feeds the cup.",
};

// ---------------------------------------------------------------------------
// Hole 9 — Island Green: reach the island over the bridge, water all around.
// ---------------------------------------------------------------------------
const hole9: Hole = {
  id: 9,
  name: "Island Green",
  par: 4,
  bounds: { w: 1000, h: 1020 },
  green: rectPoly(80, 80, 840, 860),
  tee: P(500, 860),
  cup: P(500, 240),
  water: [
    { type: "rect", x: 80, y: 120, w: 300, h: 460 },
    { type: "rect", x: 620, y: 120, w: 300, h: 460 },
    { type: "rect", x: 380, y: 360, w: 80, h: 220 },
    { type: "rect", x: 540, y: 360, w: 80, h: 220 },
  ],
  hint: "The cup sits on an island. Roll up the bridge — don't get wet!",
};

// ---------------------------------------------------------------------------
// Hole 10 — The Gauntlet: bumpers, sand and a moving block together.
// ---------------------------------------------------------------------------
const hole10: Hole = {
  id: 10,
  name: "The Gauntlet",
  par: 4,
  bounds: { w: 920, h: 1120 },
  green: rectPoly(80, 80, 760, 960),
  tee: P(460, 960),
  cup: P(460, 200),
  sand: [{ type: "rect", x: 300, y: 700, w: 320, h: 150 }],
  bumpers: [
    { x: 240, y: 520, r: 32 },
    { x: 680, y: 520, r: 32 },
  ],
  walls: [
    { a: P(80, 360), b: P(330, 360), kind: "inner" },
    { a: P(590, 360), b: P(840, 360), kind: "inner" },
  ],
  movers: [
    {
      w: 130,
      h: 42,
      path: [P(280, 360), P(640, 360)],
      speed: 200,
      pingpong: true,
    },
  ],
  hint: "Through the sand, off the bumpers, and time the gate. Good luck.",
};

// ---------------------------------------------------------------------------
// Hole 11 — Spiral: wind into the cup at the center of the maze.
// ---------------------------------------------------------------------------
const hole11: Hole = {
  id: 11,
  name: "Spiral",
  par: 4,
  bounds: { w: 1000, h: 1000 },
  green: rectPoly(80, 80, 840, 840),
  tee: P(160, 840),
  cup: P(500, 500),
  walls: [
    // outer wrap (leaves an entry gap on the bottom-left)
    { a: P(200, 760), b: P(800, 760), kind: "inner" },
    { a: P(800, 760), b: P(800, 200), kind: "inner" },
    { a: P(800, 200), b: P(200, 200), kind: "inner" },
    { a: P(200, 200), b: P(200, 620), kind: "inner" },
    // inner wrap
    { a: P(340, 620), b: P(660, 620), kind: "inner" },
    { a: P(660, 620), b: P(660, 360), kind: "inner" },
    { a: P(660, 360), b: P(360, 360), kind: "inner" },
  ],
  hint: "Follow the spiral inward. Soft touches keep you on track.",
};

// ---------------------------------------------------------------------------
// Hole 12 — Grand Finale: water, sand, slope, bumpers and a mover. Par 5.
// ---------------------------------------------------------------------------
const hole12: Hole = {
  id: 12,
  name: "Grand Finale",
  par: 5,
  bounds: { w: 1000, h: 1240 },
  green: rectPoly(80, 80, 840, 1080),
  tee: P(500, 1080),
  cup: P(500, 220),
  water: [
    { type: "rect", x: 80, y: 760, w: 320, h: 150 },
    { type: "rect", x: 600, y: 760, w: 320, h: 150 },
  ],
  sand: [{ type: "circle", x: 500, y: 560, r: 120 }],
  bumpers: [
    { x: 260, y: 420, r: 30 },
    { x: 740, y: 420, r: 30 },
  ],
  slopes: [
    {
      shape: { type: "circle", x: 500, y: 250, r: 140 },
      dir: P(0, -1),
      strength: 380,
    },
  ],
  walls: [
    { a: P(80, 380), b: P(330, 380), kind: "inner" },
    { a: P(670, 380), b: P(920, 380), kind: "inner" },
  ],
  movers: [
    {
      w: 140,
      h: 42,
      path: [P(300, 380), P(700, 380)],
      speed: 210,
      pingpong: true,
    },
  ],
  hint: "Cross the moat, escape the sand, dodge the gate. Sink it for glory!",
};

export const COURSE: Course = [
  hole1,
  hole2,
  hole3,
  hole4,
  hole5,
  hole6,
  hole7,
  hole8,
  hole9,
  hole10,
  hole11,
  hole12,
];

export const TOTAL_PAR = COURSE.reduce((sum, h) => sum + h.par, 0);
