export const COLORS = ["red", "yellow", "green", "blue"] as const;
export type Color = (typeof COLORS)[number];

export const NUMBER_VALUES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const ACTION_VALUES = ["skip", "reverse", "draw2"] as const;
export type NumberValue = (typeof NUMBER_VALUES)[number];
export type ActionValue = (typeof ACTION_VALUES)[number];
export type Value = NumberValue | ActionValue | "wild4" | "wlc";

/** A physical card. `liar` cards are always played face down. */
export interface Card {
  id: string;
  color: Color | null;
  value: Value;
  liar: boolean;
}

/** A card identity as announced in a claim ("Red 7", "Wild Draw 4"). */
export interface Claim {
  color: Color | null;
  value: Value;
}

export const isWild = (v: Value) => v === "wild4" || v === "wlc";
export const isNumber = (v: Value): v is NumberValue => (NUMBER_VALUES as readonly string[]).includes(v);
export const isAction = (v: Value) => !isNumber(v);

/** Every value that may legally be announced for a Liar's Card. */
export const CLAIMABLE_VALUES: Value[] = [...NUMBER_VALUES, ...ACTION_VALUES, "wild4"];

/** Builds the 112-card Liar's UNO deck (ids are assigned by the caller). */
export function deckTemplate(): Omit<Card, "id">[] {
  const cards: Omit<Card, "id">[] = [];
  for (const color of COLORS) {
    for (const value of NUMBER_VALUES) {
      cards.push({ color, value, liar: false });
      cards.push({ color, value, liar: true });
    }
    for (const value of ACTION_VALUES) {
      cards.push({ color, value, liar: true });
      cards.push({ color, value, liar: true });
    }
  }
  cards.push({ color: null, value: "wild4", liar: true });
  cards.push({ color: null, value: "wild4", liar: true });
  for (let i = 0; i < 6; i++) cards.push({ color: null, value: "wlc", liar: false });
  return cards;
}

export function cardPoints(c: { value: Value }): number {
  if (isNumber(c.value)) return Number(c.value);
  if (isWild(c.value)) return 50;
  return 20;
}

export function sameIdentity(a: Claim, b: Claim): boolean {
  return a.value === b.value && (isWild(a.value) || a.color === b.color);
}

/** The color/value that the next card has to match. */
export interface TopFace {
  color: Color;
  value: Value;
}

/** Does a card (or claimed identity) match the effective top of the discard pile? */
export function matchesTop(c: Claim, top: TopFace): boolean {
  if (isWild(c.value)) return true;
  if (c.color === top.color) return true;
  if (!isWild(top.value) && c.value === top.value) return true;
  return false;
}
