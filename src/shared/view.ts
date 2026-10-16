import type { Card, Claim, Color, TopFace } from "./cards";
import {
  type CommitStatus,
  type DiscardEntry,
  type GameEvent,
  type GameSettings,
  type GameState,
  effectiveTop,
} from "./engine";

export interface DiscardView {
  seq: number;
  /** True while the identity is hidden (face down & never revealed). */
  hidden: boolean;
  card: Card | null;
  claim: Claim | null;
  chosenColor: Color | null;
  by: string | null;
  rot: number;
}

export interface GPlayerView {
  id: string;
  handCount: number;
  unoDeclared: boolean;
  unoVulnerable: boolean;
}

export type PhaseView =
  | { kind: "turn" }
  | { kind: "afterDraw"; cardId: string | null }
  | {
      kind: "challenge";
      by: string;
      seq: number;
      claim: Claim;
      chosenColor: Color | null;
      swapTarget: string | null;
      responded: string[];
    }
  | { kind: "wlcCommit"; by: string; color: Color; committed: string[]; myCommit: Card | null }
  | {
      kind: "wlcChallenge";
      by: string;
      color: Color;
      commits: { who: string; status: CommitStatus; card: Card | null }[];
    }
  | {
      kind: "roundOver";
      winners: string[];
      points: number;
      gameOver: boolean;
      hands: Record<string, Card[]>;
    };

export interface GameView {
  round: number;
  you: string | null;
  hand: Card[];
  players: GPlayerView[];
  current: number;
  direction: 1 | -1;
  dealer: number;
  drawCount: number;
  discardCount: number;
  discard: DiscardView[];
  top: TopFace;
  phase: PhaseView;
  deadline: number | null;
  settings: GameSettings;
  scores: Record<string, number>;
  turnId: number;
}

function discardView(e: DiscardEntry): DiscardView {
  const hidden = e.faceDown && !e.revealed;
  return {
    seq: e.seq,
    hidden,
    card: hidden ? null : e.card,
    claim: e.claim,
    chosenColor: e.chosenColor,
    by: e.by,
    rot: e.rot,
  };
}

/** Builds what one viewer is allowed to see. `viewer` may be a spectator (null / not in game). */
export function viewFor(s: GameState, viewer: string | null, opts: { fullDiscard?: boolean } = {}): GameView {
  const me = viewer ? s.players.find((p) => p.id === viewer) : undefined;
  const ph = s.phase;
  let phase: PhaseView;
  switch (ph.kind) {
    case "turn":
      phase = { kind: "turn" };
      break;
    case "afterDraw":
      phase = { kind: "afterDraw", cardId: me && s.players[s.current] === me ? ph.cardId : null };
      break;
    case "challenge": {
      const e = s.discard[s.discard.length - 1];
      phase = {
        kind: "challenge",
        by: ph.by,
        seq: ph.seq,
        claim: e.claim!,
        chosenColor: e.chosenColor,
        swapTarget: ph.swapTarget,
        responded: [...ph.responded],
      };
      break;
    }
    case "wlcCommit":
      phase = {
        kind: "wlcCommit",
        by: ph.by,
        color: ph.color,
        committed: ph.commits.map((c) => c.who),
        myCommit: ph.commits.find((c) => c.who === viewer)?.card ?? null,
      };
      break;
    case "wlcChallenge":
      phase = {
        kind: "wlcChallenge",
        by: ph.by,
        color: ph.color,
        commits: ph.commits.map((c) => ({
          who: c.who,
          status: c.status,
          card: c.status !== "hidden" || c.who === viewer ? c.card : null,
        })),
      };
      break;
    case "roundOver": {
      const hands: Record<string, Card[]> = {};
      for (const p of s.players) hands[p.id] = [...p.hand];
      phase = { kind: "roundOver", winners: ph.winners, points: ph.points, gameOver: ph.gameOver, hands };
      break;
    }
  }
  const entries = opts.fullDiscard ? s.discard : s.discard.slice(-6);
  return {
    round: s.round,
    you: me ? me.id : null,
    hand: me ? [...me.hand] : [],
    players: s.players.map((p) => ({
      id: p.id,
      handCount: p.hand.length,
      unoDeclared: p.unoDeclared,
      unoVulnerable: p.unoVulnerable,
    })),
    current: s.current,
    direction: s.direction,
    dealer: s.dealer,
    drawCount: s.drawPile.length,
    discardCount: s.discard.length,
    discard: entries.map(discardView),
    top: effectiveTop(s),
    phase,
    deadline: s.deadline,
    settings: s.settings,
    scores: { ...s.scores },
    turnId: s.turnId,
  };
}

/** Strips hidden card identities from events for one viewer. */
export function eventsFor(events: GameEvent[], viewer: string | null): GameEvent[] {
  return events.map((e) => {
    switch (e.t) {
      case "deal": {
        const hands: Record<string, Card[]> = {};
        if (viewer && e.hands[viewer]) hands[viewer] = e.hands[viewer];
        return { ...e, hands };
      }
      case "play":
        return e.faceDown && e.who !== viewer ? { ...e, card: null } : e;
      case "draw":
        return e.who === viewer ? e : { ...e, cards: null };
      default:
        return e;
    }
  });
}
