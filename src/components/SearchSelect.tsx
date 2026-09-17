"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Searchable dropdown — used for Brand and Offer where the master list has
 * hundreds of entries. Type to filter, click or arrow-key to select.
 */
export function SearchSelect({ value, onChange, options, placeholder, disabled }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = q.trim()
    ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
    : options;

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

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-line bg-surface shadow-pop">
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
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-tiny text-muted">No matches</li>
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
      )}
    </div>
  );
}
