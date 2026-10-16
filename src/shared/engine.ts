import {
  CLAIMABLE_VALUES,
  COLORS,
  type Card,
  type Claim,
  type Color,
  type TopFace,
  type Value,
  cardPoints,
  deckTemplate,
  isNumber,
  isWild,
  matchesTop,
  sameIdentity,
} from "./cards";
import { type RngHolder, nextRandom, randId, shuffle } from "./rng";

export const HAND_SIZE = 7;
export const WLC_COMMIT_MS = 25_000;
export const WLC_CHALLENGE_MS = 30_000;
export const CHEAT_PENALTY = 6;

export interface GameSettings {
  /** Allow (illegally) playing a Regular Card face down; caught = take back + draw 6. */
  allowRegularFaceDown: boolean;
  challengeSeconds: number;
  turnSeconds: number;
  /** 0 = single round, otherwise first to reach this score. */
  targetScore: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  allowRegularFaceDown: true,
  challengeSeconds: 6,
  turnSeconds: 30,
  targetScore: 0,
};

export interface GPlayer {
  id: string;
  hand: Card[];
  unoDeclared: boolean;
  unoVulnerable: boolean;
}

export interface DiscardEntry {
  seq: number;
  card: Card;
  /** Played face down (Liar's Card or illegal Regular). */
  faceDown: boolean;
  /** A face-down card that was challenged and turned out honest — now visible. */
  revealed: boolean;
  claim: Claim | null;
  chosenColor: Color | null;
  by: string | null;
  rot: number;
}

export type CommitStatus = "hidden" | "honest" | "lied";
export interface WlcCommit {
  who: string;
  card: Card;
  status: CommitStatus;
}

export type Phase =
  | { kind: "turn" }
  | { kind: "afterDraw"; cardId: string }
  | { kind: "challenge"; by: string; seq: number; swapTarget: string | null; responded: string[] }
  | { kind: "wlcCommit"; by: string; color: Color; commits: WlcCommit[] }
  | { kind: "wlcChallenge"; by: string; color: Color; commits: WlcCommit[] }
  | { kind: "roundOver"; winners: string[]; points: number; gameOver: boolean };

export interface GameState extends RngHolder {
  players: GPlayer[];
  drawPile: Card[];
  discard: DiscardEntry[];
  direction: 1 | -1;
  current: number;
  dealer: number;
  phase: Phase;
  deadline: number | null;
  settings: GameSettings;
  seq: number;
  turnId: number;
  round: number;
  /** Cumulative scores (updated when a round ends). */
  scores: Record<string, number>;
}

export type DrawReason = "turn" | "timeout" | "challenge" | "lie" | "cheat" | "draw2" | "wild4" | "uno";

export type GameEvent =
  | { t: "deal"; order: string[]; count: number; start: Card; burned: Card[]; hands: Record<string, Card[]> }
  | { t: "turn"; who: string }
  | {
      t: "play";
      who: string;
      seq: number;
      faceDown: boolean;
      card: Card | null;
      claim: Claim | null;
      chosenColor: Color | null;
      swapTarget: string | null;
    }
  | { t: "draw"; who: string; n: number; cards: Card[] | null; reason: DrawReason }
  | { t: "reshuffle"; n: number }
  | { t: "keep"; who: string }
  | { t: "trust"; who: string }
  | { t: "accepted"; who: string }
  | { t: "challenge"; who: string; target: string }
  | { t: "reveal"; who: string; card: Card; result: "honest" | "lie" | "cheat" }
  | { t: "swap"; a: string; b: string }
  | { t: "pass"; direction: 1 | -1 }
  | { t: "reverse"; direction: 1 | -1 }
  | { t: "skip"; who: string }
  | { t: "color"; color: Color }
  | { t: "wlcCommit"; who: string; auto: boolean }
  | { t: "wlcPhase"; by: string }
  | { t: "wlcReveal"; who: string; card: Card; honest: boolean }
  | { t: "wlcDiscard"; who: string[] }
  | { t: "uno"; who: string }
  | { t: "caught"; who: string; by: string }
  | { t: "timeout"; who: string }
  | { t: "roundEnd"; winners: string[]; points: number; gameOver: boolean };

