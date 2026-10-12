"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { Card, Loading, PageHead, Tabs } from "@/components/ui";
import { CategorySlaTracker } from "@/components/CategorySlaTracker";
import { ActivitiesPanel } from "@/components/ActivitiesPanel";
import { SystemNotifications } from "@/components/SystemNotifications";
import { ExecutiveSlaSummary } from "@/components/ExecutiveSlaSummary";
import { ExecutiveDefaultRate } from "@/components/ExecutiveDefaultRate";
import {
  listSla, listActivities, listSystemNotifications,
  slaSummary, slaTrend, slaOffenders,
  type SlaRow, type ActivityRow, type SystemNotification, type SlaSummary,
} from "@/services/categorySla";

/**
 * A NEW page. Nothing existing was modified to add it.
 *
 * Three tabs for three separate systems: the SLA tracker, the Activities
 * log, and the shared notification centre. Executive additionally gets the
 * SLA summary, trend and top offenders.
 */
export default function SlaPage() {
  const { profile } = useSession();
  const [tab, setTab] = useState("sla");
  const [rows, setRows] = useState<SlaRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [summary, setSummary] = useState<SlaSummary>({
    on_time: 0, due_soon: 0, overdue: 0, defaults_created: 0, crm_overrides: 0, total: 0 });
  const [trend, setTrend] = useState<{ month: string; on_time: number; total: number; on_time_pct: number }[]>([]);
  const [offenders, setOffenders] = useState<{ category: string; missed: number; defaults: number; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setSetupMsg(null);
    try {
      const [s, a, n, sum, tr, off] = await Promise.all([
        listSla(), listActivities(), listSystemNotifications(),
        slaSummary(), slaTrend(), slaOffenders(),
      ]);
      setRows(s); setActivities(a); setNotifications(n);
      setSummary(sum); setTrend(tr); setOffenders(off);
    } catch (e) {
      // Migration 24 not applied: say so rather than showing an empty board
      // that looks like everyone submitted on time.
      setSetupMsg(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!profile) return null;
  const isCrm = profile.role === "CRM";
  const isExec = profile.role === "EXECUTIVE";

  return (
    <div className="space-y-5">
      <PageHead title="Category SLA"
        sub="Who submitted on time, who is due soon, and who has defaulted. A default never blocks a campaign." />

      {setupMsg && <Card><p className="text-tiny text-warning-700">{setupMsg}</p></Card>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: "sla", label: "SLA & Defaults", count: rows.length },
        { key: "activities", label: "Activities", count: activities.length },
        { key: "notifications", label: "Notifications", count: notifications.length },
        ...(isExec ? [{ key: "exec", label: "Executive summary", count: summary.total }] : []),
      ]} />

      {loading ? <Loading label="Loading SLA data" /> : (
        <>
          {tab === "sla" && (
            <>
              <CategorySlaTracker rows={rows} isCrm={isCrm} onChanged={load} />
              {/* Directly BELOW the submission deadlines, in the same
                  governance area: upcoming deadlines, missed deadlines, then
                  recurring default behaviour. Reporting only. */}
              <ExecutiveDefaultRate />
            </>
          )}
          {tab === "activities" && <ActivitiesPanel activities={activities} />}
          {tab === "notifications" && <SystemNotifications notifications={notifications} />}
          {tab === "exec" && isExec && (
            <ExecutiveSlaSummary summary={summary} trend={trend} offenders={offenders} />
          )}
        </>
      )}
    </div>
  );
}
