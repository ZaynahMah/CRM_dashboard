"use client";

import { useState } from "react";
import type { Campaign } from "@/types/campaign";
import { categoryCompleteness, REQUIRED_CATEGORY_FIELDS } from "@/lib/workflow";
import { fmtLongDate, fmtTime } from "@/lib/format";
import { Button, Field, Pill } from "./ui";

export const CATEGORIES = ["Beauty", "Fashion", "Luxury", "Watches", "Footwear", "Accessories", "Jewellery"];
export const SUB_CATEGORIES: Record<string, string[]> = {
  Beauty: ["Skincare", "Makeup", "Fragrance", "Haircare"],
  Fashion: ["Womenswear", "Menswear", "Denim", "Activewear"],
  Luxury: ["Handbags", "Small Leather Goods", "Luxury Beauty", "Ready to Wear"],
  Watches: ["Luxury Watches", "Smart Watches", "Fashion Watches"],
  Footwear: ["Heels", "Sneakers", "Formal", "Sandals"],
  Accessories: ["Eyewear", "Belts", "Wallets", "Scarves"],
  Jewellery: ["Fine Jewellery", "Fashion Jewellery", "Silver"],
};
export const CAMPAIGN_TYPES = ["Offer", "Brand Launch", "Collection Drop", "Sale", "Category Event", "Re-engagement"];
export const OFFER_TYPES = ["Flat 20% Off", "Up to 40% Off", "Buy 2 Get 1", "Extra 15% on App", "Gift With Purchase", "No Offer"];
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"];

type Mode = "CATEGORY" | "CRM_PLANNED" | "EMERGENCY";