export type Action =
  | {
      type: "play";
      cardId: string;
      faceDown: boolean;
      claim?: Claim | null;
      chosenColor?: Color | null;
      swapTarget?: string | null;
    }
  | { type: "draw" }
  | { type: "keep" }
  | { type: "trust" }
  | { type: "challenge" }
  | { type: "wlcCommit"; cardId: string }
  | { type: "wlcChallenge"; target: string }
  | { type: "wlcEnd" }
  | { type: "uno" }
  | { type: "catch"; target: string };

export class EngineError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };

const isColor = (c: unknown): c is Color => typeof c === "string" && (COLORS as readonly string[]).includes(c);

// ───────────────────────────── helpers ─────────────────────────────

export function playerIndex(s: GameState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}

export function nextIndex(s: GameState, from: number, steps = 1): number {
  const n = s.players.length;
  return (((from + s.direction * steps) % n) + n) % n;
}

export function entryFace(e: DiscardEntry): TopFace {
  const id: Claim = e.faceDown && !e.revealed && e.claim ? e.claim : e.card;
  const color = isWild(id.value) ? (e.chosenColor ?? "red") : (id.color ?? "red");
  return { color, value: id.value };
}

export function effectiveTop(s: GameState): TopFace {
  return entryFace(s.discard[s.discard.length - 1]);
}

/** All identities that may be announced for a face-down card on this top. */
export function legalClaims(top: TopFace): Claim[] {
  const out: Claim[] = [];
  for (const color of COLORS) {
    for (const value of CLAIMABLE_VALUES) {
      if (value === "wild4") continue;
      const c: Claim = { color, value };
      if (matchesTop(c, top)) out.push(c);
    }
  }
  out.push({ color: null, value: "wild4" });
  return out;
}

export function isLegalClaim(c: Claim | null | undefined, top: TopFace): c is Claim {
  if (!c || typeof c !== "object") return false;
  if (!CLAIMABLE_VALUES.includes(c.value as Value)) return false;
  if (c.value === "wild4") return c.color === null;
  if (!isColor(c.color)) return false;
  return matchesTop(c, top);
}

/** Can this card be played at all right now (by its owner, on their turn)? */
export function canPlayCard(card: Card, top: TopFace, settings: GameSettings): boolean {
  if (card.value === "wlc") return true;
  if (card.liar) return true; // may always be played face down with a (possibly false) claim
  if (matchesTop(card, top)) return true;
  return settings.allowRegularFaceDown;
}

function drawCards(s: GameState, pIdx: number, n: number, reason: DrawReason, ev: GameEvent[]): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (s.drawPile.length === 0) {
      // While a face-down card awaits a challenge, the card under it must survive: a caught lie restores it as top.
      const keep = s.phase.kind === "challenge" ? 2 : 1;
      if (s.discard.length <= keep) break;
      const kept = s.discard.slice(-keep);
      const recycled = s.discard.slice(0, -keep).map((e) => e.card);
      s.discard = kept;
      s.drawPile = shuffle(s, recycled);
      ev.push({ t: "reshuffle", n: recycled.length });
    }
    const c = s.drawPile.pop();
    if (!c) break;
    drawn.push(c);
  }
  s.players[pIdx].hand.push(...drawn);
  if (drawn.length > 0) ev.push({ t: "draw", who: s.players[pIdx].id, n: drawn.length, cards: drawn, reason });
  return drawn;
}

function startTurn(s: GameState, idx: number, now: number, ev: GameEvent[]) {
  s.current = idx;
  s.phase = { kind: "turn" };
  s.deadline = now + s.settings.turnSeconds * 1000;
  s.turnId++;
  ev.push({ t: "turn", who: s.players[idx].id });
}

/** A turn action by the next player closes everybody's "UNO catch" window. */
function clearVulnerable(s: GameState) {
  for (const p of s.players) p.unoVulnerable = false;
}

function refreshUno(s: GameState, before: number[]) {
  s.players.forEach((p, i) => {
    const after = p.hand.length;
    if (after > before[i] || after === 0) p.unoDeclared = false;
    if (after !== 1) p.unoVulnerable = false;
    else if (before[i] !== 1) p.unoVulnerable = !p.unoDeclared;
  });
}

