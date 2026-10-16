import { describe, expect, it } from "vitest";
import { deckTemplate, matchesTop, cardPoints } from "../src/shared/cards";
import {
  DEFAULT_SETTINGS,
  applyAction,
  applyTimeout,
  countCards,
  createRound,
  effectiveTop,
  legalClaims,
} from "../src/shared/engine";
import { NOW, act, card, fail, setup } from "./helpers";

describe("deck", () => {
  it("has the official 112-card composition", () => {
    const d = deckTemplate();
    expect(d).toHaveLength(112);
    const count = (f: (c: (typeof d)[number]) => boolean) => d.filter(f).length;
    expect(count((c) => /^[0-9]$/.test(c.value) && !c.liar)).toBe(40);
    expect(count((c) => /^[0-9]$/.test(c.value) && c.liar)).toBe(40);
    expect(count((c) => c.value === "skip")).toBe(8);
    expect(count((c) => c.value === "reverse")).toBe(8);
    expect(count((c) => c.value === "draw2")).toBe(8);
    expect(count((c) => c.value === "wild4")).toBe(2);
    expect(count((c) => c.value === "wlc")).toBe(6);
    // Only Wild Liar's Challenge cards are non-liar among actions/wilds.
    expect(count((c) => !/^[0-9]$/.test(c.value) && !c.liar)).toBe(6);
    expect(count((c) => c.liar)).toBe(66);
  });

  it("scores cards per the rulebook", () => {
    expect(cardPoints({ value: "7" })).toBe(7);
    expect(cardPoints({ value: "skip" })).toBe(20);
    expect(cardPoints({ value: "draw2" })).toBe(20);
    expect(cardPoints({ value: "wild4" })).toBe(50);
    expect(cardPoints({ value: "wlc" })).toBe(50);
  });
});

describe("setup", () => {
  it("deals 7 each, starts on a number card, left of dealer goes first", () => {
    for (let seed = 1; seed < 200; seed++) {
      const { state, events } = createRound({
        playerIds: ["a", "b", "c", "d"],
        dealer: 2,
        settings: DEFAULT_SETTINGS,
        seed,
        now: NOW,
      });
      expect(state.players.every((p) => p.hand.length === 7)).toBe(true);
      expect(/^[0-9]$/.test(state.discard[state.discard.length - 1].card.value)).toBe(true);
      expect(state.current).toBe(3);
      expect(countCards(state)).toBe(112);
      expect(events[0].t).toBe("deal");
      const ids = new Set([...state.drawPile, ...state.discard.map((e) => e.card), ...state.players.flatMap((p) => p.hand)].map((c) => c.id));
      expect(ids.size).toBe(112);
    }
  });
});

describe("matching", () => {
  it("matches color, number, symbol; wilds match anything", () => {
    const top = { color: "red" as const, value: "5" as const };
    expect(matchesTop({ color: "red", value: "9" }, top)).toBe(true);
    expect(matchesTop({ color: "blue", value: "5" }, top)).toBe(true);
    expect(matchesTop({ color: "blue", value: "6" }, top)).toBe(false);
    expect(matchesTop({ color: null, value: "wild4" }, top)).toBe(true);
    expect(matchesTop({ color: "green", value: "skip" }, { color: "red", value: "skip" })).toBe(true);
  });

  it("legal claims are exactly matching cards plus Wild Draw 4", () => {
    const claims = legalClaims({ color: "red", value: "3" });
    expect(claims.every((c) => c.value === "wild4" || c.color === "red" || c.value === "3")).toBe(true);
    // 13 red identities + 3 other-color "3"s + wild4
    expect(claims).toHaveLength(13 + 3 + 1);
  });
});

