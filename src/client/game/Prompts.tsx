import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { EMOTES } from "../../shared/protocol";
import { Avatar } from "../components/Avatar";
import { CardFace } from "../components/Card";
import { SmileIcon } from "../components/icons";
import { Button, Ring } from "../components/ui";
import { claimText } from "../lib/cardText";
import { useT } from "../lib/i18n";
import { act, send } from "../state/connection";
import { useGame } from "../state/store";
import { SeatFx } from "./Seat";
import { useTable } from "./hooks";

/** "Alice says: Red 7" — believe or challenge. */
export function ChallengePrompt() {
  const t = useT();
  const { g, me, seated, seatOf } = useTable();
  const ph = g.phase;
  const revealing = useGame((s) => s.reveal !== null);
  const open = ph.kind === "challenge" && !revealing;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key={ph.seq}
          className="challenge-bar"
          initial={{ y: 30, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 16, opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          data-testid="challenge-bar"
        >
          <div className="cb-who">
            <Avatar name={seatOf(ph.by).name} index={seatOf(ph.by).avatar} size={34} />
            <div className="cb-text">
              <span className="cb-label">{ph.by === me ? t.youClaimed : t.claims(seatOf(ph.by).name)}</span>
              <b className="cb-claim">{claimText(t, ph.claim, ph.chosenColor)}</b>
            </div>
            <div className="cb-mini">
              <CardFace card={{ ...ph.claim, liar: true }} chosen={ph.chosenColor} />
            </div>
          </div>
          <div className="cb-actions">
            <Ring key={ph.seq} deadline={g.deadline} total={g.settings.challengeSeconds * 1000} size={40} stroke={3.5} />
            {seated && ph.by !== me && !ph.responded.includes(me) ? (
              <>
                <Button variant="truth" onClick={() => act({ type: "trust" })} data-testid="trust-btn">
                  {t.trust}
                  <kbd>Space</kbd>
                </Button>
                <Button variant="danger" onClick={() => act({ type: "challenge" })} data-testid="challenge-btn">
                  {t.challenge}
                  <kbd>C</kbd>
                </Button>
              </>
            ) : (
              <span className="cb-wait">{t.waitingResponses}</span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmoteButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="emote">
      <button type="button" className="icon-btn" aria-label={t.emotes} onClick={() => setOpen((o) => !o)}>
        <SmileIcon />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="emote-pop" initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }}>
            {EMOTES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  send({ t: "emote", e });
                  setOpen(false);
                }}
              >
                {e}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Bottom bar: me, turn status, draw / keep / UNO. */
export function Controls({ onPlayDrawn }: { onPlayDrawn: () => void }) {
  const t = useT();
  const { g, me, seatOf, myTurn, current } = useTable();
  const mine = g.players.find((p) => p.id === me)!;
  const seat = seatOf(me);
  const ph = g.phase;
  const canUno = mine.handCount >= 1 && mine.handCount <= 2 && !mine.unoDeclared && ph.kind !== "roundOver";
  const urgent = mine.unoVulnerable;
  const autoplay = seat.autoplay;
  return (
    <div className="controls">
      <div className={`me-badge ${myTurn ? "is-turn" : ""}`}>
        <div className="me-avatar">
          {myTurn && <Ring key={g.turnId} deadline={g.deadline} total={g.settings.turnSeconds * 1000} size={54} stroke={3} />}
          <Avatar name={seat.name} index={seat.avatar} size={42} />
          <SeatFx pid={me} />
        </div>
        <div className="me-text">
          <span className="me-name">{seat.name}</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={myTurn ? "me" : (current ?? "")}
              className={`me-status ${myTurn ? "is-turn" : ""}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              {ph.kind === "roundOver" ? "" : myTurn ? t.yourTurn : current ? t.turnOf(seatOf(current).name) : ""}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      <div className="controls-actions">
        <AnimatePresence mode="popLayout">
          {myTurn && ph.kind === "turn" && (
            <motion.div key="draw" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
              <Button variant="primary" onClick={() => act({ type: "draw" })} data-testid="draw-btn">
                {t.draw}
                <kbd>D</kbd>
              </Button>
            </motion.div>
          )}
          {myTurn && ph.kind === "afterDraw" && (
            <motion.div key="after" className="after-draw" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
              <Button variant="primary" onClick={onPlayDrawn} data-testid="play-drawn-btn">
                {t.playIt}
              </Button>
              <Button onClick={() => act({ type: "keep" })} data-testid="keep-btn">
                {t.keep}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {canUno && (
            <motion.button
              type="button"
              className={`uno-btn ${urgent ? "is-urgent" : ""}`}
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 20 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => act({ type: "uno" })}
              data-testid="uno-btn"
            >
              {t.uno}
            </motion.button>
          )}
        </AnimatePresence>
        <EmoteButton />
      </div>

      <AnimatePresence>
        {autoplay && (
          <motion.div className="autoplay-banner" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
            <span>{t.autoplayBanner}</span>
            <Button size="sm" variant="primary" onClick={() => send({ t: "resume" })}>
              {t.imBack}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Feed() {
  const feed = useGame((s) => s.feed);
  return (
    <div className="feed" aria-live="polite">
      <AnimatePresence initial={false}>
        {feed.map((f) => (
          <motion.div
            key={f.id}
            layout
            className={`feed-item is-${f.tone}`}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10, transition: { duration: 0.25 } }}
          >
            {f.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