function pushDiscard(
  s: GameState,
  card: Card,
  by: string | null,
  faceDown: boolean,
  claim: Claim | null,
  chosenColor: Color | null,
): DiscardEntry {
  const e: DiscardEntry = {
    seq: ++s.seq,
    card,
    faceDown,
    revealed: false,
    claim,
    chosenColor,
    by,
    rot: Math.round((nextRandom(s) - 0.5) * 28),
  };
  s.discard.push(e);
  return e;
}

function endRound(s: GameState, winners: string[], ev: GameEvent[]) {
  let points = 0;
  for (const p of s.players) {
    if (winners.includes(p.id)) continue;
    for (const c of p.hand) points += cardPoints(c);
  }
  for (const w of winners) s.scores[w] = (s.scores[w] ?? 0) + points;
  const target = s.settings.targetScore;
  const gameOver = target <= 0 || winners.some((w) => (s.scores[w] ?? 0) >= target);
  s.phase = { kind: "roundOver", winners, points, gameOver };
  s.deadline = null;
  for (const p of s.players) p.unoVulnerable = false;
  ev.push({ t: "roundEnd", winners, points, gameOver });
}

/** Applies a card's effect after it has been accepted (face up, unchallenged, or honest). */
function resolveEffects(
  s: GameState,
  byIdx: number,
  identity: Claim,
  chosenColor: Color | null,
  swapTarget: string | null,
  penaltyIdx: number | null,
  now: number,
  ev: GameEvent[],
) {
  const by = s.players[byIdx];
  if (by.hand.length === 0) {
    if (penaltyIdx !== null) drawCards(s, penaltyIdx, 1, "challenge", ev);
    endRound(s, [by.id], ev);
    return;
  }
  let skipNext = false;
  switch (identity.value) {
    case "7": {
      let tIdx = swapTarget ? playerIndex(s, swapTarget) : -1;
      if (tIdx < 0 || tIdx === byIdx) tIdx = nextIndex(s, byIdx, 1);
      const t = s.players[tIdx];
      [by.hand, t.hand] = [t.hand, by.hand];
      ev.push({ t: "swap", a: by.id, b: t.id });
      break;
    }
    case "0": {
      const hands = s.players.map((p) => p.hand);
      s.players.forEach((_, i) => {
        s.players[nextIndex(s, i, 1)].hand = hands[i];
      });
      ev.push({ t: "pass", direction: s.direction });
      break;
    }
    case "reverse":
      s.direction = s.direction === 1 ? -1 : 1;
      ev.push({ t: "reverse", direction: s.direction });
      if (s.players.length === 2) {
        skipNext = true;
        ev.push({ t: "skip", who: s.players[nextIndex(s, byIdx, 1)].id });
      }
      break;
    case "skip":
      skipNext = true;
      ev.push({ t: "skip", who: s.players[nextIndex(s, byIdx, 1)].id });
      break;
    case "draw2":
    case "wild4": {
      const victim = nextIndex(s, byIdx, 1);
      drawCards(s, victim, identity.value === "draw2" ? 2 : 4, identity.value, ev);
      skipNext = true;
      ev.push({ t: "skip", who: s.players[victim].id });
      break;
    }
  }
  if (chosenColor) ev.push({ t: "color", color: chosenColor });
  // Rule: if a 7 or 0 is challenged, the penalty card is drawn AFTER any exchange of hands.
  if (penaltyIdx !== null) drawCards(s, penaltyIdx, 1, "challenge", ev);
  startTurn(s, nextIndex(s, byIdx, skipNext ? 2 : 1), now, ev);
}

function topEntry(s: GameState) {
  return s.discard[s.discard.length - 1];
}

function resolveUnchallenged(s: GameState, now: number, ev: GameEvent[]) {
  const ph = s.phase;
  if (ph.kind !== "challenge") return;
  const e = topEntry(s);
  const byIdx = playerIndex(s, ph.by);
  ev.push({ t: "accepted", who: ph.by });
  resolveEffects(s, byIdx, e.claim!, e.chosenColor, ph.swapTarget, null, now, ev);
}