describe("regular cards", () => {
  it("plays a matching regular card face up and passes the turn", () => {
    const s = setup({ hands: [[card("red", "7", false, "x"), card("blue", "1")], [card("blue", "2")], [card("green", "3")]] });
    const r = act(s, "p0", { type: "play", cardId: "x", faceDown: false, swapTarget: "p1" });
    expect(r.state.current).toBe(1);
    expect(r.state.players[0].hand.map((c) => c.value)).toEqual(["2"]);
    expect(r.state.players[1].hand.map((c) => c.value)).toEqual(["1"]);
  });

  it("rejects non-matching regular face up and liar cards face up", () => {
    const s = setup({ hands: [[card("blue", "7", false, "x"), card("red", "1", true, "y")], [card("blue", "2")]] });
    expect(fail(s, "p0", { type: "play", cardId: "x", faceDown: false })).toBe("noMatch");
    expect(fail(s, "p0", { type: "play", cardId: "y", faceDown: false })).toBe("liarMustBeFaceDown");
    expect(fail(s, "p1", { type: "draw" })).toBe("notYourTurn");
  });

  it("requires a swap target when a 7 is played with cards left (3+ players)", () => {
    const s = setup({ hands: [[card("red", "7", false, "x"), card("blue", "1")], [card("blue", "2")], [card("green", "3")]] });
    expect(fail(s, "p0", { type: "play", cardId: "x", faceDown: false })).toBe("chooseSwapTarget");
  });
});

