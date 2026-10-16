import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CODE_LENGTH, CODE_RE, type LobbyMsg, type LobbyRoom } from "../../shared/protocol";
import { Avatar } from "../components/Avatar";
import { CardBack, CardFace } from "../components/Card";
import { GlobeIcon, LockIcon } from "../components/icons";
import { TopBar } from "../components/TopBar";
import { Button, Modal, Toggle } from "../components/ui";
import { createRoom, quickJoin, wsUrl } from "../lib/api";
import { useT } from "../lib/i18n";
import { useIdentity } from "../lib/identity";
import { useRoute } from "../lib/router";
import { AVATAR_COUNT } from "../../shared/protocol";

function useLobbyRooms(): LobbyRoom[] | null {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const open = () => {
      ws = new WebSocket(wsUrl("/api/lobby/ws"));
      ws.onopen = () => {
        attempt = 0;
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 30_000);
      };
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data as string) as LobbyMsg;
          if (msg.t === "rooms") setRooms(msg.rooms);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (ping) clearInterval(ping);
        if (stopped) return;
        attempt++;
        timer = setTimeout(open, Math.min(10_000, 500 * 2 ** attempt));
      };
    };
    open();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, []);
  return rooms;
}

function HeroCards() {
  const cards = [
    { el: <CardFace card={{ color: "red", value: "7", liar: false }} />, r: -18, x: -118, y: 22 },
    { el: <CardFace card={{ color: "blue", value: "skip", liar: true }} />, r: -6, x: -42, y: -4 },
    { el: <CardFace card={{ color: null, value: "wlc", liar: false }} />, r: 7, x: 36, y: -6 },
    { el: <CardBack />, r: 19, x: 112, y: 20 },
  ];
  return (
    <div className="hero-cards" aria-hidden>
      {cards.map((c, i) => (
        <motion.div
          key={i}
          className="hero-card"
          initial={{ opacity: 0, y: 80, rotate: 0, x: 0 }}
          animate={{ opacity: 1, y: [c.y, c.y - 10, c.y], rotate: c.r, x: c.x }}
          transition={{
            opacity: { duration: 0.5, delay: 0.1 + i * 0.08 },
            x: { type: "spring", stiffness: 120, damping: 16, delay: 0.1 + i * 0.08 },
            rotate: { type: "spring", stiffness: 120, damping: 16, delay: 0.1 + i * 0.08 },
            y: { duration: 5 + i * 0.6, repeat: Infinity, ease: "easeInOut", delay: 0.6 + i * 0.3 },
          }}
          whileHover={{ y: c.y - 26, rotate: c.r * 0.6, transition: { type: "spring", stiffness: 300, damping: 18 } }}
        >
          {c.el}
        </motion.div>
      ))}
      <div className="hero-glow" />
    </div>
  );
}