function resolveChallenge(s: GameState, challengerIdx: number, now: number, ev: GameEvent[]) {
  const ph = s.phase;
  if (ph.kind !== "challenge") return;
  const e = topEntry(s);
  const byIdx = playerIndex(s, ph.by);
  const by = s.players[byIdx];
  ev.push({ t: "challenge", who: s.players[challengerIdx].id, target: by.id });
  if (!e.card.liar) {
    // A Regular Card passed off as a Liar's Card: take it back and draw 6, whatever was claimed.
    s.discard.pop();
    by.hand.push(e.card);
    ev.push({ t: "reveal", who: by.id, card: e.card, result: "cheat" });
    drawCards(s, byIdx, CHEAT_PENALTY, "cheat", ev);
    startTurn(s, nextIndex(s, byIdx, 1), now, ev);
    return;
  }
  if (sameIdentity(e.card, e.claim!)) {
    e.revealed = true;
    ev.push({ t: "reveal", who: by.id, card: e.card, result: "honest" });
    resolveEffects(s, byIdx, e.claim!, e.chosenColor, ph.swapTarget, challengerIdx, now, ev);
  } else {
    s.discard.pop();
    by.hand.push(e.card);
    ev.push({ t: "reveal", who: by.id, card: e.card, result: "lie" });
    drawCards(s, byIdx, 1, "lie", ev);
    startTurn(s, nextIndex(s, byIdx, 1), now, ev);
  }
}

function enterWlcChallenge(s: GameState, now: number, ev: GameEvent[]) {
  const ph = s.phase;
  if (ph.kind !== "wlcCommit") return;
  const order = s.players.map((p) => p.id);
  const commits = [...ph.commits].sort((a, b) => order.indexOf(a.who) - order.indexOf(b.who));
  s.phase = { kind: "wlcChallenge", by: ph.by, color: ph.color, commits };
  s.deadline = now + WLC_CHALLENGE_MS;
  ev.push({ t: "wlcPhase", by: ph.by });
}

function finishWlc(s: GameState, now: number, ev: GameEvent[]) {
  const ph = s.phase;
  if (ph.kind !== "wlcChallenge") return;
  const going = ph.commits.filter((c) => c.status !== "lied");
  const wlc = s.discard.pop()!;
  for (const c of going) {
    s.discard.push({
      seq: ++s.seq,
      card: c.card,
      faceDown: c.status === "hidden",
      revealed: false,
      claim: null,
      chosenColor: null,
      by: c.who,
      rot: Math.round((nextRandom(s) - 0.5) * 28),
    });
  }
  s.discard.push(wlc);
  ev.push({ t: "wlcDiscard", who: going.map((c) => c.who) });
  const winners = s.players.filter((p) => p.hand.length === 0).map((p) => p.id);
  if (winners.length > 0) {
    endRound(s, winners, ev);
    return;
  }
  startTurn(s, nextIndex(s, playerIndex(s, ph.by), 1), now, ev);
}

/** Card a player puts down for a Wild Liar's Challenge when they do not choose one (timeout / autoplay). */
export function defaultWlcCommit(hand: Card[], color: Color): Card {
  const honest = hand.filter((c) => c.color === color && !isWild(c.value));
  if (honest.length > 0) return honest.reduce((a, b) => (cardPoints(a) <= cardPoints(b) ? a : b));
  return hand.reduce((a, b) => (cardPoints(a) >= cardPoints(b) ? a : b));
}

// ───────────────────────────── actions ─────────────────────────────

