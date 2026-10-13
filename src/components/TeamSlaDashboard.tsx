"use client";

import { useMemo } from "react";
import type { SlaRow } from "@/services/categorySla";
import {
  healthSummary, requiresAttention, deadlineCalendar, accountabilityRows,
  completionPercent, defaultPercent, missingInputs,
  HEALTH_LABEL, HEALTH_TONE, type HealthStatus,
} from "@/lib/teamSla";
import { Card, Pill, Empty } from "./ui";
import { Icon } from "./icons";
import { fmtDate } from "@/lib/format";

/**
 * Team SLA & Accountability — dashboard-first, not a data table.
 *
 * It answers "what should CRM do today?" rather than "who is overdue?",
 * which is why Requires Attention comes before any table and everything is
 * sorted by urgency.
 *
 * All numbers derive from the SLA that migration 24 already computes. No
 * deadline formula is defined here; see `lib/teamSla.ts`.
 */
export function TeamSlaDashboard({ rows }: { rows: SlaRow[] }) {
  const summary = useMemo(() => healthSummary(rows), [rows]);
  const attention = useMemo(() => requiresAttention(rows), [rows]);
  const calendar = useMemo(() => deadlineCalendar(rows), [rows]);
  const accountability = useMemo(() => accountabilityRows(rows), [rows]);
  const defaulting = useMemo(
    () => rows.filter((r) => missingInputs(r) > 0)
      .sort((a, b) => defaultPercent(b) - defaultPercent(a)),
    [rows]);

  const cards: { label: string; value: number; tone: HealthStatus | null }[] = [
    { label: "Total Campaign Weeks", value: summary.total, tone: null },
    { label: "On Track", value: summary.on_track, tone: "ON_TRACK" },
    { label: "Due Soon", value: summary.due_soon, tone: "DUE_SOON" },
    { label: "Due Today", value: summary.due_today, tone: "DUE_TODAY" },
    { label: "Overdue", value: summary.overdue, tone: "OVERDUE" },
    { label: "Defaulted", value: summary.defaulted, tone: "DEFAULTED" },
    { label: "Completed", value: summary.completed, tone: "COMPLETED" },
  ];

  const toneClass = (t: HealthStatus | null, n: number) =>
    n === 0 ? "text-faint"
    : t === "OVERDUE" ? "text-danger-700"
    : t === "DEFAULTED" ? "text-indigo-700"
    : t === "DUE_SOON" || t === "DUE_TODAY" ? "text-warning-700"
    : t === "COMPLETED" ? "text-success-700"
    : "text-heading";

  return (
    <div className="space-y-5">

      {/* ── CARD 1: team health in five seconds ── */}
      <Card>
        <h3 className="mb-3 font-display text-[15px] font-600 text-heading">Team Health Summary</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-line px-3 py-2.5">
              <div className={`text-[22px] font-700 tabular-nums ${toneClass(c.tone, c.value)}`}>
                {c.value}
              </div>
              <div className="mt-0.5 text-micro leading-tight text-faint">{c.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── CARD 2: the to-do list, most urgent first ── */}
      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h3 className="font-display text-[15px] font-600 text-heading">Requires Attention</h3>
            <p className="text-micro text-faint">Where to follow up today, most urgent first.</p>
          </div>
          <Pill dot={false} label={String(attention.length)}
            tone={attention.length > 0 ? "danger" : "success"} />
        </div>
        {attention.length === 0 ? (
          <Empty title="Nothing needs chasing"
            hint="Every team is either on track or has submitted." />
        ) : (
          <ul className="divide-y divide-line">
            {attention.slice(0, 20).map((a) => (
              <li key={a.row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
                <span className="w-[120px] shrink-0 text-[13px] font-medium text-heading">
                  {a.row.category}
                </span>
                <span className="w-[150px] shrink-0 text-micro text-muted">
                  {fmtDate(a.row.week_start)} – {fmtDate(a.row.week_end)}
                </span>
                <span className="text-tiny text-danger-700">
                  Missing inputs: <span className="font-medium tabular-nums">{a.missing}</span>
                </span>
                <span className={`text-tiny ${a.daysPast >= 1 ? "text-danger-700" : "text-warning-700"}`}>
                  {a.deadlineText}
                </span>
                <span className="ml-auto">
                  <Pill dot={false} label={HEALTH_LABEL[a.health]} tone={HEALTH_TONE[a.health]} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {attention.length > 20 && (
          <p className="px-5 pb-3 text-micro text-faint">
            Showing the 20 most urgent of {attention.length}.
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── CARD 3: who must submit next ── */}
        <Card pad={false}>
          <div className="border-b border-line px-5 py-3.5">
            <h3 className="font-display text-[15px] font-600 text-heading">Deadline Calendar</h3>
            <p className="text-micro text-faint">Who must submit next.</p>
          </div>
          {calendar.length === 0 ? (
            <Empty title="No upcoming deadlines" hint="Nothing falls due in the next two weeks." />
          ) : (
            <ul className="divide-y divide-line">
              {calendar.map((g) => (
                <li key={g.days} className="flex items-start gap-4 px-5 py-2.5">
                  <span className={`w-[92px] shrink-0 text-tiny font-medium ${
                    g.days <= 1 ? "text-warning-700" : "text-heading"}`}>
                    {g.label}
                  </span>
                  <span className="min-w-0 flex-1 text-tiny text-body">
                    {g.categories.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── CARD 4: default tracker, feeding the Executive KPI ── */}
        <Card pad={false}>
          <div className="border-b border-line px-5 py-3.5">
            <h3 className="font-display text-[15px] font-600 text-heading">Default Tracker</h3>
            <p className="text-micro text-faint">
              Expected against actual inputs, per campaign week.
            </p>
          </div>
          {defaulting.length === 0 ? (
            <Empty title="No shortfalls" hint="Every week has its full set of inputs." />
          ) : (
            <table className="w-full">
              <thead>
                <tr><th>Category</th><th>Week</th><th>Expected</th><th>Submitted</th><th>Default %</th></tr>
              </thead>
              <tbody>
                {defaulting.slice(0, 12).map((r) => {
                  const pct = defaultPercent(r);
                  return (
                    <tr key={r.id}>
                      <td className="text-tiny font-medium text-heading">{r.category}</td>
                      <td className="whitespace-nowrap text-micro text-muted">
                        {fmtDate(r.week_start)} – {fmtDate(r.week_end)}
                      </td>
                      <td className="text-tiny tabular-nums text-muted">{r.pn_count}</td>
                      <td className="text-tiny tabular-nums text-muted">{r.submitted_count}</td>
                      <td>
                        <Pill dot={false} label={`${pct}%`}
                          tone={pct >= 25 ? "danger" : pct > 0 ? "warning" : "success"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ── CARD 6: the full accountability view ── */}
      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h3 className="font-display text-[15px] font-600 text-heading">Team Accountability</h3>
            <p className="text-micro text-faint">Every category and campaign week, worst first.</p>
          </div>
          <Pill dot={false} label={`${accountability.length} weeks`} tone="indigo" />
        </div>
        {accountability.length === 0 ? (
          <Empty title="No SLA data yet"
            hint="Press Recalculate once campaigns exist, or wait for the nightly run." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <th>Category</th><th>Campaign Week</th><th>Progress</th>
                  <th>Required</th><th>Submitted</th><th>Missing</th>
                  <th>Deadline</th><th>Status</th><th>Default %</th><th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {accountability.map((r, i) => {
                  const src = rows.find((x) => x.category === r.category
                    && fmtDate(x.week_start) === r.week.split(" – ")[0]);
                  const done = src ? completionPercent(src) : 0;
                  return (
                    <tr key={`${r.category}-${r.week}-${i}`}>
                      <td className="text-tiny font-medium text-heading">{r.category}</td>
                      <td className="whitespace-nowrap text-micro text-muted">{r.week}</td>
                      <td>
                        {/* A bar reads faster than two numbers side by side. */}
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-[70px] overflow-hidden rounded-full bg-[#F2F4F7]">
                            <div className={`h-full rounded-full ${
                              done === 100 ? "bg-success-600"
                                : done >= 50 ? "bg-indigo-600" : "bg-warning-600"}`}
                              style={{ width: `${done}%` }} />
                          </div>
                          <span className="text-micro tabular-nums text-faint">{done}%</span>
                        </div>
                      </td>
                      <td className="text-tiny tabular-nums text-muted">{r.required}</td>
                      <td className="text-tiny tabular-nums text-muted">{r.submitted}</td>
                      <td className={`text-tiny tabular-nums ${
                        r.missing > 0 ? "font-medium text-danger-700" : "text-muted"}`}>
                        {r.missing}
                      </td>
                      <td className="whitespace-nowrap text-micro text-muted">{fmtDate(r.deadline)}</td>
                      <td>
                        <Pill dot={false} label={HEALTH_LABEL[r.health]} tone={HEALTH_TONE[r.health]} />
                      </td>
                      <td className="text-tiny tabular-nums text-muted">{r.defaultPct}%</td>
                      <td className="whitespace-nowrap text-micro text-faint">
                        {r.lastActivity ? fmtDate(r.lastActivity.slice(0, 10)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="flex items-center gap-1.5 border-t border-line px-5 py-2 text-micro text-faint">
          {Icon.check(11)}
          A default never blocks a campaign. It records the miss and lets CRM proceed.
        </p>
      </Card>
    </div>
  );
}
