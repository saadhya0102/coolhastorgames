import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { getName, getUid } from "./identity";

/** Generic, latency-tolerant multiplayer room layer on top of Firestore.
 * Every online + party game reuses this: create/join by 4-letter code, a shared
 * `state` blob, a players map, and snapshot subscriptions. Turn/role logic is
 * implemented per-game inside `state` via transactional updates. */

export interface RoomPlayer {
  uid: string;
  name: string;
  joinedAt: number;
  /** arbitrary per-player data (ready flag, team, hand, etc.) */
  [k: string]: unknown;
}

export type RoomStatus = "lobby" | "playing" | "ended";

export interface RoomDoc<S = Record<string, unknown>> {
  code: string;
  gameId: string;
  hostUid: string;
  status: RoomStatus;
  players: Record<string, RoomPlayer>;
  /** seating / turn order of uids */
  order: string[];
  state: S | null;
  createdAt: number;
  updatedAt: number;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
const genCode = (n = 4) =>
  Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

const roomRef = (code: string) => doc(getDb(), "rooms", code.toUpperCase());

export function me(): RoomPlayer {
  return { uid: getUid(), name: getName(), joinedAt: Date.now() };
}

export async function createRoom<S = Record<string, unknown>>(
  gameId: string,
  initialState: S | null = null,
): Promise<string> {
  const uid = getUid();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genCode();
    const ref = roomRef(code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    const player = me();
    const room: RoomDoc<S> = {
      code,
      gameId,
      hostUid: uid,
      status: "lobby",
      players: { [uid]: player },
      order: [uid],
      state: initialState,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setDoc(ref, { ...room, serverAt: serverTimestamp() });
    return code;
  }
  throw new Error("Could not allocate a room code, try again.");
}

export interface JoinResult {
  ok: boolean;
  error?: string;
}

export async function joinRoom(code: string, maxPlayers = 12): Promise<JoinResult> {
  const uid = getUid();
  const ref = roomRef(code);
  try {
    const res = await runTransaction(getDb(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false, error: "Room not found." };
      const room = snap.data() as RoomDoc;
      if (room.players[uid]) return { ok: true }; // already in
      if (room.status !== "lobby") return { ok: false, error: "Game already in progress." };
      if (Object.keys(room.players).length >= maxPlayers)
        return { ok: false, error: "Room is full." };
      const players = { ...room.players, [uid]: me() };
      const order = room.order.includes(uid) ? room.order : [...room.order, uid];
      tx.update(ref, { players, order, updatedAt: Date.now() });
      return { ok: true };
    });
    return res;
  } catch (e) {
    console.warn("joinRoom failed", e);
    return { ok: false, error: "Could not join (are you online?)." };
  }
}

export function subscribeRoom<S = Record<string, unknown>>(
  code: string,
  cb: (room: RoomDoc<S> | null) => void,
): Unsubscribe {
  return onSnapshot(
    roomRef(code),
    (snap) => cb(snap.exists() ? (snap.data() as RoomDoc<S>) : null),
    (err) => {
      console.warn("room subscribe error", err);
      cb(null);
    },
  );
}

/** Shallow-merge top-level fields (e.g. status). */
export async function patchRoom<S = Record<string, unknown>>(
  code: string,
  fields: Partial<RoomDoc<S>>,
): Promise<void> {
  await updateDoc(roomRef(code), { ...fields, updatedAt: Date.now() } as Record<string, unknown>);
}

/** Transactionally read the room and apply an update function. The function
 * receives the current room and returns the fields to write (or null to abort). */
export async function mutateRoom<S = Record<string, unknown>>(
  code: string,
  fn: (room: RoomDoc<S>) => Partial<RoomDoc<S>> | null,
): Promise<boolean> {
  const ref = roomRef(code);
  try {
    return await runTransaction(getDb(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const room = snap.data() as RoomDoc<S>;
      const update = fn(room);
      if (!update) return false;
      tx.update(ref, { ...update, updatedAt: Date.now() } as Record<string, unknown>);
      return true;
    });
  } catch (e) {
    console.warn("mutateRoom failed", e);
    return false;
  }
}

/** Host starts the game with an initial shared state and (optionally) a frozen order. */
export async function startGame<S>(code: string, state: S, order?: string[]): Promise<void> {
  const fields: Partial<RoomDoc<S>> = { status: "playing", state };
  if (order) fields.order = order;
  await patchRoom(code, fields as Partial<RoomDoc>);
}

export async function setPlayerData(code: string, data: Partial<RoomPlayer>): Promise<void> {
  const uid = getUid();
  await mutateRoom(code, (room) => {
    const cur = room.players[uid];
    if (!cur) return null;
    return { players: { ...room.players, [uid]: { ...cur, ...data } } } as Partial<RoomDoc>;
  });
}

export async function leaveRoom(code: string): Promise<void> {
  const uid = getUid();
  await mutateRoom(code, (room) => {
    const players = { ...room.players };
    delete players[uid];
    const order = room.order.filter((u) => u !== uid);
    // if host leaves, hand off to the next player
    const hostUid = room.hostUid === uid ? order[0] ?? uid : room.hostUid;
    return { players, order, hostUid } as Partial<RoomDoc>;
  });
}

export const myUid = getUid;
export const myName = getName;
