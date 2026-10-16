/** Small deterministic PRNG (mulberry32). The state lives in the game state so rounds are reproducible. */
export interface RngHolder {
  rng: number;
}

export function nextRandom(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(h: RngHolder, n: number): number {
  return Math.floor(nextRandom(h) * n);
}

export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
export function randId(h: RngHolder, len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ID_CHARS[randInt(h, ID_CHARS.length)];
  return s;
}