describe("liar's cards and challenges", () => {
  const base = () =>
    setup({
      hands: [
        [card("red", "9", true, "honest"), card("blue", "4", true, "lie"), card("green", "1"), card("green", "2")],
        [card("yellow", "1"), card("yellow", "2")],
        [card("yellow", "3"), card("yellow", "4")],
      ],
    });

  it("rejects implausible claims", () => {
    const s = base();
    expect(fail(s, "p0", { type: "play", cardId: "lie", faceDown: true, claim: { color: "blue", value: "4" } })).toBe("badClaim");
    expect(fail(s, "p0", { type: "play", cardId: "lie", faceDown: true, claim: { color: "red", value: "wlc" } })).toBe("badClaim");
    expect(fail(s, "p0", { type: "play", cardId: "lie", faceDown: true, claim: { color: null, value: "wild4" } })).toBe("chooseColor");
  });

  it("opens a challenge window; unchallenged lie stands as the claim", () => {
    const s = base();
    let r = act(s, "p0", { type: "play", cardId: "lie", faceDown: true, claim: { color: "red", value: "8" } });
    expect(r.state.phase.kind).toBe("challenge");
    expect(fail(r.state, "p0", { type: "trust" })).toBe("ownPlay");
    r = act(r.state, "p1", { type: "trust" });
    expect(r.state.phase.kind).toBe("challenge");
    r = act(r.state, "p2", { type: "trust" });
    expect(r.state.phase.kind).toBe("turn");
    expect(r.state.current).toBe(1);
    expect(effectiveTop(r.state)).toEqual({ color: "red", value: "8" });
  });

  it("closes the window on timeout", () => {
    const s = base();
    const r = act(s, "p0", { type: "play", cardId: "lie", faceDown: true, claim: { color: "red", value: "8" } });
    expect(applyTimeout(r.state, NOW + 1000)).toBeNull();
    const t = applyTimeout(r.state, NOW + 6000)!;
    expect(t.ok && t.state.current).toBe(1);
  });

  it("caught lying: take the card back, draw 1, effect cancelled", () => {
    const s = base();
    let r = act(s, "p0", { type: "play", cardId: "lie", faceDown: true, claim: { color: "red", value: "skip" } });
    r = act(r.state, "p2", { type: "challenge" });
    expect(r.state.players[0].hand).toHaveLength(5);
    expect(r.state.players[0].hand.some((c) => c.id === "lie")).toBe(true);
    expect(r.state.players[2].hand).toHaveLength(2);
    expect(r.state.current).toBe(1); // skip was cancelled
    expect(effectiveTop(r.state)).toEqual({ color: "red", value: "5" });
    expect(r.events.find((e) => e.t === "reveal")).toMatchObject({ result: "lie" });
  });

  it("honest when challenged: challenger draws 1 and the effect applies", () => {
    const s = setup({
      hands: [
        [card("red", "skip", true, "sk"), card("green", "1")],
        [card("yellow", "1"), card("yellow", "2")],
        [card("yellow", "3"), card("yellow", "4")],
      ],
    });
    let r = act(s, "p0", { type: "play", cardId: "sk", faceDown: true, claim: { color: "red", value: "skip" } });
    r = act(r.state, "p1", { type: "challenge" });
    expect(r.state.players[1].hand).toHaveLength(3);
    expect(r.state.current).toBe(2); // p1 skipped
    expect(r.state.discard[r.state.discard.length - 1].revealed).toBe(true);
  });

  it("a regular card played face down and caught costs 6 cards, even if the claim was true", () => {
    const s = setup({
      hands: [[card("red", "9", false, "reg"), card("green", "1")], [card("yellow", "1")], [card("yellow", "3")]],
    });
    let r = act(s, "p0", { type: "play", cardId: "reg", faceDown: true, claim: { color: "red", value: "9" } });
    r = act(r.state, "p1", { type: "challenge" });
    expect(r.state.players[0].hand).toHaveLength(2 + 6);
    expect(r.state.players[1].hand).toHaveLength(1);
    expect(r.events.find((e) => e.t === "reveal")).toMatchObject({ result: "cheat" });
  });

  it("regular face down can be disabled by the room", () => {
    const s = setup({
      hands: [[card("red", "9", false, "reg"), card("green", "1")], [card("yellow", "1")]],
      settings: { allowRegularFaceDown: false },
    });
    expect(fail(s, "p0", { type: "play", cardId: "reg", faceDown: true, claim: { color: "red", value: "9" } })).toBe(
      "regularMustBeFaceUp",
    );
  });

  it("first challenger wins the race; later responses are rejected", () => {
    const s = base();
    let r = act(s, "p0", { type: "play", cardId: "honest", faceDown: true, claim: { color: "red", value: "9" } });
    r = act(r.state, "p1", { type: "challenge" });
    expect(applyAction(r.state, "p2", { type: "challenge" }, NOW).ok).toBe(false);
  });

  it("Wild Draw 4 claim: next player draws 4 and is skipped, color is chosen", () => {
    const s = setup({
      hands: [[card(null, "wild4", true, "w"), card("green", "1")], [card("yellow", "1")], [card("yellow", "3")]],
    });
    let r = act(s, "p0", { type: "play", cardId: "w", faceDown: true, claim: { color: null, value: "wild4" }, chosenColor: "blue" });
    r = act(r.state, "p1", { type: "trust" });
    r = act(r.state, "p2", { type: "trust" });
    expect(r.state.players[1].hand).toHaveLength(5);
    expect(r.state.current).toBe(2);
    expect(effectiveTop(r.state)).toEqual({ color: "blue", value: "wild4" });
  });

  it("winning on a face-down last card requires surviving the challenge", () => {
    const s = setup({
      hands: [[card("blue", "4", true, "last")], [card("yellow", "1")], [card("yellow", "3")]],
    });
    let r = act(s, "p0", { type: "play", cardId: "last", faceDown: true, claim: { color: "red", value: "4" } });
    expect(r.state.phase.kind).toBe("challenge");
    r = act(r.state, "p1", { type: "challenge" });
    expect(r.state.phase.kind).toBe("turn");
    expect(r.state.players[0].hand).toHaveLength(2);

    const s2 = setup({
      hands: [[card("red", "4", true, "last")], [card("yellow", "1")], [card("yellow", "3")]],
      pile: [card("blue", "6")],
    });
    let r2 = act(s2, "p0", { type: "play", cardId: "last", faceDown: true, claim: { color: "red", value: "4" } });
    r2 = act(r2.state, "p1", { type: "challenge" });
    expect(r2.state.phase).toMatchObject({ kind: "roundOver", winners: ["p0"] });
    // challenger drew the penalty (a 6) before scoring: 1 + 6 (p1) + 3 (p2)
    expect(r2.state.phase.kind === "roundOver" && r2.state.phase.points).toBe(1 + 6 + 3);
  });
});

