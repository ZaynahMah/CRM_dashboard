"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import {
  approveChange, listChangeRequests, listCampaigns, rejectChange,
  notifyChangeRequestsUpdated,
} from "@/services/campaigns";
import type { Campaign, ChangeRequest } from "@/types/campaign";
import { Button, Card, Empty, Pill, PageHead } from "@/components/ui";
import { fmtRelative, titleCase } from "@/lib/format";

export default function ChangesPage() {
  const { profile } = useSession();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [campaigns, setCampaigns] = useState<Record<string, Campaign>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([listChangeRequests(), listCampaigns()]);
    setRequests(r);
    setCampaigns(Object.fromEntries(c.map((x) => [x.id, x])));
  }, []);

  useEffect(() => { load(); }, [load]);
  if (!profile) return null;
  const isCrm = profile.role === "CRM";

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Change requests"
        title="Changes to locked submissions"
        sub="Once Category submits, the record is locked. Every edit after that point is requested, reviewed and logged."
      />

      {requests.length === 0 ? (
        <Card><Empty title="No change requests" hint="Requests raised against locked campaigns will collect here." /></Card>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const c = campaigns[r.campaign_id];
            return (
              <li key={r.id} className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="min-w-[260px] flex-1">
                    <div className="flex items-center gap-3">
                      <Pill
                        label={titleCase(r.status)}
                        tone={r.status === "PENDING" ? "warning" : r.status === "APPROVED" ? "success" : "danger"} />
                      <span className="text-micro text-faint">{fmtRelative(r.created_at)}</span>
                    </div>
                    <div className="mt-2 font-display text-[16px] font-600 text-heading">{c?.campaign_name ?? "Campaign"}</div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div>
                        <div className="text-micro font-medium uppercase tracking-wide text-faint">Field</div>
                        <div className="mt-1 text-[13.5px] text-heading">{titleCase(r.field_name)}</div>
                      </div>
                      <div>
                        <div className="text-micro font-medium uppercase tracking-wide text-faint">Current</div>
                        <div className="mt-1 text-[13.5px] text-muted line-through decoration-[#D0D5DD]">
                          {r.current_value || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-micro font-medium uppercase tracking-wide text-faint">Requested</div>
                        <div className="mt-1 text-[13.5px] font-medium text-heading">{r.requested_value || "—"}</div>
                      </div>
                    </div>

                    {r.reason && (
                      <p className="mt-4 max-w-2xl rounded-lg bg-[#F9FAFB] px-3.5 py-2.5 text-tiny text-muted">{r.reason}</p>
                    )}
                  </div>

                  {isCrm && r.status === "PENDING" && (
                    <div className="flex gap-3">
                      <Button
                        disabled={busy === r.id}
                        onClick={async () => {
                          setBusy(r.id);
                          await approveChange(r, profile.id);
                          await load();
                          // Drops the nav badge immediately, rather than on
                          // the next navigation.
                          notifyChangeRequestsUpdated();
                          setBusy(null);
                        }}>
                        Approve &amp; update
                      </Button>
                      <Button
                        variant="danger" disabled={busy === r.id}
                        onClick={async () => {
                          setBusy(r.id);
                          await rejectChange(r, profile.id);
                          await load();
                          notifyChangeRequestsUpdated();
                          setBusy(null);
                        }}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
