import type { Card } from "../../shared/cards";
import { matchesTop } from "../../shared/cards";
import type { SeatView } from "../../shared/protocol";
import type { GameView } from "../../shared/view";
import { useGame } from "../state/store";

export function useTable() {
  const room = useGame((s) => s.room)!;
  const g = room.game!;
  const me = room.you;
  const myIdx = g.players.findIndex((p) => p.id === me);
  const seated = room.role === "seat" && myIdx >= 0;
  const seatOf = (pid: string): SeatView =>
    room.seats.find((s) => s.id === pid) ?? { id: pid, name: "?", avatar: 0, isBot: false, connected: false, autoplay: false };
  const current = g.players[g.current]?.id;
  const myTurn = seated && current === me && (g.phase.kind === "turn" || g.phase.kind === "afterDraw");
  return { room, g, me, myIdx, seated, seatOf, current, myTurn };
}

export type CardState = "play" | "bluff" | "cheat" | "commit" | "none" | "idle";

/** How a hand card may be used right now (drives highlighting and click behaviour). */
export function cardState(g: GameView, card: Card, myTurn: boolean, me: string): CardState {
  const ph = g.phase;
  if (ph.kind === "wlcCommit" && ph.by !== me && !ph.committed.includes(me)) return "commit";
  if (!myTurn) return "idle";
  if (ph.kind === "afterDraw" && ph.cardId !== card.id) return "none";
  if (card.value === "wlc") return "play";
  if (card.liar) return matchesTop(card, g.top) ? "play" : "bluff";
  if (matchesTop(card, g.top)) return "play";
  return g.settings.allowRegularFaceDown ? "cheat" : "none";
}

export function opponentsInOrder(g: GameView, myIdx: number, seated: boolean): string[] {
  const ids = g.players.map((p) => p.id);
  if (!seated) return ids;
  const out: string[] = [];
  for (let k = 1; k < ids.length; k++) out.push(ids[(myIdx + k) % ids.length]);
  return out;
}
