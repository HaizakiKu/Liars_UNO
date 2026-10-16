import { create } from "zustand";
import { AVATAR_COUNT, NAME_MAX } from "../../shared/protocol";

export interface Identity {
  pid: string;
  token: string;
  name: string;
  avatar: number;
}

const KEY = "luno.identity";

function randomHex(bytes: number) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function load(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Identity;
      if (v.pid && v.token) return v;
    }
  } catch {
    /* storage unavailable */
  }
  const id: Identity = {
    pid: "p" + randomHex(10),
    token: randomHex(24),
    name: "",
    avatar: Math.floor(Math.random() * AVATAR_COUNT),
  };
  persist(id);
  return id;
}

function persist(id: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
}

export const useIdentity = create<Identity & { update: (p: Partial<Identity>) => void }>((set, get) => ({
  ...load(),
  update: (p) => {
    const next = { ...get(), ...p };
    if (p.name !== undefined) next.name = Array.from(p.name).slice(0, NAME_MAX).join("");
    persist({ pid: next.pid, token: next.token, name: next.name, avatar: next.avatar });
    set(next);
  },
}));
