import type { LobbyDO } from "./lobby-do";
import type { RoomDO } from "./room-do";

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  ASSETS: Fetcher;
  /** "1" shortens cleanup timers (local integration tests only). */
  FAST_TIMERS?: string;
}

export function lobbyStub(env: Env) {
  return env.LOBBY.get(env.LOBBY.idFromName("global"));
}
