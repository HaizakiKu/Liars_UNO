import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { ExitIcon } from "../components/icons";
import { TopBar } from "../components/TopBar";
import { Button, IconButton, Modal } from "../components/ui";
import { Table } from "../game/Table";
import { roomExists } from "../lib/api";
import { useT } from "../lib/i18n";
import { useIdentity } from "../lib/identity";
import { useRoute } from "../lib/router";
import { connectRoom, send } from "../state/connection";
import { useGame } from "../state/store";
import { WaitingRoom } from "./WaitingRoom";
import { AVATAR_COUNT } from "../../shared/protocol";

function NamePrompt({ onDone }: { onDone: () => void }) {
  const t = useT();
  const id = useIdentity();
  const [name, setName] = useState(id.name);
  return (
    <form
      className="center-card panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        id.update({ name: name.trim() });
        onDone();
      }}
    >
      <button type="button" className="profile-avatar big" onClick={() => id.update({ avatar: (id.avatar + 1) % AVATAR_COUNT })}>
        <Avatar name={name || "?"} index={id.avatar} size={72} />
      </button>
      <label className="field">
        <span>{t.yourName}</span>
        <input value={name} maxLength={16} placeholder={t.namePlaceholder} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <Button type="submit" variant="primary" size="lg" disabled={!name.trim()}>
        {t.join}
      </Button>
    </form>
  );
}

export function RoomPage({ code }: { code: string }) {
  const t = useT();
  const go = useRoute((s) => s.go);
  const id = useIdentity();
  const [exists, setExists] = useState<boolean | null>(null);
  const [ready, setReady] = useState(!!id.name.trim());
  const [leaving, setLeaving] = useState(false);
  const status = useGame((s) => s.status);
  const closedReason = useGame((s) => s.closedReason);
  const room = useGame((s) => s.room);

  useEffect(() => {
    let alive = true;
    void roomExists(code).then((ok) => alive && setExists(ok !== false));
    return () => {
      alive = false;
    };
  }, [code]);

  useEffect(() => {
    if (!exists || !ready) return;
    return connectRoom(code);
  }, [code, exists, ready]);

  const leave = () => {
    send({ t: "leave" });
    setLeaving(false);
    setTimeout(() => go("/"), 80);
  };

  const inGame = room && room.status !== "lobby";
  let body;
  if (exists === false || (status === "closed" && closedReason)) {
    const msg = exists === false || closedReason === "notFound" ? t.roomNotFound : closedReason === "kicked" ? t.kicked : t.roomClosed;
    body = (
      <div className="center-card panel">
        <p className="center-card-title">{msg}</p>
        <Button variant="primary" onClick={() => go("/")}>
          {t.backHome}
        </Button>
      </div>
    );
  } else if (!ready) {
    body = <NamePrompt onDone={() => setReady(true)} />;
  } else if (!room) {
    body = (
      <div className="center-card is-loading">
        <span className="spinner" />
        <p>{t.connecting}</p>
      </div>
    );
  } else if (room.status === "lobby") {
    body = <WaitingRoom />;
  } else {
    body = <Table />;
  }

  return (
    <div className={`page room-page ${inGame ? "is-game" : ""}`}>
      <TopBar
        onLogo={() => (room ? setLeaving(true) : go("/"))}
        left={
          room && (
            <div className="topbar-room">
              <span className="topbar-room-name">{room.name}</span>
              <span className="topbar-room-code">{room.code}</span>
            </div>
          )
        }
        right={
          room && (
            <IconButton label={t.leave} onClick={() => setLeaving(true)}>
              <ExitIcon />
            </IconButton>
          )
        }
      />
      {body}
      <AnimatePresence>
        {status === "reconnecting" && (
          <motion.div className="conn-banner" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}>
            <span className="spinner sm" />
            {t.reconnecting}
          </motion.div>
        )}
      </AnimatePresence>
      <Modal open={leaving} onClose={() => setLeaving(false)} className="confirm-modal">
        <p>{t.leaveConfirm}</p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setLeaving(false)}>
            {t.cancel}
          </Button>
          <Button variant="danger" onClick={leave}>
            {t.leave}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
