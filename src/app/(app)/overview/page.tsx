"use client";

import { useCallback, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { AddCampaignModal } from "@/components/AddCampaignModal";
import { DayDetail } from "@/components/DayDetail";
import { MonthlyProgressBar } from "@/components/ProgressBar";
import { WeekDeadlines } from "@/components/WeekDeadlines";
import { CrmOwnCampaigns } from "@/components/CrmOwnCampaigns";
import { Icon } from "@/components/icons";
import { Button, Card, Empty, Loading, Modal, Pill } from "@/components/ui";
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
  const [popResult, setPopResult] = useState<string | null>(null);

  if (!profile) return null;
  const role = profile.role;
  const isCrm = role === "CRM";
  const isCategory = role === "CATEGORY";
  const isContent = role === "CONTENT";

  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstDay = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7;
  const todayIso = isoDate(today());
  const monthName = MONTH_NAMES[cursor.getMonth()];

  const campaignsByDate = useMemo(() => {
    const m = new Map<string, Campaign[]>();
    campaigns.forEach((c) => {
      const list = m.get(c.launch_date) ?? [];
      list.push(c);
      m.set(c.launch_date, list);
    });
    return m;
  }, [campaigns]);

  // Filter campaigns relevant to this month
  const monthCampaigns = useMemo(() => {
    const from = isoDate(cursor);
    const to = isoDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    return campaigns.filter((c) => c.launch_date >= from && c.launch_date <= to);
  }, [campaigns, cursor]);

  const handlePopulate = useCallback(async () => {
    setPopulating(true); setPopResult(null);
    try {
      const existing = await isMonthPopulated(cursor.getFullYear(), cursor.getMonth());
      if (existing > 0) {
        setPopResult(`${monthName} already has ${existing.toLocaleString()} campaigns. Clear them first or select a different month.`);
        setPopulating(false);
        return;
      }
      const r = await populateMonth(cursor.getFullYear(), cursor.getMonth(), profile.id);
      setPopResult(`Created ${r.totalCampaigns.toLocaleString()} campaigns across ${r.totalDays} days.`);
      reload();
    } catch (e) {
      setPopResult(e instanceof Error ? e.message : "Failed to populate.");
    }
    setPopulating(false);
  }, [cursor, profile.id, monthName, reload]);

  // Stats
  const catFilled = monthCampaigns.filter((c) => c.brand && c.offer).length;
  const contentDone = monthCampaigns.filter((c) => c.content_status === "SUBMITTED").length;
  const readyCount = monthCampaigns.filter((c) => c.production_status === "READY" || c.production_status === "PUSHED").length;

  if (loading) return <Loading label="Loading dashboard" />;

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <MonthlyProgressBar campaigns={monthCampaigns} />

      {/* Primary actions row */}
      <div className="flex flex-wrap items-center gap-3">
        {isCrm && (
          <Button onClick={handlePopulate} disabled={populating}>
            {populating ? "Populating..." : `Populate ${monthName} Campaigns`}
          </Button>
        )}
        {(isCrm || isCategory) && (
          <Button variant={isCrm ? "ghost" : "primary"}
            onClick={() => { setUrgentMode(false); setCreating(true); }}>
            {Icon.spark(15)} Add Campaign
          </Button>
        )}
        {isCategory && (
          <Button variant="subtle" onClick={() => { setUrgentMode(true); setCreating(true); }}>
            {Icon.alert(14)} Add Urgent Campaign
          </Button>
        )}
        {isCrm && monthCampaigns.length > 0 && (
          <Button variant="ghost" onClick={() => {
            const publishReady = monthCampaigns.filter((c) =>
              c.production_status === "READY" || c.production_status === "PUSHED");
            downloadCSV(publishReady.length > 0 ? publishReady : monthCampaigns,
              `PN_${monthName}_${cursor.getFullYear()}.csv`);
          }}>
            {Icon.chart(14)} Download Excel
          </Button>
        )}
      </div>

      {popResult && (
        <div className="rounded-lg border border-line bg-[#F9FAFB] px-4 py-3 text-tiny text-body">
          {popResult}
        </div>
      )}

      {/* Compact stats */}
      <div className="flex flex-wrap gap-3">
        {[
          [`Total PNs`, monthCampaigns.length],
          [`Category filled`, `${catFilled} / ${monthCampaigns.length}`],
          [`Content done`, contentDone],
          [`Ready`, readyCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 shadow-card">
            <span className="text-[18px] font-700 text-heading">{value}</span>
            <span className="text-micro text-muted">{label}</span>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="rounded-lg p-1 text-muted hover:bg-[#F9FAFB]">‹</button>
            <h2 className="font-display text-[15px] font-600 text-heading">{fmtMonth(cursor)}</h2>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="rounded-lg p-1 text-muted hover:bg-[#F9FAFB]">›</button>
          </div>
          <button onClick={() => setCursor(new Date())} className="text-micro font-medium text-indigo-700">Today</button>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-faint">{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`p-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const dayNum = i + 1;
              const dateIso = isoDate(new Date(cursor.getFullYear(), cursor.getMonth(), dayNum));
              const dc = campaignsByDate.get(dateIso) ?? [];
              const isToday = dateIso === todayIso;
              const isSelected = dateIso === selectedDate;
              const past = dateIso < todayIso;
              const uniqueTimes = new Set(dc.map((c) => c.launch_time));
              const pending = dc.filter((c) => !c.brand || !c.offer).length;
              return (
                <button key={dayNum}
                  onClick={() => setSelectedDate(dateIso === selectedDate ? null : dateIso)}
                  className={`flex flex-col items-start rounded-lg border p-1.5 text-left transition-all min-h-[62px] ${
                    isSelected ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                    : isToday ? "border-indigo-300 bg-surface"
                    : past ? "border-transparent bg-[#FCFCFD] opacity-55"
                    : "border-line bg-surface hover:border-indigo-300"}`}>
                  <span className={`text-[12px] font-600 ${isToday || isSelected ? "text-indigo-700" : "text-heading"}`}>{dayNum}</span>
                  {dc.length > 0 && (
                    <div className="mt-auto">
                      <span className="text-[10px] font-600 text-indigo-700">{dc.length}</span>
                      <span className="ml-1 text-[10px] text-faint">{uniqueTimes.size}t</span>
                    </div>
                  )}
                  {pending > 0 && <span className="text-[10px] text-warning-700">{pending}p</span>}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Day detail */}
      {selectedDate ? (
        <DayDetail
          date={selectedDate}
          campaigns={campaignsByDate.get(selectedDate) ?? []}
          onOpenCampaign={setOpen}
          profile={profile}
        />
      ) : (
        <Card><Empty title="Select a date" hint="Click any date to see all time slots and campaigns." /></Card>
      )}

      {/* CRM Own Campaigns */}
      {isCrm && monthCampaigns.length > 0 && (
        <CrmOwnCampaigns campaigns={monthCampaigns} onOpen={setOpen} />
      )}

      {/* Week deadlines */}
      {(isCrm || isCategory) && monthCampaigns.length > 0 && (
        <WeekDeadlines campaigns={monthCampaigns} monthStart={cursor} />
      )}

      {/* Modals */}
      <AddCampaignModal open={creating} onClose={() => setCreating(false)}
        profileId={profile.id} isCrm={isCrm} isUrgent={urgentMode}
        onCreated={() => { setCreating(false); reload(); }} />

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
