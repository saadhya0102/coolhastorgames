/** Local-first persistent storage, namespaced per game.
 * High scores and saves are written to localStorage immediately; an optional
 * sync sink (wired up by the leaderboards service) is notified so data can be
 * pushed to the cloud opportunistically when the user is online + signed in. */

export type ScoreSink = (gameId: string, score: number, ascending: boolean) => void;

let scoreSink: ScoreSink | null = null;
/** Called by services/leaderboards.ts once Firebase is ready. */
export function setScoreSink(sink: ScoreSink | null) {
  scoreSink = sink;
}

const PREFIX = "chg.save.";

export class GameStorage {
  constructor(private gameId: string) {}

  private key(k: string) {
    return `${PREFIX}${this.gameId}.${k}`;
  }

  get<T>(k: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(this.key(k));
      if (raw == null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set<T>(k: string, value: T): void {
    try {
      localStorage.setItem(this.key(k), JSON.stringify(value));
    } catch {
      /* quota / private mode - ignore */
    }
  }

  remove(k: string) {
    localStorage.removeItem(this.key(k));
  }

  /** Returns the locally stored best score. */
  bestScore(ascending = false): number | null {
    return this.get<number | null>("__best", null) ?? (ascending ? null : null);
  }

  /** Submit a score; updates local best and notifies the cloud sink.
   * Returns true if it was a new local best. */
  submitScore(score: number, ascending = false): boolean {
    const prev = this.get<number | null>("__best", null);
    const isBest = prev == null || (ascending ? score < prev : score > prev);
    if (isBest) this.set("__best", score);
    try {
      scoreSink?.(this.gameId, score, ascending);
    } catch {
      /* ignore sink errors */
    }
    return isBest;
  }
}

export function makeStorage(gameId: string) {
  return new GameStorage(gameId);
}
