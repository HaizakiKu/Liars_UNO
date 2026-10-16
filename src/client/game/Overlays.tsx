import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { CardBack, CardFace, FlipCard } from "../components/Card";
import { Button, Ring, useCountdown } from "../components/ui";
import { anchor, centerOf } from "../anim/anchors";
import { claimText } from "../lib/cardText";
import { useT } from "../lib/i18n";
import { act, send } from "../state/connection";
import { type Flight, removeFlight, useGame } from "../state/store";
import { useTable } from "./hooks";

const COLOR_HEX: Record<string, string> = { red: "#e5484d", yellow: "#f5b83d", green: "#30a46c", blue: "#3e63dd" };

// ───────────────────────── flights ─────────────────────────

function FlightView({ f }: { f: Flight }) {
  const [pts] = useState(() => ({ from: centerOf(f.from), to: centerOf(f.to) }));
  useEffect(() => {
    if (!pts.from || !pts.to) removeFlight(f.id);
  }, [f.id, pts]);
  if (!pts.from || !pts.to) return null;
  const { from, to } = pts;
  const w = 46;
  const h = w * 1.5;
  const lift = Math.min(90, Math.hypot(to.x - from.x, to.y - from.y) * 0.25);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - lift;
  const spin = (Math.random() - 0.5) * 50;
  return (
    <motion.div
      className="flight"
      style={{ width: w }}
      initial={{ x: from.x - w / 2, y: from.y - h / 2, rotate: spin, scale: 0.7, opacity: 0 }}
      animate={{
        x: [from.x - w / 2, midX - w / 2, to.x - w / 2],
        y: [from.y - h / 2, midY - h / 2, to.y - h / 2],
        rotate: [spin, spin / 2 + 8, 0],
        scale: [0.7, 1, 0.75],
        opacity: [0, 1, 0.9, 0],
      }}
      transition={{ duration: f.dur / 1000, delay: f.delay / 1000, ease: [0.45, 0, 0.25, 1], times: [0, 0.5, 1] }}
      onAnimationComplete={() => removeFlight(f.id)}
    >
      {f.card ? <CardFace card={f.card} /> : <CardBack />}
    </motion.div>
  );
}

export function FlyLayer() {
  const flights = useGame((s) => s.flights);
  return (
    <div className="fly-layer" aria-hidden>
      {flights.map((f) => (
        <FlightView key={f.id} f={f} />
      ))}
    </div>
  );
}

// ───────────────────────── challenge reveal ─────────────────────────

