"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { Button, Card, Empty, Loading, PageHead, Pill } from "@/components/ui";
import { fmtDate, fmtRelative } from "@/lib/format";
import {
  listDays, dayStatus, dayBlockers, downloadDayBackup, deleteDay,
  listDeleteAudit, rememberedStorageName, rememberStorageName,
  type DayStatus, type Blocker, type DayAudit, type BackupResult,
} from "@/services/storageDays";

/**
 * Storage — CRM deletes days whose PNs are all on the calendar.
 *
 * CRM only. The route guard and `accessPolicy` keep other roles out of the
 * page, and every function behind it is CRM-only in Postgres, so hiding the
 * nav item is convenience, not the control.
 *
 * Deletion is permanent and there is NO snapshot: the warning below says
 * exactly what disappears, and links to the calendar export first.
 */
export default function StoragePage() {
  const { profile } = useSession();
  const [days, setDays] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, DayStatus>>({});
  const [blockers, setBlockers] = useState<Record<string, Blocker[]>>({});
  const [audit, setAudit] = useState<DayAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupResult | null>(null);
  const [typed, setTyped] = useState("");
  const [name, setName] = useState(() => rememberedStorageName());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await listDays();
      setDays(d);
      const s: Record<string, DayStatus> = {};
      for (const day of d) {
        const st = await dayStatus(day);
        if (st) s[day] = st;
      }
      setStatus(s);
      setAudit(await listDeleteAudit());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!profile) return null;
  if (profile.role !== "CRM") {
    return <Card><Empty title="Not available"
      hint="Storage is a CRM-only page." /></Card>;
  }
  if (loading) return <Loading label="Reading days" />;

  const showBlockers = async (day: string) => {
    if (blockers[day]?.length) { setBlockers((b) => ({ ...b, [day]: [] })); return; }
    try {
      const rows = await dayBlockers(day);
      setBlockers((b) => ({ ...b, [day]: rows }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runDelete = async (day: string) => {
    if (!backup) return;
    setBusy(true); setError(null);
    try {
      const n = await deleteDay(day, backup.sha, backup.fileName, name);
      rememberStorageName(name);
      setDone(`${day}: ${n} PN${n === 1 ? "" : "s"} deleted.`);
      setOpen(null); setBackup(null); setTyped("");
      await load();
    } catch (e) {
      // Never a success message for a failed delete.
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <PageHead eyebrow="Storage" title="Delete finished days"
        sub="A day can be deleted only when every one of its PNs is on the calendar." />

      <Card>
        <p className="text-tiny font-600 text-danger-700">
          Deleting a day is permanent. There is no snapshot.
        </p>
        <ul className="mt-2 space-y-1 text-micro text-muted">
          <li>• That day disappears from the <strong>Calendar</strong> and <strong>Final View</strong>.</li>
          <li>• It disappears from <strong>every export</strong>, including the date-range calendar export.</li>
          <li>• <strong>Executive numbers</strong> change: filled and defaulted counts, the deadlines table and Default Rate all read these rows.</li>
          <li>• <strong>Reset last upload</strong> keeps the batch record but its PNs are gone, so it will report nothing to reset.</li>
          <li>• Activity, QC checklists, change requests, notifications and CRM decisions for those PNs are removed too.</li>
        </ul>
        <p className="mt-2 text-micro text-muted">
          Export first: <a href="/final-view" className="font-medium text-indigo-700 hover:underline">
            Final View → Export date range</a>.
        </p>
        <p className="mt-2 text-micro text-faint">
          Freed space does not show immediately — Postgres reuses it internally
          until a vacuum runs.
        </p>
      </Card>

      {error && (
        <Card><p className="text-tiny text-danger-700">{error}</p></Card>
      )}
      {done && (
        <Card><p className="text-tiny text-success-700">{done}</p></Card>
      )}

      {days.length === 0 ? (
        <Card><Empty title="No PNs" hint="There is nothing stored yet." /></Card>
      ) : (
        <Card pad={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th>Day</th><th>PNs</th><th>On calendar</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const s = status[day];
                if (!s) return null;
                const isOpen = open === day;
                return (
                  <tr key={day}>
                    <td className="text-tiny font-medium text-heading">{fmtDate(day)}</td>
                    <td className="text-tiny tabular-nums">{s.total_pns}</td>
                    <td className="text-tiny tabular-nums">{s.on_calendar}</td>
                    <td>
                      {s.eligible ? (
                        <Pill dot={false} tone="success" label="Ready to delete" />
                      ) : (
                        <div className="space-y-1">
                          <span className="text-micro text-warning-700">
                            Not ready: {s.blocking} PN{s.blocking === 1 ? "" : "s"} not on calendar
                          </span>
                          <div className="flex flex-wrap gap-2 text-micro text-faint">
                            {s.still_with_category > 0 && <span>Category {s.still_with_category}</span>}
                            {s.still_with_content > 0 && <span>Content {s.still_with_content}</span>}
                            {s.pending_crm > 0 && <span>CRM review {s.pending_crm}</span>}
                          </div>
                          <button onClick={() => void showBlockers(day)}
                            className="text-micro font-medium text-indigo-700 hover:underline">
                            {blockers[day]?.length ? "Hide" : "Show"} blocking PNs
                          </button>
                          {blockers[day]?.length ? (
                            <ul className="mt-1 space-y-0.5">
                              {blockers[day].map((b) => (
                                <li key={b.id} className="text-micro text-muted">
                                  <a href={`/campaigns?open=${b.id}`}
                                    className="text-indigo-700 hover:underline">
                                    {b.campaign_name}
                                  </a>{" "}
                                  · slot {b.slot_label ?? "—"} · {b.content_status}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td>
                      {s.eligible && !isOpen && (
                        <Button size="sm" variant="ghost"
                          onClick={() => { setOpen(day); setBackup(null);
                                           setTyped(""); setError(null); }}>
                          Delete this day
                        </Button>
                      )}
                      {isOpen && (
                        <div className="space-y-2 py-2">
                          <Button size="sm" variant="ghost" disabled={busy}
                            onClick={async () => {
                              setError(null);
                              try { setBackup(await downloadDayBackup(day)); }
                              catch (e) {
                                setError(e instanceof Error ? e.message : String(e));
                              }
                            }}>
                            {backup ? "Backup downloaded — download again" : "1. Download backup"}
                          </Button>

                          {backup && (
                            <p className="text-micro text-success-700">
                              {Object.entries(backup.counts)
                                .filter(([, n]) => n > 0)
                                .map(([t, n]) => `${t} ${n}`).join(" · ")}
                            </p>
                          )}

                          <input value={name} onChange={(e) => setName(e.target.value)}
                            placeholder="2. Your name"
                            className="!m-0 !w-[200px] !py-1 !text-[12px]" />
                          <input value={typed} onChange={(e) => setTyped(e.target.value)}
                            placeholder={`3. Type ${day}`}
                            className="!m-0 !w-[200px] !py-1 !font-mono !text-[12px]" />

                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" disabled={busy}
                              onClick={() => { setOpen(null); setBackup(null); }}>
                              Cancel
                            </Button>
                            <Button size="sm" variant="danger"
                              disabled={busy || !backup || typed !== day || name.trim() === ""}
                              onClick={() => void runDelete(day)}>
                              {busy ? "Deleting..." : `Delete ${s.total_pns} PNs`}
                            </Button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {audit.length > 0 && (
        <Card pad={false}>
          <div className="border-b border-line px-5 py-3.5">
            <h3 className="font-display text-[15px] font-600 text-heading">
              Deletion history
            </h3>
          </div>
          <ul className="divide-y divide-line">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                <span className="text-tiny font-medium text-heading">
                  {fmtDate(a.launch_date)}
                </span>
                <span className="text-micro text-muted">
                  {a.campaigns_removed} PN{a.campaigns_removed === 1 ? "" : "s"}
                </span>
                <span className="ml-auto text-micro text-faint">
                  {a.performed_name} · {fmtRelative(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
