/** All tunable constants for Mossbloom Run, in world pixels / seconds. */

/** World size of one tile in pixels. */
export const TILE = 32;

/** Number of tile rows visible vertically (drives the camera scale). */
export const VIEW_ROWS = 14;

// ---- Player physics ----
export const GRAVITY = 2300;
export const FALL_GRAVITY_MULT = 1.25; // snappier descent than ascent
export const MAX_FALL = 1150;

export const WALK_ACCEL = 1700;
export const AIR_ACCEL = 1150;
export const MAX_WALK = 300;
export const MAX_RUN = 470;
export const GROUND_FRICTION = 2100;
export const AIR_FRICTION = 240;
export const TURN_BOOST = 1.8; // extra accel when reversing direction

export const JUMP_V = 830;
export const JUMP_CUT = 0.45;
export const COYOTE_TIME = 0.09;
export const JUMP_BUFFER = 0.12;
export const BOUNCE_V = 580; // bounce after stomping an enemy
export const HURT_INVULN = 1.4;
export const STAR_TIME = 8.0;
export const STAR_SPEED_MULT = 1.18;

/** Player collision box (world px). Small vs Big. */
export const PLAYER_W = 20;
export const PLAYER_H_SMALL = 26;
export const PLAYER_H_BIG = 40;

// ---- Enemies ----
export const GRUMBUG_SPEED = 110;
export const SNAPPER_SPEED = 90;
export const SHELL_SPEED = 520;
export const FLUTTER_SPEED = 95;
export const FLUTTER_AMP = 1.6 * TILE; // vertical sine amplitude
export const ENEMY_GRAVITY = 2200;
export const ENEMY_MAX_FALL = 1000;

// ---- Pickups ----
export const MUSHROOM_SPEED = 85;
export const STAR_BOUNCE_V = 520;
export const COINS_PER_LIFE = 100;

// ---- Scoring ----
export const SCORE_COIN = 10;
export const SCORE_ENEMY = 100;
export const SCORE_POWERUP = 50;
export const SCORE_CLEAR_BONUS = 500;
export const SCORE_TIME_PER_SEC = 5;

// ---- Camera ----
export const CAM_LERP = 9; // higher = snappier follow
export const CAM_LOOKAHEAD = 2.4 * TILE;
export const SHAKE_DECAY = 7;

// ---- Lives ----
export const START_LIVES = 3;

// ---- Misc timing ----
export const MAX_DT = 1 / 30;
export const DEATH_FREEZE = 1.1;
export const INTRO_TIME = 1.8;
export const CLEAR_DELAY = 2.6;
