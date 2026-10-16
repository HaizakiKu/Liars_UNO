import { DurableObject } from "cloudflare:workers";
import { botAction } from "../shared/bot";
import {
  type Action,
  type ApplyResult,
  type GameEvent,
  type GameState,
  applyAction,
  applyTimeout,
  createRound,
  defaultWlcCommit,
} from "../shared/engine";
import {
  type ClientMsg,
  DEFAULT_ROOM_SETTINGS,
  type LobbyRoom,
  ROOM_NAME_MAX,
  type RoomSettings,
  type RoomStatus,
  type RoomView,
  type ServerMsg,
  parseClientMsg,
  sanitizeSettings,
  sanitizeText,
} from "../shared/protocol";
import { eventsFor, viewFor } from "../shared/view";
import { type Env, lobbyStub } from "./env";

interface Seat {
  id: string;
  name: string;
  avatar: number;
  isBot: boolean;
  tokenHash: string | null;
  joinedAt: number;
  connected: boolean;
  disconnectedAt: number | null;
  /** Consecutive turn timeouts while connected. Two → auto-play until the player is back. */
  afk: number;
  /** Left during a game: the seat is auto-played until the round ends (or the player rejoins). */
  left: boolean;
}

interface Spectator {
  id: string;
  name: string;
  avatar: number;
  tokenHash: string;
  connected: boolean;
}

interface RoomData {
  code: string;
  name: string;
  isPublic: boolean;
  createdAt: number;
  lastActivity: number;
  hostId: string;
  status: RoomStatus;
  settings: RoomSettings;
  seats: Seat[];
  spectators: Spectator[];
  /** Player ids the host removed; they may not rejoin this room. */
  banned?: string[];
  scores: Record<string, number>;
  dealer: number;
  round: number;
  game: GameState | null;
  /** Bumped on every game state change; a planned bot move is only valid for the version it was planned on. */
  version: number;
  pendingBot: { pid: string; action: Action; version: number } | null;
  nextRoundAt: number | null;
  botAt: number | null;
  cleanupAt: number | null;
  lobbyRefreshAt: number | null;
}

interface Attachment {
  pid: string | null;
}

const BOT_NAMES = ["Ace", "Joker", "Fox", "Raven", "Ghost", "Viper", "Lynx", "Mamba", "Bishop", "Cobra"];
const IDLE_MS = 60 * 60_000;
const LOBBY_TTL_MS = 150_000;
const LOBBY_REFRESH_MS = 60_000;
const NEXT_ROUND_MS = 15_000;
const HOST_GRACE_MS = 30_000;
const SEAT_GRACE_MS = 60_000;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));

