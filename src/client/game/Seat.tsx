import { AnimatePresence, motion } from "motion/react";
import { anchor, seatKey } from "../anim/anchors";
import { Avatar } from "../components/Avatar";
import { CardBack } from "../components/Card";
import { BotIcon, SkipIcon } from "../components/icons";
import { Ring } from "../components/ui";
import { useT } from "../lib/i18n";
import { act } from "../state/connection";
import { useGame } from "../state/store";
import { useTable } from "./hooks";

export function SeatFx({ pid }: { pid: string }) {
  const t = useT();
  const fx = useGame((s) => s.seatFx).filter((f) => f.pid === pid);
  return (
    <div className="seatfx">
      <AnimatePresence>
        {fx.map((f) => (
          <motion.div
            key={f.id}
            className={`seatfx-item is-${f.kind}`}
            initial={{ opacity: 0, scale: 0.4, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: f.kind === "draw" ? -18 : 0 }}
            exit={{ opacity: 0, scale: 0.8, y: -14 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
          >
            {f.kind === "skip" && <SkipIcon />}
            {f.kind === "uno" && "UNO!"}
            {f.kind === "caught" && t.catchUno}
            {f.kind === "timeout" && "⏱"}
            {(f.kind === "emote" || f.kind === "challenge" || f.kind === "draw") && f.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Seat around the table for an opponent (or any player, for spectators). */
export function Seat({ pid, x, y }: { pid: string; x: number; y: number }) {
  const t = useT();
  const { g, me, seated, seatOf, current } = useTable();
  const seat = seatOf(pid);
  const p = g.players.find((pp) => pp.id === pid)!;
  const isCurrent = current === pid && g.phase.kind !== "roundOver";
  const ph = g.phase;
  const fan = Math.min(p.handCount, 9);
  const committed = (ph.kind === "wlcCommit" && ph.committed.includes(pid)) || ph.kind === "wlcChallenge";
  const responded = ph.kind === "challenge" && ph.responded.includes(pid);
  const claimant = ph.kind === "challenge" && ph.by === pid;
  const dealer = g.players[g.dealer]?.id === pid;
  return (
    <div
      className={`seat ${isCurrent ? "is-current" : ""} ${seat.connected ? "" : "is-offline"} ${claimant ? "is-claimant" : ""}`}
      style={{ "--x": `${x}%`, "--y": `${y}%` } as React.CSSProperties}
      ref={anchor(seatKey(pid))}
      data-testid={`seat-${seat.name}`}
    >
      <div className="seat-avatar">
        {isCurrent && <Ring key={`${g.turnId}-${g.deadline}`} deadline={g.deadline} total={g.settings.turnSeconds * 1000} size={66} stroke={3.5} className="seat-ring" />}
        <Avatar name={seat.name} index={seat.avatar} size={52} />
        {seat.isBot && (
          <span className="seat-badge is-bot" title={t.bot}>
            <BotIcon />
          </span>
        )}
        {!seat.isBot && seat.autoplay && <span className="seat-badge is-auto">AUTO</span>}
        {dealer && <span className="seat-dealer">D</span>}
        {responded && <span className="seat-check">✓</span>}
        <SeatFx pid={pid} />
      </div>
      <div className="seat-name" title={seat.name}>
        {seat.name}
      </div>
      <div className="seat-hand">
        <div className="seat-fan">
          {Array.from({ length: fan }, (_, i) => (
            <span key={i} className="seat-fan-card" style={{ "--i": i - (fan - 1) / 2 } as React.CSSProperties}>
              <CardBack />
            </span>
          ))}
        </div>
        <motion.span key={p.handCount} className="seat-count" initial={{ scale: 1.5 }} animate={{ scale: 1 }}>
          {p.handCount}
        </motion.span>
      </div>
      <AnimatePresence>
        {p.handCount === 1 && p.unoDeclared && (
          <motion.span className="uno-tag" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            UNO
          </motion.span>
        )}
        {p.unoVulnerable && seated && pid !== me && (
          <motion.button
            type="button"
            className="catch-btn"
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            onClick={() => act({ type: "catch", target: pid })}
          >
            {t.catchUno}
          </motion.button>
        )}
      </AnimatePresence>
      {committed && ph.kind === "wlcCommit" && <span className="seat-commit" />}
    </div>
  );
}
