import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Card } from "../../shared/cards";
import { anchor, centerOf } from "../anim/anchors";
import { FlipCard } from "../components/Card";
import { useGame } from "../state/store";
import { type CardState, cardState, useTable } from "./hooks";

export function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

const COLOR_ORDER: Record<string, number> = { red: 0, yellow: 1, green: 2, blue: 3 };
const VALUE_ORDER = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2", "wild4", "wlc"];

/** Hand order: by color, then value, Regular before Liar's; wilds last. */
function compareCards(a: Card, b: Card) {
  const ca = a.color ? COLOR_ORDER[a.color] : 9;
  const cb = b.color ? COLOR_ORDER[b.color] : 9;
  if (ca !== cb) return ca - cb;
  const va = VALUE_ORDER.indexOf(a.value);
  const vb = VALUE_ORDER.indexOf(b.value);
  if (va !== vb) return va - vb;
  if (a.liar !== b.liar) return a.liar ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

export function handCardWidth(w: number, h: number) {
  if (w < 520) return Math.max(58, Math.min(72, w * 0.17));
  return Math.max(76, Math.min(112, w * 0.075, h * 0.13));
}

interface HandCardProps {
  card: Card;
  index: number;
  x: number;
  y: number;
  rot: number;
  cw: number;
  state: CardState;
  selected: boolean;
  stagger: number;
  handEl: HTMLDivElement | null;
  onPick: (card: Card, alt: boolean) => void;
}

function HandCard({ card, index, x, y, rot, cw, state, selected, stagger, handEl, onPick }: HandCardProps) {
  const originKey = useGame((s) => s.handOrigin[card.id]);
  const exitKey = useGame((s) => s.handExit[card.id]);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const [initial] = useState(() => {
    if (!originKey || originKey === "pile" || !handEl) return undefined;
    const o = centerOf(originKey);
    const r = handEl.getBoundingClientRect();
    if (!o) return { opacity: 0, y: y + 60 };
    const baseX = r.left + r.width / 2;
    const baseY = r.bottom - (cw * 1.5) / 2;
    return { x: o.x - baseX, y: o.y - baseY, rotate: rot - 25, scale: 0.6, opacity: 0 };
  });
  const [flipFromBack] = useState(() => originKey === "deck" || (!!originKey && originKey.startsWith("seat:")));

  const exitTarget = (() => {
    if (!exitKey || !handEl) return { opacity: 0, transition: { duration: 0.01 } };
    const o = centerOf(exitKey);
    const r = handEl.getBoundingClientRect();
    if (!o) return { opacity: 0, y: y - 40 };
    return {
      x: o.x - (r.left + r.width / 2),
      y: o.y - (r.bottom - (cw * 1.5) / 2),
      scale: 0.45,
      rotate: rot + 30,
      opacity: 0,
      transition: { duration: 0.55, ease: [0.4, 0, 0.2, 1] as const },
    };
  })();

  const interactive = state === "play" || state === "bluff" || state === "cheat" || state === "commit";
  const lift = selected ? -34 : state === "play" || state === "bluff" ? -10 : 0;
  const clearPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };

  return (
    <motion.div
      layoutId={card.id}
      className={`hand-card is-${state} ${selected ? "is-selected" : ""}`}
      style={{ zIndex: index + 1, width: cw, marginLeft: -cw / 2 }}
      initial={initial}
      animate={{ x, y: y + lift, rotate: selected ? rot * 0.3 : rot, scale: 1, opacity: 1 }}
      exit={exitTarget}
      whileHover={interactive ? { y: y + lift - 20, rotate: rot * 0.4, transition: { type: "spring", stiffness: 500, damping: 30 } } : undefined}
      transition={{ type: "spring", stiffness: 340, damping: 30, mass: 0.85, delay: stagger }}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        if (interactive) onPick(card, false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onPick(card, true);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        clearPress();
        press.current = setTimeout(() => {
          longPressed.current = true;
          onPick(card, true);
        }, 520);
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={`${card.liar ? "Liar's " : ""}${card.color ?? "wild"} ${card.value}`}
      data-testid="hand-card"
      data-state={state}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && interactive) {
          e.preventDefault();
          onPick(card, false);
        }
      }}
    >
      <FlipCard card={card} faceUp initialFaceUp={!flipFromBack} />
      {state === "bluff" && <span className="hand-card-tag">?</span>}
    </motion.div>
  );
}

export function Hand({ onPick }: { onPick: (card: Card, alt: boolean) => void }) {
  const { g, me, myTurn } = useTable();
  const selected = useGame((s) => s.selected);
  const origins = useGame((s) => s.handOrigin);
  const { w, h } = useViewport();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const cards = [...g.hand].sort(compareCards);
  const n = cards.length;
  const cw = handCardWidth(w, h);
  const maxSpan = Math.min(w - 32, 1000);
  const step = n > 1 ? Math.min(cw * 0.68, (maxSpan - cw) / (n - 1)) : 0;
  const tilt = Math.min(3.4, 30 / Math.max(n, 1));
  const arc = Math.min(2.4, 20 / Math.max(n, 1));
  const arriving = cards.filter((c) => origins[c.id] === "deck").length;
  let arrivalIndex = 0;

  return (
    <div
      className="hand"
      ref={(node) => {
        setEl(node);
        return anchor("hand")(node);
      }}
      style={{ height: cw * 1.5 + 28 }}
    >
      <AnimatePresence>
        {cards.map((c, i) => {
          const off = i - (n - 1) / 2;
          const st = cardState(g, c, myTurn, me);
          const stagger = origins[c.id] === "deck" && arriving > 2 ? arrivalIndex++ * 0.065 : 0;
          return (
            <HandCard
              key={c.id}
              card={c}
              index={i}
              x={off * step}
              y={Math.abs(off) ** 2 * arc}
              rot={off * tilt}
              cw={cw}
              state={st}
              selected={selected === c.id}
              stagger={stagger}
              handEl={el}
              onPick={onPick}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
