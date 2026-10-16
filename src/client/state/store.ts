import { create } from "zustand";
import type { Card, Claim, Color } from "../../shared/cards";
import type { RoomView } from "../../shared/protocol";

export type ConnStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface Flight {
  id: number;
  from: string;
  to: string;
  card?: Card | null;
  delay: number;
  dur: number;
}

export interface SeatFx {
  id: number;
  pid: string;
  kind: "skip" | "uno" | "caught" | "timeout" | "emote" | "challenge" | "draw";
  text?: string;
}

export interface Reveal {
  id: number;
  challenger: string;
  target: string;
  card: Card;
  result: "honest" | "lie" | "cheat";
  claim: Claim | null;
  chosen: Color | null;
}

export interface FeedItem {
  id: number;
  text: string;
  tone: "info" | "good" | "bad" | "warn";
}

interface GameStore {
  status: ConnStatus;
  closedReason: string | null;
  room: RoomView | null;
  clockOffset: number;
  /** Anchor each newly arrived hand card should fly in from. */
  handOrigin: Record<string, string>;
  /** Anchor each departing hand card should fly to (swap/pass/commit). */
  handExit: Record<string, string>;
  /** Discard seq → my card id, for my own face-down plays (keeps the hand→pile morph). */
  mySeqCard: Record<number, string>;
  flights: Flight[];
  seatFx: SeatFx[];
  reveal: Reveal | null;
  feed: FeedItem[];
  toast: { id: number; text: string } | null;
  selected: string | null;
  /** Discard entries up to this seq were already on the table when we arrived — don't animate them in. */
  pileBaseline: number;
}

export const useGame = create<GameStore>(() => ({
  status: "idle",
  closedReason: null,
  room: null,
  clockOffset: 0,
  handOrigin: {},
  handExit: {},
  mySeqCard: {},
  flights: [],
  seatFx: [],
  reveal: null,
  feed: [],
  toast: null,
  selected: null,
  pileBaseline: Number.MAX_SAFE_INTEGER,
}));

let nextId = 1;
export const uid = () => nextId++;

export function pushFeed(text: string, tone: FeedItem["tone"] = "info") {
  const item = { id: uid(), text, tone };
  useGame.setState((s) => ({ feed: [...s.feed.slice(-5), item] }));
  setTimeout(() => useGame.setState((s) => ({ feed: s.feed.filter((f) => f.id !== item.id) })), 5200);
}

export function pushSeatFx(fx: Omit<SeatFx, "id">, ms = 1600) {
  const item = { ...fx, id: uid() };
  useGame.setState((s) => ({ seatFx: [...s.seatFx, item] }));
  setTimeout(() => useGame.setState((s) => ({ seatFx: s.seatFx.filter((f) => f.id !== item.id) })), ms);
}

export function pushFlight(f: Omit<Flight, "id">) {
  const item = { ...f, id: uid() };
  useGame.setState((s) => ({ flights: [...s.flights, item] }));
}

export function removeFlight(id: number) {
  useGame.setState((s) => ({ flights: s.flights.filter((f) => f.id !== id) }));
}

export function showToast(text: string) {
  const id = uid();
  useGame.setState({ toast: { id, text } });
  setTimeout(() => useGame.setState((s) => (s.toast?.id === id ? { toast: null } : {})), 2600);
}

export const serverNow = () => Date.now() + useGame.getState().clockOffset;
