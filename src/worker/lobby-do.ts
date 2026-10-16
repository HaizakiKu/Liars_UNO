import { DurableObject } from "cloudflare:workers";
import type { LobbyMsg, LobbyRoom, RoomStatus } from "../shared/protocol";
import type { Env } from "./env";

const SWEEP_MS = 60_000;

/**
 * Global index of public rooms. Rooms upsert themselves (with an expiry) whenever their
 * roster or status changes and refresh periodically; anything not refreshed is swept.
 */
export class LobbyDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      players INTEGER NOT NULL,
      max INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated INTEGER NOT NULL,
      expires INTEGER NOT NULL
    )`);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async upsert(room: LobbyRoom, ttlMs: number): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO rooms (code, name, host, players, max, status, updated, expires)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name=excluded.name, host=excluded.host, players=excluded.players,
         max=excluded.max, status=excluded.status, updated=excluded.updated, expires=excluded.expires`,
      room.code,
      room.name,
      room.host,
      room.players,
      room.max,
      room.status,
      now,
      now + ttlMs,
    );
    await this.ensureAlarm();
    this.broadcast();
  }

  async remove(code: string): Promise<void> {
    const before = this.count();
    this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
    if (this.count() !== before) this.broadcast();
  }

  async list(): Promise<LobbyRoom[]> {
    return this.rows();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return Response.json({ rooms: this.rows() });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ t: "rooms", rooms: this.rows() } satisfies LobbyMsg));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(): Promise<void> {
    // The lobby feed is push-only; pings are answered by the auto-response.
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      /* already closed */
    }
  }

  async alarm(): Promise<void> {
    const before = this.count();
    this.sql.exec("DELETE FROM rooms WHERE expires <= ?", Date.now());
    if (this.count() !== before) this.broadcast();
    if (this.count() > 0) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  private async ensureAlarm() {
    const current = await this.ctx.storage.getAlarm();
    if (current === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  private count(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM rooms").one().n;
  }

  private rows(): LobbyRoom[] {
    return this.sql
      .exec<{
        code: string;
        name: string;
        host: string;
        players: number;
        max: number;
        status: string;
        updated: number;
      }>(
        `SELECT code, name, host, players, max, status, updated FROM rooms
         WHERE expires > ? ORDER BY (status = 'lobby') DESC, players DESC, updated DESC LIMIT 100`,
        Date.now(),
      )
      .toArray()
      .map((r) => ({ ...r, status: r.status as RoomStatus }));
  }

  private broadcast() {
    const msg = JSON.stringify({ t: "rooms", rooms: this.rows() } satisfies LobbyMsg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* closed socket */
      }
    }
  }
}
