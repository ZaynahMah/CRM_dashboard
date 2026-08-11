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
import { Icon } from "@/components/icons";
import { Button, Card, Empty, Loading, Pill } from "@/components/ui";
import { fmtDate, fmtMonth, isoDate, today } from "@/lib/format";
import type { Campaign } from "@/types/campaign";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function OverviewPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [urgentMode, setUrgentMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  if (!profile) return null;
  const role = profile.role;
  const isCrm = role === "CRM";
  const isCategory = role === "CATEGORY";

  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstDay = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7;
  const todayIso = isoDate(today());

  const campaignsByDate = useMemo(() => {
    const m = new Map<string, Campaign[]>();
    campaigns.forEach((c) => {
      const list = m.get(c.launch_date) ?? [];
      list.push(c);
      m.set(c.launch_date, list);
    });
    return m;
  }, [campaigns]);

  if (loading) return <Loading label="Loading dashboard" />;

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <MonthlyProgressBar campaigns={campaigns} />

      {/* Primary CTAs */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => { setUrgentMode(false); setCreating(true); }} className="text-[14px]">
          {Icon.spark(15)} Add Campaign
        </Button>
        {isCategory && (
          <Button variant="subtle" onClick={() => { setUrgentMode(true); setCreating(true); }}>
            {Icon.alert(14)} Add Urgent Campaign
          </Button>
        )}
        {isCrm && (
          <span className="text-tiny text-muted">
            {campaigns.length} total PNs this month ·{" "}
            {campaigns.filter((c) => !c.brand || !c.offer).length} pending Category
          </span>
        )}
      </div>

      {/* Calendar */}
      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-3">
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="rounded-lg p-1.5 text-muted hover:bg-[#F9FAFB]">‹</button>
            <h2 className="font-display text-[16px] font-600 text-heading">{fmtMonth(cursor)}</h2>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="rounded-lg p-1.5 text-muted hover:bg-[#F9FAFB]">›</button>
          </div>
          <button onClick={() => setCursor(new Date())} className="text-tiny font-medium text-indigo-700 hover:underline">
            Today
          </button>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-2 text-center text-micro font-medium uppercase tracking-wide text-faint">{d}</div>
            ))}

            {Array.from({ length: firstDay }).map((_, i) => <div key={`pad-${i}`} />)}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const dayNum = i + 1;
              const dateIso = isoDate(new Date(cursor.getFullYear(), cursor.getMonth(), dayNum));
              const dayCampaigns = campaignsByDate.get(dateIso) ?? [];
              const isToday = dateIso === todayIso;
              const isSelected = dateIso === selectedDate;
              const past = dateIso < todayIso;
              const uniqueTimes = new Set(dayCampaigns.map((c) => c.launch_time));
              const pendingCount = dayCampaigns.filter((c) => !c.brand || !c.offer).length;

              return (
                <button key={dayNum}
                  onClick={() => setSelectedDate(dateIso === selectedDate ? null : dateIso)}
                  className={`group flex flex-col items-start rounded-lg border p-2 text-left transition-all min-h-[72px] ${
                    isSelected ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                    : isToday ? "border-indigo-300 bg-surface"
                    : past ? "border-transparent bg-[#FCFCFD] opacity-60"
                    : "border-line bg-surface hover:border-indigo-300"}`}>
                  <span className={`text-[13px] font-600 ${isToday || isSelected ? "text-indigo-700" : "text-heading"}`}>
                    {dayNum}
                  </span>
                  {dayCampaigns.length > 0 && (
                    <div className="mt-auto">
                      <span className="text-micro font-medium text-indigo-700">{dayCampaigns.length} PNs</span>
                      <span className="ml-1.5 text-micro text-faint">{uniqueTimes.size} slots</span>
                    </div>
                  )}
                  {pendingCount > 0 && (
                    <span className="mt-0.5 text-micro text-warning-700">{pendingCount} pending</span>
                  )}
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
        <Card>
          <Empty title="Select a date" hint="Click any date on the calendar to see all time slots and campaigns for that day." />
        </Card>
      )}

      {/* CRM Own Campaigns — CRM only */}
      {isCrm && (
        <CrmOwnCampaigns campaigns={campaigns} onOpen={setOpen} />
      )}

      {/* Week deadlines — show to Category and CRM */}
      {(isCrm || isCategory) && (
        <WeekDeadlines campaigns={campaigns} monthStart={cursor} />
      )}

      {/* Modals */}
      <AddCampaignModal
        open={creating}
        onClose={() => setCreating(false)}
        profileId={profile.id}
        isCrm={isCrm}
        isUrgent={urgentMode}
        onCreated={() => { setCreating(false); reload(); }}
      />

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
