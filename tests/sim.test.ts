import { describe, expect, it } from "vitest";
import { botAction } from "../src/shared/bot";
import { CLAIMABLE_VALUES, COLORS, type Card } from "../src/shared/cards";
import {
  type Action,
  type GameEvent,
  type GameState,
  DEFAULT_SETTINGS,
  type GameSettings,
  applyAction,
  applyTimeout,
  countCards,
  createRound,
} from "../src/shared/engine";
import { eventsFor, viewFor } from "../src/shared/view";

function mulberry(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allIds(s: GameState): string[] {
  const ids = [...s.drawPile, ...s.discard.map((e) => e.card), ...s.players.flatMap((p) => p.hand)].map((c) => c.id);
  const ph = s.phase;
  if (ph.kind === "wlcCommit" || ph.kind === "wlcChallenge") {
    for (const c of ph.commits) if (c.status !== "lied") ids.push(c.card.id);
  }
  return ids;
}

/** Ids a viewer must not be able to see right now. */
function hiddenFrom(s: GameState, viewer: string): Set<string> {
  const h = new Set<string>();
  for (const c of s.drawPile) h.add(c.id);
  for (const p of s.players) if (p.id !== viewer) for (const c of p.hand) h.add(c.id);
  for (const e of s.discard) if (e.faceDown && !e.revealed && e.by !== viewer) h.add(e.card.id);
  const ph = s.phase;
  if (ph.kind === "wlcCommit" || ph.kind === "wlcChallenge") {
    for (const c of ph.commits) if (c.who !== viewer && c.status === "hidden") h.add(c.card.id);
  }
  if (ph.kind === "roundOver") h.clear();
  return h;
}

const ID_RE = /"id":"([a-z0-9]+)"/g;
function idsIn(obj: unknown): string[] {
  return [...JSON.stringify(obj).matchAll(ID_RE)].map((m) => m[1]);
}

function randomAction(s: GameState, who: string, rand: () => number): Action {
  const p = s.players.find((x) => x.id === who)!;
  const r = rand();
  const pickCard = (): Card | undefined => p.hand[Math.floor(rand() * p.hand.length)];
  if (r < 0.4 && p.hand.length) {
    const c = pickCard()!;
    const value = CLAIMABLE_VALUES[Math.floor(rand() * CLAIMABLE_VALUES.length)];
    return {
      type: "play",
      cardId: c.id,
      faceDown: rand() < 0.6,
      claim: { color: value === "wild4" ? null : COLORS[Math.floor(rand() * 4)], value },
      chosenColor: COLORS[Math.floor(rand() * 4)],
      swapTarget: s.players[Math.floor(rand() * s.players.length)].id,
    };
  }
  const simple: Action[] = [
    { type: "draw" },
    { type: "keep" },
    { type: "trust" },
    { type: "challenge" },
    { type: "uno" },
    { type: "wlcEnd" },
    { type: "catch", target: s.players[Math.floor(rand() * s.players.length)].id },
    { type: "wlcChallenge", target: s.players[Math.floor(rand() * s.players.length)].id },
    { type: "wlcCommit", cardId: pickCard()?.id ?? "none" },
  ];
  return simple[Math.floor(rand() * simple.length)];
}

interface SimStats {
  rounds: number;
  steps: number;
  challenges: number;
  lies: number;
  wlc: number;
  multiWin: number;
}

function simulateRound(seed: number, nPlayers: number, settings: GameSettings, checkLeaks: boolean, stats: SimStats) {
  const rand = mulberry(seed);
  const ids = Array.from({ length: nPlayers }, (_, i) => `pl${i}`);
  let now = 1_000_000;
  const created = createRound({ playerIds: ids, dealer: seed % nPlayers, settings, seed, now });
  let state = created.state;
  const everPublic = new Set<string>();
  const notePublic = (evs: GameEvent[]) => {
    for (const e of evs) {
      if (e.t === "play" && !e.faceDown && e.card) everPublic.add(e.card.id);
      if (e.t === "reveal" || e.t === "wlcReveal") everPublic.add(e.card.id);
      if (e.t === "deal") [e.start, ...e.burned].forEach((c) => everPublic.add(c.id));
      if (e.t === "challenge") stats.challenges++;
      if (e.t === "reveal" && e.result !== "honest") stats.lies++;
      if (e.t === "wlcPhase") stats.wlc++;
    }
  };
  const check = (s: GameState, evs: GameEvent[]) => {
    expect(countCards(s)).toBe(112);
    const all = allIds(s);
    expect(new Set(all).size).toBe(112);
    for (const p of s.players) {
      if (p.unoVulnerable) expect(p.hand.length).toBe(1);
    }
    if (!checkLeaks) return;
    for (const v of [...ids, null]) {
      const hidden = v ? hiddenFrom(s, v) : new Set(all);
      if (s.phase.kind === "roundOver") hidden.clear();
      const view = viewFor(s, v);
      if (v) expect(view.hand.map((c) => c.id)).toEqual(s.players.find((p) => p.id === v)!.hand.map((c) => c.id));
      for (const id of idsIn(view)) {
        if (hidden.has(id) && !everPublic.has(id)) throw new Error(`view leak to ${v}: ${id}`);
      }
      const redacted = eventsFor(evs, v);
      for (const id of idsIn(redacted)) {
        if (hidden.has(id) && !everPublic.has(id)) {
          throw new Error(`event leak to ${v}: ${id} in ${JSON.stringify(redacted)}`);
        }
      }
    }
  };

  notePublic(created.events);
  check(state, created.events);
  for (let step = 0; step < 4000; step++) {
    if (state.phase.kind === "roundOver") {
      stats.rounds++;
      if (state.phase.winners.length > 1) stats.multiWin++;
      return state;
    }
    stats.steps++;
    now += 50 + Math.floor(rand() * 400);
    let result = null;
    if (rand() < 0.12) {
      const who = ids[Math.floor(rand() * ids.length)];
      const r = applyAction(state, who, randomAction(state, who, rand), now);
      if (r.ok) result = r;
    }
    if (!result) {
      const order = [...ids].sort(() => rand() - 0.5);
      for (const who of order) {
        const a = botAction(viewFor(state, who, { fullDiscard: true }), who, rand);
        if (!a) continue;
        const r = applyAction(state, who, a, now);
        if (r.ok) {
          result = r;
          break;
        }
        // Bots must only produce legal actions (except racing "catch"/"uno").
        if (a.type !== "catch" && a.type !== "uno") throw new Error(`bot illegal ${a.type}: ${r.error}`);
      }
    }
    if (!result && state.deadline !== null) {
      now = Math.max(now, state.deadline);
      result = applyTimeout(state, now);
    }
    if (!result || !result.ok) throw new Error(`stuck in phase ${state.phase.kind}`);
    notePublic(result.events);
    check(result.state, result.events);
    state = result.state;
  }
  throw new Error(`round did not finish (seed ${seed})`);
}

describe("simulation", () => {
  it("bots + fuzzing: cards conserved, rounds terminate, no hidden info leaks", () => {
    const stats: SimStats = { rounds: 0, steps: 0, challenges: 0, lies: 0, wlc: 0, multiWin: 0 };
    for (let seed = 1; seed <= 150; seed++) {
      const n = 2 + (seed % 7);
      const settings = { ...DEFAULT_SETTINGS, allowRegularFaceDown: seed % 3 !== 0 };
      simulateRound(seed, n, settings, true, stats);
    }
    expect(stats.rounds).toBe(150);
    expect(stats.challenges).toBeGreaterThan(60);
    expect(stats.lies).toBeGreaterThan(20);
    expect(stats.wlc).toBeGreaterThan(10);
    console.log("leak-checked sim", stats);
  });

  it("many fast rounds without leak checks", () => {
    const stats: SimStats = { rounds: 0, steps: 0, challenges: 0, lies: 0, wlc: 0, multiWin: 0 };
    for (let seed = 1000; seed < 1400; seed++) {
      simulateRound(seed, 2 + (seed % 7), DEFAULT_SETTINGS, false, stats);
    }
    expect(stats.rounds).toBe(400);
    console.log("fast sim", stats);
  });
});
