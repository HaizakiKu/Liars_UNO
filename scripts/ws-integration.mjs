// End-to-end protocol test against a real local workerd (wrangler dev on the built worker).
// Usage: npm run build && npm run test:ws
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { botAction } from "./bot-bundle.mjs";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}

async function waitFor(fn, ms = 15000, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

class Client {
  constructor(name) {
    this.name = name;
    this.pid = "p" + randomBytes(8).toString("hex");
    this.token = randomBytes(24).toString("hex");
    this.room = null;
    this.errors = [];
    this.events = [];
    this.closed = null;
    this.messages = 0;
  }
  connect(code, token = this.token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws`);
      this.ws = ws;
      this.closed = null;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "hello", pid: this.pid, token, name: this.name, avatar: 3 }));
        resolve();
      };
      ws.onerror = (e) => reject(e);
      ws.onclose = (e) => (this.closed = e.code);
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        this.messages++;
        if (msg.t === "state") {
          this.room = msg.room;
          this.events.push(...msg.events);
          this.validate();
        } else if (msg.t === "error") this.errors.push(msg.code);
      };
    });
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  act(a) {
    this.send({ t: "act", a });
  }
  close() {
    this.ws.close();
  }
  validate() {
    const g = this.room.game;
    if (!g) return;
    const me = g.players.find((p) => p.id === this.pid);
    if (me && g.phase.kind !== "roundOver" && g.hand.length !== me.handCount) {
      this.errors.push(`handMismatch ${g.hand.length}/${me.handCount}`);
    }
    if (!me && g.hand.length > 0) this.errors.push("spectatorSeesHand");
    for (const d of g.discard) if (d.hidden && d.card) this.errors.push("hiddenCardLeaked");
  }
}

async function main() {
  console.log("starting wrangler dev…");
  const wr = spawn(
    "npx",
    ["wrangler", "dev", "-c", "dist/liars_uno/wrangler.json", "--port", String(PORT), "--var", "FAST_TIMERS:1", "--ip", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } },
  );
  let log = "";
  wr.stdout.on("data", (d) => (log += d));
  wr.stderr.on("data", (d) => (log += d));
  const up = await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/api/lobby`)).ok;
    } catch {
      return false;
    }
  }, 60000, 300);
  if (!up) {
    console.log(log);
    throw new Error("wrangler dev did not start");
  }
  try {
    await run();
  } finally {
    wr.kill("SIGTERM");
  }
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall integration checks passed");
}

