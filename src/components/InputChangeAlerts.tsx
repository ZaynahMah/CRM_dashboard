"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Pill } from "./ui";
import { fmtDate, fmtRelative } from "@/lib/format";
import {
  openRedAlerts, acknowledgeAlert, type ChangeAlert,
} from "@/services/changeAlerts";
import { rememberedName, rememberName } from "@/services/sendBack";

/**
 * The red banner and list of input changes awaiting CRM review.
 *
 * Alerts come from the database trigger, so this never creates one. It is
 * CRM-only; RLS returns nothing to other roles anyway.
 *
 * Unacknowledged alerts never auto-expire — they stay until CRM clicks
 * Seen / Reviewed, which records the typed name.
 */
export function InputChangeAlerts({ onOpenCampaign }: {
  onOpenCampaign?: (id: string) => void;
}) {
  const [alerts, setAlerts] = useState<ChangeAlert[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState(() => rememberedName());
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<string>("");

  const load = useCallback(() => {
    openRedAlerts().then(setAlerts).catch(() => setAlerts([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Nothing waiting is the normal state; an empty banner would be noise.
  if (alerts.length === 0) return null;

  const shown = team ? alerts.filter((a) => a.source_team === team) : alerts;

  const ack = async (id: string) => {
    if (name.trim() === "") { setError("Enter your name first."); return; }
    setBusy(id); setError(null);
    try {
      await acknowledgeAlert(id, name);
      rememberName(name);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  return (
    <Card pad={false}>
      <button onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 rounded-t-2xl bg-danger-50 px-5 py-3 text-left">
        <span className="grid h-6 min-w-[24px] place-items-center rounded-full bg-danger-500 px-1.5 text-[11px] font-700 text-white">
          {alerts.length}
        </span>
        <span className="text-tiny font-600 text-danger-700">
          {alerts.length} input change{alerts.length === 1 ? "" : "s"} need review
        </span>
        <span className="ml-auto text-micro text-danger-700">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Your name (for Seen / Reviewed)"
              className="!m-0 !w-[240px] !py-1 !text-[12px]" />
            <select value={team} onChange={(e) => setTeam(e.target.value)}
              className="!m-0 !w-[150px] !py-1 !text-[12px]">
              <option value="">All teams</option>
              <option value="CATEGORY">Category</option>
              <option value="CONTENT">Content</option>
            </select>
            <span className="text-micro text-faint">
              Showing {shown.length} of {alerts.length}
            </span>
          </div>

          {error && (
            <p className="border-b border-line bg-danger-50 px-5 py-2 text-micro text-danger-700">
              {error}
            </p>
          )}

          <ul className="divide-y divide-line">
            {shown.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill dot={false} tone="danger" label={a.source_team ?? "Team"} />
                  <span className="text-tiny font-medium text-heading">
                    {a.field_label ?? "Input"}
                  </span>
                  <span className="ml-auto text-micro text-faint">
                    {fmtRelative(a.created_at)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-micro text-muted">
                  <span className="text-danger-700">{a.old_value || "(empty)"}</span>
                  {" → "}
                  <span className="text-success-700">{a.new_value || "(empty)"}</span>
                </p>
                <p className="mt-0.5 text-micro text-faint">
                  {a.changed_by_name ?? "name not provided"}
                  {a.batch_id ? " · part of a bulk change" : ""}
                </p>
                <div className="mt-1.5 flex gap-2">
                  {a.campaign_id && onOpenCampaign && (
                    <Button size="sm" variant="ghost"
                      onClick={() => onOpenCampaign(a.campaign_id!)}>
                      Open PN
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === a.id}
                    onClick={() => ack(a.id)}>
                    {busy === a.id ? "..." : "Seen / Reviewed"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
