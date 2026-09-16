"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listChannels, listCohorts, listExclusions, listOfferFactors, listPlaybook, listPushTags, listSegments,
} from "@/services/targeting";
import type {
  Channel, Cohort, OfferFactor, OfferPlaybookEntry, PushTag, Segment, SegmentExclusion,
} from "@/types/targeting";
import {
  Card, CardHead, Empty, Loading, PageHead, Pill, StatCard, StatGrid, TableCard, Tabs,
} from "@/components/ui";
import { SplitBar } from "@/components/Charts";
import { Icon } from "@/components/icons";

const FAMILY_TONE: Record<string, "indigo" | "info" | "success" | "warning" | "neutral"> = {
  Predominance: "indigo", Behaviour: "info", Lifecycle: "success",
  Location: "warning", Search: "neutral", Value: "indigo", Email: "neutral",
};

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [exclusions, setExclusions] = useState<SegmentExclusion[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [factors, setFactors] = useState<OfferFactor[]>([]);
  const [playbook, setPlaybook] = useState<OfferPlaybookEntry[]>([]);
  const [tags, setTags] = useState<PushTag[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("segments");
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("");

  useEffect(() => {
    Promise.all([
      listSegments(), listExclusions(), listCohorts(),
      listOfferFactors(), listPlaybook(), listPushTags(), listChannels(),
    ]).then(([s, e, c, f, p, t, ch]) => {
      setSegments(s); setExclusions(e); setCohorts(c);
      setFactors(f); setPlaybook(p); setTags(t); setChannels(ch);
      setLoading(false);
    });
  }, []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return segments.filter((s) => {
      if (family && s.segment_family !== family) return false;
      if (term && ![s.display_name, s.moe_name, s.catalogue_codes, s.definition]
        .some((v) => v?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [segments, q, family]);

  const families = Array.from(new Set(segments.map((s) => s.segment_family)));
  const totalBase = segments.reduce((a, s) => a + (s.base_count ?? 0), 0);
  const pushable = segments.filter((s) => s.segment_family !== "Email");

  if (loading) return <Loading label="Loading the audience library" />;

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Targeting"
        title="Audience library"
        sub="The live MoEngage segments, the offer decision factors, and the push tag mapping that CRM works from. Editing is CRM-only; everyone else reads."
      />

      <StatGrid>
        <StatCard label="Segments" value={segments.length} icon={Icon.target(14)} tone="indigo" />
        <StatCard label="Push segments" value={pushable.length} icon={Icon.bell(14)} tone="info" />
        <StatCard label="Combined base" value={`${(totalBase / 1_000_000).toFixed(1)}M`} icon={Icon.users(14)} tone="success" />
        <StatCard label="Standard exclusions" value={exclusions.length} icon={Icon.swap(14)} tone="warning" />
      </StatGrid>

      <Card>
        <CardHead title="Channel contribution"
          sub="Share of CRM revenue by channel — push is the primary channel by a wide margin" />
        <div className="pt-1">
          <SplitBar segments={channels.slice(0, 4).map((c, i) => ({
            label: c.label,
            value: c.revenue_share,
            color: ["#6438E8", "#9B8AFB", "#D9D6FE", "#EBE9FE"][i],
          }))} />
        </div>
      </Card>

      <Card pad={false} className="overflow-hidden">
        <div className="px-5 pt-4">
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: "segments", label: "Segments", count: segments.length },
            { key: "factors", label: "Offer factors", count: factors.length },
            { key: "playbook", label: "Offer playbook", count: playbook.length },
            { key: "cohorts", label: "Cohorts", count: cohorts.length },
            { key: "tags", label: "Push tags", count: tags.length },
          ]} />
        </div>

        {tab === "segments" && (
          <>
            <div className="grid gap-3 border-b border-line px-5 py-4 md:grid-cols-[2fr_1fr]">
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, MoEngage ID or catalogue code" />
              <select value={family} onChange={(e) => setFamily(e.target.value)}>
                <option value="">All families</option>
                {families.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              {rows.length === 0 ? (
                <Empty title="No segments match" hint="Clear the filter or widen the search." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Segment</th><th>Family</th><th>Gender</th><th>Catalogue</th>
                      <th className="text-right">Base</th><th>MoEngage name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td className="max-w-[280px]">
                          <div className="font-medium text-heading">{s.display_name}</div>
                          {s.definition && (
                            <div className="mt-0.5 line-clamp-2 text-micro text-muted">{s.definition}</div>
                          )}
                        </td>
                        <td><Pill dot={false} label={s.segment_family} tone={FAMILY_TONE[s.segment_family] ?? "neutral"} /></td>
                        <td className="text-muted">{s.gender === "ALL" ? "All" : s.gender ?? "—"}</td>
                        <td className="font-mono text-micro text-muted">{s.catalogue_codes ?? "—"}</td>
                        <td className="whitespace-nowrap text-right font-medium text-heading">
                          {s.base_count ? s.base_count.toLocaleString("en-IN") : "—"}
                        </td>
                        <td className="font-mono text-micro text-muted">{s.moe_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-line bg-[#FCFCFD] px-5 py-4">
              <div className="text-micro font-medium uppercase tracking-wide text-faint">
                Applied to every push segment
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {exclusions.map((e) => <Pill key={e.id} dot={false} label={e.label} tone="neutral" />)}
              </div>
            </div>
          </>
        )}

        {tab === "factors" && (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Factor</th><th>Why it matters</th><th>Offer implication</th><th /></tr></thead>
              <tbody>
                {factors.map((f) => (
                  <tr key={f.id}>
                    <td className="font-medium text-heading">{f.factor}</td>
                    <td className="text-muted">{f.why_it_matters}</td>
                    <td>{f.offer_implication}</td>
                    <td className="text-right">
                      {f.is_priority && <Pill label="Priority" tone="indigo" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "playbook" && (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Customer segment</th><th>Typical offer</th></tr></thead>
              <tbody>
                {playbook.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-heading">{p.customer_segment}</td>
                    <td>{p.typical_offer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "cohorts" && (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Cohort</th><th>Definition</th><th>Exclusion</th></tr></thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-heading">{c.name}</td>
                    <td className="text-muted">{c.definition}</td>
                    <td className="text-muted">{c.exclusion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "tags" && (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Tag</th><th>Label</th><th>Group ID</th></tr></thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.id}>
                    <td className="font-mono text-tiny text-heading">{t.tag}</td>
                    <td>{t.label}</td>
                    <td className="font-mono text-tiny text-muted">{t.group_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
