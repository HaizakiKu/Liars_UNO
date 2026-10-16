import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_RE,
  type CreateRoomRequest,
  DEFAULT_ROOM_SETTINGS,
  ROOM_NAME_MAX,
  sanitizeSettings,
  sanitizeText,
} from "../shared/protocol";
import { type Env, lobbyStub } from "./env";

export { LobbyDO } from "./lobby-do";
export { RoomDO } from "./room-do";

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function readJson<T>(req: Request): Promise<T | null> {
  const len = Number(req.headers.get("Content-Length") ?? "0");
  if (len > 4096) return null;
  try {
    const text = await req.text();
    if (text.length > 4096) return null;
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return null;
  }
}

async function createRoom(env: Env, body: CreateRoomRequest): Promise<string | null> {
  const name = sanitizeText(body.name, ROOM_NAME_MAX) || "Liar's Table";
  const settings = sanitizeSettings(body.settings, DEFAULT_ROOM_SETTINGS);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    if (await stub.init({ code, name, isPublic: body.isPublic !== false, settings })) return code;
  }
  return null;
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;

  if (parts[1] === "rooms" && parts.length === 2 && method === "POST") {
    const body = await readJson<CreateRoomRequest>(req);
    if (!body) return json({ error: "badRequest" }, 400);
    const code = await createRoom(env, body);
    return code ? json({ code }) : json({ error: "tryAgain" }, 503);
  }

  if (parts[1] === "rooms" && parts.length >= 3) {
    const code = parts[2].toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: "badCode" }, 400);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    if (parts.length === 3 && method === "GET") {
      const info = await stub.info();
      return info.exists ? json(info) : json({ error: "notFound" }, 404);
    }
    if (parts.length === 4 && parts[3] === "ws") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "expectedWebSocket" }, 426);
      return stub.fetch(req);
    }
  }

  if (parts[1] === "lobby") {
    const lobby = lobbyStub(env);
    if (parts.length === 2 && method === "GET") return json({ rooms: await lobby.list() });
    if (parts[2] === "ws") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "expectedWebSocket" }, 426);
      return lobby.fetch(req);
    }
  }

  if (parts[1] === "quick-join" && method === "POST") {
    const body = (await readJson<CreateRoomRequest>(req)) ?? {};
    const rooms = await lobbyStub(env).list();
    const open = rooms.filter((r) => r.status === "lobby" && r.players < r.max).sort((a, b) => b.players - a.players);
    for (const r of open) {
      const info = await env.ROOMS.get(env.ROOMS.idFromName(r.code)).info();
      if (info.exists && info.status === "lobby" && info.players < info.max) return json({ code: r.code });
    }
    const code = await createRoom(env, { ...body, isPublic: true });
    return code ? json({ code, created: true }) : json({ error: "tryAgain" }, 503);
  }

  return json({ error: "notFound" }, 404);
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, env, url);
      } catch (e) {
        console.error("api error", e);
        return json({ error: "internal" }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