function actPlay(s: GameState, pIdx: number, a: Extract<Action, { type: "play" }>, now: number, ev: GameEvent[]) {
  const ph = s.phase;
  if (!(ph.kind === "turn" || ph.kind === "afterDraw") || s.current !== pIdx) throw new EngineError("notYourTurn");
  if (ph.kind === "afterDraw" && ph.cardId !== a.cardId) throw new EngineError("mustPlayDrawn");
  const p = s.players[pIdx];
  const ci = p.hand.findIndex((c) => c.id === a.cardId);
  if (ci < 0) throw new EngineError("noSuchCard");
  const card = p.hand[ci];
  const top = effectiveTop(s);

  let identity: Claim;
  let chosen: Color | null = null;
  let claim: Claim | null = null;
  if (card.value === "wlc") {
    if (a.faceDown) throw new EngineError("wlcFaceUp");
    if (!isColor(a.chosenColor)) throw new EngineError("chooseColor");
    chosen = a.chosenColor;
    identity = { color: null, value: "wlc" };
  } else if (!a.faceDown) {
    if (card.liar) throw new EngineError("liarMustBeFaceDown");
    if (!matchesTop(card, top)) throw new EngineError("noMatch");
    identity = { color: card.color, value: card.value };
  } else {
    if (!card.liar && !s.settings.allowRegularFaceDown) throw new EngineError("regularMustBeFaceUp");
    if (!isLegalClaim(a.claim, top)) throw new EngineError("badClaim");
    claim = { color: a.claim.color, value: a.claim.value };
    if (claim.value === "wild4") {
      if (!isColor(a.chosenColor)) throw new EngineError("chooseColor");
      chosen = a.chosenColor;
    }
    identity = claim;
  }

  let swapTarget: string | null = null;
  if (identity.value === "7" && p.hand.length > 1) {
    const t = a.swapTarget ?? (s.players.length === 2 ? s.players[nextIndex(s, pIdx, 1)].id : null);
    const tIdx = t ? playerIndex(s, t) : -1;
    if (tIdx < 0 || tIdx === pIdx) throw new EngineError("chooseSwapTarget");
    swapTarget = t;
  }

  clearVulnerable(s);
  p.hand.splice(ci, 1);
  const faceDown = card.value !== "wlc" && a.faceDown;
  const entry = pushDiscard(s, card, p.id, faceDown, claim, chosen);
  ev.push({
    t: "play",
    who: p.id,
    seq: entry.seq,
    faceDown,
    card,
    claim,
    chosenColor: chosen,
    swapTarget,
  });

  if (faceDown) {
    s.phase = { kind: "challenge", by: p.id, seq: entry.seq, swapTarget, responded: [] };
    s.deadline = now + s.settings.challengeSeconds * 1000;
    return;
  }
  if (card.value === "wlc") {
    ev.push({ t: "color", color: chosen! });
    if (p.hand.length === 0) {
      endRound(s, [p.id], ev);
      return;
    }
    s.phase = { kind: "wlcCommit", by: p.id, color: chosen!, commits: [] };
    s.deadline = now + WLC_COMMIT_MS;
    return;
  }
  resolveEffects(s, pIdx, identity, chosen, swapTarget, null, now, ev);
}

function actDraw(s: GameState, pIdx: number, now: number, ev: GameEvent[], reason: DrawReason = "turn") {
  if (s.phase.kind !== "turn" || s.current !== pIdx) throw new EngineError("notYourTurn");
  clearVulnerable(s);
  const drawn = drawCards(s, pIdx, 1, reason, ev);
  const card = drawn[0];
  if (!card || reason === "timeout" || !canPlayCard(card, effectiveTop(s), s.settings)) {
    if (card && reason !== "timeout") ev.push({ t: "keep", who: s.players[pIdx].id });
    startTurn(s, nextIndex(s, pIdx, 1), now, ev);
    return;
  }
  s.phase = { kind: "afterDraw", cardId: card.id };
  s.deadline = now + s.settings.turnSeconds * 1000;
}

