"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Searchable dropdown — used for Brand and Offer where the master list has
 * hundreds of entries. Type to filter, click or arrow-key to select.
 *
 * `portal`: render the menu into document.body at fixed coordinates instead
 * of absolutely inside the field. Needed anywhere this sits inside a
 * clipping ancestor — the Category grid lives in
 * `<Card className="overflow-hidden"><div className="overflow-x-auto">`,
 * which cuts the menu off and makes its option list unscrollable. Opt-in so
 * that surfaces which already work are left exactly as they were.
 */
export function SearchSelect({ value, onChange, options, placeholder, disabled, portal = false, allowCreate = false }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  portal?: boolean;
  /** Show "+ Add new value" when the typed text matches nothing in the list. */
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on any click that lands outside BOTH the field and the portalled
  // menu. Without the menu check, clicking an option in the portal would
  // read as "outside" and close the menu before the click registered.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const place = useCallback(() => {
    if (!portal || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, [portal]);

  // Measure before paint so the menu never appears at the wrong spot first.
  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  // A fixed-position menu doesn't move with its field, so follow scroll and
  // resize while open. `true` captures scroll on ancestor containers too,
  // not just the window — the grid scrolls horizontally inside a div.
  useEffect(() => {
    if (!open || !portal) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, portal, place]);

  const canCreate = Boolean(
    q.trim() && !options.some((o) => o.toLowerCase() === q.trim().toLowerCase())
  );

  const filtered = q.trim()
    ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
    : options;

  const menu = (
    <div
      ref={menuRef}
      style={portal && rect ? { position: "fixed", top: rect.top, left: rect.left, width: rect.width } : undefined}
      className={portal
        ? "z-[60] rounded-xl border border-line bg-surface shadow-pop"
        : "absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-line bg-surface shadow-pop"}
    >
      <div className="border-b border-line p-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type to search"
          className="!border-0 !p-2 !text-tiny !shadow-none !ring-0 focus:!ring-0 focus:!border-0"
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); setQ(""); }
            if (e.key === "Enter" && filtered.length === 1) {
              onChange(filtered[0]); setOpen(false); setQ("");
            }
          }}
        />
      </div>
      <ul className="max-h-[240px] overflow-y-auto py-1">
        {/* The master list is a starting point, not a closed vocabulary —
            new brands appear faster than the reference data is refreshed.
            The typed value is stored as-is; it is not added to
            masterData.json, which stays the curated list. */}
        {allowCreate && canCreate && (
          <li>
            <button
              type="button"
              onClick={() => { onChange(q.trim()); setOpen(false); setQ(""); }}
              className="w-full px-3 py-2 text-left text-[13px] font-medium text-indigo-700 hover:bg-indigo-50"
            >
              + Add new value: “{q.trim()}”
            </button>
          </li>
        )}
        {filtered.length === 0 ? (
          allowCreate
            ? (!canCreate && <li className="px-3 py-2 text-tiny text-muted">Type a value to add it</li>)
            : <li className="px-3 py-2 text-tiny text-muted">No matches</li>
        ) : (
          <>
            {value && (
              <li>
                <button
                  type="button"
                  onClick={() => { onChange(""); setOpen(false); setQ(""); }}
                  className="w-full px-3 py-1.5 text-left text-tiny text-faint hover:bg-[#F9FAFB]"
                >
                  Clear selection
                </button>
              </li>
            )}
            {filtered.slice(0, 80).map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => { onChange(o); setOpen(false); setQ(""); }}
                  className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-indigo-50 ${
                    o === value ? "bg-indigo-50 font-medium text-indigo-700" : "text-body"
                  }`}
                >
                  {o}
                </button>
              </li>
            ))}
            {filtered.length > 80 && (
              <li className="px-3 py-2 text-micro text-faint">
                {filtered.length - 80} more — type to narrow
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-line bg-white px-3 py-[9px] text-left text-[13.5px] transition-colors hover:border-indigo-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 disabled:bg-[#F9FAFB] disabled:text-faint"
      >
        <span className={value ? "text-heading" : "text-faint"}>
          {value || placeholder || "Select"}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" className="shrink-0 text-faint">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (portal && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : menu)}
    </div>
  );
}
