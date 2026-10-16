import type { Card, Color, Value } from "../src/shared/cards";
import {
  type Action,
  type GameState,
  DEFAULT_SETTINGS,
  type GameSettings,
  applyAction,
  createRound,
} from "../src/shared/engine";

let n = 0;
export function card(color: Color | null, value: Value, liar = false, id?: string): Card {
  return { id: id ?? `t${++n}`, color, value, liar };
}

export const NOW = 1_000_000;

/** A round with deterministic hands: player i gets `hands[i]`, top card `top`, draw pile `pile` (last = next drawn). */
export function setup(opts: {
  hands: Card[][];
  top?: Card;
  pile?: Card[];
  settings?: Partial<GameSettings>;
  current?: number;
}): GameState {
  const ids = opts.hands.map((_, i) => `p${i}`);
  const { state } = createRound({
    playerIds: ids,
    dealer: ids.length - 1,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    seed: 42,
    now: NOW,
  });
  state.players.forEach((p, i) => (p.hand = [...opts.hands[i]]));
  state.discard = [
    {
      seq: 1,
      card: opts.top ?? card("red", "5"),
      faceDown: false,
      revealed: false,
      claim: null,
      chosenColor: null,
      by: null,
      rot: 0,
    },
  ];
  state.seq = 1;
  state.drawPile = opts.pile ?? Array.from({ length: 30 }, (_, i) => card("green", String(i % 10) as Value));
  state.current = opts.current ?? 0;
  state.phase = { kind: "turn" };
  state.deadline = NOW + 30_000;
  return state;
}

export function act(s: GameState, who: string, a: Action, now = NOW) {
  const r = applyAction(s, who, a, now);
  if (!r.ok) throw new Error(`action failed: ${r.error} (${JSON.stringify(a)})`);
  return r;
}

export function fail(s: GameState, who: string, a: Action) {
  const r = applyAction(s, who, a, NOW);
  if (r.ok) throw new Error(`expected failure for ${JSON.stringify(a)}`);
  return r.error;
}