function apply(s: GameState, pIdx: number, a: Action, now: number, ev: GameEvent[]) {
  const ph = s.phase;
  if (ph.kind === "roundOver") throw new EngineError("roundOver");
  const me = s.players[pIdx];
  switch (a.type) {
    case "play":
      return actPlay(s, pIdx, a, now, ev);
    case "draw":
      return actDraw(s, pIdx, now, ev);
    case "keep":
      if (ph.kind !== "afterDraw" || s.current !== pIdx) throw new EngineError("notYourTurn");
      ev.push({ t: "keep", who: me.id });
      return startTurn(s, nextIndex(s, pIdx, 1), now, ev);
    case "trust": {
      if (ph.kind !== "challenge") throw new EngineError("noChallenge");
      if (ph.by === me.id) throw new EngineError("ownPlay");
      if (ph.responded.includes(me.id)) throw new EngineError("alreadyResponded");
      ph.responded.push(me.id);
      ev.push({ t: "trust", who: me.id });
      if (ph.responded.length >= s.players.length - 1) resolveUnchallenged(s, now, ev);
      return;
    }
    case "challenge": {
      if (ph.kind !== "challenge") throw new EngineError("noChallenge");
      if (ph.by === me.id) throw new EngineError("ownPlay");
      if (ph.responded.includes(me.id)) throw new EngineError("alreadyResponded");
      return resolveChallenge(s, pIdx, now, ev);
    }
    case "wlcCommit": {
      if (ph.kind !== "wlcCommit") throw new EngineError("noWlc");
      if (ph.by === me.id) throw new EngineError("ownPlay");
      if (ph.commits.some((c) => c.who === me.id)) throw new EngineError("alreadyCommitted");
      const ci = me.hand.findIndex((c) => c.id === a.cardId);
      if (ci < 0) throw new EngineError("noSuchCard");
      const [card] = me.hand.splice(ci, 1);
      ph.commits.push({ who: me.id, card, status: "hidden" });
      ev.push({ t: "wlcCommit", who: me.id, auto: false });
      if (ph.commits.length >= s.players.length - 1) enterWlcChallenge(s, now, ev);
      return;
    }
    case "wlcChallenge": {
      if (ph.kind !== "wlcChallenge") throw new EngineError("noWlc");
      if (ph.by !== me.id) throw new EngineError("notYourWlc");
      const commit = ph.commits.find((c) => c.who === a.target && c.status === "hidden");
      if (!commit) throw new EngineError("badTarget");
      const tIdx = playerIndex(s, commit.who);
      const honest = commit.card.color === ph.color && !isWild(commit.card.value);
      ev.push({ t: "challenge", who: me.id, target: commit.who });
      ev.push({ t: "wlcReveal", who: commit.who, card: commit.card, honest });
      if (honest) {
        commit.status = "honest";
        return finishWlc(s, now, ev);
      }
      commit.status = "lied";
      s.players[tIdx].hand.push(commit.card);
      drawCards(s, tIdx, 1, "lie", ev);
      if (!ph.commits.some((c) => c.status === "hidden")) finishWlc(s, now, ev);
      return;
    }
    case "wlcEnd":
      if (ph.kind !== "wlcChallenge") throw new EngineError("noWlc");
      if (ph.by !== me.id) throw new EngineError("notYourWlc");
      return finishWlc(s, now, ev);
    case "uno": {
      const n = me.hand.length;
      if (n < 1 || n > 2 || me.unoDeclared) throw new EngineError("cannotUno");
      me.unoDeclared = true;
      me.unoVulnerable = false;
      ev.push({ t: "uno", who: me.id });
      return;
    }
    case "catch": {
      const tIdx = playerIndex(s, a.target);
      if (tIdx < 0 || tIdx === pIdx) throw new EngineError("badTarget");
      const t = s.players[tIdx];
      if (!t.unoVulnerable) throw new EngineError("notVulnerable");
      t.unoVulnerable = false;
      ev.push({ t: "caught", who: t.id, by: me.id });
      drawCards(s, tIdx, 2, "uno", ev);
      return;
    }
    default:
      throw new EngineError("badAction");
  }
}

function run(state: GameState, fn: (s: GameState, ev: GameEvent[]) => void): ApplyResult {
  const s = structuredClone(state);
  const ev: GameEvent[] = [];
  const before = s.players.map((p) => p.hand.length);
  try {
    fn(s, ev);
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.code };
    throw e;
  }
  refreshUno(s, before);
  return { ok: true, state: s, events: ev };
}

/** Validates and applies one player action. Never mutates the input state. */
export function applyAction(state: GameState, playerId: string, action: Action, now: number): ApplyResult {
  return run(state, (s, ev) => {
    const pIdx = playerIndex(s, playerId);
    if (pIdx < 0) throw new EngineError("notInGame");
    if (!action || typeof action !== "object") throw new EngineError("badAction");
    apply(s, pIdx, action, now, ev);
  });
}

