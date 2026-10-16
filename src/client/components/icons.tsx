import type { Color } from "../../shared/cards";

type P = { className?: string };

export const SkipIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="2.8" />
    <path d="M6.4 17.6 17.6 6.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
  </svg>
);

export const ReverseIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M5 9.5h11.5l-3-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 14.5H7.5l3 3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const MaskIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 16" className={className} aria-hidden>
    <path
      d="M2 4.2C2 2.6 3.4 1.6 5 2c3.4.9 7 1.5 11 1.5S23.6 2.9 27 2c1.6-.4 3 .6 3 2.2 0 5.3-3.2 9.8-7.6 9.8-2.6 0-4.4-1.6-6.4-3.6-2 2-3.8 3.6-6.4 3.6C5.2 14 2 9.5 2 4.2Z"
      fill="currentColor"
    />
    <ellipse cx="9.6" cy="6.9" rx="3.2" ry="2.1" fill="#000" opacity=".75" />
    <ellipse cx="22.4" cy="6.9" rx="3.2" ry="2.1" fill="#000" opacity=".75" />
  </svg>
);

export const BubbleIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden>
    <path
      d="M16 4C8.8 4 3 8.9 3 15c0 3.3 1.7 6.3 4.5 8.3L6 29l6.2-3.2c1.2.3 2.5.4 3.8.4 7.2 0 13-4.9 13-11.1S23.2 4 16 4Z"
      fill="currentColor"
    />
    <text x="16" y="20.5" textAnchor="middle" fontSize="14" fontWeight="900" fill="#111" fontFamily="system-ui">
      ?
    </text>
  </svg>
);

/** Official colorblind marks: ● red, ✦ yellow, ▼ green, ■ blue. */
export const ColorMark = ({ color, className }: P & { color: Color }) => (
  <svg viewBox="0 0 20 20" className={className} aria-hidden>
    {color === "red" && <circle cx="10" cy="10" r="7" fill="currentColor" />}
    {color === "yellow" && <path d="M10 1.5 12.3 7.7 18.5 10l-6.2 2.3L10 18.5l-2.3-6.2L1.5 10l6.2-2.3Z" fill="currentColor" />}
    {color === "green" && <path d="M2.5 4h15L10 17.5Z" fill="currentColor" />}
    {color === "blue" && <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" fill="currentColor" />}
  </svg>
);

export const CrownIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5Z" fill="currentColor" />
  </svg>
);

export const BotIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <rect x="4" y="7" width="16" height="12" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="9.5" cy="13" r="1.6" fill="currentColor" />
    <circle cx="14.5" cy="13" r="1.6" fill="currentColor" />
    <path d="M12 3.5V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const SoundIcon = ({ muted, className }: P & { muted: boolean }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor" />
    {muted ? (
      <path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    ) : (
      <path d="M15.5 8.5a5 5 0 0 1 0 7m2.8-9.8a9 9 0 0 1 0 12.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    )}
  </svg>
);

export const BookIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8.5A3.5 3.5 0 0 1 5 16Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M5 16a3.5 3.5 0 0 1 3.5-3.5H18" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const ExitIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M14 5h4.5v14H14M10 8l-4 4 4 4M6 12h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CopyIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const GlobeIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M3.5 12h17M12 3.5c2.6 2.6 3.6 5.4 3.6 8.5s-1 5.9-3.6 8.5c-2.6-2.6-3.6-5.4-3.6-8.5s1-5.9 3.6-8.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const LockIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" fill="currentColor" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const SmileIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
    <circle cx="9" cy="10" r="1.2" fill="currentColor" />
    <circle cx="15" cy="10" r="1.2" fill="currentColor" />
    <path d="M8.5 14.2c1.9 2.2 5.1 2.2 7 0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