export function CampaignForm({ mode, slot, onSubmit, onCancel }: {
  mode: Mode;
  slot?: { date: string; slotId: string; time: string };
  onSubmit: (values: Partial<Campaign>) => Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<Partial<Campaign>>({
    campaign_origin: mode === "CRM_PLANNED" ? "CRM_PLANNED" : "CATEGORY_REQUEST",
    priority: mode === "EMERGENCY" ? "CRITICAL" : "NORMAL",
    launch_date: slot?.date ?? "",
    launch_time: slot?.time ?? "",
    calendar_slot_id: slot?.slotId ?? null,
    is_emergency: mode === "EMERGENCY",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Campaign) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  const { filled, total } = categoryCompleteness(v);
  const extra = mode === "EMERGENCY"
    ? Boolean(v.emergency_reason?.trim() && v.business_deadline && v.launch_date && v.launch_time)
    : Boolean(v.launch_date);
  // RULE 6 / RULE 13 — emergencies skip the 7-day window, never the validation.
  const ready = filled === total && extra;

  return (
    <div className="space-y-6">
      {slot && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3.5">
          <div className="text-micro font-medium uppercase tracking-wide text-indigo-700">
            Slot held for this campaign
          </div>
          <div className="mt-1 font-display text-[16px] font-600 text-heading">
            {fmtLongDate(slot.date)} · {fmtTime(slot.time)}
          </div>
          <p className="mt-1 text-tiny text-muted">
            Date and time come from the CRM calendar and cannot be edited here.
          </p>
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Campaign name" required>
          <input value={v.campaign_name ?? ""} onChange={set("campaign_name")} placeholder="Estée Lauder Festive Edit" />
        </Field>
        <Field label="Brand" required>
          <input value={v.brand ?? ""} onChange={set("brand")} placeholder="Estée Lauder" />
        </Field>
        <Field label="Category" required>
          <select value={v.category ?? ""} onChange={set("category")}>
            <option value="">Select a category</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Sub-category" required>
          <select value={v.sub_category ?? ""} onChange={set("sub_category")} disabled={!v.category}>
            <option value="">{v.category ? "Select a sub-category" : "Choose a category first"}</option>
            {(SUB_CATEGORIES[v.category ?? ""] ?? []).map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Campaign type" required>
          <select value={v.campaign_type ?? ""} onChange={set("campaign_type")}>
            <option value="">Select a type</option>
            {CAMPAIGN_TYPES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Offer" required>
          <select value={v.offer ?? ""} onChange={set("offer")}>
            <option value="">Select an offer</option>
            {OFFER_TYPES.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
      </section>

      <Field label="Offer details" required hint="What the customer actually gets, including any exclusions.">
        <textarea rows={2} value={v.offer_details ?? ""} onChange={set("offer_details")} />
      </Field>

      <Field label="Campaign brief" required hint="Why this push exists and what it should achieve.">
        <textarea rows={3} value={v.brief ?? ""} onChange={set("brief")} />
      </Field>

      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Landing page" required>
          <input value={v.landing ?? ""} onChange={set("landing")} placeholder="/brand/estee-lauder" />
        </Field>
        <Field label="Reference link">
          <input value={v.reference_link ?? ""} onChange={set("reference_link")} />
        </Field>
        <Field label="Product / collection">
          <input value={v.product_collection ?? ""} onChange={set("product_collection")} />
        </Field>
        <Field label="Business objective">
          <input value={v.business_objective ?? ""} onChange={set("business_objective")} placeholder="Revenue" />
        </Field>
        <Field label="Priority" required>
          <select value={v.priority ?? "NORMAL"} onChange={set("priority")}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}
          </select>
        </Field>
        {!slot && (
          <Field label={mode === "EMERGENCY" ? "Desired launch date" : "Launch date"} required>
            <input type="date" value={v.launch_date ?? ""} onChange={set("launch_date")} />
          </Field>
        )}
        {!slot && (
          <Field label={mode === "EMERGENCY" ? "Desired launch time" : "Launch time"} required={mode === "EMERGENCY"}>
            <input type="time" value={v.launch_time ?? ""} onChange={set("launch_time")} />
          </Field>
        )}
      </section>

      {mode === "CRM_PLANNED" && (
        <Field label="Reason for CRM campaign" hint="Recorded on the campaign so the origin is never ambiguous.">
          <textarea rows={2} value={v.additional_notes ?? ""} onChange={set("additional_notes")} />
        </Field>
      )}

      {mode === "EMERGENCY" && (
        <section className="grid gap-4 border-t border-line pt-5 md:grid-cols-2">
          <Field label="Reason for emergency" required>
            <textarea rows={2} value={v.emergency_reason ?? ""} onChange={set("emergency_reason")} />
          </Field>
          <Field label="Business deadline" required>
            <input type="date" value={v.business_deadline ?? ""} onChange={set("business_deadline")} />
          </Field>
        </section>
      )}

      {/* RULE 6 — incomplete campaigns cannot be submitted */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-[#F9FAFB] px-4 py-3.5">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-center gap-2">
            <span className="text-micro font-medium uppercase tracking-wide text-faint">Submission quality</span>
            {ready && <Pill label="Complete" tone="success" />}
          </div>
          <div className="mt-2 h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full transition-all ${ready ? "bg-success-500" : "bg-indigo-500"}`}
              style={{ width: `${(filled / total) * 100}%` }} />
          </div>
          <div className="mt-2 text-tiny text-body">
            {filled} of {total} required fields complete
          </div>
          {!ready && (
            <p className="mt-1 text-micro text-muted">
              Missing: {REQUIRED_CATEGORY_FIELDS.filter((f) => !String(v[f] ?? "").trim())
                .map((f) => f.replace(/_/g, " ")).join(", ") || "launch details"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-3">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true); setError(null);
              try { await onSubmit(v); }
              catch (e) { setError(e instanceof Error ? e.message : "Could not save the campaign."); }
              finally { setBusy(false); }
            }}>
            {busy ? "Saving" : "Submit campaign"}
          </Button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">{error}</p>}
    </div>
  );
}
