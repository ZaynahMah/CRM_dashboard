"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { log } from "@/services/campaigns";
import { fmtDate, fmtTime } from "@/lib/format";
import { Button, Card, Pill } from "./ui";
import { Icon } from "./icons";
import type { Campaign } from "@/types/campaign";

interface ParsedRow { day: string; time: string; segment: string; category: string }

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length >= 4) {
      rows.push({ day: cols[0], time: cols[1], segment: cols[2], category: cols[3] });
    }
  }
  return rows;
}

function normalizeDate(raw: string): string {
  // Accept formats like "1 Sep", "01-09-2026", "2026-09-01", "1 Sep 2026"
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // Try "1 Sep" or "1 Sep 2026"
  const parts = raw.split(/[\s-/]+/);
  const months: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  if (parts.length >= 2) {
    const day = parseInt(parts[0]);
    const mon = months[parts[1].toLowerCase().slice(0, 3)];
    const year = parts[2] ? parseInt(parts[2]) : 2026;
    if (day && mon) return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return raw;
}

function normalizeTime(raw: string): string {
  // Accept "9:00 AM", "09:00", "9:30 AM" etc.
  const clean = raw.toUpperCase().trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return raw;
  let h = parseInt(match[1]);
  const m = match[2];
  const ampm = match[3];
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}

export function ExcelUpload({ profileId, onDone }: { profileId: string; onDone: () => void }) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setSent(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      setParsed(rows);
    };
    reader.readAsText(file);
  }, []);

  const handleSend = async () => {
    setSending(true);
    try {
      const campaigns = parsed.map((r) => ({
        campaign_name: `${r.segment} · ${r.category}`,
        campaign_origin: "CRM_PLANNED" as const,
        launch_date: normalizeDate(r.day),
        launch_time: normalizeTime(r.time),
        pncc_segment_label: r.segment,
        pncc_category_code: r.category,
        category: r.category,
        slot_type: "STANDARD",
        category_status: "EMPTY" as const,
        crm_status: "AWAITING_REVIEW" as const,
        content_status: "NOT_ASSIGNED" as const,
        qc_status: "PENDING" as const,
        production_status: "NOT_READY" as const,
        priority: "NORMAL" as const,
        created_by: profileId,
      }));

      for (let i = 0; i < campaigns.length; i += 100) {
        const { error } = await supabase.from("campaigns").insert(campaigns.slice(i, i + 100));
        if (error) throw error;
      }

      await log(null, profileId, "EXCEL_UPLOAD", `Uploaded ${campaigns.length} campaigns from ${fileName} and sent to Category.`);
      setSent(true);
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
    }
    setSending(false);
  };

  const dates = [...new Set(parsed.map((r) => r.day))];

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-[15px] font-600 text-heading">Upload September Excel</h3>
          <p className="mt-0.5 text-micro text-faint">
            Upload a CSV with columns: Day, Time Slot, Segment, Category (7 days at a time)
          </p>
        </div>
        <label className="cursor-pointer">
          <Button variant="ghost" className="pointer-events-none">{Icon.chart(13)} Choose file</Button>
          <input type="file" accept=".csv,.txt" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      </div>

      {parsed.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Pill dot={false} label={fileName} tone="indigo" />
            <span className="text-tiny text-muted">{parsed.length} rows · {dates.length} days ({dates[0]} to {dates[dates.length - 1]})</span>
          </div>

          <div className="max-h-[300px] overflow-auto rounded-lg border border-line">
            <table className="w-full">
              <thead><tr><th>Day</th><th>Time</th><th>Segment</th><th>Category</th></tr></thead>
              <tbody>
                {parsed.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td className="text-tiny font-medium">{r.day}</td>
                    <td className="text-tiny text-muted">{r.time}</td>
                    <td><Pill dot={false} label={r.segment} tone="indigo" /></td>
                    <td><Pill dot={false} label={r.category} tone="neutral" /></td>
                  </tr>
                ))}
                {parsed.length > 50 && (
                  <tr><td colSpan={4} className="text-center text-micro text-faint">+{parsed.length - 50} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {sent ? (
            <div className="flex items-center gap-2 rounded-lg bg-success-50 px-4 py-3 text-tiny text-success-700">
              {Icon.check(14)} {parsed.length} campaigns uploaded and sent to Category Team.
            </div>
          ) : (
            <Button onClick={handleSend} disabled={sending}>
              {sending ? "Sending..." : `Send ${parsed.length} campaigns to Category Team`}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
