/** Tap Cascade — an original Piano-Tiles-style rhythm tap game.
 *
 * Four vertical lanes of black tiles scroll downward; tap each tile as it
 * reaches the glowing hit line to play its note and build the melody. Tap an
 * empty lane or let a tile slip past the line and the run ends.
 *
 * Everything here is original: the melodies are composed from scratch, the
 * visuals are 100% procedural canvas drawing (no asset files), and all audio is
 * synthesized through the engine's `ctx.audio`. See PRD.md for the full design. */

import type { GameContext, GameInstance } from "@/engine";
import { PianoTiles } from "./game";

export function create(ctx: GameContext): GameInstance {
  return new PianoTiles(ctx);
}
