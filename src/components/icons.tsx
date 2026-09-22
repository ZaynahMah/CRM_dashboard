"use client";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
  home: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>,
  calendar: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>,
  list: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>,
  spark: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="m12 3 2.2 5.6L20 10.8l-5.8 2.2L12 19l-2.2-6L4 10.8l5.8-2.2z" /></svg>,
  check: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="m4 12.5 5 5L20 6.5" /></svg>,
  swap: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M7 4 3 8l4 4M3 8h13a4 4 0 0 1 0 8h-1M17 20l4-4-4-4" /></svg>,
  alert: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M12 3 2 20h20zM12 10v4M12 17h.01" /></svg>,
  chart: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M3 20h18M7 20v-7M12 20V6M17 20v-4" /></svg>,
  users: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.4 5.1a3.5 3.5 0 0 1 0 6.8" /></svg>,
  bell: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 20a2 2 0 0 1-3.4 0" /></svg>,
  search: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  logout: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
  rupee: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M7 4h10M7 9h10M14.5 4c2.5 0 4 2 4 4.2S17 12.5 14 12.5H7L15 21" /></svg>,
  send: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4z" /></svg>,
  clock: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></svg>,
  target: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>,
  chevron: (p = 16) => <svg width={p} height={p} viewBox="0 0 24 24" {...s}><path d="m9 6 6 6-6 6" /></svg>,
};
