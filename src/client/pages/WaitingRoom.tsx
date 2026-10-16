import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { type RoomSettings, SETTING_CHOICES } from "../../shared/protocol";
import { Avatar } from "../components/Avatar";
import { BotIcon, CopyIcon, CrownIcon, GlobeIcon, LockIcon } from "../components/icons";
import { Button, Segmented, Toggle } from "../components/ui";
import { useT } from "../lib/i18n";
import { send } from "../state/connection";
import { useGame } from "../state/store";

export function WaitingRoom() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const isHost = room.hostId === room.you;
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(room.name);
  useEffect(() => setName(room.name), [room.name]);

  const s = room.settings;
  const set = (patch: Partial<RoomSettings>) => send({ t: "settings", s: patch });
  const link = `${location.origin}/r/${room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  const mySeat = room.seats.find((x) => x.id === room.you);
  const canStart = room.seats.length >= 2;
  const slots = Array.from({ length: s.maxPlayers }, (_, i) => room.seats[i] ?? null);

  return (
    <main className="waiting">
      <section className="waiting-main panel">
        <div className="waiting-head">
          <div className="waiting-title">
            {isHost ? (
              <input
                className="room-name-input"
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== room.name && send({ t: "settings", s: {}, name })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                aria-label={t.roomName}
              />
            ) : (
              <h1>{room.name}</h1>
            )}
            <span className="visibility-chip">
              {room.isPublic ? <GlobeIcon className="inline-icon" /> : <LockIcon className="inline-icon" />}
              {room.isPublic ? t.public : t.private}
            </span>
          </div>
          <div className="share">
            <div className="share-code">
              <span>{t.roomCode}</span>
              <b>{room.code}</b>
            </div>
            <Button variant="ghost" size="sm" onClick={copy}>
              <CopyIcon className="inline-icon" />
              {copied ? t.copied : t.copyLink}
            </Button>
          </div>
        </div>

        <div className="seat-grid">
          <AnimatePresence initial={false} mode="popLayout">
            {slots.map((seat, i) =>
              seat ? (
                <motion.div
                  key={seat.id}
                  layout
                  className={`seat-tile ${seat.id === room.you ? "is-me" : ""} ${!seat.connected ? "is-away" : ""}`}
                  initial={{ opacity: 0, scale: 0.9, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                >
                  <div className="seat-tile-avatar">
                    <Avatar name={seat.name} index={seat.avatar} size={56} />
                    {seat.id === room.hostId && (
                      <span className="seat-tile-badge is-host" title={t.host}>
                        <CrownIcon />
                      </span>
                    )}
                    {seat.isBot && (
                      <span className="seat-tile-badge is-bot" title={t.bot}>
                        <BotIcon />
                      </span>
                    )}
                  </div>
                  <span className="seat-tile-name">
                    {seat.name}
                    {seat.id === room.you && <em> · {t.you}</em>}
                  </span>
                  {isHost && seat.id !== room.you && (
                    <button type="button" className="seat-tile-kick" onClick={() => send({ t: "kick", pid: seat.id })}>
                      {t.kick}
                    </button>
                  )}
                </motion.div>
              ) : (
                <motion.div key={`empty-${i}`} layout className="seat-tile is-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {isHost ? (
                    <button type="button" className="add-bot" onClick={() => send({ t: "addBot" })}>
                      <span className="add-bot-plus">+</span>
                      <span>{t.addBot}</span>
                    </button>
                  ) : (
                    <span className="seat-tile-wait" />
                  )}
                </motion.div>
              ),
            )}
          </AnimatePresence>
        </div>

        {(room.spectators.length > 0 || room.role === "spectator") && (
          <div className="spectators">
            <span className="spectators-label">{t.spectators}</span>
            {room.spectators.map((sp) => (
              <span key={sp.id} className="spectator-chip">
                <Avatar name={sp.name} index={sp.avatar} size={22} />
                {sp.name}
              </span>
            ))}
            {room.role === "spectator" && room.seats.length < s.maxPlayers && (
              <Button size="sm" variant="primary" onClick={() => send({ t: "sit" })}>
                {t.sit}
              </Button>
            )}
          </div>
        )}

        <div className="waiting-foot">
          {isHost ? (
            <>
              <Button variant="primary" size="lg" disabled={!canStart} onClick={() => send({ t: "start" })} className="start-btn">
                {t.startGame}
              </Button>
              {!canStart && <span className="hint">{t.needTwo}</span>}
            </>
          ) : (
            <div className="waiting-host">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              {t.waitingHost}
            </div>
          )}
          {mySeat && !isHost && (
            <Button variant="ghost" size="sm" onClick={() => send({ t: "stand" })}>
              {t.stand}
            </Button>
          )}
        </div>
      </section>

      <aside className="waiting-settings panel">
        <h2>{t.settings}</h2>
        <div className="setting">
          <span className="setting-label">{t.maxPlayers}</span>
          <Segmented
            value={s.maxPlayers}
            disabled={!isHost}
            onChange={(v) => set({ maxPlayers: v })}
            options={SETTING_CHOICES.maxPlayers.map((v) => ({ value: v, label: v }))}
          />
        </div>
        <div className="setting">
          <span className="setting-label">{t.challengeWindow}</span>
          <Segmented
            value={s.challengeSeconds}
            disabled={!isHost}
            onChange={(v) => set({ challengeSeconds: v })}
            options={SETTING_CHOICES.challengeSeconds.map((v) => ({ value: v, label: t.seconds(v) }))}
          />
        </div>
        <div className="setting">
          <span className="setting-label">{t.turnTimer}</span>
          <Segmented
            value={s.turnSeconds}
            disabled={!isHost}
            onChange={(v) => set({ turnSeconds: v })}
            options={SETTING_CHOICES.turnSeconds.map((v) => ({ value: v, label: t.seconds(v) }))}
          />
        </div>
        <div className="setting">
          <span className="setting-label">{t.targetScore}</span>
          <Segmented
            value={s.targetScore}
            disabled={!isHost}
            onChange={(v) => set({ targetScore: v })}
            options={SETTING_CHOICES.targetScore.map((v) => ({ value: v, label: v === 0 ? t.singleRound : t.points(v) }))}
          />
        </div>
        <div className="setting setting-row">
          <div>
            <span className="setting-label">{t.allowRegularFaceDown}</span>
            <p className="setting-hint">{t.allowRegularFaceDownHint}</p>
          </div>
          <Toggle
            checked={s.allowRegularFaceDown}
            disabled={!isHost}
            onChange={(v) => set({ allowRegularFaceDown: v })}
            label={t.allowRegularFaceDown}
          />
        </div>
        <div className="setting setting-row">
          <div>
            <span className="setting-label">{t.publicRoom}</span>
            <p className="setting-hint">{room.isPublic ? t.publicHint : t.privateHint}</p>
          </div>
          <Toggle checked={room.isPublic} disabled={!isHost} onChange={(v) => send({ t: "settings", s: {}, isPublic: v })} label={t.publicRoom} />
        </div>
      </aside>
    </main>
  );
}
