import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import type { DiscardView } from "../../shared/view";
import { anchor, centerOf, seatKey } from "../anim/anchors";
import { CardBack, FlipCard } from "../components/Card";
import { claimText } from "../lib/cardText";
import { useT } from "../lib/i18n";
import { act } from "../state/connection";
import { useGame } from "../state/store";
import { useTable } from "./hooks";

const COLOR_HEX: Record<string, string> = { red: "#e5484d", yellow: "#f5b83d", green: "#30a46c", blue: "#3e63dd" };

/** Offset from the pile center to an anchor (where a card should appear to come from / go to). */
function offsetFromPile(key: string) {
  const from = centerOf(key);
  const pile = centerOf("pile");
  if (!from || !pile) return null;
  return { x: from.x - pile.x, y: from.y - pile.y };
}

function PileEntry({ e, depth, me }: { e: DiscardView; depth: number; me: string }) {
  const mySeqCard = useGame((s) => s.mySeqCard);
  const myCardId = e.by === me ? (e.card?.id ?? mySeqCard[e.seq]) : undefined;
  const [initial] = useState(() => {
    if (myCardId) return undefined;
    if (e.seq <= useGame.getState().pileBaseline) return false as const;
    const o = offsetFromPile(e.by ? seatKey(e.by) : "deck");
    if (!o) return { opacity: 0, scale: 0.8 };
    return { x: o.x, y: o.y, scale: 0.55, rotate: e.rot - 50, opacity: 0.4 };
  });
  const [faceUpAtStart] = useState(() => !!myCardId);
  const back = e.by ? offsetFromPile(seatKey(e.by)) : null;
  return (
    <motion.div
      className="pile-card"
      layoutId={myCardId}
      style={{ zIndex: 10 - depth }}
      initial={initial}
      animate={{ x: depth * 1.5, y: -depth * 1.5, scale: 1, rotate: e.rot, opacity: 1 }}
      variants={{
        gone: (mode: string) =>
          mode === "takeback" && back
            ? { x: back.x, y: back.y, scale: 0.4, rotate: e.rot + 40, opacity: 0, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } }
            : { opacity: 0, transition: { duration: 0.15 } },
      }}
      exit={myCardId ? { opacity: 0, transition: { duration: 0.01 } } : "gone"}
      transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.9 }}
    >
      <FlipCard card={e.card} faceUp={!e.hidden} chosen={e.chosenColor} initialFaceUp={faceUpAtStart || !e.hidden} />
    </motion.div>
  );
}

function Pile() {
  const t = useT();
  const { g, me, seatOf } = useTable();
  const entries = g.discard.slice(-5);
  const top = g.discard[g.discard.length - 1];
  const prevTop = useRef(top?.seq ?? 0);
  const takeback = top && top.seq < prevTop.current;
  prevTop.current = top?.seq ?? 0;
  const claimShown = top?.hidden && top.claim;
  return (
    <div className="pile" ref={anchor("pile")}>
      <div className="pile-aura" style={{ background: COLOR_HEX[g.top.color] }} />
      <AnimatePresence custom={takeback ? "takeback" : "buried"}>
        {entries.map((e, i) => (
          <PileEntry key={e.seq} e={e} depth={entries.length - 1 - i} me={me} />
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {claimShown && top.claim && (
          <motion.div
            key={top.seq}
            className="claim-tag"
            initial={{ opacity: 0, y: -6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          >
            <span className="claim-tag-who">{top.by ? (top.by === me ? t.youClaimed : t.claims(seatOf(top.by).name)) : ""}</span>
            <b className={`claim-tag-what c-${top.claim.color ?? top.chosenColor ?? "wild"}`}>{claimText(t, top.claim, top.chosenColor)}</b>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Deck() {
  const t = useT();
  const { g, myTurn } = useTable();
  const canDraw = myTurn && g.phase.kind === "turn";
  const layers = Math.min(4, Math.ceil(g.drawCount / 14));
  return (
    <button
      type="button"
      className={`deck ${canDraw ? "is-ready" : ""}`}
      ref={anchor("deck")}
      disabled={!canDraw}
      onClick={() => canDraw && act({ type: "draw" })}
      aria-label={`${t.draw} (${g.drawCount})`}
      data-testid="deck"
    >
      {Array.from({ length: Math.max(1, layers) }, (_, i) => (
        <span key={i} className="deck-layer" style={{ transform: `translate(${-i * 2}px, ${-i * 2.5}px)` }}>
          <CardBack />
        </span>
      ))}
      <span className="deck-count">{g.drawCount}</span>
      {canDraw && <span className="deck-hint">{t.draw}</span>}
    </button>
  );
}

const RX = 170;
const RY = 104;
function arc(a0: number, a1: number) {
  const p = (a: number) => [200 + RX * Math.cos((a * Math.PI) / 180), 120 + RY * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${RX} ${RY} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

/** Ellipse around the piles; dots flow and arrowheads point in the direction of play (mirrored when reversed). */
function DirectionRing() {
  const { g } = useTable();
  return (
    <motion.svg
      className="direction-ring"
      viewBox="0 0 400 240"
      initial={false}
      animate={{ scaleX: g.direction }}
      transition={{ type: "spring", stiffness: 120, damping: 16 }}
      style={{ color: COLOR_HEX[g.top.color] }}
      aria-hidden
    >
      <defs>
        <marker id="dir-arrow" viewBox="0 0 10 10" refX="4" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">
          <path d="M1 1 9 5 1 9Z" fill="currentColor" />
        </marker>
      </defs>
      <ellipse cx="200" cy="120" rx={RX} ry={RY} className="dir-dots" />
      {[
        [196, 232],
        [316, 352],
        [76, 112],
      ].map(([a, b]) => (
        <path key={a} d={arc(a, b)} className="dir-arc" markerEnd="url(#dir-arrow)" />
      ))}
    </motion.svg>
  );
}

export function Center() {
  return (
    <div className="center">
      <DirectionRing />
      <div className="center-anchor" ref={anchor("center")} />
      <Deck />
      <Pile />
    </div>
  );
}
