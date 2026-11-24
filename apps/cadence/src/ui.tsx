import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Cadence's mark: four bars of a voice. */
export const Logo = ({ size = 28 }: { size?: number }) =>
  <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
    <rect width="512" height="512" rx="112" fill="var(--accent)" />
    <g fill="#fff"><rect x="116" y="216" width="40" height="80" rx="20" /><rect x="196" y="136" width="40" height="240" rx="20" /><rect x="276" y="176" width="40" height="160" rx="20" /><rect x="356" y="226" width="40" height="60" rx="20" /></g>
  </svg>;

/** A round 36-point button holding one icon. */
export function RoundButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return <button type="button" className="round" aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

export const CloseButton = ({ onClick, label = "Close" }: { onClick: () => void; label?: string }) =>
  <RoundButton label={label} onClick={onClick}><X size={18} aria-hidden /></RoundButton>;

/** Small bars, `value` of them filled. */
export function Meter({ value, of, label }: { value: number; of: number; label: string }) {
  return <span role="img" aria-label={label} className="meter">
    {Array.from({ length: of }, (_, i) => <span key={i} className={i < value ? "on" : undefined} />)}
  </span>;
}

export function Segmented<T extends string>({ label, role, value, options, onChange }: {
  label: string; role: "radiogroup" | "tablist"; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void;
}) {
  const tabs = role === "tablist";
  return <div role={role} aria-label={label} className="segmented" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map((o) => <button key={o.id} type="button" className="segment" role={tabs ? "tab" : "radio"}
      {...(tabs ? { "aria-selected": o.id === value } : { "aria-checked": o.id === value })}
      onClick={() => onChange(o.id)}>{o.label}</button>)}
  </div>;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A sheet that rises from the bottom over a dimmed page (a centred dialog on wider screens).
 * Escape or a tap outside closes it,
 * Tab stays inside it, and focus goes back to where it was.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab" || !sheet.current) return;
      const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheet.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = overflow;
      before?.focus();
    };
  }, []);
  return createPortal(
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={sheet} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="sheet">
        <span className="sheet-grip" aria-hidden />
        {children}
      </section>
    </div>,
    document.body,
  );
}
