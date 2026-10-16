import {
  COLORS,
  type Card,
  type Claim,
  type Color,
  type TopFace,
  cardPoints,
  isWild,
  matchesTop,
  sameIdentity,
} from "./cards";
import { type Action, legalClaims } from "./engine";
import type { GameView } from "./view";

type Rand = () => number;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export interface Personality {
  bluff: number;
  suspicion: number;
  forgetful: number;
}

export function personality(id: string): Personality {
  return {
    bluff: 0.3 + hash(id + "b") * 0.35,
    suspicion: 0.08 + hash(id + "s") * 0.14,
    forgetful: 0.04 + hash(id + "f") * 0.1,
  };
}

function bestColor(hand: Card[], rand: Rand): Color {
  const counts = new Map<Color, number>();
  for (const c of hand) if (c.color && !isWild(c.value)) counts.set(c.color, (counts.get(c.color) ?? 0) + 1);
  let best: Color = COLORS[Math.floor(rand() * 4)];
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

/** How many physical Liar's copies exist for an identity. */
function liarCopies(c: Claim): number {
  if (c.value === "wild4") return 2;
  if (c.value === "skip" || c.value === "reverse" || c.value === "draw2") return 2;
  return 1;
}

/** Liar's copies of an identity this bot can see outside the claimant's hand. */
function knownLiarCopies(view: GameView, c: Claim): number {
  let n = 0;
  for (const h of view.hand) if (h.liar && sameIdentity(h, c)) n++;
  for (const d of view.discard) if (d.card && d.card.liar && sameIdentity(d.card, c)) n++;
  return n;
}

function idx(view: GameView, id: string) {
  return view.players.findIndex((p) => p.id === id);
}

function nextOf(view: GameView, i: number, steps = 1) {
  const n = view.players.length;
  return (((i + view.direction * steps) % n) + n) % n;
}

function minOpponent(view: GameView, me: string) {
  return view.players.filter((p) => p.id !== me).reduce((a, b) => (a.handCount <= b.handCount ? a : b));
}

interface Option {
  score: number;
  action: Action;
}

function swapValue(view: GameView, me: string): { score: number; target: string } {
  const mine = view.hand.length - 1;
  const t = minOpponent(view, me);
  return { score: mine - t.handCount >= 2 ? 8 : -8, target: t.id };
}

function passValue(view: GameView, me: string): number {
  const i = idx(view, me);
  const giver = view.players[nextOf(view, i, -1)];
  const mine = view.hand.length - 1;
  return mine - giver.handCount >= 2 ? 6 : giver.handCount - mine >= 2 ? -6 : 0;
}

function effectScore(view: GameView, me: string, c: Claim): { score: number; swapTarget?: string } {
  const i = idx(view, me);
  const next = view.players[nextOf(view, i)];
  let s = 0;
  if (c.value === "draw2" || c.value === "wild4" || c.value === "skip") s += next.handCount <= 3 ? 5 : 2;
  if (c.value === "7") {
    const v = swapValue(view, me);
    return { score: v.score, swapTarget: v.target };
  }
  if (c.value === "0") s += passValue(view, me);
  return { score: s };
}

function bluffClaim(view: GameView, me: string, rand: Rand): Claim | null {
  const top = view.top;
  const claims = legalClaims(top).filter((c) => knownLiarCopies(view, c) < liarCopies(c));
  if (claims.length === 0) return null;
  const weighted = claims.map((c) => {
    let w = 1;
    if (c.color === top.color && /^[0-9]$/.test(c.value)) w = 5;
    else if (c.value === top.value) w = 2.5;
    else if (c.value === "wild4") w = 0.35;
    else if (c.value === "7") w = swapValue(view, me).score > 0 ? 2 : 0.2;
    else if (c.value === "0") w = passValue(view, me) > 0 ? 1.5 : 0.3;
    return { c, w };
  });
  let r = rand() * weighted.reduce((a, b) => a + b.w, 0);
  for (const { c, w } of weighted) {
    r -= w;
    if (r <= 0) return c;
  }
  return weighted[weighted.length - 1].c;
}

function playOptions(view: GameView, me: string, cards: Card[], rand: Rand, p: Personality): Option[] {
  const top: TopFace = view.top;
  const opts: Option[] = [];
  const settings = view.settings;
  for (const card of cards) {
    if (card.value === "wlc") {
      const danger = minOpponent(view, me).handCount <= 2 ? 3 : 0;
      opts.push({
        score: 4 + danger + rand(),
        action: { type: "play", cardId: card.id, faceDown: false, chosenColor: bestColor(view.hand, rand) },
      });
      continue;
    }
    if (!card.liar) {
      if (matchesTop(card, top)) {
        const eff = effectScore(view, me, card);
        opts.push({
          score: 10 + cardPoints(card) / 4 + eff.score + rand(),
          action: { type: "play", cardId: card.id, faceDown: false, swapTarget: eff.swapTarget ?? null },
        });
      } else if (settings.allowRegularFaceDown && rand() < 0.04) {
        const claim = bluffClaim(view, me, rand);
        if (claim) {
          const eff = effectScore(view, me, claim);
          opts.push({
            score: 3.5 + rand(),
            action: {
              type: "play",
              cardId: card.id,
              faceDown: true,
              claim,
              chosenColor: claim.value === "wild4" ? bestColor(view.hand, rand) : null,
              swapTarget: eff.swapTarget ?? null,
            },
          });
        }
      }
      continue;
    }
    // Liar's Card
    const honest: Claim = { color: card.color, value: card.value };
    if (matchesTop(honest, top)) {
      const eff = effectScore(view, me, honest);
      opts.push({
        score: 9 + cardPoints(card) / 5 + eff.score + rand(),
        action: {
          type: "play",
          cardId: card.id,
          faceDown: true,
          claim: honest,
          chosenColor: card.value === "wild4" ? bestColor(view.hand, rand) : null,
          swapTarget: eff.swapTarget ?? null,
        },
      });
    } else if (rand() < p.bluff) {
      const claim = bluffClaim(view, me, rand);
      if (claim) {
        const eff = effectScore(view, me, claim);
        opts.push({
          score: 5 + cardPoints(card) / 10 + eff.score / 2 + rand() * 2,
          action: {
            type: "play",
            cardId: card.id,
            faceDown: true,
            claim,
            chosenColor: claim.value === "wild4" ? bestColor(view.hand, rand) : null,
            swapTarget: eff.swapTarget ?? null,
          },
        });
      }
    }
  }
  return opts;
}

function decideChallenge(view: GameView, me: string, rand: Rand, p: Personality): Action {
  const ph = view.phase;
  if (ph.kind !== "challenge") return { type: "trust" };
  if (knownLiarCopies(view, ph.claim) >= liarCopies(ph.claim)) return { type: "challenge" };
  const claimant = view.players[idx(view, ph.by)];
  const myI = idx(view, me);
  const iAmVictim = nextOf(view, idx(view, ph.by)) === myI;
  let pr = p.suspicion;
  if (iAmVictim && (ph.claim.value === "draw2" || ph.claim.value === "wild4")) pr += 0.22;
  if (iAmVictim && ph.claim.value === "skip") pr += 0.08;
  if (claimant.handCount === 0) pr += 0.4;
  else if (claimant.handCount <= 2) pr += 0.15;
  if (ph.claim.value === "7" && ph.swapTarget === me) pr += 0.2;
  // Fewer bots should pile onto the same challenge in big games.
  pr /= Math.sqrt(Math.max(1, view.players.length - 2));
  return rand() < Math.min(pr, 0.9) ? { type: "challenge" } : { type: "trust" };
}

function decideWlcCommit(view: GameView, rand: Rand): Action | null {
  const ph = view.phase;
  if (ph.kind !== "wlcCommit" || view.hand.length === 0) return null;
  const honest = view.hand.filter((c) => c.color === ph.color && !isWild(c.value));
  if (honest.length > 0 && rand() < 0.88) {
    const c = honest.reduce((a, b) => (cardPoints(a) <= cardPoints(b) ? a : b));
    return { type: "wlcCommit", cardId: c.id };
  }
  const c = view.hand.reduce((a, b) => (cardPoints(a) >= cardPoints(b) ? a : b));
  return { type: "wlcCommit", cardId: c.id };
}

function decideWlcChallenge(view: GameView, rand: Rand): Action {
  const ph = view.phase;
  if (ph.kind !== "wlcChallenge") return { type: "wlcEnd" };
  const hidden = ph.commits.filter((c) => c.status === "hidden");
  if (hidden.length === 0) return { type: "wlcEnd" };
  const target = hidden.reduce((a, b) =>
    view.players[idx(view, a.who)].handCount <= view.players[idx(view, b.who)].handCount ? a : b,
  );
  const lied = ph.commits.filter((c) => c.status === "lied").length;
  let pr = lied === 0 ? 0.7 : 0.45;
  if (view.players[idx(view, target.who)].handCount <= 1) pr += 0.3;
  return rand() < pr ? { type: "wlcChallenge", target: target.who } : { type: "wlcEnd" };
}

/**
 * One decision for a bot (or an auto-played seat) based solely on its own view.
 * Returns null when the bot has nothing to do right now.
 */
export function botAction(view: GameView, me: string, rand: Rand = Math.random): Action | null {
  const ph = view.phase;
  if (ph.kind === "roundOver") return null;
  const p = personality(me);
  const myI = idx(view, me);
  if (myI < 0) return null;
  const mine = view.players[myI];

  // UNO: declare (unless this bot "forgets" this time), and catch others.
  const forgets = hash(`${me}:${view.turnId}`) < p.forgetful;
  const myTurn = view.current === myI && (ph.kind === "turn" || ph.kind === "afterDraw");
  if (!mine.unoDeclared && !forgets && (mine.handCount === 1 || (mine.handCount === 2 && myTurn))) {
    return { type: "uno" };
  }
  const vulnerable = view.players.find((o) => o.id !== me && o.unoVulnerable);
  if (vulnerable && rand() < 0.5) return { type: "catch", target: vulnerable.id };

  switch (ph.kind) {
    case "challenge":
      if (ph.by === me || ph.responded.includes(me)) return null;
      return decideChallenge(view, me, rand, p);
    case "wlcCommit":
      if (ph.by === me || ph.committed.includes(me)) return null;
      return decideWlcCommit(view, rand);
    case "wlcChallenge":
      return ph.by === me ? decideWlcChallenge(view, rand) : null;
    case "turn": {
      if (view.current !== myI) return null;
      const opts = playOptions(view, me, view.hand, rand, p);
      const best = opts.sort((a, b) => b.score - a.score)[0];
      return best && best.score > 3 ? best.action : { type: "draw" };
    }
    case "afterDraw": {
      if (view.current !== myI || !ph.cardId) return null;
      const card = view.hand.find((c) => c.id === ph.cardId);
      if (!card) return { type: "keep" };
      const best = playOptions(view, me, [card], rand, p).sort((a, b) => b.score - a.score)[0];
      return best && best.score > 3 ? best.action : { type: "keep" };
    }
  }
  return null;
}

/** Would this bot act right now? (Used to keep the challenge window short when only bots remain.) */
export function botHasWork(view: GameView, me: string): boolean {
  const ph = view.phase;
  const myI = idx(view, me);
  if (myI < 0 || ph.kind === "roundOver") return false;
  switch (ph.kind) {
    case "challenge":
      return ph.by !== me && !ph.responded.includes(me);
    case "wlcCommit":
      return ph.by !== me && !ph.committed.includes(me);
    case "wlcChallenge":
      return ph.by === me;
    case "turn":
    case "afterDraw":
      return view.current === myI;
  }
}
