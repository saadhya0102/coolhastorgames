import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { getDb, isOnline } from "./firebase";
import { getName, getUid } from "./identity";
import { setScoreSink } from "@/engine";

export interface ScoreEntry {
  uid: string;
  name: string;
  score: number;
  at?: number;
}

let queue: Array<{ gameId: string; score: number; ascending: boolean }> = [];
let flushing = false;

async function flushQueue() {
  if (flushing || !isOnline()) return;
  flushing = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      await writeScore(job.gameId, job.score, job.ascending);
    }
  } catch (e) {
    console.warn("score flush failed", e);
  } finally {
    flushing = false;
  }
}

async function writeScore(gameId: string, score: number, ascending: boolean) {
  const db = getDb();
  const uid = getUid();
  const ref = doc(db, "leaderboards", gameId, "scores", uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const prev = existing.data().score as number;
    const better = ascending ? score < prev : score > prev;
    if (!better) return;
  }
  await setDoc(ref, {
    score: Math.floor(score),
    name: getName().slice(0, 24),
    at: serverTimestamp(),
  });
}

/** Wire the engine's local score sink to the cloud. */
export function initLeaderboards() {
  setScoreSink((gameId, score, ascending) => {
    queue.push({ gameId, score, ascending });
    void flushQueue();
  });
  window.addEventListener("online", () => void flushQueue());
}

export async function getTopScores(
  gameId: string,
  ascending = false,
  n = 25,
): Promise<ScoreEntry[]> {
  if (!isOnline()) return [];
  try {
    const db = getDb();
    const q = query(
      collection(db, "leaderboards", gameId, "scores"),
      orderBy("score", ascending ? "asc" : "desc"),
      limit(n),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        name: data.name || "Player",
        score: data.score,
        at: data.at?.toMillis?.() ?? 0,
      } as ScoreEntry;
    });
  } catch (e) {
    console.warn("getTopScores failed", e);
    return [];
  }
}
