"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "./SessionProvider";
import { signOut } from "@/services/auth";
import { listNotifications, markAllRead } from "@/services/notifications";
import type { AppNotification } from "@/types/campaign";
import type { AppRole } from "@/types/user";
import { fmtRelative } from "@/lib/format";
import { Drawer, Empty } from "./ui";
import { Icon } from "./icons";

interface NavItem { href: string; label: string; roles: AppRole[]; icon: () => React.ReactNode; group: string }

const NAV: NavItem[] = [
  { group: "General", href: "/overview",    label: "Dashboard",   icon: Icon.home,     roles: ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"] },
  { group: "General", href: "/calendar",    label: "Calendar",    icon: Icon.calendar, roles: ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"] },
  { group: "General", href: "/campaigns",   label: "Campaigns",   icon: Icon.list,     roles: ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"] },
  { group: "Planning", href: "/planned",    label: "CRM planned", icon: Icon.spark,    roles: ["CRM"] },
  { group: "Planning", href: "/segments",   label: "Audiences",   icon: Icon.target,   roles: ["CATEGORY", "CRM", "EXECUTIVE"] },
  { group: "Planning", href: "/emergency",  label: "Emergency",   icon: Icon.alert,    roles: ["CATEGORY", "CRM", "EXECUTIVE"] },
  { group: "Execution", href: "/qc",        label: "Final QC",    icon: Icon.check,    roles: ["CRM"] },
  { group: "Execution", href: "/changes",   label: "Changes",     icon: Icon.swap,     roles: ["CATEGORY", "CRM"] },
  { group: "Execution", href: "/performance", label: "Performance", icon: Icon.chart,  roles: ["EXECUTIVE"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [notes, setNotes] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => { if (!loading && !profile) router.replace("/login"); }, [loading, profile, router]);
  useEffect(() => { if (profile) listNotifications(profile.role).then(setNotes); }, [profile, pathname]);
  useEffect(() => { setNavOpen(false); }, [pathname]);

  if (loading || !profile) {
    return (
      <div className="grid h-screen place-items-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(profile.role));
  const groups = Array.from(new Set(items.map((i) => i.group)));
  const unread = notes.filter((n) => !n.is_read).length;
  const initials = profile.role.slice(0, 2);
  const current = items.find((i) => i.href === pathname);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
        navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
            </svg>
          </span>
          <div>
            <div className="font-display text-[15px] font-700 leading-tight text-heading">CLiQ Push Ops</div>
            <div className="text-micro text-faint">Fashion &amp; Luxury</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <div className="px-3 pb-1.5 text-micro font-medium uppercase tracking-wide text-faint">{g}</div>
              <ul className="space-y-0.5">
                {items.filter((i) => i.group === g).map((n) => {
                  const active = pathname === n.href;
                  const badge = n.href === "/emergency"
                    ? notes.filter((x) => x.type === "EMERGENCY" && !x.is_read).length
                    : n.href === "/changes"
                    ? notes.filter((x) => x.type === "CHANGE_REQUEST" && !x.is_read).length
                    : 0;
                  return (
                    <li key={n.href}>
                      <Link href={n.href}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                          active ? "bg-indigo-50 font-medium text-indigo-700" : "text-body hover:bg-[#F9FAFB]"}`}>
                        <span className={active ? "text-indigo-600" : "text-faint"}>{n.icon()}</span>
                        <span className="flex-1">{n.label}</span>
                        {badge > 0 && (
                          <span className="rounded bg-indigo-600 px-1.5 py-px text-micro text-white">{badge}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-100 text-tiny font-600 text-indigo-700">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-heading">{profile.display_name}</div>
              <div className="truncate text-micro text-faint">{profile.role.toLowerCase()}@internal.local</div>
            </div>
            <button onClick={async () => { await signOut(); router.replace("/login"); }}
              aria-label="Sign out" className="rounded-lg p-1.5 text-faint hover:bg-[#F9FAFB] hover:text-danger-700">
              {Icon.logout(15)}
            </button>
          </div>
        </div>
      </aside>

      {navOpen && <div className="fixed inset-0 z-20 bg-[#101828]/30 lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-surface px-4 py-3 lg:px-8">
          <button onClick={() => setNavOpen(true)} aria-label="Open menu"
            className="rounded-lg p-1.5 text-muted hover:bg-[#F9FAFB] lg:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>

          <nav className="hidden items-center gap-1.5 text-tiny text-faint sm:flex">
            <span>Pages</span>
            <span>/</span>
            <span className="font-medium text-heading">{current?.label ?? "Dashboard"}</span>
          </nav>

          <div className="relative ml-auto hidden w-full max-w-[300px] md:block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">{Icon.search(15)}</span>
            <input readOnly onFocus={() => router.push("/campaigns")} placeholder="Search campaigns, brands, segments"
              className="cursor-pointer pl-9 text-tiny" />
          </div>

          <button onClick={() => setOpen(true)} aria-label="Notifications"
            className="relative ml-auto rounded-lg p-2 text-muted hover:bg-[#F9FAFB] md:ml-0">
            {Icon.bell(17)}
            {unread > 0 && (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-500 px-1 text-[9px] font-600 text-white">
                {unread}
              </span>
            )}
          </button>

          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-100 text-micro font-600 text-indigo-700">
            {initials}
          </span>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-7">{children}</main>
      </div>

      <Drawer open={open} onClose={() => setOpen(false)}>
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-6 py-4">
          <h2 className="font-display text-[17px] font-600 text-heading">Notifications</h2>
          <button className="text-tiny font-medium text-indigo-700 hover:underline"
            onClick={async () => { await markAllRead(profile.role); setNotes(await listNotifications(profile.role)); }}>
            Mark all read
          </button>
        </div>
        <div className="bg-surface">
          {notes.length === 0 ? (
            <Empty title="You're all caught up" hint="Deadline alerts, handovers and change requests will land here." />
          ) : (
            <ul>
              {notes.map((n) => (
                <li key={n.id} className={`border-b border-line px-6 py-4 ${n.is_read ? "" : "bg-indigo-50/40"}`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[13.5px] font-medium text-heading">{n.title}</span>
                    <span className="shrink-0 text-micro text-faint">{fmtRelative(n.created_at)}</span>
                  </div>
                  {n.message && <p className="mt-1 text-tiny text-muted">{n.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Drawer>
    </div>
  );
}
