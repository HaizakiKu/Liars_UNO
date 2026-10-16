import { AnimatePresence, motion } from "motion/react";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { serverNow } from "../state/store";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "truth";
  size?: "sm" | "md" | "lg";
}) {
  return <button type="button" className={`btn btn-${variant} btn-${size} ${className ?? ""}`} {...rest} />;
}

export function IconButton({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={`icon-btn ${className ?? ""}`} aria-label={label} title={label} {...rest} />;
}

export function Modal({
  open,
  onClose,
  children,
  className,
  sheet,
  labelledBy,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  sheet?: boolean;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={`modal-root ${sheet ? "is-sheet" : ""}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={`modal ${className ?? ""}`}
            initial={sheet ? { y: 60, opacity: 0 } : { y: 18, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={sheet ? { y: 60, opacity: 0 } : { y: 10, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`segmented ${disabled ? "is-disabled" : ""}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "is-on" : ""}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.value === value && <motion.span layoutId={`seg-${options.map((x) => x.value).join("-")}`} className="segmented-pill" />}
          <span className="segmented-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <motion.span className="toggle-knob" layout transition={{ type: "spring", stiffness: 600, damping: 34 }} />
    </button>
  );
}

/** Seconds left until a server timestamp, re-rendering 4×/s. */
export function useCountdown(deadline: number | null): { left: number; frac: number } {
  const [now, setNow] = useState(serverNow());
  const [start] = useState(() => serverNow());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return { left: 0, frac: 0 };
  const total = Math.max(1, deadline - start);
  const left = Math.max(0, deadline - now);
  return { left: Math.ceil(left / 1000), frac: Math.min(1, left / total) };
}

/** A circular countdown ring driven by CSS (smooth, no re-render per frame). */
export function Ring({ deadline, total, size = 44, stroke = 3.5, className }: { deadline: number | null; total: number; size?: number; stroke?: number; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const left = deadline ? Math.max(0, deadline - serverNow()) : 0;
  const frac = Math.min(1, left / Math.max(1, total));
  return (
    <svg className={`ring ${className ?? ""}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
      {deadline && (
        <circle
          key={deadline}
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={`ring-bar ${frac < 0.3 ? "is-low" : ""}`}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeLinecap="round"
          style={
            {
              "--ring-c": c,
              "--ring-from": c * (1 - frac),
              animationDuration: `${left}ms`,
            } as React.CSSProperties
          }
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}