describe("action effects", () => {
  it("reverse flips direction; with 2 players it acts as skip", () => {
    const s3 = setup({ hands: [[card("red", "reverse", true, "r"), card("green", "1")], [card("yellow", "1")], [card("yellow", "3")]] });
    let r = act(s3, "p0", { type: "play", cardId: "r", faceDown: true, claim: { color: "red", value: "reverse" } });
    r = act(r.state, "p1", { type: "trust" });
    r = act(r.state, "p2", { type: "trust" });
    expect(r.state.direction).toBe(-1);
    expect(r.state.current).toBe(2);

    const s2 = setup({ hands: [[card("red", "reverse", true, "r"), card("green", "1")], [card("yellow", "1")]] });
    let r2 = act(s2, "p0", { type: "play", cardId: "r", faceDown: true, claim: { color: "red", value: "reverse" } });
    r2 = act(r2.state, "p1", { type: "trust" });
    expect(r2.state.current).toBe(0);
  });

  it("draw two: next draws 2 and loses turn", () => {
    const s = setup({ hands: [[card("red", "draw2", true, "d"), card("green", "1")], [card("yellow", "1")], [card("yellow", "3")]] });
    let r = act(s, "p0", { type: "play", cardId: "d", faceDown: true, claim: { color: "red", value: "draw2" } });
    r = act(r.state, "p1", { type: "trust" });
    r = act(r.state, "p2", { type: "trust" });
    expect(r.state.players[1].hand).toHaveLength(3);
    expect(r.state.current).toBe(2);
  });

  it("7 swap: challenged honest — penalty drawn AFTER the exchange", () => {
    const s = setup({
      hands: [
        [card("red", "7", true, "seven"), card("green", "1"), card("green", "2")],
        [card("yellow", "1")],
        [card("yellow", "3"), card("yellow", "4"), card("yellow", "5"), card("yellow", "6")],
      ],
    });
    let r = act(s, "p0", { type: "play", cardId: "seven", faceDown: true, claim: { color: "red", value: "7" }, swapTarget: "p1" });
    r = act(r.state, "p1", { type: "challenge" });
    // p0 gets p1's single card; p1 gets p0's two cards and then draws the penalty card.
    expect(r.state.players[0].hand.map((c) => c.value)).toEqual(["1"]);
    expect(r.state.players[1].hand).toHaveLength(3);
    const evs = r.events.map((e) => e.t);
    expect(evs.indexOf("swap")).toBeLessThan(evs.lastIndexOf("draw"));
  });

  it("0 pass: everyone passes their hand in the current direction", () => {
    const s = setup({
      hands: [
        [card("red", "0", false, "z"), card("green", "1")],
        [card("yellow", "2")],
        [card("blue", "3"), card("blue", "4")],
      ],
    });
    const r = act(s, "p0", { type: "play", cardId: "z", faceDown: false });
    expect(r.state.players[1].hand.map((c) => c.value)).toEqual(["1"]);
    expect(r.state.players[2].hand.map((c) => c.value)).toEqual(["2"]);
    expect(r.state.players[0].hand.map((c) => c.value)).toEqual(["3", "4"]);
  });

  it("playing your last card wins before 7/0 effects", () => {
    const s = setup({ hands: [[card("red", "0", false, "z")], [card("yellow", "2")], [card("blue", "3")]] });
    const r = act(s, "p0", { type: "play", cardId: "z", faceDown: false });
    expect(r.state.phase).toMatchObject({ kind: "roundOver", winners: ["p0"], points: 5 });
  });
});

