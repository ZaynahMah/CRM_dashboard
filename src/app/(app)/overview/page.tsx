"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { AddCampaignModal } from "@/components/AddCampaignModal";
import { DayDetail } from "@/components/DayDetail";
import { MonthlyProgressBar } from "@/components/ProgressBar";
import { WeekDeadlines } from "@/components/WeekDeadlines";
import { CrmOwnCampaigns } from "@/components/CrmOwnCampaigns";
import { MonthlyInputSheet } from "@/components/MonthlyInputSheet";
import { IncomingData } from "@/components/IncomingData";
import { Icon } from "@/components/icons";
import { Button, Card, Empty, Loading } from "@/components/ui";
import { fmtMonth, isoDate, today } from "@/lib/format";
import { populateMonth, isMonthPopulated } from "@/services/populate";
import { downloadCSV } from "@/services/exportExcel";
import type { Campaign } from "@/types/campaign";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function OverviewPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [urgentMode, setUrgentMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [populating, setPopulating] = useState(false);
  const [showSeptSheet, setShowSeptSheet] = useState(false);

  if (!profile) return null;
  const role = profile.role;
  const isCrm = role === "CRM";
  const isCategory = role === "CATEGORY";
  const isContent = role === "CONTENT";

  // Calendar math
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstDay = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7;
  const todayIso = isoDate(today());
  const monthName = MONTH_NAMES[cursor.getMonth()];

  // Next month for "Prepare Input Sheet"
  const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const nextMonthName = MONTH_NAMES[nextMonth.getMonth()];

  // Filter campaigns for current calendar month
  const monthFrom = isoDate(cursor);
  const monthTo = isoDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const monthCampaigns = useMemo(
    () => campaigns.filter((c) => c.launch_date >= monthFrom && c.launch_date <= monthTo),
    [campaigns, monthFrom, monthTo]
  );

  const campaignsByDate = useMemo(() => {
    const m = new Map<string, Campaign[]>();
    monthCampaigns.forEach((c) => {
      const list = m.get(c.launch_date) ?? [];
      list.push(c);
      m.set(c.launch_date, list);
    });
    return m;
  }, [monthCampaigns]);

  // Stats
  const catFilled = monthCampaigns.filter((c) => c.brand && c.offer).length;
  const readyCount = monthCampaigns.filter((c) =>
    c.production_status === "READY" || c.production_status === "PUSHED").length;

  // Populate August handler
  const handlePopulateAug = async () => {
    setPopulating(true);
    try {
      const existing = await isMonthPopulated(cursor.getFullYear(), cursor.getMonth());
      if (existing > 100) {
        alert(`${monthName} already has ${existing} campaigns.`);
      } else {
        await populateMonth(cursor.getFullYear(), cursor.getMonth(), profile.id);
        reload();
      }
    } catch (e) { alert(String(e)); }
    setPopulating(false);
  };

  if (loading) return <Loading label="Loading dashboard" />;

  // If the September input sheet is open, show it full-screen
  if (showSeptSheet) {
    return (
      <MonthlyInputSheet
        year={nextMonth.getFullYear()}
        month={nextMonth.getMonth()}
        profileId={profile.id}
        onClose={() => { setShowSeptSheet(false); reload(); }}
        onDone={() => { setShowSeptSheet(false); reload(); }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <MonthlyProgressBar campaigns={monthCampaigns} />

      {/* ─── Top action bar ─── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {isCrm && (
          <>
            <Button size="sm" onClick={handlePopulateAug} disabled={populating}>
              {populating ? "..." : `Populate ${monthName} Campaigns`}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setShowSeptSheet(true)}>
              {Icon.calendar(13)} Prepare Input Sheet for {nextMonthName}
            </Button>
          </>
        )}
        {(isCrm || isCategory) && (
          <Button size="sm" variant="ghost" onClick={() => { setUrgentMode(false); setCreating(true); }}>
            {Icon.spark(13)} Add Campaign
          </Button>
        )}
        {isCategory && (
          <Button size="sm" variant="ghost" onClick={() => { setUrgentMode(true); setCreating(true); }}>
            {Icon.alert(13)} Emergency Campaign
          </Button>
        )}
        {isCrm && monthCampaigns.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => {
            const ready = monthCampaigns.filter((c) =>
              c.production_status === "READY" || c.production_status === "PUSHED");
            downloadCSV(ready.length > 0 ? ready : monthCampaigns,
              `PN_${monthName}_${cursor.getFullYear()}.csv`);
          }}>
            {Icon.chart(13)} Download Excel
          </Button>
        )}

        {/* Compact stats */}
        <div className="ml-auto flex gap-2">
          {[[monthCampaigns.length, "total"], [catFilled, "cat filled"], [readyCount, "ready"]].map(([v, l]) => (
            <span key={String(l)} className="rounded-md bg-[#F9FAFB] px-2 py-1 text-micro text-muted">
              <span className="font-600 text-heading">{v}</span> {l}
            </span>
          ))}
        </div>
      </div>

      {/* ─── Category / Content incoming data ─── */}
      {(isCategory || isContent) && (
        <IncomingData
          year={nextMonth.getFullYear()}
          month={nextMonth.getMonth()}
          profileId={profile.id}
          role={isCategory ? "CATEGORY" : "CONTENT"}
          onOpenCampaign={setOpen}
        />
      )}

      {/* ─── Calendar ─── */}
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
              const dc = campaignsByDate.get(dateIso) ?? [];
              const isToday = dateIso === todayIso;
              const isSelected = dateIso === selectedDate;
              const past = dateIso < todayIso;
              const pending = dc.filter((c) => !c.brand || !c.offer).length;
              return (
                <button key={dayNum}
                  onClick={() => setSelectedDate(dateIso === selectedDate ? null : dateIso)}
                  className={`flex flex-col items-start rounded-lg border p-1.5 text-left min-h-[58px] transition-all ${
                    isSelected ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                    : isToday ? "border-indigo-300 bg-surface"
                    : past ? "border-transparent bg-[#FCFCFD] opacity-50"
                    : "border-line bg-surface hover:border-indigo-300"}`}>
                  <span className={`text-[11px] font-600 ${isToday || isSelected ? "text-indigo-700" : "text-heading"}`}>{dayNum}</span>
                  {dc.length > 0 && (
                    <span className="mt-auto text-[9px] font-600 text-indigo-700">{dc.length} PNs</span>
                  )}
                  {pending > 0 && <span className="text-[9px] text-warning-700">{pending}p</span>}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ─── Day detail ─── */}
      {selectedDate ? (
        <DayDetail
          date={selectedDate}
          campaigns={campaignsByDate.get(selectedDate) ?? []}
          onOpenCampaign={setOpen}
          profile={profile}
        />
      ) : (
        <Card><Empty title="Select a date" hint="Click any date to see time slots and campaigns." /></Card>
      )}

      {/* ─── CRM Own Campaigns ─── */}
      {isCrm && monthCampaigns.length > 0 && (
        <CrmOwnCampaigns campaigns={monthCampaigns} onOpen={setOpen} />
      )}

      {/* ─── Week deadlines ─── */}
      {(isCrm || isCategory) && monthCampaigns.length > 0 && (
        <WeekDeadlines campaigns={monthCampaigns} monthStart={cursor} />
      )}

      {/* Modals */}
      <AddCampaignModal open={creating} onClose={() => setCreating(false)}
        profileId={profile.id} isCrm={isCrm} isUrgent={urgentMode}
        onCreated={() => { setCreating(false); reload(); }} />

      <CampaignDrawer campaignId={open} profile={profile}
        onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
