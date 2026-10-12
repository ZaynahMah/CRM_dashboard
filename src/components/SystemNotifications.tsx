"use client";

import type { SystemNotification } from "@/services/categorySla";
import { Card, Pill, Empty } from "./ui";
import { fmtDate } from "@/lib/format";

/**
 * The shared notification centre — a NEW component.
 *
 * Every role sees the SAME list: CRM, Category, Content and Executive. The
 * existing per-role `notifications` table is untouched and still carries
 * workflow assignments; this is the system-wide feed, which is why it has
 * its own table.
 */

const TONE: Record<string, "success" | "warning" | "danger" | "indigo" | "neutral"> = {
  DEADLINE_SOON: "warning",
  DEADLINE_MISSED: "danger",
  CRM_OVERRIDE: "indigo",
  SUBMITTED_EARLY: "success",
};

export function SystemNotifications({ notifications }: {
  notifications: SystemNotification[];
}) {
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <h3 className="font-display text-[15px] font-600 text-heading">Notifications</h3>
          <p className="text-micro text-faint">Shared by every role — everyone sees the same list.</p>
        </div>
        <Pill dot={false} label={String(notifications.length)} tone="indigo" />
      </div>

      {notifications.length === 0 ? (
        <Empty title="No notifications" hint="Deadline reminders and defaults appear here." />
      ) : (
        <ul className="divide-y divide-line">
          {notifications.map((n) => (
            <li key={n.id} className="px-5 py-3">
              <div className="flex items-start gap-2.5">
                <Pill dot={false} label={n.kind.replace(/_/g, " ").toLowerCase()}
                  tone={TONE[n.kind] ?? "neutral"} />
                <div className="min-w-0 flex-1">
                  <div className="text-tiny font-medium text-heading">{n.title}</div>
                  <div className="text-micro text-muted">{n.body}</div>
                </div>
                <span className="shrink-0 whitespace-nowrap text-micro text-faint">
                  {fmtDate(n.created_at.slice(0, 10))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