describe("drawing", () => {
  it("draw then play the drawn card, or keep it", () => {
    const s = setup({
      hands: [[card("blue", "1")], [card("yellow", "1")]],
      pile: [card("red", "8", false, "drawn")],
      settings: { allowRegularFaceDown: false },
    });
    let r = act(s, "p0", { type: "draw" });
    expect(r.state.phase).toEqual({ kind: "afterDraw", cardId: "drawn" });
    expect(fail(r.state, "p0", { type: "play", cardId: s.players[0].hand[0].id, faceDown: false })).toBe("mustPlayDrawn");
    const keep = act(r.state, "p0", { type: "keep" });
    expect(keep.state.current).toBe(1);
    r = act(r.state, "p0", { type: "play", cardId: "drawn", faceDown: false });
    expect(r.state.current).toBe(1);
  });

  it("auto-ends the turn if the drawn regular card cannot be played", () => {
    const s = setup({
      hands: [[card("blue", "1")], [card("yellow", "1")]],
      pile: [card("blue", "8", false, "drawn")],
      settings: { allowRegularFaceDown: false },
    });
    const r = act(s, "p0", { type: "draw" });
    expect(r.state.current).toBe(1);
  });

  it("reshuffles the discard pile (except top) when the draw pile runs out", () => {
    const s = setup({ hands: [[card("blue", "1")], [card("yellow", "1")]], pile: [] });
    s.discard.unshift(
      { seq: 0, card: card("green", "2"), faceDown: false, revealed: false, claim: null, chosenColor: null, by: null, rot: 0 },
      { seq: 0, card: card("green", "3"), faceDown: true, revealed: false, claim: { color: "green", value: "3" }, chosenColor: null, by: null, rot: 0 },
    );
    const r = act(s, "p0", { type: "draw" });
    expect(r.events.some((e) => e.t === "reshuffle")).toBe(true);
    expect(r.state.discard).toHaveLength(1);
    expect(r.state.players[0].hand).toHaveLength(2);
  });

  it("turn timeout draws a card and passes", () => {
    const s = setup({ hands: [[card("blue", "1")], [card("yellow", "1")]] });
    const r = applyTimeout(s, NOW + 31_000)!;
    expect(r.ok && r.state.current).toBe(1);
    expect(r.ok && r.state.players[0].hand).toHaveLength(2);
  });
});

describe("UNO", () => {
  it("going to one card undeclared is catchable until the next player acts", () => {
    const s = setup({ hands: [[card("red", "1", false, "a"), card("blue", "2")], [card("red", "3")], [card("yellow", "3")]] });
    let r = act(s, "p0", { type: "play", cardId: "a", faceDown: false });
    expect(r.state.players[0].unoVulnerable).toBe(true);
    const caught = act(r.state, "p2", { type: "catch", target: "p0" });
    expect(caught.state.players[0].hand).toHaveLength(3);
    expect(caught.state.players[0].unoVulnerable).toBe(false);
    // next player acts → window closes
    r = act(r.state, "p1", { type: "draw" });
    expect(r.state.players[0].unoVulnerable).toBe(false);
    expect(fail(r.state, "p2", { type: "catch", target: "p0" })).toBe("notVulnerable");
  });

  it("declaring UNO (before or after playing) protects you", () => {
    const s = setup({ hands: [[card("red", "1", false, "a"), card("blue", "2")], [card("red", "3")], [card("yellow", "3")]] });
    let r = act(s, "p0", { type: "uno" });
    r = act(r.state, "p0", { type: "play", cardId: "a", faceDown: false });
    expect(r.state.players[0].unoVulnerable).toBe(false);
    expect(fail(r.state, "p1", { type: "catch", target: "p0" })).toBe("notVulnerable");

    let r2 = act(s, "p0", { type: "play", cardId: "a", faceDown: false });
    r2 = act(r2.state, "p0", { type: "uno" });
    expect(r2.state.players[0].unoVulnerable).toBe(false);
  });

  it("pre-declaration is cleared when the hand grows again", () => {
    const s = setup({ hands: [[card("blue", "9", true, "a"), card("blue", "2")], [card("red", "3")], [card("yellow", "3")]] });
    let r = act(s, "p0", { type: "uno" });
    r = act(r.state, "p0", { type: "play", cardId: "a", faceDown: true, claim: { color: "red", value: "9" } });
    r = act(r.state, "p1", { type: "challenge" });
    expect(r.state.players[0].hand).toHaveLength(3);
    expect(r.state.players[0].unoDeclared).toBe(false);
  });
});

