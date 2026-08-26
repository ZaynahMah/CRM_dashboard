"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useCampaigns } from "@/components/useCampaigns";
import { CampaignDrawer } from "@/components/CampaignDrawer";
import { StageChip } from "@/components/StatusChip";
import { Card, CardHead, Empty, Loading, PageHead, TableCard } from "@/components/ui";
import { SplitBar } from "@/components/Charts";
import { Icon } from "@/components/icons";
import { stageOf, type Stage } from "@/lib/workflow";
import { fmtDate, fmtTime } from "@/lib/format";
import type { Campaign } from "@/types/campaign";

export default function PerformancePage() {
  const { profile } = useSession();
  const { campaigns, loading, reload } = useCampaigns();
  const [focus, setFocus] = useState<{ label: string; rows: Campaign[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const m = useMemo(() => {
    const at = (s: Stage) => campaigns.filter((c) => stageOf(c) === s);
    const past = (stages: Stage[]) => campaigns.filter((c) => stages.includes(stageOf(c)));
    const total = campaigns.length || 1;

    const categoryDone = campaigns.filter((c) => c.category_status === "LOCKED");
    const crmDone = past(["CONTENT_PENDING", "CONTENT_SUBMITTED", "FINAL_QC", "READY", "PUSHED"]);
    const contentDone = past(["CONTENT_SUBMITTED", "FINAL_QC", "READY", "PUSHED"]);
    const ready = past(["READY", "PUSHED"]);

    return {
      total: campaigns.length,
      categoryPct: Math.round((categoryDone.length / total) * 100),
      crmPct: Math.round((crmDone.length / total) * 100),
      contentPct: Math.round((contentDone.length / total) * 100),
      readyPct: Math.round((ready.length / total) * 100),
      categoryMix: Math.round(
        (campaigns.filter((c) => c.campaign_origin === "CATEGORY_REQUEST").length / total) * 100),
      blocked: at("BLOCKED"),
      awaitingCategory: at("AWAITING_CATEGORY"),
      contentPending: at("CONTENT_PENDING"),
      inQc: past(["CONTENT_SUBMITTED", "FINAL_QC"]),
      emergency: campaigns.filter((c) => c.is_emergency && c.production_status !== "PUSHED"),
      pushed: at("PUSHED"),
      ready_: at("READY"),
    };
  }, [campaigns]);

  if (!profile) return null;
  if (loading) return <Loading />;

  const bottlenecks = [
    { label: "Category submissions outstanding", rows: m.awaitingCategory },
    { label: "Waiting on Content", rows: m.contentPending },
    { label: "Waiting on final QC", rows: m.inQc },
    { label: "Emergency pushes needing a slot", rows: m.emergency },
    { label: "Blocked", rows: m.blocked },
  ].sort((a, b) => b.rows.length - a.rows.length);

  const worst = bottlenecks[0];

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Executive · Read only"
        title="Operational health"
        sub="Throughput by team, where the calendar is coming from, and what is holding the month up."
      />

      {worst.rows.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-[#FEDF89] bg-warning-50 px-4 py-3.5">
          <span className="mt-0.5 text-warning-700">{Icon.alert(16)}</span>
          <p className="text-[13.5px] text-warning-700">
            {worst.label} is the current bottleneck — {worst.rows.length} campaigns.
          </p>
        </div>
      )}

      {/* Funnel */}
      <Card>
        <CardHead title="Stage completion" sub="Share of campaigns that have cleared each team" />
        <div className="space-y-4">
          {[["Category", m.categoryPct], ["CRM", m.crmPct], ["Content", m.contentPct], ["Ready", m.readyPct]]
            .map(([label, pct]) => (
              <div key={String(label)}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13.5px] text-body">{label}</span>
                  <span className="text-[13.5px] font-600 text-heading">{pct}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#F2F4F7]">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-700"
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
        </div>
      </Card>

      {/* Origin mix */}
      <Card>
        <CardHead title="Campaign origin" sub="Roughly half the calendar is raised by CRM rather than Category" />
        <div className="pt-1">
          <SplitBar segments={[
            { label: "Category requested", value: m.categoryMix, color: "#6438E8" },
            { label: "CRM planned", value: 100 - m.categoryMix, color: "#D9D6FE" },
          ]} />
        </div>
      </Card>

      {/* Bottlenecks */}
      <Card pad={false}>
        <div className="px-5 pt-5">
          <CardHead title="Where work is accumulating" sub="Click a row to filter the campaigns behind it" />
        </div>
        <ul className="border-t border-line">
          {bottlenecks.map((b) => {
            const on = focus?.label === b.label;
            return (
              <li key={b.label}>
                <button
                  onClick={() => setFocus(on ? null : b)}
                  className={`flex w-full items-center justify-between border-b border-line px-5 py-3.5 text-left transition-colors last:border-0 ${
                    on ? "bg-indigo-50" : "hover:bg-[#FCFCFD]"}`}>
                  <span className={`text-[13.5px] ${on ? "font-medium text-indigo-700" : "text-body"}`}>{b.label}</span>
                  <span className={`font-display text-[17px] font-700 ${b.rows.length ? "text-heading" : "text-faint"}`}>
                    {b.rows.length}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {focus && (
        <section>
          <h2 className="mb-3 font-display text-[15px] font-600 text-heading">{focus.label}</h2>
          <TableCard>
            {focus.rows.length === 0 ? (
              <Empty title="Nothing here" hint="This stage is clear for the current window." />
            ) : (
              <table>
                <thead>
                  <tr><th>Launch</th><th>Campaign</th><th>Category</th><th>Brand</th><th>Stage</th></tr>
                </thead>
                <tbody>
                  {focus.rows.map((c) => (
                    <tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                      <td className="whitespace-nowrap text-tiny text-muted">
                        {fmtDate(c.launch_date)} · {fmtTime(c.launch_time)}
                      </td>
                      <td className="max-w-[240px] truncate font-medium text-heading">{c.campaign_name}</td>
                      <td className="text-muted">{c.category ?? "—"}</td>
                      <td className="text-muted">{c.brand ?? "—"}</td>
                      <td><StageChip campaign={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        </section>
      )}

      <CampaignDrawer campaignId={open} profile={profile} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
