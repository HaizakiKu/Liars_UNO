import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { COLORS, type Card, type Claim, type Color, matchesTop, sameIdentity } from "../../shared/cards";
import { legalClaims } from "../../shared/engine";
import { Avatar } from "../components/Avatar";
import { CardFace } from "../components/Card";
import { ColorMark } from "../components/icons";
import { Button, Modal } from "../components/ui";
import { claimText } from "../lib/cardText";
import { useT } from "../lib/i18n";
import { act } from "../state/connection";
import { useTable } from "./hooks";

export type SheetReq =
  | { kind: "claim"; card: Card }
  | { kind: "seven"; card: Card }
  | { kind: "wlc"; card: Card };

export function ColorChooser({ value, onPick }: { value: Color | null; onPick: (c: Color) => void }) {
  const t = useT();
  return (
    <div className="color-chooser" role="radiogroup" aria-label={t.chooseColor}>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={`color-swatch c-${c} ${value === c ? "is-on" : ""}`}
          onClick={() => onPick(c)}
        >
          <ColorMark color={c} />
          <span>{t.colorNames[c]}</span>
        </button>
      ))}
    </div>
  );
}

function TargetChooser({ value, onPick }: { value: string | null; onPick: (pid: string) => void }) {
  const { g, me, seatOf } = useTable();
  return (
    <div className="target-chooser">
      {g.players
        .filter((p) => p.id !== me)
        .map((p) => {
          const s = seatOf(p.id);
          return (
            <button key={p.id} type="button" className={`target ${value === p.id ? "is-on" : ""}`} onClick={() => onPick(p.id)}>
              <Avatar name={s.name} index={s.avatar} size={40} />
              <span className="target-name">{s.name}</span>
              <span className="target-count">{p.handCount}</span>
            </button>
          );
        })}
    </div>
  );
}

function ClaimOption({ claim, on, honest, onPick }: { claim: Claim; on: boolean; honest: boolean; onPick: () => void }) {
  const t = useT();
  return (
    <motion.button
      type="button"
      className={`claim-opt ${on ? "is-on" : ""}`}
      onClick={onPick}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.95 }}
      animate={{ y: on ? -6 : 0 }}
      aria-pressed={on}
      title={claimText(t, claim)}
    >
      <CardFace card={{ color: claim.color, value: claim.value, liar: true }} />
      {honest && <span className="claim-opt-truth">{t.truthful}</span>}
    </motion.button>
  );
}

export function PlaySheet({ req, onClose }: { req: SheetReq | null; onClose: () => void }) {
  const t = useT();
  const { g, me } = useTable();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [color, setColor] = useState<Color | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const card = req?.card ?? null;
  const multi = g.players.length > 2;
  const handAfter = g.hand.length - 1;

  const claims = useMemo(() => legalClaims(g.top), [g.top]);
  const honestLegal = card && card.liar ? claims.find((c) => sameIdentity(c, card)) : undefined;

  useEffect(() => {
    if (!req) return;
    setClaim(req.kind === "claim" && honestLegal ? honestLegal : null);
    setColor(null);
    setTarget(multi ? null : (g.players.find((p) => p.id !== me)?.id ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req || !card) return <Modal open={false}>{null}</Modal>;

  const sameColor = claims.filter((c) => c.color === g.top.color);
  const sameValue = claims.filter((c) => c.color !== g.top.color && c.value !== "wild4");
  const wild = claims.filter((c) => c.value === "wild4");

  const needColor = (req.kind === "claim" && claim?.value === "wild4") || req.kind === "wlc";
  const needTarget = handAfter > 0 && ((req.kind === "claim" && claim?.value === "7") || req.kind === "seven");
  const isLie = req.kind === "claim" && claim && !(card.liar && sameIdentity(card, claim));
  const cheat = req.kind === "claim" && !card.liar;
  const ready = (req.kind !== "claim" || !!claim) && (!needColor || !!color) && (!needTarget || !!target);

  const submit = () => {
    if (!ready) return;
    if (req.kind === "claim" && claim) {
      act({
        type: "play",
        cardId: card.id,
        faceDown: true,
        claim,
        chosenColor: claim.value === "wild4" ? color : null,
        swapTarget: needTarget ? target : null,
      });
    } else if (req.kind === "seven") {
      act({ type: "play", cardId: card.id, faceDown: false, swapTarget: target });
    } else if (req.kind === "wlc" && color) {
      act({ type: "play", cardId: card.id, faceDown: false, chosenColor: color });
    }
    onClose();
  };

  const title = req.kind === "wlc" ? t.chooseColor : req.kind === "seven" ? t.chooseSwap : t.sayItIs;

  return (
    <Modal open onClose={onClose} sheet className="play-sheet" labelledBy="sheet-title">
      <div className="sheet-head">
        <div className="sheet-cards">
          <div className="sheet-card">
            <CardFace card={card} />
          </div>
          {req.kind === "claim" && (
            <>
              <span className="sheet-arrow">→</span>
              <motion.div className="sheet-card is-claim" key={claim ? `${claim.color}-${claim.value}` : "none"} initial={{ rotateY: 90 }} animate={{ rotateY: 0 }}>
                {claim ? <CardFace card={{ ...claim, liar: true }} chosen={claim.value === "wild4" ? color : null} /> : <div className="sheet-card-empty">?</div>}
              </motion.div>
            </>
          )}
        </div>
        <div className="sheet-title">
          <h3 id="sheet-title">{title}</h3>
          {req.kind === "claim" && (
            <p className={`sheet-note ${cheat || isLie ? "is-warn" : "is-ok"}`}>
              {cheat ? t.cheatWarning : isLie ? t.lieWarning : claim ? t.truthful + " · " + claimText(t, claim) : t.matchHint}
            </p>
          )}
        </div>
      </div>

      {req.kind === "claim" && (
        <div className="claim-groups">
          <div className="claim-row">
            {sameColor.map((c) => (
              <ClaimOption
                key={`${c.color}${c.value}`}
                claim={c}
                on={!!claim && sameIdentity(claim, c)}
                honest={!!card.liar && sameIdentity(card, c) && matchesTop(card, g.top)}
                onPick={() => setClaim(c)}
              />
            ))}
          </div>
          <div className="claim-row">
            {sameValue.map((c) => (
              <ClaimOption
                key={`${c.color}${c.value}`}
                claim={c}
                on={!!claim && sameIdentity(claim, c)}
                honest={!!card.liar && sameIdentity(card, c)}
                onPick={() => setClaim(c)}
              />
            ))}
            {wild.map((c) => (
              <ClaimOption key="wild4" claim={c} on={claim?.value === "wild4"} honest={card.liar && card.value === "wild4"} onPick={() => setClaim(c)} />
            ))}
          </div>
        </div>
      )}

      {needColor && (
        <div className="sheet-section">
          <span className="sheet-label">{t.chooseColor}</span>
          <ColorChooser
            value={color}
            onPick={(c) => {
              setColor(c);
              if (req.kind === "wlc") {
                act({ type: "play", cardId: card.id, faceDown: false, chosenColor: c });
                onClose();
              }
            }}
          />
        </div>
      )}
      {needTarget && (
        <div className="sheet-section">
          <span className="sheet-label">{t.chooseSwap}</span>
          <TargetChooser value={target} onPick={setTarget} />
        </div>
      )}

      {req.kind !== "wlc" && (
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant={isLie || cheat ? "danger" : "primary"} disabled={!ready} onClick={submit} data-testid="sheet-confirm">
            {req.kind === "claim" ? t.playFaceDown : t.playIt}
          </Button>
        </div>
      )}
    </Modal>
  );
}
