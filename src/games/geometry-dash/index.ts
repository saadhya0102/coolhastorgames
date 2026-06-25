/**
 * Neon Dash — an original "Geometry Dash"-style rhythm auto-runner.
 *
 * A glowing cube auto-scrolls right at a beat-locked constant speed; the single
 * verb is JUMP (tap / Space / click, hold to fly / keep jumping). Three
 * hand-designed levels of escalating difficulty mix cube, ship/fly, and
 * gravity-flip modes with spikes, gaps, blocks, pads and orbs. Death restarts
 * the level instantly; progress % is tracked per level. Everything (art, music,
 * levels) is original and procedural — no asset files, no libraries.
 *
 * See PRD.md for the full design. Code is split across:
 *   constants.ts · types.ts · levels.ts · level.ts · music.ts · particles.ts
 *   render.ts · game.ts · index.ts
 */
import type { GameContext, GameInstance } from "@/engine";
import { NeonDash } from "./game";

export function create(ctx: GameContext): GameInstance {
  const game = new NeonDash(ctx);
  return {
    update(dt: number): void {
      game.update(dt);
    },
    render(): void {
      game.render();
    },
    resize(): void {
      game.resize();
    },
  };
}
