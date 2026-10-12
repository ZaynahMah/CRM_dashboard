"use client";

import { useMemo, useState } from "react";
import type { ActivityRow } from "@/services/categorySla";
import { Card, Pill, Empty, Tabs } from "./ui";
import { fmtDate } from "@/lib/format";

/**
 * Activities — a NEW, dedicated operational event log.
 *
 * Deliberately NOT the notification centre and deliberately not built on
 * the existing `notifications` table. Activities answer "what happened";
 * notifications answer "what should someone be told". Conflating the two
 * means every log line becomes an interruption.
 */

const FILTERS = [
  { key: "all",        label: "All",              match: () => true },
  { key: "defaults",   label: "Defaults",         match: (e: string) => e === "DEFAULTED" },
  { key: "overdue",    label: "Overdue",          match: (e: string) => ["OVERDUE","REMINDER","ESCALATION"].includes(e) },
  { key: "overrides",  label: "CRM Overrides",    match: (e: string) => e === "CRM_OVERRIDE" },
  { key: "ontime",     label: "Submitted On Time", match: (e: string) => e === "SUBMITTED_ON_TIME" },
];

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "indigo"> = {
  SUBMITTED_ON_TIME: "success",
  DUE_SOON: "warning",
  OVERDUE: "danger",
  REMINDER: "danger",
  ESCALATION: "danger",
  DEFAULTED: "neutral",
  CRM_OVERRIDE: "indigo",
};

export function ActivitiesPanel({ activities }: { activities: ActivityRow[] }) {
  const [filter, setFilter] = useState("all");

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
    return activities.filter((a) => f.match(a.event_type));
  }, [activities, filter]);

  return (
    <Card pad={false}>
      <div className="border-b border-line px-5 py-3.5">
        <h3 className="font-display text-[15px] font-600 text-heading">Activities</h3>
        <p className="text-micro text-faint">
          Operational events. Separate from the notification centre.
        </p>
      </div>

      <div className="px-5 pt-3">
        <Tabs active={filter} onChange={setFilter}
          tabs={FILTERS.map((f) => ({
            key: f.key, label: f.label,
            count: activities.filter((a) => f.match(a.event_type)).length,
          }))} />
      </div>

      {shown.length === 0 ? (
        <Empty title="Nothing here yet" hint="Events appear as deadlines approach and pass." />
      ) : (
        <ul className="divide-y divide-line">
          {shown.slice(0, 100).map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-2.5">
              <span className="w-[84px] shrink-0 whitespace-nowrap text-micro text-faint">
                {fmtDate(a.occurred_at.slice(0, 10))}
                <span className="ml-1">{a.occurred_at.slice(11, 16)}</span>
              </span>
              <Pill dot={false} label={a.event_type.replace(/_/g, " ").toLowerCase()}
                tone={TONE[a.event_type] ?? "neutral"} />
              <span className="min-w-0 flex-1 text-tiny text-body">{a.details}</span>
              {a.category && (
                <span className="shrink-0 text-micro text-faint">{a.category}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {shown.length > 100 && (
        <p className="px-5 pb-3 text-micro text-faint">
          Showing the 100 most recent of {shown.length}.
        </p>
      )}
    </Card>
  );
}
