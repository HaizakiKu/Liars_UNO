import { motion } from "motion/react";
import type { Card as CardT, Color } from "../../shared/cards";
import { isNumber } from "../../shared/cards";
import { BubbleIcon, ColorMark, MaskIcon, ReverseIcon, SkipIcon } from "./icons";

function Glyph({ value, big }: { value: CardT["value"]; big?: boolean }) {
  if (isNumber(value)) return <span className={big ? "cval-num" : undefined}>{value}</span>;
  if (value === "skip") return <SkipIcon className="cicon" />;
  if (value === "reverse") return <ReverseIcon className="cicon" />;
  if (value === "draw2") return <span className={big ? "cval-num cval-plus" : undefined}>+2</span>;
  if (value === "wild4") return <span className={big ? "cval-num cval-plus" : undefined}>+4</span>;
  return big ? <BubbleIcon className="cicon cicon-bubble" /> : <span>?</span>;
}

/** The printed face of a card. Regular cards are solid; Liar's Cards are dark, striped and neon-edged. */
export function CardFace({ card, chosen }: { card: Pick<CardT, "color" | "value" | "liar">; chosen?: Color | null }) {
  const wild = card.color === null;
  const cls = [
    "cface",
    wild ? "c-wild" : `c-${card.color}`,
    card.liar ? "is-liar" : "is-regular",
    card.value === "wlc" ? "is-wlc" : "",
    chosen ? `chosen-${chosen}` : "",
  ].join(" ");
  return (
    <div className={cls}>
      <div className="cface-frame">
        <span className="cidx cidx-tl">
          <Glyph value={card.value} />
        </span>
        <span className="cidx cidx-br">
          <Glyph value={card.value} />
        </span>
        {card.color && <ColorMark color={card.color} className="cmark" />}
        <div className="coval">
          <span className="cval">
            <Glyph value={card.value} big />
          </span>
        </div>
        {card.liar && <MaskIcon className="cmask" />}
        {card.value === "wlc" && <span className="cwlc-label">LIAR'S CHALLENGE</span>}
      </div>
    </div>
  );
}

export function CardBack() {
  return (
    <div className="cback">
      <div className="cback-frame">
        <div className="cback-oval">
          <span className="cback-word">LIAR'S</span>
          <MaskIcon className="cback-mask" />
        </div>
      </div>
    </div>
  );
}

/** A 3D card that can flip between face and back. `card` may be null for an unknown (hidden) card. */
export function FlipCard({
  card,
  faceUp,
  chosen,
  initialFaceUp,
  className,
}: {
  card: CardT | null;
  faceUp: boolean;
  chosen?: Color | null;
  initialFaceUp?: boolean;
  className?: string;
}) {
  const show = faceUp && !!card;
  return (
    <div className={`card3d ${className ?? ""}`}>
      <motion.div
        className="card3d-inner"
        initial={{ rotateY: (initialFaceUp ?? show) ? 0 : 180 }}
        animate={{ rotateY: show ? 0 : 180 }}
        transition={{ type: "spring", stiffness: 210, damping: 24 }}
      >
        <div className="card3d-side card3d-front">{card && <CardFace card={card} chosen={chosen} />}</div>
        <div className="card3d-side card3d-back">
          <CardBack />
        </div>
      </motion.div>
    </div>
  );
}
