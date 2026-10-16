import type { GameEvent } from "../../shared/engine";
import type { RoomView } from "../../shared/protocol";
import { seatKey } from "../anim/anchors";
import { claimText } from "../lib/cardText";
import { getT } from "../lib/i18n";
import { sfx } from "../lib/sound";
import { pushFeed, pushFlight, pushSeatFx, uid, useGame } from "./store";

/**
 * Server snapshots arrive with the events that produced them. The director plays them back in order:
 * a dramatic reveal is shown *before* its snapshot lands, then the snapshot is applied (hand/pile morphs
 * happen through shared layout ids) while seat-to-seat flights and badges are spawned from the events.
 */
interface Batch {
  room: RoomView;
  events: GameEvent[];
}

const queue: Batch[] = [];
let busy = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function enqueue(room: RoomView, events: GameEvent[]) {
  useGame.setState({ clockOffset: room.serverNow - Date.now() });
  queue.push({ room, events });
  void pump();
}

export function resetDirector() {
  queue.length = 0;
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length > 0) {
      const b = queue.shift()!;
      const backlog = queue.length;
      const reveal = b.events.find((e) => e.t === "reveal");
      const challenge = b.events.find((e) => e.t === "challenge");
      if (reveal && reveal.t === "reveal" && challenge && challenge.t === "challenge" && backlog < 3) {
        const prevPhase = useGame.getState().room?.game?.phase;
        const claim = prevPhase?.kind === "challenge" ? prevPhase.claim : null;
        const chosen = prevPhase?.kind === "challenge" ? prevPhase.chosenColor : null;
        useGame.setState({
          reveal: {
            id: uid(),
            challenger: challenge.who,
            target: reveal.who,
            card: reveal.card,
            result: reveal.result,
            claim,
            chosen,
          },
        });
        sfx.challenge();
        const fast = reducedMotion();
        await sleep(fast ? 300 : 700);
        sfx.flip();
        await sleep(fast ? 200 : 420);
        if (reveal.result === "honest") sfx.truth();
        else sfx.lie();
        await sleep(fast ? 700 : 1150);
        useGame.setState({ reveal: null });
      }
      apply(b);
      const settle = backlog > 2 ? 60 : settleTime(b.events);
      await sleep(settle);
    }
  } finally {
    busy = false;
  }
}

function settleTime(events: GameEvent[]): number {
  if (reducedMotion()) return 80;
  let ms = 100;
  for (const e of events) {
    if (e.t === "deal") ms = Math.max(ms, 1100);
    else if (e.t === "swap" || e.t === "pass") ms = Math.max(ms, 750);
    else if (e.t === "play" || e.t === "wlcDiscard") ms = Math.max(ms, 420);
    else if (e.t === "draw") ms = Math.max(ms, 320);
  }
  return ms;
}

function apply(b: Batch) {
  const st = useGame.getState();
  const prev = st.room;
  const room = b.room;
  const me = room.you;
  const prevHand = prev?.game?.hand ?? [];
  const nextHand = room.game?.hand ?? [];
  const prevIds = new Set(prevHand.map((c) => c.id));
  const nextIds = new Set(nextHand.map((c) => c.id));
  const added = nextHand.filter((c) => !prevIds.has(c.id)).map((c) => c.id);
  const removed = prevHand.filter((c) => !nextIds.has(c.id)).map((c) => c.id);
  const origin: Record<string, string> = {};
  const exit: Record<string, string> = {};
  const mySeq = { ...st.mySeqCard };
  for (const id of added) origin[id] = "deck";

  const players = room.game?.players.map((p) => p.id) ?? [];
  const myIdx = players.indexOf(me);
  for (const e of b.events) {
    if (e.t === "swap" && (e.a === me || e.b === me)) {
      const other = e.a === me ? e.b : e.a;
      for (const id of added) origin[id] = seatKey(other);
      for (const id of removed) exit[id] = seatKey(other);
    } else if (e.t === "pass" && myIdx >= 0) {
      const n = players.length;
      const giver = players[(myIdx - e.direction + n) % n];
      const receiver = players[(myIdx + e.direction + n) % n];
      for (const id of added) origin[id] = seatKey(giver);
      for (const id of removed) exit[id] = seatKey(receiver);
    } else if (e.t === "wlcCommit" && e.who === me) {
      for (const id of removed) exit[id] = `wlc:${me}`;
    } else if (e.t === "play" && e.who === me && e.faceDown && e.card) {
      mySeq[e.seq] = e.card.id;
    }
  }
  for (const e of b.events) {
    if (e.t === "draw" && e.who === me && e.cards) for (const c of e.cards) origin[c.id] = "deck";
    if (e.t === "reveal" && e.who === me && e.result !== "honest") origin[e.card.id] = "pile";
    if (e.t === "wlcReveal" && e.who === me && !e.honest) origin[e.card.id] = `wlc:${me}`;
  }
  const dealt = b.events.some((e) => e.t === "deal");
  if (dealt) {
    for (const k of Object.keys(mySeq)) delete mySeq[Number(k)];
  }
  let pileBaseline = st.pileBaseline;
  if (dealt) pileBaseline = 0;
  else if (!prev?.game && room.game) pileBaseline = room.game.discard.at(-1)?.seq ?? 0;
  useGame.setState({
    room,
    pileBaseline,
    handOrigin: origin,
    handExit: exit,
    mySeqCard: mySeq,
    selected: st.selected && nextIds.has(st.selected) ? st.selected : null,
  });
  effects(b.events, room);
}