export function RevealOverlay() {
  const t = useT();
  const reveal = useGame((s) => s.reveal);
  const room = useGame((s) => s.room);
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    setFlipped(false);
    if (!reveal) return;
    const id = setTimeout(() => setFlipped(true), 650);
    return () => clearTimeout(id);
  }, [reveal]);
  const name = (pid: string) => (pid === room?.you ? t.you : (room?.seats.find((s) => s.id === pid)?.name ?? "?"));
  return (
    <AnimatePresence>
      {reveal && (
        <motion.div
          key={reveal.id}
          className={`reveal is-${reveal.result}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          data-testid="reveal"
        >
          <motion.div className="reveal-stage" initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
            <motion.div className="reveal-title" initial={{ scale: 1.6, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: -3 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
              {t.challenge}
            </motion.div>
            <p className="reveal-sub">{t.challenged(name(reveal.challenger), name(reveal.target))}</p>
            {reveal.claim && (
              <p className="reveal-claim">
                {reveal.target === room?.you ? t.youClaimed : t.claims(name(reveal.target))} <b>{claimText(t, reveal.claim, reveal.chosen)}</b>
              </p>
            )}
            <div className="reveal-card">
              <FlipCard card={reveal.card} faceUp={flipped} initialFaceUp={false} chosen={reveal.chosen} />
              <AnimatePresence>
                {flipped && (
                  <motion.div
                    className="reveal-stamp"
                    initial={{ scale: 2.4, opacity: 0, rotate: -24 }}
                    animate={{ scale: 1, opacity: 1, rotate: -12 }}
                    transition={{ type: "spring", stiffness: 520, damping: 16, delay: 0.25 }}
                  >
                    {reveal.result === "honest" ? t.revealTruth : reveal.result === "lie" ? t.revealLie : t.revealCheat}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {flipped && (
                <motion.p className="reveal-penalty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                  {reveal.result === "honest"
                    ? t.penalty(name(reveal.challenger), 1)
                    : t.penalty(name(reveal.target), reveal.result === "cheat" ? 6 : 1)}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────── wild liar's challenge ─────────────────────────

export function WlcStage({ selected, onClearSelected }: { selected: string | null; onClearSelected: () => void }) {
  const t = useT();
  const { g, me, seated, seatOf } = useTable();
  const ph = g.phase;
  const open = ph.kind === "wlcCommit" || ph.kind === "wlcChallenge";
  const color = open ? ph.color : "red";
  const by = open ? ph.by : "";
  const others = g.players.filter((p) => p.id !== by).map((p) => p.id);
  const iNeedCommit = ph.kind === "wlcCommit" && seated && by !== me && !ph.committed.includes(me);
  const iChallenge = ph.kind === "wlcChallenge" && by === me;
  const hasColor = g.hand.some((c) => c.color === color);
  const colorName = t.colorNamesLong[color];

  const slots = useMemo(
    () =>
      others.map((pid) => {
        if (ph.kind === "wlcChallenge") {
          const c = ph.commits.find((x) => x.who === pid);
          return { pid, placed: !!c, status: c?.status ?? "hidden", card: c?.card ?? null };
        }
        if (ph.kind === "wlcCommit") {
          const placed = ph.committed.includes(pid);
          return { pid, placed, status: "hidden" as const, card: pid === me ? ph.myCommit : null };
        }
        return { pid, placed: false, status: "hidden" as const, card: null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g],
  );

  let prompt = "";
  if (ph.kind === "wlcCommit") {
    if (iNeedCommit) prompt = hasColor ? t.wlcCommitPrompt(colorName) : t.wlcCommitNoColor(colorName);
    else if (by === me || !seated) prompt = t.wlcWaitingCommits(by === me ? t.you : seatOf(by).name, colorName);
    else prompt = t.wlcCommitted;
  } else if (ph.kind === "wlcChallenge") {
    prompt = iChallenge ? t.wlcChallengePrompt : t.wlcWaitingChallenger(seatOf(by).name);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="wlc-stage"
          style={{ "--wlc": COLOR_HEX[color] } as React.CSSProperties}
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          data-testid="wlc-stage"
        >
          <div className="wlc-head">
            <span className="wlc-chip">
              <i />
              {t.wlcTitle} · {t.colorNames[color]}
            </span>
            <Ring key={ph.kind} deadline={g.deadline} total={ph.kind === "wlcCommit" ? 25_000 : 30_000} size={30} stroke={3} />
          </div>
          <p className="wlc-prompt">{prompt}</p>
          <div className="wlc-slots">
            {slots.map((s) => {
              const seat = seatOf(s.pid);
              const revealed = s.status !== "hidden";
              const clickable = iChallenge && s.placed && s.status === "hidden";
              return (
                <motion.button
                  key={s.pid}
                  type="button"
                  className={`wlc-slot is-${s.status} ${clickable ? "is-clickable" : ""}`}
                  disabled={!clickable}
                  onClick={() => clickable && act({ type: "wlcChallenge", target: s.pid })}
                  whileHover={clickable ? { y: -6 } : undefined}
                  data-testid="wlc-slot"
                >
                  <div className="wlc-card" ref={anchor(`wlc:${s.pid}`)}>
                    {s.placed ? (
                      <motion.div initial={{ scale: 1.15, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: s.pid === me ? 0 : 0.35 }}>
                        <FlipCard card={s.card} faceUp={(revealed || s.pid === me) && !!s.card} initialFaceUp={s.pid === me} />
                      </motion.div>
                    ) : (
                      <div className="wlc-empty" />
                    )}
                    {revealed && (
                      <motion.span
                        className={`wlc-verdict is-${s.status}`}
                        initial={{ scale: 2, opacity: 0, rotate: -20 }}
                        animate={{ scale: 1, opacity: 1, rotate: -10 }}
                        transition={{ delay: 0.35, type: "spring", stiffness: 500, damping: 18 }}
                      >
                        {s.status === "honest" ? t.wlcHonest : t.wlcLied}
                      </motion.span>
                    )}
                    {clickable && <span className="wlc-challenge-hint">{t.challenge}</span>}
                  </div>
                  <span className="wlc-name">
                    <Avatar name={seat.name} index={seat.avatar} size={20} />
                    {s.pid === me ? t.you : seat.name}
                  </span>
                </motion.button>
              );
            })}
          </div>
          {iNeedCommit && (
            <div className="wlc-actions">
              <Button
                variant="primary"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  act({ type: "wlcCommit", cardId: selected });
                  onClearSelected();
                }}
                data-testid="wlc-commit-btn"
              >
                {t.confirm}
              </Button>
            </div>
          )}
          {iChallenge && (
            <div className="wlc-actions">
              <Button onClick={() => act({ type: "wlcEnd" })} data-testid="wlc-end-btn">
                {t.wlcEnd}
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────── round result ─────────────────────────

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 2.2 + Math.random() * 1.6,
        rot: Math.random() * 720 - 360,
        color: ["#e5484d", "#f5b83d", "#30a46c", "#3e63dd", "#f2c86b", "#fff"][i % 6],
        w: 6 + Math.random() * 6,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b) => (
        <motion.i
          key={b.id}
          style={{ left: `${b.x}%`, background: b.color, width: b.w, height: b.w * 0.45 }}
          initial={{ y: -40, rotate: 0, opacity: 1 }}
          animate={{ y: "105vh", rotate: b.rot, opacity: [1, 1, 0.8] }}
          transition={{ duration: b.dur, delay: b.delay, ease: [0.2, 0.6, 0.4, 1] }}
        />
      ))}
    </div>
  );
}

export function RoundResult() {
  const t = useT();
  const { room, g, me, seatOf } = useTable();
  const ph = g.phase;
  const [show, setShow] = useState(false);
  const over = ph.kind === "roundOver";
  useEffect(() => {
    if (!over) {
      setShow(false);
      return;
    }
    const id = setTimeout(() => setShow(true), 700);
    return () => clearTimeout(id);
  }, [over]);
  const { left } = useCountdown(room.nextRoundAt);
  if (ph.kind !== "roundOver") return null;
  const isHost = room.hostId === me;
  const winners = ph.winners.map((w) => (w === me ? t.you : seatOf(w).name)).join(" & ");
  const iWon = ph.winners.includes(me);
  const target = g.settings.targetScore;
  const ranking = [...g.players].sort((a, b) => (room.scores[b.id] ?? 0) - (room.scores[a.id] ?? 0));

  return (
    <AnimatePresence>
      {show && (
        <motion.div className="result-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="round-result">
          <Confetti />
          <motion.div className="result panel" initial={{ y: 40, scale: 0.94, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}>
            <div className="result-winners">
              {ph.winners.map((w) => (
                <motion.div key={w} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 14, delay: 0.2 }}>
                  <Avatar name={seatOf(w).name} index={seatOf(w).avatar} size={72} className="result-avatar" />
                </motion.div>
              ))}
            </div>
            <h2 className="result-title">{iWon ? t.youWin : ph.winners.length > 1 ? t.roundWinners(winners) : t.roundWinner(winners)}</h2>
            <p className="result-points">{t.pointsWon(ph.points)}</p>

            <div className="result-table">
              {ranking.map((p, i) => {
                const s = seatOf(p.id);
                const hand = ph.hands[p.id] ?? [];
                return (
                  <motion.div
                    key={p.id}
                    className={`result-row ${ph.winners.includes(p.id) ? "is-winner" : ""}`}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.05 }}
                  >
                    <Avatar name={s.name} index={s.avatar} size={28} />
                    <span className="result-name">{p.id === me ? `${s.name} · ${t.you}` : s.name}</span>
                    <span className="result-hand">
                      {hand.slice(0, 12).map((c) => (
                        <span key={c.id} className="result-mini">
                          <CardFace card={c} />
                        </span>
                      ))}
                      {hand.length > 12 && <em>+{hand.length - 12}</em>}
                    </span>
                    {target > 0 && (
                      <span className="result-score">
                        <b>{room.scores[p.id] ?? 0}</b>
                        <span className="result-bar">
                          <i style={{ width: `${Math.min(100, ((room.scores[p.id] ?? 0) / target) * 100)}%` }} />
                        </span>
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </div>

            <div className="result-foot">
              {!ph.gameOver && room.nextRoundAt && <span className="hint">{t.nextRoundIn(left)}</span>}
              {ph.gameOver && <span className="hint">{t.gameOver}</span>}
              {isHost && (
                <div className="modal-actions">
                  {!ph.gameOver && (
                    <Button variant="ghost" onClick={() => send({ t: "lobby" })}>
                      {t.backToRoom}
                    </Button>
                  )}
                  <Button variant="primary" onClick={() => send({ t: ph.gameOver ? "lobby" : "next" })} data-testid="next-round-btn">
                    {ph.gameOver ? t.backToRoom : t.nextRound}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
