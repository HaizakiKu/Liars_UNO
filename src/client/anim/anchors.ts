/** Registry of DOM anchors (deck, pile, seats, hand…) that animations fly between. */
const anchors = new Map<string, HTMLElement>();

export function anchor(key: string) {
  return (el: HTMLElement | null) => {
    if (!el) return;
    anchors.set(key, el);
    return () => {
      if (anchors.get(key) === el) anchors.delete(key);
    };
  };
}

export function centerOf(key: string): { x: number; y: number } | null {
  const el = anchors.get(key);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Offset that moves an element centered at `toKey`'s position so it appears at `fromKey`. */
export function offsetBetween(fromKey: string, toEl: HTMLElement | null): { x: number; y: number } | null {
  const from = centerOf(fromKey);
  if (!from || !toEl) return null;
  const r = toEl.getBoundingClientRect();
  return { x: from.x - (r.left + r.width / 2), y: from.y - (r.top + r.height / 2) };
}

export const seatKey = (pid: string) => `seat:${pid}`;