/** Applies the default outcome of an expired phase timer. Returns null if nothing is due. */
export function applyTimeout(state: GameState, now: number): ApplyResult | null {
  if (state.deadline === null || now < state.deadline || state.phase.kind === "roundOver") return null;
  return run(state, (s, ev) => {
    const ph = s.phase;
    switch (ph.kind) {
      case "turn":
        ev.push({ t: "timeout", who: s.players[s.current].id });
        return actDraw(s, s.current, now, ev, "timeout");
      case "afterDraw":
        ev.push({ t: "timeout", who: s.players[s.current].id });
        ev.push({ t: "keep", who: s.players[s.current].id });
        return startTurn(s, nextIndex(s, s.current, 1), now, ev);
      case "challenge":
        return resolveUnchallenged(s, now, ev);
      case "wlcCommit": {
        for (const p of s.players) {
          if (p.id === ph.by || ph.commits.some((c) => c.who === p.id) || p.hand.length === 0) continue;
          const card = defaultWlcCommit(p.hand, ph.color);
          p.hand.splice(p.hand.indexOf(card), 1);
          ph.commits.push({ who: p.id, card, status: "hidden" });
          ev.push({ t: "wlcCommit", who: p.id, auto: true });
        }
        return enterWlcChallenge(s, now, ev);
      }
      case "wlcChallenge":
        return finishWlc(s, now, ev);
    }
  });
}

// ───────────────────────────── setup ─────────────────────────────

export interface RoundInit {
  playerIds: string[];
  dealer: number;
  settings: GameSettings;
  seed: number;
  scores?: Record<string, number>;
  round?: number;
  now: number;
}

export function createRound(init: RoundInit): { state: GameState; events: GameEvent[] } {
  if (init.playerIds.length < 2) throw new EngineError("notEnoughPlayers");
  const s: GameState = {
    rng: init.seed | 0,
    players: init.playerIds.map((id) => ({ id, hand: [], unoDeclared: false, unoVulnerable: false })),
    drawPile: [],
    discard: [],
    direction: 1,
    current: 0,
    dealer: init.dealer % init.playerIds.length,
    phase: { kind: "turn" },
    deadline: null,
    settings: { ...init.settings },
    seq: 0,
    turnId: 0,
    round: init.round ?? 1,
    scores: { ...(init.scores ?? {}) },
  };
  for (const id of init.playerIds) s.scores[id] ??= 0;
  const used = new Set<string>();
  s.drawPile = shuffle(
    s,
    deckTemplate().map((c) => {
      let id = randId(s);
      while (used.has(id)) id = randId(s);
      used.add(id);
      return { ...c, id };
    }),
  );
  const order: string[] = [];
  for (let k = 1; k <= s.players.length; k++) order.push(s.players[nextIndex(s, s.dealer, k)].id);
  for (let r = 0; r < HAND_SIZE; r++) {
    for (const id of order) s.players[playerIndex(s, id)].hand.push(s.drawPile.pop()!);
  }
  const burned: Card[] = [];
  let start = s.drawPile.pop()!;
  while (!isNumber(start.value)) {
    burned.push(start);
    pushDiscard(s, start, null, false, null, null);
    start = s.drawPile.pop()!;
  }
  pushDiscard(s, start, null, false, null, null);
  const hands: Record<string, Card[]> = {};
  for (const p of s.players) hands[p.id] = [...p.hand];
  const ev: GameEvent[] = [{ t: "deal", order, count: HAND_SIZE, start, burned, hands }];
  startTurn(s, nextIndex(s, s.dealer, 1), init.now, ev);
  return { state: s, events: ev };
}

/** Total number of cards in play — must always be 112. */
export function countCards(s: GameState): number {
  let n = s.drawPile.length + s.discard.length;
  for (const p of s.players) n += p.hand.length;
  const ph = s.phase;
  if (ph.kind === "wlcCommit" || ph.kind === "wlcChallenge") {
    n += ph.commits.filter((c) => c.status !== "lied").length;
  }
  return n;
}
