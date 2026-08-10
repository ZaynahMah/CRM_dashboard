"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { WorkList } from "@/components/WorkList";
import { BarChart, LineChart, SplitBar } from "@/components/Charts";
import { Icon } from "@/components/icons";
import {
  Button, Card, CardHead, PageHead, StatCard, StatGrid, TableCard, Tabs, Loading,
} from "@/components/ui";
import { deadlineAlert, deadlineState } from "@/lib/deadlines";
import { stageOf, STAGE_LABEL, type Stage } from "@/lib/workflow";
import { daysBetween, fmtDate, toDate, today } from "@/lib/format";
import type { Campaign } from "@/types/campaign";

export default function OverviewPage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState("action");

  const buckets = useMemo(() => {
    const t = today();
    const within = (c: Campaign, days: number) => {
      const gap = daysBetween(t, toDate(c.category_deadline));
      return gap >= 0 && gap <= days;
    };
    return {
      upcoming: campaigns.filter((c) => toDate(c.launch_date) >= t && c.production_status !== "PUSHED"),
      dueToday: campaigns.filter((c) => deadlineState(c) === "DUE_TODAY"),
      dueWeek: campaigns.filter((c) => deadlineState(c) !== "COMPLETED" && within(c, 7)),
      overdue: campaigns.filter((c) => deadlineState(c) === "OVERDUE"),
      completed: campaigns.filter((c) => deadlineState(c) === "COMPLETED"),
      emergency: campaigns.filter((c) => c.is_emergency && c.production_status !== "PUSHED"),
    };
  }, [campaigns]);

  const byStage = useMemo(() => {
    const m = new Map<Stage, Campaign[]>();
    campaigns.forEach((c) => { const s = stageOf(c); m.set(s, [...(m.get(s) ?? []), c]); });
    return m;
  }, [campaigns]);

  /** Pushes per launch date over the next fortnight — the real volume curve. */
  const volume = useMemo(() => {
    const t = today();
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(t); d.setDate(t.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { label: fmtDate(iso), value: campaigns.filter((c) => c.launch_date === iso).length };
    });
  }, [campaigns]);

  /** Cumulative reach across the same window, from the segment base counts. */
  const reach = useMemo(
    () => volume.map((v, i) => {
      const t = today(); const d = new Date(t); d.setDate(t.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const total = campaigns
        .filter((c) => c.launch_date === iso)
        .reduce((a, c) => a + (c.expected_reach ?? 0), 0);
      return { label: v.label, value: Math.round(total / 1000) };
    }),
    [campaigns, volume]
  );

  const channelMix = useMemo(() => {
    const count = (ch: string) => campaigns.filter((c) => (c.channel ?? "PN") === ch).length;
    return [
      { label: "Push", value: count("PN"), color: "#6438E8" },
      { label: "WhatsApp", value: count("WHATSAPP"), color: "#9B8AFB" },
      { label: "Email", value: count("EMAIL"), color: "#D9D6FE" },
    ];
  }, [campaigns]);

  if (!profile) return null;
  if (loading) return <Loading label="Loading your dashboard" />;

  const alert = deadlineAlert(campaigns);
  const role = profile.role;
  const count = (s: Stage) => byStage.get(s)?.length ?? 0;
  const totalReach = campaigns.reduce((a, c) => a + (c.expected_reach ?? 0), 0);

  const actionRows =
    role === "CATEGORY" ? [...buckets.overdue, ...buckets.dueToday, ...buckets.dueWeek].slice(0, 10)
    : role === "CONTENT" ? (byStage.get("CONTENT_PENDING") ?? []).slice(0, 10)
    : role === "EXECUTIVE" ? campaigns.filter((c) => !["READY", "PUSHED"].includes(stageOf(c)) && toDate(c.launch_date) >= today()).slice(0, 10)
    : [...(byStage.get("CATEGORY_SUBMITTED") ?? []), ...(byStage.get("CONTENT_SUBMITTED") ?? [])].slice(0, 10);

  const tabRows: Record<string, Campaign[]> = {
    action: actionRows,
    emergency: buckets.emergency,
    ready: byStage.get("READY") ?? [],
    blocked: byStage.get("BLOCKED") ?? [],
  };

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow={`${role} workspace`}
        title={
          role === "EXECUTIVE" ? "Is the push operation healthy?"
          : role === "CONTENT" ? "Copy and creative queue"
          : role === "CRM" ? "Push operations control"
          : "Your push submissions"
        }
        sub={
          role === "CATEGORY"
            ? "Campaign details are due seven days before a push goes live. The deadline is calculated for you."
            : role === "CRM"
            ? "Every campaign, Category-requested and CRM-planned, across all channels."
            : role === "CONTENT"
            ? "Campaigns handed over by CRM, with the Category and targeting context already attached."
            : "Volume, throughput and where work is accumulating this month."
        }
        action={role === "CRM" ? <Link href="/planned"><Button>{Icon.spark(14)} Create CRM campaign</Button></Link> : undefined}
      />

      {alert && (role === "CATEGORY" || role === "CRM") && (
        <div className="flex items-start gap-3 rounded-xl border border-[#FEDF89] bg-warning-50 px-4 py-3.5">
          <span className="mt-0.5 text-warning-700">{Icon.alert(16)}</span>
          <p className="text-[13.5px] text-warning-700">{alert}</p>
        </div>
      )}

      {/* KPIs */}
      {role === "CRM" && (
        <StatGrid>
          <StatCard label="Total pushes" value={campaigns.length} icon={Icon.list(14)} tone="indigo"
            delta={`${campaigns.filter((c) => c.campaign_origin === "CRM_PLANNED").length} CRM planned`} />
          <StatCard label="Awaiting review" value={count("CATEGORY_SUBMITTED")} icon={Icon.clock(14)} tone="info" />
          <StatCard label="With Content" value={count("CONTENT_PENDING")} icon={Icon.send(14)} tone="warning" />
          <StatCard label="Ready" value={count("READY")} icon={Icon.check(14)} tone="success" />
        </StatGrid>
      )}

      {role === "CATEGORY" && (
        <StatGrid>
          <StatCard label="Upcoming" value={buckets.upcoming.length} icon={Icon.calendar(14)} tone="indigo" />
          <StatCard label="Due today" value={buckets.dueToday.length} icon={Icon.clock(14)} tone="warning" />
          <StatCard label="Overdue" value={buckets.overdue.length} icon={Icon.alert(14)} tone="danger" />
          <StatCard label="Completed" value={buckets.completed.length} icon={Icon.check(14)} tone="success" />
        </StatGrid>
      )}

      {role === "CONTENT" && (
        <StatGrid>
          <StatCard label="In my queue" value={count("CONTENT_PENDING")} icon={Icon.list(14)} tone="indigo" />
          <StatCard label="Needs changes" value={campaigns.filter((c) => c.content_status === "NEEDS_CHANGES").length}
            icon={Icon.swap(14)} tone="danger" />
          <StatCard label="Submitted" value={campaigns.filter((c) => c.content_status === "SUBMITTED").length}
            icon={Icon.check(14)} tone="success" />
          <StatCard label="Live already" value={count("PUSHED")} icon={Icon.send(14)} tone="neutral" />
        </StatGrid>
      )}

      {role === "EXECUTIVE" && (
        <StatGrid>
          <StatCard label="Total pushes" value={campaigns.length} icon={Icon.list(14)} tone="indigo" />
          <StatCard label="Reachable base" value={`${(totalReach / 1_000_000).toFixed(1)}M`} icon={Icon.users(14)} tone="info" />
          <StatCard label="Ready" value={count("READY")} icon={Icon.check(14)} tone="success" />
          <StatCard label="Blocked" value={count("BLOCKED")} icon={Icon.alert(14)} tone="danger" />
        </StatGrid>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHead title="Pushes scheduled" sub="Next 14 launch dates" />
          <BarChart data={volume} />
        </Card>
        <Card>
          <CardHead title="Reachable base" sub="Thousands of users, by launch date" />
          <LineChart data={reach} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHead title="Channel mix" sub="Push carries over 70% of CRM revenue contribution" />
          <div className="pt-2"><SplitBar segments={channelMix} /></div>
        </Card>

        <Card>
          <CardHead title="Pipeline" sub="Where campaigns are sitting right now" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["AWAITING_CATEGORY", "CRM_PROCESSING", "CONTENT_PENDING", "FINAL_QC",
               "CONTENT_SUBMITTED", "READY", "PUSHED", "BLOCKED"] as Stage[]).map((s) => (
              <div key={s} className="rounded-lg border border-line px-3 py-2.5">
                <div className="font-display text-[19px] font-700 text-heading">{count(s)}</div>
                <div className="mt-0.5 text-micro leading-tight text-muted">{STAGE_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Working list */}
      <div>
        <Card pad={false} className="overflow-hidden">
          <div className="px-5 pt-4">
            <Tabs
              active={tab} onChange={setTab}
              tabs={[
                { key: "action", label: role === "CATEGORY" ? "Needs your details" : "Needs action", count: actionRows.length },
                { key: "emergency", label: "Emergency", count: buckets.emergency.length },
                { key: "ready", label: "Ready", count: count("READY") },
                { key: "blocked", label: "Blocked", count: count("BLOCKED") },
              ]}
            />
          </div>
          <div className="overflow-x-auto">
            <WorkList campaigns={tabRows[tab] ?? []} onOpen={setOpen} readOnly={role === "EXECUTIVE"} />
          </div>
        </Card>
      </div>

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
