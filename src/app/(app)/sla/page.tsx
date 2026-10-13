"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { Card, Empty, Loading, PageHead, Tabs } from "@/components/ui";
import { CategorySlaTracker } from "@/components/CategorySlaTracker";
import { ActivitiesPanel } from "@/components/ActivitiesPanel";
import { SystemNotifications } from "@/components/SystemNotifications";
import { ExecutiveSlaSummary } from "@/components/ExecutiveSlaSummary";
import { ExecutiveDefaultRate } from "@/components/ExecutiveDefaultRate";
import { TeamSlaDashboard } from "@/components/TeamSlaDashboard";
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
  // Operational management view. Category, Content and Design must not see
  // it; middleware redirects them, and this is the second line of defence
  // in case the route table and this page ever drift apart.
  if (profile.role !== "CRM" && profile.role !== "EXECUTIVE") {
    return (
      <Card>
        <Empty title="Not available"
          hint="Team SLA & Accountability is available to CRM and Executive accounts." />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHead title="Team SLA & Accountability"
        sub="What to follow up today: who is at risk, which deadlines are next, and where inputs are missing." />

      {setupMsg && <Card><p className="text-tiny text-warning-700">{setupMsg}</p></Card>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: "sla", label: "Team Health", count: rows.length },
        { key: "activities", label: "Activity Feed", count: activities.length },
        { key: "notifications", label: "Notifications", count: notifications.length },
        { key: "exec", label: "Default Rate & Trends", count: summary.total },
      ]} />

      {loading ? <Loading label="Loading SLA data" /> : (
        <>
          {tab === "sla" && (
            <>
              {/* Cards 1-4 and 6: health, actions, deadlines, defaults,
                  accountability. Dashboard-first, tables only where a table
                  is genuinely the clearest form. */}
              <TeamSlaDashboard rows={rows} />
              {/* The per-week table, kept because it carries the CRM
                  override action the dashboard deliberately does not. */}
              <CategorySlaTracker rows={rows} isCrm={isCrm} onChanged={load} />
            </>
          )}
          {/* Card 5: the activity feed lives inside this experience rather
              than on a screen of its own. */}
          {tab === "activities" && <ActivitiesPanel activities={activities} />}
          {tab === "notifications" && <SystemNotifications notifications={notifications} />}
          {tab === "exec" && (
            <>
              <ExecutiveSlaSummary summary={summary} trend={trend} offenders={offenders} />
              <ExecutiveDefaultRate />
            </>
          )}
        </>
      )}
    </div>
  );
}
