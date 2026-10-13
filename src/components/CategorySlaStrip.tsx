"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { slaSummary, type SlaSummary } from "@/services/categorySla";
import { Card, Pill } from "./ui";

/**
 * A one-line SLA summary on every role's dashboard, linking through to the
 * full tracker.
 *
 * It exists because a tracker on its own page is a tracker nobody opens.
 * The counts are live, so a default is visible the moment someone lands on
 * their dashboard rather than only if they think to go looking.
 *
 * Counts come from `category_sla_summary()`, which spans every row, so all
 * four roles see identical figures.
 */
export function CategorySlaStrip() {
  const [s, setS] = useState<SlaSummary | null>(null);

  const load = useCallback(async () => {
    try { setS(await slaSummary()); } catch { setS(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Silent when migration 24 is missing or there is nothing to report:
  // an empty strip on every dashboard would just be noise.
  if (!s || s.total === 0) return null;

  const needsAttention = s.overdue + s.defaults_created > 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[13px] font-600 text-heading">Team SLA</span>

        <div className="flex flex-wrap items-center gap-2">
          <Pill dot={false} label={`${s.on_time} on time`} tone="success" />
          {s.due_soon > 0 && <Pill dot={false} label={`${s.due_soon} due soon`} tone="warning" />}
          {s.overdue > 0 && <Pill dot={false} label={`${s.overdue} overdue`} tone="danger" />}
          {s.defaults_created > 0 && (
            <Pill dot={false} label={`${s.defaults_created} defaulted`} tone="neutral" />
          )}
          {s.crm_overrides > 0 && (
            <Pill dot={false} label={`${s.crm_overrides} CRM filled`} tone="indigo" />
          )}
        </div>

        <Link href="/sla"
          className={`ml-auto text-micro font-medium hover:underline ${
            needsAttention ? "text-danger-700" : "text-indigo-700"}`}>
          {needsAttention ? "Review SLA & defaults →" : "View SLA tracker →"}
        </Link>
      </div>
    </Card>
  );
}
