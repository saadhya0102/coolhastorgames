/**
 * Neon Nexus — an original, procedurally-rendered portrait pinball table.
 *
 * Entry point: exports `create(ctx)` returning a GameInstance, as required by the
 * portal's canvas-game contract. All physics, art and audio are generated in
 * code (see PRD.md) — there are no asset files and nothing is copied from any
 * real-world table.
 */
import type { GameContext, GameInstance } from "@/engine";
import { PinballGame } from "./game";

export function create(ctx: GameContext): GameInstance {
  return new PinballGame(ctx);
}
