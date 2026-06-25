/**
 * Bubble Pop Saga — an original bubble shooter (Puzzle Bobble lineage).
 *
 * 100% original procedural art, code, level generation and audio. No external
 * assets, no copied levels. Entry point for the CoolHastorGames canvas runtime.
 *
 * See PRD.md in this folder for the full design (hex grid, match flood-fill,
 * ceiling connectivity / drop logic, scoring and tuning).
 */

import type { GameContext, GameInstance } from "@/engine";
import { BubbleGame } from "./game";

export function create(ctx: GameContext): GameInstance {
  const game = new BubbleGame(ctx);
  return {
    update(dt: number) {
      game.update(dt);
    },
    render() {
      game.render();
    },
    resize() {
      game.resize();
    },
    destroy() {
      game.destroy();
    },
  };
}
