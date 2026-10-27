"use client";

import { useMemo, useState } from "react";
import { Card, Empty, PageHead, Pill, Tabs } from "@/components/ui";
import cohorts from "@/data/cohort_informations.json";

/**
 * Audience — a read-only reference for every role.
 *
 * Reads `src/data/cohort_informations.json` directly. No Supabase table, no
 * upload: to update it, edit that file. Values are shown verbatim, including
 * the CRM team's own spellings.
 */

interface Segment { segment_name: string; base_size: string; definition: string }
interface TcSegment { segment: string; segment_name_in_tc: string }

const SEGMENTS = cohorts.segment_directory as Segment[];
const TC = cohorts.tc_segments as TcSegment[];
const DEFS = cohorts.cohort_definitions;

export default function AudiencePage() {
  const [tab, setTab] = useState("directory");
  const [q, setQ] = useState("");
  const [tcQ, setTcQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return SEGMENTS;
    // Searches the name AND the definition, as specified.
    return SEGMENTS.filter((s) =>
      s.segment_name.toLowerCase().includes(t) || s.definition.toLowerCase().includes(t));
  }, [q]);

  const filteredTc = useMemo(() => {
    const t = tcQ.trim().toLowerCase();
    if (!t) return TC;
    return TC.filter((s) =>
      s.segment.toLowerCase().includes(t) || s.segment_name_in_tc.toLowerCase().includes(t));
  }, [tcQ]);

  const toggle = (name: string) => setOpen((p) => {
    const n = new Set(p);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });

  /** First two lines, with the rest hidden until expanded. */
  const preview = (d: string) => d.split("\n").slice(0, 2).join("\n");
  const hasMore = (d: string) => d.split("\n").length > 2 || d.length > 220;

  return (
    <div className="space-y-5">
      <PageHead title="Audience"
        sub="Segment reference for CRM planning. Read-only — maintained in cohort_informations.json." />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: "directory", label: "Segment Directory", count: SEGMENTS.length },
        { key: "tc", label: "TC Segments", count: TC.length },
        { key: "defs", label: "Cohort Definitions" },
      ]} />

      {tab === "directory" && (
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search segment name or definition"
              className="!m-0 !w-[320px] !py-1.5 !text-[13px]" />
            <span className="text-micro text-faint">
              {filtered.length} of {SEGMENTS.length}
            </span>
          </div>
          {filtered.length === 0 ? (
            <Empty title="No segments match" hint="Try a shorter search term." />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="w-[280px]">Segment Name (MoEngage)</th>
                  <th className="w-[100px]">Base Size</th>
                  <th>Definition</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const expanded = open.has(s.segment_name);
                  const more = hasMore(s.definition);
                  return (
                    <tr key={s.segment_name} className="align-top">
                      <td className="text-tiny font-medium text-heading">{s.segment_name}</td>
                      <td className="whitespace-nowrap text-tiny tabular-nums text-muted">
                        {s.base_size}
                      </td>
                      <td>
                        {/* whitespace-pre-wrap preserves the "and exclude
                            users in" line break exactly as written. */}
                        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-muted">
                          {expanded || !more ? s.definition : preview(s.definition)}
                        </p>
                        {more && (
                          <button onClick={() => toggle(s.segment_name)}
                            className="mt-1 text-micro font-medium text-indigo-700 hover:underline">
                            {expanded ? "Show less" : "Show full definition"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "tc" && (
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <input value={tcQ} onChange={(e) => setTcQ(e.target.value)}
              placeholder="Search segment"
              className="!m-0 !w-[320px] !py-1.5 !text-[13px]" />
            <span className="text-micro text-faint">{filteredTc.length} of {TC.length}</span>
          </div>
          {filteredTc.length === 0 ? (
            <Empty title="No segments match" hint="Try a shorter search term." />
          ) : (
            <table className="w-full">
              <thead><tr><th>Segment</th><th>Segment Name in TC</th></tr></thead>
              <tbody>
                {filteredTc.map((s) => (
                  <tr key={s.segment_name_in_tc}>
                    <td className="text-tiny font-medium text-heading">{s.segment}</td>
                    <td className="font-mono text-[12px] text-muted">{s.segment_name_in_tc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "defs" && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {[DEFS.push, DEFS.in_app].map((t) => (
              <Card key={t.title} pad={false}>
                <div className="border-b border-line px-5 py-3.5">
                  <h3 className="font-display text-[15px] font-600 text-heading">{t.title}</h3>
                </div>
                <table className="w-full">
                  <thead><tr><th>Cohort</th><th>Months</th></tr></thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.cohort}>
                        <td className="text-tiny font-medium text-heading">{r.cohort}</td>
                        <td className="text-tiny text-muted">{r.months}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>

          {([
            ["Combination segments", DEFS.combination_segments],
            ["Custom segments", DEFS.custom_segments],
            ["Data segments", DEFS.data_segments],
          ] as [string, string[]][]).map(([title, list]) => (
            <Card key={title}>
              <h3 className="mb-2.5 font-display text-[15px] font-600 text-heading">{title}</h3>
              <div className="flex flex-wrap gap-1.5">
                {list.map((s) => <Pill key={s} dot={false} label={s} tone="neutral" />)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
