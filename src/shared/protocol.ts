import type { Action, GameEvent, GameSettings } from "./engine";
import type { GameView } from "./view";

export interface RoomSettings extends GameSettings {
  maxPlayers: number;
}

export const SETTING_CHOICES = {
  maxPlayers: [2, 3, 4, 5, 6, 7, 8],
  challengeSeconds: [4, 6, 10],
  turnSeconds: [15, 30, 60],
  targetScore: [0, 200, 500],
} as const;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 6,
  allowRegularFaceDown: true,
  challengeSeconds: 6,
  turnSeconds: 30,
  targetScore: 0,
};

export const EMOTES = ["😏", "🤔", "😂", "😱", "👏", "🤥"] as const;
export const AVATAR_COUNT = 12;
export const NAME_MAX = 16;
export const ROOM_NAME_MAX = 24;
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export type RoomStatus = "lobby" | "playing" | "roundOver";

export interface SeatView {
  id: string;
  name: string;
  avatar: number;
  isBot: boolean;
  connected: boolean;
  autoplay: boolean;
}

export interface SpectatorView {
  id: string;
  name: string;
  avatar: number;
}

export interface RoomView {
  code: string;
  name: string;
  isPublic: boolean;
  hostId: string;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatView[];
  spectators: SpectatorView[];
  scores: Record<string, number>;
  game: GameView | null;
  you: string;
  role: "seat" | "spectator";
  nextRoundAt: number | null;
  serverNow: number;
}

export interface LobbyRoom {
  code: string;
  name: string;
  host: string;
  players: number;
  max: number;
  status: RoomStatus;
  updated: number;
}

export type ClientMsg =
  | { t: "hello"; pid: string; token: string; name: string; avatar: number }
  | { t: "act"; a: Action }
  | { t: "start" }
  | { t: "next" }
  | { t: "lobby" }
  | { t: "settings"; s: Partial<RoomSettings>; name?: string; isPublic?: boolean }
  | { t: "addBot" }
  | { t: "kick"; pid: string }
  | { t: "sit" }
  | { t: "stand" }
  | { t: "leave" }
  | { t: "emote"; e: string }
  | { t: "resume" }
  | { t: "ping" };

export type ServerMsg =
  | { t: "state"; room: RoomView; events: GameEvent[] }
  | { t: "error"; code: string }
  | { t: "emote"; from: string; e: string }
  | { t: "kicked" }
  | { t: "closed"; reason: string }
  | { t: "pong" };

export type LobbyMsg = { t: "rooms"; rooms: LobbyRoom[] };

export interface CreateRoomRequest {
  name?: string;
  isPublic?: boolean;
  settings?: Partial<RoomSettings>;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

export function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  const clean = input.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return Array.from(clean).slice(0, max).join("");
}

export function sanitizeSettings(input: unknown, base: RoomSettings): RoomSettings {
  const out = { ...base };
  if (!input || typeof input !== "object") return out;
  const s = input as Record<string, unknown>;
  const pick = <K extends keyof typeof SETTING_CHOICES>(k: K) => {
    const v = s[k];
    if (typeof v === "number" && (SETTING_CHOICES[k] as readonly number[]).includes(v)) out[k] = v;
  };
  pick("maxPlayers");
  pick("challengeSeconds");
  pick("turnSeconds");
  pick("targetScore");
  if (typeof s.allowRegularFaceDown === "boolean") out.allowRegularFaceDown = s.allowRegularFaceDown;
  return out;
}

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || typeof (m as { t?: unknown }).t !== "string") return null;
  const msg = m as Record<string, unknown>;
  switch (msg.t) {
    case "hello":
      if (typeof msg.pid !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(msg.pid)) return null;
      if (typeof msg.token !== "string" || msg.token.length < 16 || msg.token.length > 128) return null;
      return {
        t: "hello",
        pid: msg.pid,
        token: msg.token,
        name: sanitizeText(msg.name, NAME_MAX),
        avatar: typeof msg.avatar === "number" ? Math.abs(Math.floor(msg.avatar)) % AVATAR_COUNT : 0,
      };
    case "act":
      if (!msg.a || typeof msg.a !== "object") return null;
      return { t: "act", a: msg.a as Action };
    case "kick":
      return typeof msg.pid === "string" ? { t: "kick", pid: msg.pid } : null;
    case "emote":
      return typeof msg.e === "string" && (EMOTES as readonly string[]).includes(msg.e) ? { t: "emote", e: msg.e } : null;
    case "settings":
      return {
        t: "settings",
        s: (msg.s && typeof msg.s === "object" ? msg.s : {}) as Partial<RoomSettings>,
        name: typeof msg.name === "string" ? msg.name : undefined,
        isPublic: typeof msg.isPublic === "boolean" ? msg.isPublic : undefined,
      };
    case "start":
    case "next":
    case "lobby":
    case "addBot":
    case "sit":
    case "stand":
    case "leave":
    case "resume":
    case "ping":
      return { t: msg.t } as ClientMsg;
    default:
      return null;
  }
}
