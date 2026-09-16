"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { populateMonth, isMonthPopulated } from "@/services/populate";
import { listCampaigns, log, updateCampaign } from "@/services/campaigns";
import { fmtTime, fmtDate, isoDate } from "@/lib/format";
import { SearchSelect } from "./SearchSelect";
import { Button, Card, Loading, Modal, Pill, Field } from "./ui";
import { Icon } from "./icons";
import masterData from "@/data/masterData.json";
import type { Campaign } from "@/types/campaign";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

interface Props {
  year: number;
  month: number; // 0-indexed
  profileId: string;
  onClose: () => void;
  onDone: () => void;
}

export function MonthlyInputSheet({ year, month, profileId, onClose, onDone }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [populating, setPopulating] = useState(false);
  const [sending, setSending] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [filterTime, setFilterTime] = useState("");
  const monthName = MONTH_NAMES[month];
  const from = isoDate(new Date(year, month, 1));
  const to = isoDate(new Date(year, month + 1, 0));

  const loadData = useCallback(async () => {
    setLoading(true);
    const all = await listCampaigns();
    setCampaigns(all.filter((c) => c.launch_date >= from && c.launch_date <= to));
    setLoading(false);
  }, [from, to]);

  useEffect(() => { loadData(); }, [loadData]);

  const handlePopulate = async () => {
    setPopulating(true);
    try {
      const existing = await isMonthPopulated(year, month);
      if (existing > 100) {
        alert(`${monthName} already has ${existing} campaigns. Clear first or use existing data.`);
        setPopulating(false);
        return;
      }
      await populateMonth(year, month, profileId);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to populate");
    }
    setPopulating(false);
  };

  const handleSendToCategory = async () => {
    setSending(true);
    try {
      const batch = campaigns.filter((c) => c.crm_status === "NOT_STARTED");
      for (let i = 0; i < batch.length; i += 50) {
        const slice = batch.slice(i, i + 50);
        await Promise.all(slice.map((c) =>
          updateCampaign(c.id, { crm_status: "AWAITING_REVIEW" })
        ));
      }
      if (batch.length > 0) {
        await log(null, profileId, "CRM_BULK_SEND",
          `CRM sent ${batch.length} ${monthName} campaign slots to Category.`);
      }
      await loadData();
      alert(`${batch.length} campaigns sent to Category.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to send");
    }
    setSending(false);
  };

  const handleUpdateCell = async (id: string, field: string, value: string) => {
    await updateCampaign(id, { [field]: value || null } as Partial<Campaign>);
    setCampaigns((prev) =>
      prev.map((c) => c.id === id ? { ...c, [field]: value || null } as Campaign : c)
    );
  };

  const handleAddSlot = async (date: string, time: string) => {
    const { data, error } = await supabase.from("campaigns").insert({
      campaign_name: "Additional slot",
      campaign_origin: "CRM_PLANNED",
      launch_date: date,
      launch_time: time,
      slot_type: "ADDITIONAL",
      category_status: "EMPTY",
      crm_status: "NOT_STARTED",
      content_status: "NOT_ASSIGNED",
      qc_status: "PENDING",
      production_status: "NOT_READY",
      priority: "NORMAL",
      created_by: profileId,
    }).select().single();
    if (!error && data) {
      setCampaigns((prev) => [...prev, data as Campaign]);
    }
  };

  const handleDeleteSlot = async (id: string) => {
    await supabase.from("campaigns").delete().eq("id", id);
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  };

  // Group by date, then by time
  const grouped = useMemo(() => {
    let filtered = campaigns;
    if (filterDate) filtered = filtered.filter((c) => c.launch_date === filterDate);
    if (filterTime) filtered = filtered.filter((c) => c.launch_time === filterTime);

    const byDate = new Map<string, Map<string, Campaign[]>>();
    filtered.forEach((c) => {
      const dateKey = c.launch_date;
      const timeKey = c.launch_time ?? "00:00";
      if (!byDate.has(dateKey)) byDate.set(dateKey, new Map());
      const timeMap = byDate.get(dateKey)!;
      if (!timeMap.has(timeKey)) timeMap.set(timeKey, []);
      timeMap.get(timeKey)!.push(c);
    });
    return byDate;
  }, [campaigns, filterDate, filterTime]);

  const dates = [...grouped.keys()].sort();
  const sentCount = campaigns.filter((c) => c.crm_status !== "NOT_STARTED").length;
  const notSent = campaigns.filter((c) => c.crm_status === "NOT_STARTED").length;

  if (loading) return <Loading label={`Loading ${monthName} data`} />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-700 text-heading">
            {monthName} {year} — Monthly Input Sheet
          </h2>
          <p className="mt-1 text-tiny text-muted">
            {campaigns.length} total slots · {sentCount} sent to Category · {notSent} not yet sent
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {campaigns.length === 0 && (
            <Button onClick={handlePopulate} disabled={populating}>
              {populating ? "Generating..." : `Generate ${monthName} Slots`}
            </Button>
          )}
          {notSent > 0 && (
            <Button onClick={handleSendToCategory} disabled={sending}>
              {sending ? "Sending..." : `Send ${notSent} slots to Category`}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
          className="!w-auto text-tiny">
          <option value="">All dates</option>
          {[...new Set(campaigns.map((c) => c.launch_date))].sort().map((d) => (
            <option key={d} value={d}>{fmtDate(d)}</option>
          ))}
        </select>
        <select value={filterTime} onChange={(e) => setFilterTime(e.target.value)}
          className="!w-auto text-tiny">
          <option value="">All times</option>
          {[...new Set(campaigns.map((c) => c.launch_time))].filter(Boolean).sort().map((t) => (
            <option key={t} value={t!}>{fmtTime(t!)}</option>
          ))}
        </select>
        <span className="text-micro text-faint">
          Showing {[...grouped.values()].reduce((a, m) => a + [...m.values()].reduce((b, arr) => b + arr.length, 0), 0)} rows
        </span>
      </div>

      {/* The sheet */}
      <Card pad={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[#F9FAFB]">Day</th>
                <th>Time</th>
                <th>Slot</th>
                <th>Segment</th>
                <th>Category</th>
                <th>Status</th>
                <th className="w-[60px]"></th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
                const timeMap = grouped.get(date)!;
                const times = [...timeMap.keys()].sort();
                return times.map((time) => {
                  const rows = timeMap.get(time)!;
                  return rows.map((c, idx) => (
                    <tr key={c.id} className={idx === 0 && idx === rows.length - 1 ? "" : ""}>
                      {idx === 0 && (
                        <td className="sticky left-0 z-10 bg-surface font-medium text-heading"
                          rowSpan={rows.length}>
                          {fmtDate(date)}
                        </td>
                      )}
                      {idx === 0 && (
                        <td className="text-tiny text-muted" rowSpan={rows.length}>
                          <div className="flex items-center gap-2">
                            {fmtTime(time)}
                            <button
                              onClick={() => handleAddSlot(date, time)}
                              title="Add slot at this time"
                              className="rounded bg-indigo-50 px-1 py-0.5 text-[10px] font-600 text-indigo-700 hover:bg-indigo-100">
                              +
                            </button>
                          </div>
                        </td>
                      )}
                      <td className="text-micro text-faint">
                        {idx + 1}
                        {c.slot_type === "ADDITIONAL" && (
                          <Pill dot={false} label="Extra" tone="info" />
                        )}
                      </td>
                      <td className="min-w-[160px]">
                        <SearchSelect value={c.pncc_segment_label ?? ""}
                          onChange={(v) => handleUpdateCell(c.id, "pncc_segment_label", v)}
                          options={(masterData as any).segments ?? []}
                          placeholder="Segment" />
                      </td>
                      <td className="min-w-[140px]">
                        <SearchSelect value={c.pncc_category_code ?? c.category ?? ""}
                          onChange={(v) => handleUpdateCell(c.id, "pncc_category_code", v)}
                          options={(masterData as any).categories ?? []}
                          placeholder="Category" />
                      </td>
                      <td>
                        <Pill dot label={
                          c.crm_status === "NOT_STARTED" ? "Draft"
                          : c.crm_status === "AWAITING_REVIEW" ? "Sent"
                          : "Active"
                        } tone={
                          c.crm_status === "NOT_STARTED" ? "neutral"
                          : c.crm_status === "AWAITING_REVIEW" ? "success"
                          : "indigo"
                        } />
                      </td>
                      <td>
                        <button onClick={() => handleDeleteSlot(c.id)}
                          className="rounded p-1 text-faint hover:bg-danger-50 hover:text-danger-700"
                          title="Remove slot">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  ));
                });
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