async function run() {
  console.log("lobby + room creation");
  const lobbyMsgs = [];
  const lobby = new WebSocket(`${WS_BASE}/api/lobby/ws`);
  lobby.onmessage = (m) => lobbyMsgs.push(JSON.parse(m.data));
  await waitFor(() => lobbyMsgs.length > 0);
  check(lobbyMsgs[0].t === "rooms", "lobby feed sends initial list");

  const bad = await fetch(`${BASE}/api/rooms/zzzzzz`);
  check(bad.status === 400 || bad.status === 404, "invalid room code rejected");

  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "  Integration\u0000 Table ", isPublic: true, settings: { challengeSeconds: 4, turnSeconds: 15, maxPlayers: 5 } }),
  });
  const { code } = await res.json();
  check(/^[A-Z2-9]{6}$/.test(code), `room created (${code})`);
  const info = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
  check(info.exists && info.name === "Integration Table", "room info + name sanitized");

  const A = new Client("Alice");
  const B = new Client("Bob");
  const C = new Client("Carol");
  await A.connect(code);
  await waitFor(() => A.room);
  check(A.room.hostId === A.pid, "first joiner becomes host");
  check(A.room.settings.challengeSeconds === 4 && A.room.settings.maxPlayers === 5, "settings applied");
  await waitFor(() => lobbyMsgs.at(-1)?.rooms.some((r) => r.code === code));
  check(lobbyMsgs.at(-1).rooms.some((r) => r.code === code), "public room appears in lobby feed");

  await B.connect(code);
  await C.connect(code);
  await waitFor(() => A.room.seats.length === 3);
  check(A.room.seats.length === 3, "three humans seated");

  B.send({ t: "addBot" });
  await waitFor(() => B.errors.includes("notHost"));
  check(B.errors.includes("notHost"), "non-host cannot add bots");
  B.errors.length = 0;
  A.send({ t: "addBot" });
  await waitFor(() => A.room.seats.length === 4);
  check(A.room.seats.some((s) => s.isBot), "host adds a bot");

  // Wrong token for an existing pid is refused.
  const imposter = new Client("Mallory");
  imposter.pid = B.pid;
  await imposter.connect(code);
  await waitFor(() => imposter.errors.length > 0 || imposter.closed);
  check(imposter.errors.includes("badToken"), "stolen pid with wrong token rejected");

  console.log("playing a round");
  A.send({ t: "start" });
  await waitFor(() => A.room.status === "playing");
  check(A.room.game && A.room.game.hand.length === 7, "game started, 7 cards dealt");
  check(A.events.some((e) => e.t === "deal"), "deal event received");

  // Spectator joins mid-game.
  const D = new Client("Dave");
  await D.connect(code);
  await waitFor(() => D.room);
  check(D.room.role === "spectator" && D.room.game.hand.length === 0, "late joiner spectates without seeing hands");

  const humans = [A, B, C];
  let disconnectedOnce = false;
  let reconnectChecked = false;
  const deadline = Date.now() + 240_000;
  let lastSeq = "";
  while (Date.now() < deadline) {
    const g = A.room.game;
    if (A.room.status === "roundOver") break;
    // Disconnect Bob once mid-game and reconnect later.
    if (!disconnectedOnce && g && g.turnId > 6) {
      disconnectedOnce = true;
      B.close();
      await waitFor(() => A.room.seats.find((s) => s.id === B.pid)?.connected === false, 5000);
      check(A.room.seats.find((s) => s.id === B.pid).autoplay, "disconnected player is auto-played");
      await sleep(3500);
      await B.connect(code);
      await waitFor(() => A.room.seats.find((s) => s.id === B.pid)?.connected, 5000);
      const bView = await waitFor(() => B.room?.game, 3000);
      const bInGame = bView?.players.find((p) => p.id === B.pid);
      check(bInGame && bView.hand.length === bInGame.handCount, "reconnected player gets their seat & hand back");
      reconnectChecked = true;
    }
    for (const c of humans) {
      const v = c.room?.game;
      if (!v || c.closed !== null) continue;
      const a = botAction(v, c.pid);
      if (a) c.act(a);
    }
    const sig = JSON.stringify([g?.turnId, g?.phase.kind, g?.discardCount]);
    if (sig !== lastSeq) lastSeq = sig;
    await sleep(120);
  }
  check(reconnectChecked, "reconnect scenario exercised");
  const end = await waitFor(() => A.room.status === "roundOver" && A.room.game, 20000);
  check(!!end, "round reached roundOver");
  if (end) {
    const ph = end.phase;
    check(ph.kind === "roundOver" && ph.winners.length > 0, `winner(s): ${ph.winners?.map((w) => A.room.seats.find((s) => s.id === w)?.name).join(", ")}`);
    check(Object.keys(ph.hands).length === 4, "all hands revealed at round end");
  }
  const benign = new Set(["notYourTurn", "alreadyResponded", "noChallenge", "notVulnerable", "cannotUno", "noWlc", "notYourWlc", "roundOver", "ownPlay", "alreadyCommitted", "badTarget", "mustPlayDrawn", "noSuchCard", "notPlaying"]);
  for (const c of [A, B, C, D]) {
    const bad = c.errors.filter((e) => !benign.has(e));
    check(bad.length === 0, `${c.name}: no protocol violations${bad.length ? " " + bad.join(",") : ""}`);
  }
  const eventKinds = new Set(A.events.map((e) => e.t));
  console.log("  event kinds seen:", [...eventKinds].join(" "));

  console.log("host controls after the round");
  A.send({ t: "lobby" });
  await waitFor(() => A.room.status === "lobby");
  check(A.room.status === "lobby", "host returns room to lobby");

  console.log("quick join");
  const qj = await (await fetch(`${BASE}/api/quick-join`, { method: "POST", body: "{}" })).json();
  check(typeof qj.code === "string", `quick-join returns a room (${qj.code}${qj.created ? ", new" : ""})`);

  console.log("leaving & cleanup");
  for (const c of [A, B, C, D]) c.send({ t: "leave" });
  await sleep(300);
  for (const c of [A, B, C, D]) if (c.closed === null) c.close();
  const gone = await waitFor(async () => (await fetch(`${BASE}/api/rooms/${code}`)).status === 404, 20000, 500);
  check(!!gone, "empty room is deleted from storage");
  const delisted = await waitFor(() => !lobbyMsgs.at(-1)?.rooms.some((r) => r.code === code), 10000);
  check(!!delisted, "deleted room disappears from lobby feed");
  lobby.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
