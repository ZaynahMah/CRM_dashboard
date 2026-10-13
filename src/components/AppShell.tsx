"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "./SessionProvider";
import { signOut } from "@/services/auth";
import { Drawer } from "./ui";
import { Icon } from "./icons";
interface NavItem { href: string; label: string; roles: string[]; icon: () => React.ReactNode; group: string }
const NAV: NavItem[] = [
  { group:"General",href:"/overview",label:"Dashboard",icon:Icon.home,roles:["CATEGORY","CRM","CONTENT","EXECUTIVE"] },
  { group:"General",href:"/campaigns",label:"All Campaigns",icon:Icon.list,roles:["CATEGORY","CRM","CONTENT","EXECUTIVE"] },
  { group:"General",href:"/calendar",label:"Calendar",icon:Icon.calendar,roles:["CATEGORY","CRM","CONTENT","EXECUTIVE"] },
  { group:"Planning",href:"/segments",label:"Audiences",icon:Icon.target,roles:["CRM"] },
  { group:"Planning",href:"/sla",label:"Team SLA & Accountability",icon:Icon.alert,roles:["CRM","EXECUTIVE"] },
  { group:"Planning",href:"/emergency",label:"Emergency",icon:Icon.alert,roles:["CATEGORY","CRM","CONTENT"] },
  { group:"Execution",href:"/final-view",label:"Final View",icon:Icon.list,roles:["CRM"] },
  { group:"Execution",href:"/qc",label:"Final QC",icon:Icon.check,roles:["CRM"] },
  { group:"Execution",href:"/performance",label:"Performance",icon:Icon.chart,roles:["CRM","EXECUTIVE"] },
  { group:"Execution",href:"/changes",label:"Changes",icon:Icon.swap,roles:["CATEGORY","CRM"] },
];
const ALERTS = [
  { title:"Submissions due for Kids category today",date:"10 Aug",body:"Campaign details are due today for pushes going live in 7 days.",action:"Email sent to Kids category SPOCs." },
  { title:"Submissions due for Home category today",date:"10 Aug",body:"Campaign details are due today for pushes going live in 7 days.",action:"Email sent to Home category SPOCs." },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  useEffect(() => { if (!loading && !profile) router.replace("/login"); }, [loading, profile, router]);
  useEffect(() => { setNavOpen(false); }, [pathname]);
  if (loading || !profile) return <div className="grid h-screen place-items-center"><span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" /></div>;
  const items = NAV.filter((n) => n.roles.includes(profile.role));
  const groups = Array.from(new Set(items.map((i) => i.group)));
  const initials = profile.role.slice(0, 2);
  const current = items.find((i) => i.href === pathname);
  return (
    <div className="flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[228px] flex-col border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white">{Icon.bell(15)}</span>
          <div><div className="font-display text-[14px] font-700 text-heading">CLiQ Push Ops</div><div className="text-[10px] text-faint">Fashion &amp; Luxury</div></div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (<div key={g} className="mb-3"><div className="px-3 pb-1 text-[10px] font-600 uppercase tracking-wider text-faint">{g}</div>
            <ul className="space-y-0.5">{items.filter((i) => i.group === g).map((n) => {
              const active = pathname === n.href;
              return (<li key={n.href}><Link href={n.href} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors ${active ? "bg-indigo-50 font-medium text-indigo-700" : "text-body hover:bg-[#F9FAFB]"}`}><span className={active ? "text-indigo-600" : "text-faint"}>{n.icon()}</span>{n.label}</Link></li>);
            })}</ul></div>))}
        </nav>
        <div className="border-t border-line p-3"><div className="flex items-center gap-2 px-2 py-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo-100 text-[10px] font-600 text-indigo-700">{initials}</span>
          <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium text-heading">{profile.display_name}</div><div className="truncate text-[10px] text-faint">{profile.role.toLowerCase()}@internal.local</div></div>
          <button onClick={async () => { await signOut(); router.replace("/login"); }} className="rounded p-1 text-faint hover:text-danger-700">{Icon.logout(14)}</button>
        </div></div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-20 bg-[#101828]/30 lg:hidden" onClick={() => setNavOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 lg:px-8">
          <button onClick={() => setNavOpen(true)} className="rounded p-1 text-muted lg:hidden"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg></button>
          <span className="hidden text-tiny text-faint sm:block">Pages / <span className="font-medium text-heading">{current?.label ?? "Dashboard"}</span></span>
          <div className="ml-auto flex items-center gap-3">
            <button onClick={() => setNotifOpen(true)} className="relative rounded-lg p-2 text-muted hover:bg-[#F9FAFB]">{Icon.bell(16)}<span className="absolute right-1 top-1 grid h-3.5 min-w-[14px] place-items-center rounded-full bg-danger-500 px-0.5 text-[8px] font-700 text-white">2</span></button>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo-100 text-[10px] font-600 text-indigo-700">{initials}</span>
          </div>
        </header>
        <main className="flex-1 px-4 py-5 lg:px-8 lg:py-6">{children}</main>
      </div>
      <Drawer open={notifOpen} onClose={() => setNotifOpen(false)}>
        <div className="sticky top-0 border-b border-line bg-surface px-6 py-4"><h2 className="font-display text-[16px] font-600 text-heading">Notifications</h2></div>
        <div className="bg-surface">{ALERTS.map((a, i) => (<div key={i} className="border-b border-line px-6 py-4"><div className="flex items-baseline justify-between gap-3"><span className="text-[13px] font-600 text-heading">{a.title}</span><span className="shrink-0 text-[10px] text-faint">{a.date}</span></div><p className="mt-1 text-tiny text-muted">{a.body}</p><p className="mt-1.5 text-micro text-indigo-700">{a.action}</p></div>))}</div>
      </Drawer>
    </div>
  );
}
