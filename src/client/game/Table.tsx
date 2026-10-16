import { useCallback, useEffect, useState } from "react";
import type { Card } from "../../shared/cards";
import { useT } from "../lib/i18n";
import { act } from "../state/connection";
import { useGame } from "../state/store";
import { Center } from "./Center";
import { Hand, handCardWidth, useViewport } from "./Hand";
import { cardState, opponentsInOrder, useTable } from "./hooks";
import { FlyLayer, RevealOverlay, RoundResult, WlcStage } from "./Overlays";
import { type SheetReq, PlaySheet } from "./PlaySheet";
import { ChallengePrompt, Controls, Feed } from "./Prompts";
import { Seat } from "./Seat";

/** Opponents sit on an arc above the table, in turn order from my left to my right. */
function seatPosition(i: number, k: number): { x: number; y: number } {
  const theta = Math.PI + (Math.PI * (i + 1)) / (k + 1);
  return { x: 50 + 41 * Math.cos(theta), y: 47 + 35 * Math.sin(theta) };
}

export function Table() {
  const t = useT();
  const { room, g, me, myIdx, seated, myTurn } = useTable();
  const [sheet, setSheet] = useState<SheetReq | null>(null);
  const selected = useGame((s) => s.selected);
  const opponents = opponentsInOrder(g, myIdx, seated);
  const ph = g.phase;
  const { w, h } = useViewport();
  const handH = handCardWidth(w, h) * 1.5 + 28;

  const setSelected = (id: string | null) => useGame.setState({ selected: id });

  const onPick = useCallback(
    (card: Card, alt: boolean) => {
      const st = cardState(g, card, myTurn, me);
      if (st === "commit") {
        setSelected(useGame.getState().selected === card.id ? null : card.id);
        return;
      }
      if (alt) {
        const canSneak = myTurn && !card.liar && card.value !== "wlc" && g.settings.allowRegularFaceDown && st !== "none";
        if (canSneak) setSheet({ kind: "claim", card });
        return;
      }
      if (st === "none" || st === "idle") return;
      if (card.value === "wlc") return setSheet({ kind: "wlc", card });
      if (card.liar || st === "cheat") return setSheet({ kind: "claim", card });
      if (card.value === "7" && g.hand.length > 1 && g.players.length > 2) return setSheet({ kind: "seven", card });
      act({ type: "play", cardId: card.id, faceDown: false });
    },
    [g, myTurn, me],
  );

  const playDrawn = () => {
    if (ph.kind !== "afterDraw" || !ph.cardId) return;
    const card = g.hand.find((c) => c.id === ph.cardId);
    if (card) onPick(card, false);
  };

  // Close the sheet if the moment to play has passed (timeout, someone else acted…).
  useEffect(() => {
    if (sheet && !myTurn) setSheet(null);
  }, [myTurn, sheet]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      const cur = useGame.getState().room?.game;
      if (!cur || !seated) return;
      const p = cur.phase;
      const mine = cur.players.find((x) => x.id === me);
      const key = e.key.toLowerCase();
      if (key === "d" && myTurn && p.kind === "turn") act({ type: "draw" });
      else if (key === "u" && mine && mine.handCount <= 2 && !mine.unoDeclared) act({ type: "uno" });
      else if (p.kind === "challenge" && p.by !== me && !p.responded.includes(me)) {
        if (key === "c") act({ type: "challenge" });
        else if (key === " ") {
          e.preventDefault();
          act({ type: "trust" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me, myTurn, seated]);

  return (
    <main
      className={`table ${seated ? "" : "is-spectator"}`}
      data-phase={ph.kind}
      style={{ "--hand-h": `${handH}px` } as React.CSSProperties}
    >
      <div className="felt" aria-hidden>
        <div className="felt-rim" />
      </div>
      <div className="opponents">
        {opponents.map((pid, i) => {
          const pos = seatPosition(i, opponents.length);
          return <Seat key={pid} pid={pid} x={pos.x} y={pos.y} />;
        })}
      </div>
      <Center />
      <Feed />
      <WlcStage selected={selected} onClearSelected={() => setSelected(null)} />
      <ChallengePrompt />
      {seated ? (
        <div className="hand-area">
          <Hand onPick={onPick} />
          <Controls onPlayDrawn={playDrawn} />
          {myTurn && ph.kind === "turn" && g.settings.allowRegularFaceDown && <p className="hand-hint">{t.rightClickHint}</p>}
        </div>
      ) : (
        <div className="spectator-bar">
          <span className="live-dot">{t.spectating}</span>
          <span>{room.name}</span>
        </div>
      )}
      <PlaySheet req={sheet} onClose={() => setSheet(null)} />
      <RevealOverlay />
      <FlyLayer />
      <RoundResult />
    </main>
  );
}
