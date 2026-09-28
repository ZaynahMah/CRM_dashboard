"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { DayDetail } from "@/components/DayDetail";
import { Card, Empty, Loading, PageHead } from "@/components/ui";
import { fmtMonth, isoDate, today } from "@/lib/format";
import type { Campaign } from "@/types/campaign";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The Calendar and Final View are the same operational output — this page
 * shows exactly the campaigns with calendar_status = 'UPDATED' (the same
 * filter Final View uses), laid out as a month grid instead of a table.
 * There is no separate slot-generation model here anymore: no page invents
 * its own version of campaign state, per the architecture requirement that
 * every queue read the same real Supabase data.
 */
export default function CalendarPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const finalized = useMemo(() => campaigns.filter((c) => c.calendar_status === "UPDATED"), [campaigns]);

  const byDate = useMemo(() => {
    const m = new Map<string, Campaign[]>();
    finalized.forEach((c) => {
      const list = m.get(c.launch_date) ?? [];
      list.push(c);
      m.set(c.launch_date, list);
    });
    return m;
  }, [finalized]);

  if (!profile) return null;
  if (loading) return <Loading label="Loading the calendar" />;

  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstDay = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7;
  const todayIso = isoDate(today());

  return (
    <div className="space-y-5">
      <PageHead title="Calendar" sub="Finalized campaigns only — the same set Final View shows, laid out by date." />

      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="rounded p-1 text-muted hover:bg-[#F9FAFB]">‹</button>
            <h2 className="text-[14px] font-600 text-heading">{fmtMonth(cursor)}</h2>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="rounded p-1 text-muted hover:bg-[#F9FAFB]">›</button>
          </div>
          <button onClick={() => setCursor(new Date())} className="text-[10px] font-600 text-indigo-700">Today</button>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-1 text-center text-[9px] font-600 uppercase tracking-wider text-faint">{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`p-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const dayNum = i + 1;
              const dateIso = isoDate(new Date(cursor.getFullYear(), cursor.getMonth(), dayNum));
              const dc = byDate.get(dateIso) ?? [];
              const isToday = dateIso === todayIso;
              const isSelected = dateIso === selectedDate;
              return (
                <button key={dayNum}
                  onClick={() => setSelectedDate(dateIso === selectedDate ? null : dateIso)}
                  className={`flex flex-col items-start rounded-lg border p-1.5 text-left min-h-[58px] transition-all ${
                    isSelected ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                    : isToday ? "border-indigo-300 bg-surface"
                    : "border-line bg-surface hover:border-indigo-300"}`}>
                  <span className={`text-[11px] font-600 ${isToday || isSelected ? "text-indigo-700" : "text-heading"}`}>{dayNum}</span>
                  {dc.length > 0 && (
                    <span className="mt-auto text-[9px] font-600 text-success-700">{dc.length} finalized</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {selectedDate ? (
        <DayDetail date={selectedDate} campaigns={byDate.get(selectedDate) ?? []} onOpenCampaign={setOpen} profile={profile} />
      ) : (
        <Card><Empty title="Select a date" hint="Click any date with finalized campaigns to see the detail." /></Card>
      )}

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
