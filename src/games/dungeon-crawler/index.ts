import type { GameContext, GameInstance } from "@/engine";
import { Game } from "./game";

/**
 * CRYPT OF THE CINDER KING — an original top-down roguelite dungeon shooter.
 * See PRD.md for the full design. Everything is procedural; no asset files.
 */
export function create(ctx: GameContext): GameInstance {
  // On touch we provide a movement d-pad + a PAUSE button as a fallback; the
  // primary touch scheme is the on-canvas twin virtual sticks (left = move,
  // right = aim & fire) implemented inside the Game from `input.pointers`.
  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "p", label: "❚❚", id: "pause" },
  ]);

  const game = new Game(ctx);

  return {
    update(dt: number) {
      game.update(dt);
    },
    render() {
      game.render();
    },
    onPause() {
      game.onPause();
    },
  };
}
