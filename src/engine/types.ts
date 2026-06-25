import type { ComponentType } from "react";
import type { InputManager } from "./Input";
import type { AudioManager } from "./Audio";
import type { GameStorage } from "./Storage";

export type GameSection = "featured" | "offline" | "online" | "party";
export type GameCategory =
  | "driving"
  | "arcade"
  | "puzzle"
  | "rpg"
  | "classic"
  | "party";

/** Static metadata shown by the hub. Kept in the manifest so the hub never
 * needs to import game code. */
export interface GameMeta {
  id: string;
  title: string;
  description: string;
  section: GameSection;
  category: GameCategory;
  /** accent color used for the card + in-game theme */
  color: string;
  /** emoji used as a fallback thumbnail */
  icon: string;
  players: string;
  /** preferred stage aspect ratio (width / height). Defaults to 4/3. */
  aspect?: number;
  online?: boolean;
  leaderboard?: boolean;
  /** label for the score (e.g. "Score", "Distance", "Best Time") */
  scoreLabel?: string;
  /** lower score is better (times) */
  scoreAscending?: boolean;
  instructions?: string[];
  tags?: string[];
}

/** The runtime context handed to a canvas game when it is created. */
export interface GameContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** logical drawing width (CSS pixels) */
  width: number;
  /** logical drawing height (CSS pixels) */
  height: number;
  input: InputManager;
  audio: AudioManager;
  storage: GameStorage;
  isTouch: boolean;
  /** Report the current score (updates the HUD live). */
  reportScore: (score: number) => void;
  /** Signal that the game ended; optionally submit a final score. */
  gameOver: (finalScore?: number) => void;
  /** Set arbitrary HUD text shown above the canvas. */
  setStatus: (text: string) => void;
  /** Request on-screen control buttons (mobile). */
  requestControls: (controls: TouchControl[]) => void;
}

export type TouchControl =
  | { type: "dpad"; id?: string }
  | { type: "button"; key: string; label: string; id: string }
  | { type: "stick"; id: string };

export interface GameInstance {
  update(dt: number): void;
  render(): void;
  resize?(width: number, height: number): void;
  destroy?(): void;
  onPause?(): void;
  onResume?(): void;
}

/** A canvas-based game module (default export). */
export interface CanvasGameModule {
  create(ctx: GameContext): GameInstance;
}

/** Props passed to React-based games (online / party). */
export interface ReactGameProps {
  meta: GameMeta;
  onExit: () => void;
}

export interface ReactGameModule {
  Component: ComponentType<ReactGameProps>;
}

export type GameKind = "canvas" | "react";

export interface GameDef extends GameMeta {
  kind: GameKind;
  /** when set, this game lives inside a collection sub-hub (e.g. "minigames")
   * instead of being shown as a standalone app on the main hub. */
  collection?: string;
  load: () => Promise<CanvasGameModule | ReactGameModule>;
}
