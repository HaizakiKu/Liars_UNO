import { type ReactNode, useState } from "react";
import { useLang, useT } from "../lib/i18n";
import { useSound } from "../lib/sound";
import { BookIcon, MaskIcon, SoundIcon } from "./icons";
import { RulesModal } from "./RulesModal";
import { IconButton } from "./ui";

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" className="logo" onClick={onClick} aria-label="Liar's UNO">
      <span className="logo-mark">
        <MaskIcon />
      </span>
      <span className="logo-word">
        Liar's <b>UNO</b>
      </span>
    </button>
  );
}

export function TopBar({ left, right, onLogo }: { left?: ReactNode; right?: ReactNode; onLogo?: () => void }) {
  const t = useT();
  const { lang, setLang } = useLang();
  const { muted, toggle } = useSound();
  const [rules, setRules] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Logo onClick={onLogo} />
        {left}
      </div>
      <div className="topbar-right">
        {right}
        <IconButton label={t.rules} onClick={() => setRules(true)}>
          <BookIcon />
        </IconButton>
        <IconButton label={t.sound} onClick={toggle}>
          <SoundIcon muted={muted} />
        </IconButton>
        <button type="button" className="lang-btn" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
          {t.language}
        </button>
      </div>
      <RulesModal open={rules} onClose={() => setRules(false)} />
    </header>
  );
}
