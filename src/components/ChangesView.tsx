"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Pill } from "./ui";
import { fmtDate, fmtRelative, slotDisplay } from "@/lib/format";
import type { Campaign } from "@/types/campaign";
import {
  CAMPAIGN_CATEGORY_FILTER_OPTIONS, matchesCategoryFilter,
} from "@/lib/categoryFilter";
import {
  listRequests, groupRequests, decideChangeGroup, withdrawChangeGroup,
  FIELD_LABEL, markChangesSeen, rememberedRequestName, rememberRequestName,
  type ChangeRequestGroup, type RequestStatus,
} from "@/services/changeRequests";

const TABS: { key: RequestStatus; label: string }[] = [
  { key: "PENDING",   label: "Pending" },
  { key: "APPROVED",  label: "Accepted" },
  { key: "REJECTED",  label: "Rejected" },
  { key: "WITHDRAWN", label: "Withdrawn" },
];

/**
 * The Changes page, shared by every role.
 *
 * CRM and Executive see all requests; Category and Content see only their
 * own — enforced by RLS (migration 42), not by this component. Executive is
 * read-only: no Accept, Reject or Withdraw.
 *
 * Status, date and category are applied IN THE QUERY. With many requests a
 * client-side pass would fetch everything and discard most of it.
 */
export function ChangesView({ role, campaigns, onChanged, onOpenCampaign }: {
  role: string;
  campaigns: Campaign[];
  onChanged: () => void;
  onOpenCampaign?: (id: string) => void;
}) {
  const isCrm = role === "CRM";
  const readOnly = role === "EXECUTIVE";

  const [tab, setTab] = useState<RequestStatus>("PENDING");
  const [groups, setGroups] = useState<ChangeRequestGroup[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState(() => rememberedRequestName());
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The category filter is a PN property, so it resolves to campaign ids. */
  const campaignIds = useMemo(() => {
    if (cats.length === 0) return undefined;
    return campaigns
      .filter((c) => cats.some((cat) => matchesCategoryFilter(c.category, cat)))
      .map((c) => c.id);
  }, [cats, campaigns]);

  const load = useCallback(() => {
    listRequests({ status: tab, campaignIds, from: from || undefined, to: to || undefined })
      .then((rows) => setGroups(groupRequests(rows)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [tab, campaignIds, from, to]);

  useEffect(() => { load(); }, [load]);
  // Opening the page clears the "new decisions" badge.
  useEffect(() => { markChangesSeen(); }, []);

  const decide = async (g: ChangeRequestGroup, accept: boolean) => {
    if (name.trim() === "") { setError("Enter your name first."); return; }
    if (!accept && !(note[g.groupId] ?? "").trim()) {
      setError("A reason is required when rejecting.");
      return;
    }
    if (!g.groupId) {
      setError("This is an older single-field request — use the list below.");
      return;
    }
    setBusy(g.groupId); setError(null);
    try {
      await decideChangeGroup(g.groupId, accept, name, note[g.groupId]);
      rememberRequestName(name);
      load(); onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const withdraw = async (g: ChangeRequestGroup) => {
    if (name.trim() === "") { setError("Enter your name first."); return; }
    setBusy(g.groupId); setError(null);
    try {
      await withdrawChangeGroup(g.groupId, name);
      rememberRequestName(name);
      load(); onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-tiny font-medium ${
              tab === t.key ? "bg-indigo-50 text-indigo-700" : "text-muted hover:bg-[#F9FAFB]"}`}>
            {t.label}{tab === t.key ? ` (${groups.length})` : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        <select multiple value={cats}
          onChange={(e) => setCats([...e.target.selectedOptions].map((o) => o.value))}
          className="!m-0 !h-[66px] !w-[190px] !py-1 !text-[12px]">
          {CAMPAIGN_CATEGORY_FILTER_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          aria-label="From" className="!m-0 !w-[140px] !py-1 !text-[12px]" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          aria-label="To" className="!m-0 !w-[140px] !py-1 !text-[12px]" />
        {(cats.length > 0 || from || to) && (
          <Button size="sm" variant="ghost"
            onClick={() => { setCats([]); setFrom(""); setTo(""); }}>
            Clear
          </Button>
        )}
        {!readOnly && (
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="!m-0 !ml-auto !w-[200px] !py-1 !text-[12px]" />
        )}
      </div>

      {error && (
        <p className="border-b border-line bg-danger-50 px-5 py-2 text-tiny text-danger-700">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <Empty title="Nothing here"
          hint={tab === "PENDING" ? "No change requests are waiting." : "Nothing with this status."} />
      ) : (
        <ul className="divide-y divide-line">
          {groups.map((g) => {
            const c = campaigns.find((x) => x.id === g.campaignId);
            const head = g.rows[0];
            return (
              <li key={g.groupId || head.id} className="px-5 py-3.5">
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
                      <span className="text-danger-700">{r.current_value?.trim() || "(empty)"}</span>
                      {" → "}
                      <span className="text-success-700">{r.requested_value?.trim() || "(empty)"}</span>
                    </li>
                  ))}
                </ul>

                {head.status !== "PENDING" && (
                  <p className="mt-1.5 text-micro text-faint">
                    {head.status === "APPROVED" ? "Accepted" :
                     head.status === "REJECTED" ? "Rejected" : "Withdrawn"}
                    {head.reviewed_by_name ? ` by ${head.reviewed_by_name}` : ""}
                    {head.reviewed_at ? ` · ${fmtRelative(head.reviewed_at)}` : ""}
                    {head.review_note ? ` — ${head.review_note}` : ""}
                  </p>
                )}

                {!readOnly && head.status === "PENDING" && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {c && onOpenCampaign && (
                      <Button size="sm" variant="ghost"
                        onClick={() => onOpenCampaign(c.id)}>Open PN</Button>
                    )}
                    {isCrm ? (
                      <>
                        <input value={note[g.groupId] ?? ""}
                          onChange={(e) => setNote((n) => ({ ...n, [g.groupId]: e.target.value }))}
                          placeholder="Reason (required to reject)"
                          className="!m-0 !w-[240px] !py-1 !text-[12px]" />
                        <Button size="sm" disabled={busy === g.groupId}
                          onClick={() => decide(g, true)}>
                          {busy === g.groupId ? "..." : `Accept (${g.rows.length})`}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy === g.groupId}
                          onClick={() => decide(g, false)}>
                          Reject
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy === g.groupId}
                        onClick={() => withdraw(g)}>
                        {busy === g.groupId ? "..." : "Withdraw"}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