function effects(events: GameEvent[], room: RoomView) {
  const t = getT();
  const me = room.you;
  const nameOf = (id: string) => (id === me ? t.you : (room.seats.find((s) => s.id === id)?.name ?? "?"));
  const nameObj = (id: string) => (id === me ? t.youObj : nameOf(id));
  const anchorOf = (id: string) => (id === me && room.role === "seat" ? "hand" : seatKey(id));
  const motion = !reducedMotion();
  let delay = 0;
  let challenger = "";

  for (const e of events) {
    switch (e.t) {
      case "deal": {
        if (motion) {
          for (let k = 0; k < e.count; k++) {
            e.order.forEach((pid, i) => {
              if (pid === me) return;
              pushFlight({ from: "deck", to: seatKey(pid), delay: (k * e.order.length + i) * 32, dur: 420 });
            });
          }
        }
        for (let k = 0; k < 5; k++) setTimeout(() => sfx.card(), k * 140);
        break;
      }
      case "play": {
        sfx.card();
        if (e.faceDown && e.claim) pushFeed(t.fPlayDown(nameOf(e.who), claimText(t, e.claim, e.chosenColor)));
        else if (e.card?.value === "wlc") pushFeed(t.fWlc(nameOf(e.who), t.colorNamesLong[e.chosenColor ?? "red"]), "warn");
        else if (e.card) pushFeed(t.fPlay(nameOf(e.who), claimText(t, e.card, e.chosenColor)));
        break;
      }
      case "draw": {
        if (motion) {
          const n = Math.min(e.n, 6);
          for (let i = 0; i < n; i++) {
            if (e.who !== me || room.role !== "seat") {
              pushFlight({ from: "deck", to: anchorOf(e.who), delay: delay + i * 90, dur: 480 });
            }
          }
        }
        setTimeout(() => sfx.draw(), delay);
        if (e.reason === "turn" || e.reason === "timeout" || e.reason === "draw2" || e.reason === "wild4") {
          pushFeed(t.fDraw(nameOf(e.who), e.n));
        }
        if (e.n > 1) pushSeatFx({ pid: e.who, kind: "draw", text: `+${e.n}` }, 1700);
        delay += 120;
        break;
      }
      case "reshuffle":
        if (motion) for (let i = 0; i < 5; i++) pushFlight({ from: "pile", to: "deck", delay: i * 60, dur: 500 });
        pushFeed(t.fReshuffle);
        break;
      case "challenge":
        challenger = e.who;
        pushSeatFx({ pid: e.who, kind: "challenge", text: t.challenge }, 1500);
        break;
      case "reveal":
        if (e.result === "honest") pushFeed(t.fHonest(nameOf(e.who), nameObj(challenger)), "good");
        if (e.result === "lie") pushFeed(t.fLie(nameOf(e.who)), "bad");
        if (e.result === "cheat") pushFeed(t.fCheat(nameOf(e.who)), "bad");
        break;
      case "swap": {
        if (motion) {
          for (let i = 0; i < 5; i++) {
            pushFlight({ from: anchorOf(e.a), to: anchorOf(e.b), delay: i * 50, dur: 650 });
            pushFlight({ from: anchorOf(e.b), to: anchorOf(e.a), delay: i * 50, dur: 650 });
          }
        }
        sfx.flip();
        pushFeed(t.fSwap(nameOf(e.a), nameObj(e.b)), "warn");
        break;
      }
      case "pass": {
        const ids = room.game?.players.map((p) => p.id) ?? [];
        const n = ids.length;
        if (motion) {
          ids.forEach((pid, i) => {
            const to = ids[(i + e.direction + n) % n];
            for (let k = 0; k < 3; k++) pushFlight({ from: anchorOf(pid), to: anchorOf(to), delay: k * 70, dur: 620 });
          });
        }
        sfx.flip();
        pushFeed(t.fPass, "warn");
        break;
      }
      case "reverse":
        pushFeed(t.fReverse);
        break;
      case "skip":
        pushSeatFx({ pid: e.who, kind: "skip" }, 1400);
        pushFeed(t.fSkip(nameOf(e.who)));
        break;
      case "color":
        break;
      case "wlcCommit":
        if (motion && e.who !== me) pushFlight({ from: seatKey(e.who), to: `wlc:${e.who}`, delay: 0, dur: 450 });
        sfx.card();
        break;
      case "wlcReveal":
        sfx.flip();
        setTimeout(() => (e.honest ? sfx.truth() : sfx.lie()), 380);
        pushFeed(e.honest ? t.fWlcHonest(nameOf(e.who)) : t.fWlcLie(nameOf(e.who)), e.honest ? "good" : "bad");
        break;
      case "wlcDiscard":
        if (motion) e.who.forEach((_, i) => pushFlight({ from: "center", to: "pile", delay: i * 90, dur: 480 }));
        if (e.who.length) pushFeed(t.fWlcDiscard(e.who.map(nameOf).join("、")));
        break;
      case "uno":
        sfx.uno();
        pushSeatFx({ pid: e.who, kind: "uno" }, 1800);
        pushFeed(t.fUno(nameOf(e.who)), "warn");
        break;
      case "caught":
        sfx.lie();
        pushSeatFx({ pid: e.who, kind: "caught" }, 1800);
        pushFeed(t.fCaught(nameOf(e.by), nameObj(e.who)), "bad");
        break;
      case "timeout":
        pushSeatFx({ pid: e.who, kind: "timeout" }, 1400);
        pushFeed(t.fTimeout(nameOf(e.who)));
        break;
      case "turn":
        if (e.who === me && room.role === "seat") setTimeout(() => sfx.turn(), 250);
        break;
      case "roundEnd":
        setTimeout(() => sfx.win(), 300);
        break;
    }
  }
}