export class RoomDO extends DurableObject<Env> {
  private room: RoomData | null = null;
  private buckets = new WeakMap<WebSocket, { tokens: number; last: number }>();
  private lastLobbySig = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomData>("room")) ?? null;
    });
  }

  private get fast() {
    return this.env.FAST_TIMERS === "1";
  }

  private grace(ms: number) {
    return this.fast ? ms / 10 : ms;
  }

  // ───────────────────────── RPC (called by the Worker) ─────────────────────────

  async init(opts: { code: string; name: string; isPublic: boolean; settings: RoomSettings }): Promise<boolean> {
    if (this.room) return false;
    const now = Date.now();
    this.room = {
      code: opts.code,
      name: opts.name,
      isPublic: opts.isPublic,
      createdAt: now,
      lastActivity: now,
      hostId: "",
      status: "lobby",
      settings: opts.settings,
      seats: [],
      spectators: [],
      scores: {},
      dealer: -1,
      round: 0,
      game: null,
      version: 0,
      pendingBot: null,
      nextRoundAt: null,
      botAt: null,
      cleanupAt: now + this.emptyGrace(),
      lobbyRefreshAt: null,
    };
    await this.save();
    return true;
  }

  async info() {
    const r = this.room;
    if (!r) return { exists: false as const };
    return {
      exists: true as const,
      code: r.code,
      name: r.name,
      isPublic: r.isPublic,
      status: r.status,
      players: r.seats.filter((s) => !s.left).length,
      max: r.settings.maxPlayers,
    };
  }

  // ───────────────────────── WebSocket lifecycle ─────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (!this.room) return new Response("room not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ pid: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const r = this.room;
    if (!r) {
      this.send(ws, { t: "closed", reason: "notFound" });
      ws.close(4404, "room not found");
      return;
    }
    if (!this.allow(ws)) return this.send(ws, { t: "error", code: "rateLimited" });
    const msg = parseClientMsg(typeof data === "string" ? data : "");
    if (!msg) return this.send(ws, { t: "error", code: "badMessage" });
    if (msg.t === "ping") return this.send(ws, { t: "pong" });

    const att = (ws.deserializeAttachment() as Attachment | null) ?? { pid: null };
    if (msg.t === "hello") return this.onHello(ws, msg);
    if (!att.pid) return this.send(ws, { t: "error", code: "notJoined" });
    r.lastActivity = Date.now();
    await this.onMessage(ws, att.pid, msg);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {
      /* already closed */
    }
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket) {
    const r = this.room;
    if (!r) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    const pid = att?.pid;
    if (!pid) return;
    if (this.socketsOf(pid).some((s) => s !== ws)) return;
    const now = Date.now();
    const seat = r.seats.find((s) => s.id === pid);
    if (seat && !seat.isBot) {
      seat.connected = false;
      seat.disconnectedAt = now;
    }
    const spec = r.spectators.find((s) => s.id === pid);
    if (spec) spec.connected = false;
    await this.afterChange([]);
  }

  // ───────────────────────── messages ─────────────────────────

  private async onHello(ws: WebSocket, msg: Extract<ClientMsg, { t: "hello" }>) {
    const r = this.room!;
    const now = Date.now();
    const tokenHash = await sha256(msg.token);
    const name = msg.name || "Player";
    if (r.banned?.includes(msg.pid)) {
      this.send(ws, { t: "kicked" });
      ws.close(4403, "kicked");
      return;
    }
    const seat = r.seats.find((s) => s.id === msg.pid);
    const spec = r.spectators.find((s) => s.id === msg.pid);
    if (seat) {
      if (seat.isBot || seat.tokenHash !== tokenHash) {
        this.send(ws, { t: "error", code: "badToken" });
        ws.close(4401, "bad token");
        return;
      }
      seat.connected = true;
      seat.disconnectedAt = null;
      seat.afk = 0;
      seat.left = false;
      if (r.status === "lobby") {
        seat.name = name;
        seat.avatar = msg.avatar;
      }
    } else if (spec) {
      if (spec.tokenHash !== tokenHash) {
        this.send(ws, { t: "error", code: "badToken" });
        ws.close(4401, "bad token");
        return;
      }
      spec.connected = true;
      spec.name = name;
      spec.avatar = msg.avatar;
    } else if (r.status === "lobby" && r.seats.length < r.settings.maxPlayers) {
      r.seats.push(this.newSeat(msg.pid, name, msg.avatar, tokenHash, now));
    } else {
      r.spectators.push({ id: msg.pid, name, avatar: msg.avatar, tokenHash, connected: true });
    }
    ws.serializeAttachment({ pid: msg.pid } satisfies Attachment);
    r.lastActivity = now;
    // A returning human un-pauses a game whose timers were frozen while nobody was here.
    if (r.game && r.game.deadline !== null && r.game.deadline < now + 4000) r.game.deadline = now + 8000;
    await this.afterChange([]);
  }

  private async onMessage(ws: WebSocket, pid: string, msg: ClientMsg) {
    const r = this.room!;
    const seat = r.seats.find((s) => s.id === pid);
    const isHost = r.hostId === pid;
    const now = Date.now();
    if (seat && msg.t !== "leave") {
      seat.afk = 0;
    }
    switch (msg.t) {
      case "act": {
        if (!r.game || !seat) return this.send(ws, { t: "error", code: "notPlaying" });
        const res = applyAction(r.game, pid, msg.a as Action, now);
        if (!res.ok) return this.send(ws, { t: "error", code: res.error });
        return this.commit(res);
      }
      case "resume":
        return this.afterChange([]);
      case "start": {
        if (!isHost) return this.send(ws, { t: "error", code: "notHost" });
        if (r.status !== "lobby") return this.send(ws, { t: "error", code: "alreadyStarted" });
        if (r.seats.length < 2) return this.send(ws, { t: "error", code: "needTwoPlayers" });
        r.scores = {};
        r.round = 0;
        r.dealer = rand(0, r.seats.length) - 1;
        return this.startRound();
      }
      case "next": {
        if (!isHost) return this.send(ws, { t: "error", code: "notHost" });
        if (r.status !== "roundOver") return;
        const ph = r.game?.phase;
        if (ph?.kind === "roundOver" && ph.gameOver) return this.backToLobby();
        return this.startRound();
      }
      case "lobby":
        if (!isHost) return this.send(ws, { t: "error", code: "notHost" });
        if (r.status !== "roundOver") return;
        return this.backToLobby();
      case "settings": {
        if (!isHost) return this.send(ws, { t: "error", code: "notHost" });
        if (r.status !== "lobby") return this.send(ws, { t: "error", code: "alreadyStarted" });
        const next = sanitizeSettings(msg.s, r.settings);
        if (next.maxPlayers < r.seats.length) next.maxPlayers = r.settings.maxPlayers;
        r.settings = next;
        if (msg.name !== undefined) r.name = sanitizeText(msg.name, ROOM_NAME_MAX) || r.name;
        if (msg.isPublic !== undefined) r.isPublic = msg.isPublic;
        return this.afterChange([]);
      }
      case "addBot": {
        if (!isHost) return this.send(ws, { t: "error", code: "notHost" });
        if (r.status !== "lobby") return this.send(ws, { t: "error", code: "alreadyStarted" });
        if (r.seats.length >= r.settings.maxPlayers) return this.send(ws, { t: "error", code: "roomFull" });
        const used = new Set(r.seats.map((s) => s.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${r.seats.length + 1}`;
        r.seats.push({
          ...this.newSeat(`bot_${crypto.randomUUID().slice(0, 8)}`, name, rand(0, 12), null, now),
          isBot: true,
          connected: true,
        });
        return this.afterChange([]);
      }
      case "kick": {
        if (!isHost) return this.send(ws, { t: "error", code: "notHost" });
        if (r.status !== "lobby" || msg.pid === pid) return this.send(ws, { t: "error", code: "cannotKick" });
        const kickedHuman = r.seats.some((s) => s.id === msg.pid && !s.isBot) || r.spectators.some((s) => s.id === msg.pid);
        if (kickedHuman) r.banned = [...(r.banned ?? []), msg.pid].slice(-50);
        r.seats = r.seats.filter((s) => s.id !== msg.pid);
        r.spectators = r.spectators.filter((s) => s.id !== msg.pid);
        for (const s of this.socketsOf(msg.pid)) {
          this.send(s, { t: "kicked" });
          s.serializeAttachment({ pid: null } satisfies Attachment);
          s.close(4403, "kicked");
        }
        return this.afterChange([]);
      }
      case "sit": {
        const spec = r.spectators.find((s) => s.id === pid);
        if (!spec || r.status !== "lobby" || r.seats.length >= r.settings.maxPlayers) {
          return this.send(ws, { t: "error", code: "cannotSit" });
        }
        r.spectators = r.spectators.filter((s) => s.id !== pid);
        r.seats.push(this.newSeat(pid, spec.name, spec.avatar, spec.tokenHash, now));
        return this.afterChange([]);
      }
      case "stand": {
        if (!seat || r.status !== "lobby") return this.send(ws, { t: "error", code: "cannotStand" });
        r.seats = r.seats.filter((s) => s.id !== pid);
        r.spectators.push({ id: pid, name: seat.name, avatar: seat.avatar, tokenHash: seat.tokenHash!, connected: true });
        return this.afterChange([]);
      }
      case "leave": {
        if (seat) {
          if (r.status === "lobby") r.seats = r.seats.filter((s) => s.id !== pid);
          else {
            seat.left = true;
            seat.connected = false;
            seat.disconnectedAt = now;
          }
        }
        r.spectators = r.spectators.filter((s) => s.id !== pid);
        for (const s of this.socketsOf(pid)) {
          s.serializeAttachment({ pid: null } satisfies Attachment);
          s.close(1000, "left");
        }
        return this.afterChange([]);
      }
      case "emote": {
        for (const s of this.ctx.getWebSockets()) this.send(s, { t: "emote", from: pid, e: msg.e });
        return;
      }
      default:
        return;
    }
  }

  // ───────────────────────── game flow ─────────────────────────

  private newSeat(id: string, name: string, avatar: number, tokenHash: string | null, now: number): Seat {
    return {
      id,
      name,
      avatar,
      isBot: false,
      tokenHash,
      joinedAt: now,
      connected: true,
      disconnectedAt: null,
      afk: 0,
      left: false,
    };
  }

  private async startRound() {
    const r = this.room!;
    const now = Date.now();
    r.seats = r.seats.filter((s) => !s.left);
    for (const spec of [...r.spectators]) {
      if (r.seats.length >= r.settings.maxPlayers || !spec.connected) continue;
      r.spectators = r.spectators.filter((s) => s !== spec);
      r.seats.push(this.newSeat(spec.id, spec.name, spec.avatar, spec.tokenHash, now));
    }
    if (r.seats.length < 2) return this.backToLobby();
    r.round += 1;
    r.dealer = (r.dealer + 1) % r.seats.length;
    const { state, events } = createRound({
      playerIds: r.seats.map((s) => s.id),
      dealer: r.dealer,
      settings: r.settings,
      seed: (Math.random() * 2 ** 31) | 0,
      scores: r.scores,
      round: r.round,
      now,
    });
    r.game = state;
    r.version += 1;
    r.status = "playing";
    r.nextRoundAt = null;
    await this.afterChange(events);
  }

  private async backToLobby() {
    const r = this.room!;
    r.status = "lobby";
    r.game = null;
    r.version += 1;
    r.nextRoundAt = null;
    r.seats = r.seats.filter((s) => !s.left);
    await this.afterChange([]);
  }

  private async commit(res: ApplyResult) {
    if (!res.ok) return;
    const r = this.room!;
    r.game = res.state;
    r.version += 1;
    const ph = res.state.phase;
    if (ph.kind === "roundOver") {
      r.status = "roundOver";
      r.scores = { ...res.state.scores };
      r.nextRoundAt = ph.gameOver ? null : Date.now() + (this.fast ? 2000 : NEXT_ROUND_MS);
    }
    await this.afterChange(res.events);
  }

  private isAuto(s: Seat) {
    return s.isBot || s.left || !s.connected || s.afk >= 2;
  }

  private humansOnline() {
    const r = this.room!;
    return r.seats.some((s) => !s.isBot && s.connected) || r.spectators.some((s) => s.connected);
  }

  /** What an auto-played seat does: bots think for themselves; absent humans play safe. */
  private autoAction(g: GameState, seat: Seat): Action | null {
    const view = viewFor(g, seat.id, { fullDiscard: true });
    if (seat.isBot) return botAction(view, seat.id);
    const ph = view.phase;
    const me = view.players.find((p) => p.id === seat.id)!;
    if (me.handCount <= 2 && !me.unoDeclared && me.handCount >= 1) return { type: "uno" };
    switch (ph.kind) {
      case "challenge":
        return ph.by !== seat.id && !ph.responded.includes(seat.id) ? { type: "trust" } : null;
      case "wlcCommit":
        if (ph.by === seat.id || ph.committed.includes(seat.id) || view.hand.length === 0) return null;
        return { type: "wlcCommit", cardId: defaultWlcCommit(view.hand, ph.color).id };
      case "wlcChallenge":
        return ph.by === seat.id ? { type: "wlcEnd" } : null;
      case "turn":
      case "afterDraw": {
        if (view.players[view.current]?.id !== seat.id) return null;
        const a = botAction(view, seat.id);
        return a && a.type !== "catch" && a.type !== "challenge" ? a : { type: ph.kind === "turn" ? "draw" : "keep" };
      }
      default:
        return null;
    }
  }

  /** Picks the next auto-played move (current player first), or null if no auto seat wants to act. */
  private planBot(g: GameState): { pid: string; action: Action } | null {
    const r = this.room!;
    const curId = g.players[g.current].id;
    const order = r.seats
      .filter((s) => this.isAuto(s) && g.players.some((p) => p.id === s.id))
      .sort((a, b) => (a.id === curId ? -1 : b.id === curId ? 1 : 0));
    for (const seat of order) {
      const action = this.autoAction(g, seat);
      if (action) return { pid: seat.id, action };
    }
    return null;
  }

  private botDelay(g: GameState, plan: { pid: string; action: Action }): number {
    const ph = g.phase;
    if (plan.action.type === "uno" || plan.action.type === "catch") return rand(400, 1200);
    if (ph.kind === "challenge") return rand(500, 1500);
    if (ph.kind === "wlcCommit") return rand(600, 1400);
    if (ph.kind === "wlcChallenge") return rand(1100, 1900);
    const seat = this.room!.seats.find((s) => s.id === plan.pid);
    if (seat && !seat.isBot && !seat.connected) return 2500;
    return rand(900, 1700);
  }

  private async runPlannedBot(now: number): Promise<boolean> {
    const r = this.room!;
    const plan = r.pendingBot;
    r.pendingBot = null;
    r.botAt = null;
    if (!plan || plan.version !== r.version || !r.game) return false;
    const res = applyAction(r.game, plan.pid, plan.action, now);
    if (!res.ok) return false;
    await this.commit(res);
    return true;
  }

  // ───────────────────────── persistence, timers, broadcast ─────────────────────────

  private emptyGrace() {
    const r = this.room;
    const lobby = !r || r.status === "lobby";
    if (this.fast) return lobby ? 3000 : 5000;
    return lobby ? 2 * 60_000 : 5 * 60_000;
  }

  /** Recomputes housekeeping after any change, then persists, broadcasts and re-arms the alarm. */
  private async afterChange(events: GameEvent[], opts: { quiet?: boolean } = {}) {
    const r = this.room!;
    const now = Date.now();
    const online = this.humansOnline();
    const hostBefore = r.hostId;

    // Host must be a seated human; prefer someone connected.
    const host = r.seats.find((s) => s.id === r.hostId && !s.isBot && !s.left);
    const hostAway = host && !host.connected && now - (host.disconnectedAt ?? now) > this.grace(HOST_GRACE_MS);
    if (!host || hostAway) {
      const candidates = r.seats.filter((s) => !s.isBot && !s.left).sort((a, b) => a.joinedAt - b.joinedAt);
      const next = candidates.find((s) => s.connected) ?? candidates[0];
      if (next) r.hostId = next.id;
      else if (!host) r.hostId = "";
    }

    r.cleanupAt = online ? null : (r.cleanupAt ?? now + this.emptyGrace());

    const g = r.game;
    if (!online || !g || g.phase.kind === "roundOver") {
      r.pendingBot = null;
      r.botAt = null;
    } else if (
      !r.pendingBot ||
      r.pendingBot.version !== r.version ||
      !r.seats.some((s) => s.id === r.pendingBot!.pid && this.isAuto(s))
    ) {
      const plan = this.planBot(g);
      r.pendingBot = plan ? { ...plan, version: r.version } : null;
      r.botAt = plan ? now + this.botDelay(g, plan) : null;
    }

    await this.save();
    if (!opts.quiet || events.length > 0 || r.hostId !== hostBefore) this.broadcast(events);
    await this.publishLobby(false);
    await this.armAlarm();
  }

  private async armAlarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    const online = this.humansOnline();
    const times: number[] = [r.lastActivity + IDLE_MS];
    if (r.cleanupAt) times.push(r.cleanupAt);
    if (online) {
      if (r.botAt) times.push(r.botAt);
      if (r.game?.deadline) times.push(r.game.deadline);
      if (r.nextRoundAt) times.push(r.nextRoundAt);
      if (r.lobbyRefreshAt) times.push(r.lobbyRefreshAt);
      // Wake up once when a disconnected player's grace period ends (seat drop / host hand-over).
      for (const s of r.seats) {
        if (s.disconnectedAt && !s.connected && !s.isBot) {
          const t = s.disconnectedAt + this.grace(r.status === "lobby" ? SEAT_GRACE_MS : HOST_GRACE_MS) + 50;
          if (t > now) times.push(t);
        }
      }
    }
    const at = Math.max(now + 20, Math.min(...times));
    await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    if ((r.cleanupAt && now >= r.cleanupAt) || now - r.lastActivity >= IDLE_MS) {
      await this.destroy(r.cleanupAt && now >= r.cleanupAt ? "empty" : "idle");
      return;
    }
    // Drop humans who disconnected from the waiting room a while ago.
    if (r.status === "lobby") {
      const before = r.seats.length;
      r.seats = r.seats.filter((s) => s.isBot || s.connected || now - (s.disconnectedAt ?? now) < this.grace(SEAT_GRACE_MS));
      if (r.seats.length !== before) {
        await this.afterChange([]);
        return;
      }
    }
    if (r.lobbyRefreshAt && now >= r.lobbyRefreshAt) await this.publishLobby(true);
    if (!this.humansOnline()) {
      await this.armAlarm();
      return;
    }
    if (r.status === "roundOver" && r.nextRoundAt && now >= r.nextRoundAt) {
      await this.startRound();
      return;
    }
    const g = r.game;
    if (g && g.deadline !== null && now >= g.deadline && g.phase.kind !== "roundOver") {
      const cur = r.seats.find((s) => s.id === g.players[g.current].id);
      if (cur && (g.phase.kind === "turn" || g.phase.kind === "afterDraw") && !cur.isBot) cur.afk += 1;
      const res = applyTimeout(g, now);
      if (res) {
        await this.commit(res);
        return;
      }
    }
    if (r.botAt && now >= r.botAt) {
      if (await this.runPlannedBot(now)) return;
    }
    // Housekeeping only (lobby refresh, grace checks, re-planning): no need to re-send state.
    await this.afterChange([], { quiet: true });
  }

  private async destroy(reason: string) {
    const r = this.room;
    if (!r) return;
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: "closed", reason });
      try {
        ws.close(4000, reason);
      } catch {
        /* ignore */
      }
    }
    try {
      await lobbyStub(this.env).remove(r.code);
    } catch {
      /* the lobby sweeps stale entries anyway */
    }
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private async save() {
    if (this.room) await this.ctx.storage.put("room", this.room);
  }

  private async publishLobby(force: boolean) {
    const r = this.room!;
    const listed = r.isPublic && this.humansOnline();
    const host = r.seats.find((s) => s.id === r.hostId);
    const entry: LobbyRoom = {
      code: r.code,
      name: r.name,
      host: host?.name ?? "",
      players: r.seats.filter((s) => !s.left).length,
      max: r.settings.maxPlayers,
      status: r.status,
      updated: Date.now(),
    };
    const sig = listed ? JSON.stringify({ ...entry, updated: 0 }) : "unlisted";
    if (!force && sig === this.lastLobbySig) return;
    this.lastLobbySig = sig;
    r.lobbyRefreshAt = listed ? Date.now() + LOBBY_REFRESH_MS : null;
    try {
      const lobby = lobbyStub(this.env);
      if (listed) await lobby.upsert(entry, LOBBY_TTL_MS);
      else await lobby.remove(r.code);
    } catch {
      this.lastLobbySig = "";
    }
  }

  private socketsOf(pid: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.pid === pid);
  }

  private viewFor(pid: string): RoomView {
    const r = this.room!;
    const seated = r.seats.some((s) => s.id === pid);
    const inGame = r.game?.players.some((p) => p.id === pid);
    return {
      code: r.code,
      name: r.name,
      isPublic: r.isPublic,
      hostId: r.hostId,
      status: r.status,
      settings: r.settings,
      seats: r.seats.map((s) => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        isBot: s.isBot,
        connected: s.isBot || s.connected,
        autoplay: !s.isBot && this.isAuto(s),
      })),
      spectators: r.spectators.filter((s) => s.connected).map((s) => ({ id: s.id, name: s.name, avatar: s.avatar })),
      scores: r.scores,
      game: r.game ? viewFor(r.game, inGame ? pid : null) : null,
      you: pid,
      role: seated ? "seat" : "spectator",
      nextRoundAt: r.nextRoundAt,
      serverNow: Date.now(),
    };
  }

  private broadcast(events: GameEvent[]) {
    const r = this.room;
    if (!r) return;
    for (const ws of this.ctx.getWebSockets()) {
      const pid = (ws.deserializeAttachment() as Attachment | null)?.pid;
      if (!pid) continue;
      const inGame = r.game?.players.some((p) => p.id === pid);
      this.send(ws, { t: "state", room: this.viewFor(pid), events: eventsFor(events, inGame ? pid : null) });
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  /** Token bucket: bursts of 20, refilling 8 messages per second. */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: 20, last: now };
    b.tokens = Math.min(20, b.tokens + ((now - b.last) / 1000) * 8);
    b.last = now;
    if (b.tokens < 1) {
      this.buckets.set(ws, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(ws, b);
    return true;
  }
}

export { DEFAULT_ROOM_SETTINGS };