export function Home() {
  const t = useT();
  const id = useIdentity();
  const go = useRoute((s) => s.go);
  const rooms = useLobbyRooms();
  const [code, setCode] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);

  const needName = () => {
    if (id.name.trim()) return false;
    nameRef.current?.focus();
    setNudge((n) => n + 1);
    return true;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch {
      setError(t.errors.network);
    } finally {
      setBusy(null);
    }
  };

  const onCreate = () =>
    run("create", async () => {
      const res = await createRoom({ name: roomName || t.defaultRoomName(id.name), isPublic });
      setCreateOpen(false);
      go(`/r/${res.code}`);
    });

  const onQuick = () => {
    if (needName()) return;
    void run("quick", async () => {
      const res = await quickJoin({ name: t.defaultRoomName(id.name) });
      go(`/r/${res.code}`);
    });
  };

  const onJoin = (c: string) => {
    if (needName()) return;
    go(`/r/${c}`);
  };

  const codeOk = CODE_RE.test(code);

  return (
    <div className="page home">
      <TopBar />
      <main className="home-main">
        <section className="hero">
          <div className="hero-copy">
            <motion.h1 className="hero-title" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              Liar's <span>UNO</span>
            </motion.h1>
            <motion.p className="hero-tagline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              {t.tagline}
            </motion.p>
            <p className="hero-sub">{t.subTagline}</p>

            <motion.div
              className="profile"
              key={nudge}
              animate={nudge ? { x: [0, -8, 8, -5, 5, 0] } : {}}
              transition={{ duration: 0.4 }}
            >
              <button
                type="button"
                className="profile-avatar"
                onClick={() => id.update({ avatar: (id.avatar + 1) % AVATAR_COUNT })}
                aria-label="avatar"
              >
                <Avatar name={id.name || "?"} index={id.avatar} size={48} />
              </button>
              <label className="profile-field">
                <span>{t.yourName}</span>
                <input
                  ref={nameRef}
                  value={id.name}
                  maxLength={16}
                  placeholder={t.namePlaceholder}
                  onChange={(e) => id.update({ name: e.target.value })}
                  autoComplete="nickname"
                />
              </label>
            </motion.div>

            <div className="hero-actions">
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  if (needName()) return;
                  setRoomName(t.defaultRoomName(id.name));
                  setCreateOpen(true);
                }}
              >
                {t.createRoom}
              </Button>
              <Button size="lg" onClick={onQuick} disabled={busy === "quick"}>
                {t.quickJoin}
              </Button>
            </div>
            <form
              className="code-join"
              onSubmit={(e) => {
                e.preventDefault();
                if (codeOk) onJoin(code);
              }}
            >
              <input
                value={code}
                placeholder={t.joinByCode}
                maxLength={CODE_LENGTH}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                aria-label={t.joinByCode}
                spellCheck={false}
                autoCapitalize="characters"
              />
              <Button type="submit" variant="ghost" disabled={!codeOk}>
                {t.join}
              </Button>
            </form>
            {error && <p className="form-error">{error}</p>}
          </div>
          <HeroCards />
        </section>

        <section className="lobby">
          <div className="section-head">
            <h2>{t.publicRooms}</h2>
            <span className="live-dot">{t.live}</span>
          </div>
          {rooms === null ? (
            <div className="room-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="room-card is-skeleton" />
              ))}
            </div>
          ) : rooms.length === 0 ? (
            <div className="empty">
              <p className="empty-title">{t.noRooms}</p>
              <p className="empty-hint">{t.noRoomsHint}</p>
            </div>
          ) : (
            <motion.div className="room-grid" layout>
              <AnimatePresence initial={false}>
                {rooms.map((r) => {
                  const full = r.players >= r.max;
                  const watch = r.status !== "lobby" || full;
                  return (
                    <motion.button
                      layout
                      key={r.code}
                      type="button"
                      className="room-card"
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      onClick={() => onJoin(r.code)}
                    >
                      <div className="room-card-top">
                        <span className="room-card-name">{r.name}</span>
                        <span className={`status-chip is-${r.status}`}>
                          {r.status === "lobby" ? t.waiting : r.status === "playing" ? t.playing : t.roundOver}
                        </span>
                      </div>
                      <div className="room-card-meta">
                        <span>{r.host}</span>
                        <span className="room-card-seats">
                          {Array.from({ length: r.max }, (_, i) => (
                            <i key={i} className={i < r.players ? "is-filled" : ""} />
                          ))}
                          <b>
                            {r.players}/{r.max}
                          </b>
                        </span>
                      </div>
                      <span className="room-card-cta">{watch ? t.spectate : t.join} →</span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </main>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} className="create-modal" labelledBy="create-title">
        <h2 id="create-title">{t.createRoom}</h2>
        <label className="field">
          <span>{t.roomName}</span>
          <input value={roomName} maxLength={24} onChange={(e) => setRoomName(e.target.value)} autoFocus />
        </label>
        <div className="field-row">
          <div className="field-row-text">
            <span className="field-row-title">
              {isPublic ? <GlobeIcon className="inline-icon" /> : <LockIcon className="inline-icon" />}
              {t.publicRoom}
            </span>
            <span className="field-row-hint">{isPublic ? t.publicHint : t.privateHint}</span>
          </div>
          <Toggle checked={isPublic} onChange={setIsPublic} label={t.publicRoom} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setCreateOpen(false)}>
            {t.cancel}
          </Button>
          <Button variant="primary" onClick={onCreate} disabled={busy === "create"}>
            {t.create}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
