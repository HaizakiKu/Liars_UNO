import type { Action } from "../../shared/engine";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import { roomExists, wsUrl } from "../lib/api";
import { getT } from "../lib/i18n";
import { useIdentity } from "../lib/identity";
import { enqueue, resetDirector } from "./director";
import { pushSeatFx, showToast, useGame } from "./store";

/** Errors caused by harmless races (e.g. two people challenging at once) are not shown to the user. */
const SILENT = new Set([
  "alreadyResponded",
  "noChallenge",
  "notVulnerable",
  "cannotUno",
  "roundOver",
  "alreadyCommitted",
  "noWlc",
  "badMessage",
  "notJoined",
]);

class RoomConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly code: string) {}

  start() {
    resetDirector();
    useGame.setState({ status: "connecting", closedReason: null, room: null, feed: [], flights: [], seatFx: [], reveal: null });
    this.open();
  }

  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(wsUrl(`/api/rooms/${this.code}/ws`));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      const id = useIdentity.getState();
      this.raw({ t: "hello", pid: id.pid, token: id.token, name: id.name || "Player", avatar: id.avatar });
      useGame.setState({ status: "open" });
      this.ping = setInterval(() => this.raw({ t: "ping" }), 25_000);
    };
    ws.onmessage = (m) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(m.data as string) as ServerMsg;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = (e) => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (this.stopped || this.ws !== ws) return;
      if (e.code === 4404) return this.fail("notFound");
      if (e.code === 4401) return this.fail("badToken");
      if (e.code === 4403) return this.fail("kicked");
      if (e.code === 4000) return this.fail(e.reason || "closed");
      void this.reconnect();
    };
  }

  private async reconnect() {
    this.attempt += 1;
    useGame.setState({ status: "reconnecting" });
    if (this.attempt % 3 === 0 && (await roomExists(this.code)) === false) return this.fail("notFound");
    const wait = Math.min(8000, 400 * 2 ** Math.min(this.attempt, 5)) + Math.random() * 300;
    this.retry = setTimeout(() => this.open(), wait);
  }

  private fail(reason: string) {
    this.stopped = true;
    useGame.setState({ status: "closed", closedReason: reason });
    this.ws?.close();
  }

  private handle(msg: ServerMsg) {
    switch (msg.t) {
      case "state":
        enqueue(msg.room, msg.events);
        break;
      case "error": {
        if (SILENT.has(msg.code)) return;
        const t = getT();
        showToast(t.errors[msg.code] ?? t.errors.generic);
        break;
      }
      case "emote":
        pushSeatFx({ pid: msg.from, kind: "emote", text: msg.e }, 2200);
        break;
      case "kicked":
        this.fail("kicked");
        break;
      case "closed":
        this.fail(msg.reason === "notFound" ? "notFound" : "closed");
        break;
    }
  }

  private raw(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  send(msg: ClientMsg) {
    if (!this.raw(msg)) showToast(getT().reconnecting);
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    this.ws?.close(1000);
    this.ws = null;
  }
}

let current: RoomConnection | null = null;

export function connectRoom(code: string) {
  current?.stop();
  current = new RoomConnection(code);
  current.start();
  return () => {
    current?.stop();
    current = null;
    useGame.setState({ status: "idle", room: null });
  };
}

export function send(msg: ClientMsg) {
  current?.send(msg);
}

export function act(a: Action) {
  useGame.setState({ selected: null });
  send({ t: "act", a });
}