describe("Wild Liar's Challenge", () => {
  const wlcSetup = () =>
    setup({
      hands: [
        [card(null, "wlc", false, "w"), card("green", "1"), card("green", "2")],
        [card("red", "1", false, "p1red"), card("blue", "1")],
        [card("blue", "3", false, "p2blue"), card("blue", "4")],
        [card("red", "7", true, "p3red"), card("yellow", "4")],
      ],
    });

  const commitAll = () => {
    let r = act(wlcSetup(), "p0", { type: "play", cardId: "w", faceDown: false, chosenColor: "red" });
    expect(r.state.phase.kind).toBe("wlcCommit");
    r = act(r.state, "p1", { type: "wlcCommit", cardId: "p1red" });
    r = act(r.state, "p2", { type: "wlcCommit", cardId: "p2blue" }); // lie
    r = act(r.state, "p3", { type: "wlcCommit", cardId: "p3red" });
    expect(r.state.phase.kind).toBe("wlcChallenge");
    return r;
  };

  it("must be played face up and lets the player pick a color", () => {
    const s = wlcSetup();
    expect(fail(s, "p0", { type: "play", cardId: "w", faceDown: true, claim: { color: null, value: "wild4" }, chosenColor: "red" })).toBe("wlcFaceUp");
    expect(fail(s, "p0", { type: "play", cardId: "w", faceDown: false })).toBe("chooseColor");
  });

  it("catching a liar: they take back + draw 1; then an honest reveal ends it and everyone left discards", () => {
    let r = commitAll();
    r = act(r.state, "p0", { type: "wlcChallenge", target: "p2" });
    expect(r.state.players[2].hand).toHaveLength(3); // took back + drew 1
    expect(r.state.phase.kind).toBe("wlcChallenge");
    r = act(r.state, "p0", { type: "wlcChallenge", target: "p1" }); // honest → stop
    expect(r.state.phase.kind).toBe("turn");
    expect(r.state.current).toBe(1);
    expect(r.state.players[1].hand).toHaveLength(1);
    expect(r.state.players[3].hand).toHaveLength(1); // unchallenged p3 discarded too
    expect(effectiveTop(r.state)).toEqual({ color: "red", value: "wlc" });
    expect(countCards(r.state)).toBe(countCards(wlcSetup()));
  });

  it("ending voluntarily lets all unchallenged players discard (even liars)", () => {
    let r = commitAll();
    r = act(r.state, "p0", { type: "wlcEnd" });
    expect(r.state.players.slice(1).every((p) => p.hand.length === 1)).toBe(true);
  });

  it("multiple players going out together all win", () => {
    const s = setup({
      hands: [
        [card(null, "wlc", false, "w"), card("green", "1")],
        [card("red", "1", false, "a")],
        [card("red", "2", false, "b")],
      ],
    });
    let r = act(s, "p0", { type: "play", cardId: "w", faceDown: false, chosenColor: "red" });
    r = act(r.state, "p1", { type: "wlcCommit", cardId: "a" });
    r = act(r.state, "p2", { type: "wlcCommit", cardId: "b" });
    r = act(r.state, "p0", { type: "wlcEnd" });
    expect(r.state.phase).toMatchObject({ kind: "roundOver", winners: ["p1", "p2"], points: 1 });
  });

  it("commit timeout auto-commits for missing players", () => {
    const r = act(wlcSetup(), "p0", { type: "play", cardId: "w", faceDown: false, chosenColor: "red" });
    const t = applyTimeout(r.state, NOW + 26_000)!;
    expect(t.ok && t.state.phase.kind).toBe("wlcChallenge");
  });
});

describe("scoring", () => {
  it("accumulates to the target score", () => {
    const s = setup({
      hands: [[card("red", "1", false, "a")], [card(null, "wild4", true)], [card("blue", "9")]],
      settings: { targetScore: 500 },
    });
    s.scores = { p0: 450, p1: 0, p2: 0 };
    const r = act(s, "p0", { type: "play", cardId: "a", faceDown: false });
    expect(r.state.phase).toMatchObject({ kind: "roundOver", points: 59, gameOver: true });
    expect(r.state.scores.p0).toBe(509);
  });
});
