"use client";

import { useEffect } from "react";

/* ---------------- surfaces ---------------- */

export function Card({ children, className = "", pad = true }: {
  children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface shadow-card ${pad ? "p-5" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function CardHead({ title, sub, action }: {
  title: string; sub?: string; action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-display text-[15px] font-600 text-heading">{title}</h3>
        {sub && <p className="mt-0.5 text-tiny text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-micro font-medium uppercase tracking-wide text-faint ${className}`}>{children}</div>;
}

export function PageHead({ eyebrow, title, sub, action }: {
  eyebrow?: string; title: string; sub?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-display text-[24px] font-700 tracking-[-0.01em] text-heading">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-[13.5px] text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- status ---------------- */

const TONES = {
  neutral: "bg-[#F9FAFB] text-muted ring-[#EAECF0]",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  success: "bg-success-50 text-success-700 ring-[#A6F4C5]",
  warning: "bg-warning-50 text-warning-700 ring-[#FEDF89]",
  info: "bg-info-50 text-info-700 ring-[#B2DDFF]",
  danger: "bg-danger-50 text-danger-700 ring-[#FECDCA]",
};
export type Tone = keyof typeof TONES;

export function Pill({ label, tone = "neutral", dot = true }: {
  label: string; tone?: Tone; dot?: boolean;
}) {
  const dotColor = {
    neutral: "bg-faint", indigo: "bg-indigo-500", success: "bg-success-500",
    warning: "bg-warning-500", info: "bg-info-500", danger: "bg-danger-500",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-micro font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />}
      {label}
    </span>
  );
}

/* ---------------- actions ---------------- */

export function Button({
  children, onClick, variant = "primary", disabled, type = "button", className = "", size = "md",
}: {
  children: React.ReactNode; onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "subtle"; disabled?: boolean;
  type?: "button" | "submit"; className?: string; size?: "sm" | "md";
}) {
  const sizes = { sm: "px-3 py-1.5 text-tiny", md: "px-4 py-2.5 text-[13px]" };
  const variants = {
    primary: "bg-indigo-600 text-white shadow-card hover:bg-indigo-700",
    ghost: "border border-line bg-surface text-body hover:bg-[#F9FAFB]",
    subtle: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
    danger: "border border-[#FECDCA] bg-surface text-danger-700 hover:bg-danger-50",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

/* ---------------- metrics ---------------- */

export function StatCard({ label, value, delta, tone = "neutral", icon }: {
  label: string; value: number | string; delta?: string; tone?: Tone; icon?: React.ReactNode;
}) {
  const positive = delta?.startsWith("+");
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${TONES[tone]}`}>
            {icon}
          </span>
        )}
        <span className="truncate text-tiny text-muted">{label}</span>
      </div>
      <div className="mt-3 font-display text-[26px] font-700 leading-none text-heading">{value}</div>
      {delta && (
        <div className={`mt-2 text-micro ${positive ? "text-success-700" : "text-danger-700"}`}>
          {delta}
        </div>
      )}
    </Card>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}

/* ---------------- forms ---------------- */

export function Field({ label, children, required, hint, error }: {
  label: string; children: React.ReactNode; required?: boolean; hint?: string; error?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-tiny font-medium text-body">
        {label}{required && <span className="text-danger-500"> *</span>}
      </span>
      {children}
      {hint && <span className={`mt-1.5 block text-micro ${error ? "text-danger-700" : "text-muted"}`}>{hint}</span>}
    </label>
  );
}

export function Tabs({ tabs, active, onChange }: {
  tabs: { key: string; label: string; count?: number }[];
  active: string; onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
              on ? "border-indigo-600 text-indigo-700" : "border-transparent text-muted hover:text-body"}`}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`rounded px-1.5 py-px text-micro ${on ? "bg-indigo-50 text-indigo-700" : "bg-[#F2F4F7] text-muted"}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- overlays ---------------- */

export function Modal({
  open, onClose, title, sub, children, width = "max-w-lg", z = "z-50",
}: {
  open: boolean; onClose: () => void; title: string; sub?: string;
  children: React.ReactNode; width?: string;
  /**
   * Stacking context. The default sits above the page; a modal opened from
   * INSIDE the Show All PN workspace (z-[70]) must pass a higher value or it
   * renders behind it — the same trap that hid the tracking dropdowns.
   */
  z?: string;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={`fixed inset-0 ${z} overflow-y-auto bg-[#101828]/40 p-4 backdrop-blur-[2px]`}>
      <div className={`mx-auto mt-10 w-full ${width} rounded-2xl border border-line bg-surface shadow-pop`}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="font-display text-[17px] font-600 text-heading">{title}</h2>
            {sub && <p className="mt-0.5 text-tiny text-muted">{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="rounded-lg p-1 text-faint transition-colors hover:bg-[#F9FAFB] hover:text-body">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#101828]/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto bg-canvas shadow-pop" onClick={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>
  );
}

/* ---------------- states ---------------- */

export function Empty({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-indigo-50 text-indigo-500">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" />
        </svg>
      </div>
      <div className="font-display text-[15px] font-600 text-heading">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-tiny text-muted">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-6 text-tiny text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      {label}
    </div>
  );
}

export function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
