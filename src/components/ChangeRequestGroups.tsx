"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Pill } from "./ui";
import { fmtDate, fmtRelative, slotDisplay } from "@/lib/format";
import type { Campaign } from "@/types/campaign";
import {
  listPendingRequests, groupRequests, decideChangeGroup, FIELD_LABEL,
  rememberedRequestName, rememberRequestName, type ChangeRequestGroup,
} from "@/services/changeRequests";

/**
 * CRM's view of multi-field change requests (migration 38).
 *
 * One card per request, not per field, so a team's single save is reviewed
 * as one decision. Accept applies every field in the group and, when the PN
 * had been reviewed, returns it to Pending CRM Review.
 */
export function ChangeRequestGroups({ campaigns, onChanged }: {
  campaigns: Campaign[];
  onChanged: () => void;
}) {
  const [groups, setGroups] = useState<ChangeRequestGroup[]>([]);
  const [name, setName] = useState(() => rememberedRequestName());
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listPendingRequests()
      .then((rows) => setGroups(groupRequests(rows)))
      .catch(() => setGroups([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (groups.length === 0) return null;

  const decide = async (g: ChangeRequestGroup, accept: boolean) => {
    if (name.trim() === "") { setError("Enter your name first."); return; }
    if (!g.groupId) {
      setError("This is an older single-field request — use the list below.");
      return;
    }
    setBusy(g.groupId); setError(null);
    try {
      await decideChangeGroup(g.groupId, accept, name, note[g.groupId]);
      rememberRequestName(name);
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <h3 className="font-display text-[15px] font-600 text-heading">
          Change requests ({groups.length})
        </h3>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Your name (required to decide)"
          className="!m-0 !w-[230px] !py-1 !text-[12px]" />
        {error && <span className="text-micro text-danger-700">{error}</span>}
      </div>

      <ul className="divide-y divide-line">
        {groups.map((g) => {
          const c = campaigns.find((x) => x.id === g.campaignId);
          return (
            <li key={g.groupId || g.rows[0].id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill dot={false} tone="warning" label={g.team} />
                <span className="text-tiny font-600 text-heading">
                  {c?.campaign_name ?? "PN"}
                </span>
                <span className="text-micro text-muted">
                  {c?.launch_date ? fmtDate(c.launch_date) : "no date"}
                  {c?.launch_time ? ` · ${c.launch_time.slice(0, 5)}` : ""}
                  {c ? ` · slot ${slotDisplay(c)}` : ""}
                  {c?.category ? ` · ${c.category}` : ""}
                  {c?.brand ? ` · ${c.brand}` : ""}
                </span>
                <span className="ml-auto text-micro text-faint">
                  {g.byName} · {fmtRelative(g.createdAt)}
                </span>
              </div>

              {g.reason && (
                <p className="mt-1 text-micro text-muted">Reason: {g.reason}</p>
              )}

              <ul className="mt-2 space-y-1">
                {g.rows.map((r) => (
                  <li key={r.id} className="text-micro">
                    <span className="font-medium text-heading">
                      {FIELD_LABEL[r.field_name] ?? r.field_name}:
                    </span>{" "}
                    <span className="text-danger-700">
                      {r.current_value?.trim() || "(empty)"}
                    </span>
                    {" → "}
                    <span className="text-success-700">
                      {r.requested_value?.trim() || "(empty)"}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <input value={note[g.groupId] ?? ""}
                  onChange={(e) => setNote((n) => ({ ...n, [g.groupId]: e.target.value }))}
                  placeholder="Reason if rejecting (optional)"
                  className="!m-0 !w-[260px] !py-1 !text-[12px]" />
                <Button size="sm" disabled={busy === g.groupId}
                  onClick={() => decide(g, true)}>
                  {busy === g.groupId ? "..." : `Accept (${g.rows.length})`}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === g.groupId}
                  onClick={() => decide(g, false)}>
                  Reject
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
