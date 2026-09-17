"use client";

import { useEffect, useState } from "react";
import { createCampaign, log } from "@/services/campaigns";
import { listPnccSegments, listPnccCategories, listApprovedPairs, listFixedTimeSlots,
  validCategoriesForSegment, isPairApproved, uniqueTimes } from "@/services/pncc";
import type { PnccSegment, PnccCategory, ApprovedPair, FixedTimeSlot } from "@/types/pncc";
import { fmtTime } from "@/lib/format";
import { Button, Field, Modal, Pill } from "./ui";
import { SearchSelect } from "./SearchSelect";
import masterData from "@/data/masterData.json";

export function AddCampaignModal({ open, onClose, profileId, isCrm, isUrgent = false, onCreated }: {
  open: boolean; onClose: () => void; profileId: string; isCrm: boolean;
  isUrgent?: boolean; onCreated: () => void;
}) {
  const [segments, setSegments] = useState<PnccSegment[]>([]);
  const [categories, setCategories] = useState<PnccCategory[]>([]);
  const [pairs, setPairs] = useState<ApprovedPair[]>([]);
  const [timeSlots, setTimeSlots] = useState<FixedTimeSlot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [segmentLabel, setSegmentLabel] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  // Category fields
  const [subCategory, setSubCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [offer, setOffer] = useState("");
  const [brief, setBrief] = useState("");
  const [landing, setLanding] = useState("");
  const [expectedCvr, setExpectedCvr] = useState("");
  const [expectedRpv, setExpectedRpv] = useState("");
  const [comment, setComment] = useState("");
  const [dateTimeBrief, setDateTimeBrief] = useState("");
  // CRM creative
  const [pnTemplate, setPnTemplate] = useState("");
  const [creativeReq, setCreativeReq] = useState("");
  const [creativeLink, setCreativeLink] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([listPnccSegments(), listPnccCategories(), listApprovedPairs(), listFixedTimeSlots()])
      .then(([s, c, p, t]) => { setSegments(s); setCategories(c); setPairs(p); setTimeSlots(t); });
  }, [open]);

  const times = uniqueTimes(timeSlots);
  const validCategories = segmentLabel ? validCategoriesForSegment(pairs, segmentLabel) : [];
  const pairValid = segmentLabel && categoryCode ? isPairApproved(pairs, segmentLabel, categoryCode) : null;

  const handleSegmentChange = (label: string) => {
    setSegmentLabel(label);
    const seg = segments.find((s) => s.condition_label === label);
    setSegmentName(seg?.segment_name ?? "");
    setCategoryCode(""); // reset category when segment changes
  };

  // Segment/Category validity is informational only (see the hint below the
  // dropdown) — it checks against a smaller, separately-maintained reference
  // table than the actual dropdown options (masterData.json), so a real,
  // valid selection must never be blocked by it. See the Audiences page /
  // README for the open item to reconcile these two sources properly.
  const canSubmit = isUrgent
    ? Boolean(brand && offer && brief)
    : Boolean(date && time && segmentLabel && categoryCode);

  const handleSubmit = async () => {
    setBusy(true); setError(null);
    try {
      const cat = categories.find((c) => c.code === categoryCode);
      const created = await createCampaign({
        campaign_name: `${segmentLabel} · ${categoryCode}`,
        campaign_origin: isCrm ? "CRM_PLANNED" : "CATEGORY_REQUEST",
        launch_date: date,
        launch_time: time,
        pncc_segment_label: segmentLabel,
        pncc_segment_name: segmentName,
        pncc_category_code: categoryCode,
        category: cat?.label ?? categoryCode,
        sub_category: subCategory || null,
        brand: brand || null,
        offer: offer || null,
        brief: brief || null,
        landing: landing || null,
        expected_cvr: expectedCvr || null,
        expected_rpv: expectedRpv || null,
        additional_notes: comment || null,
        date_time_brief: dateTimeBrief || null,
        pn_template: pnTemplate || null,
        creative_requirements: creativeReq || null,
        creative_link: creativeLink || null,
        category_status: brand && offer ? "LOCKED" : "EMPTY",
        crm_status: "AWAITING_REVIEW",
        slot_type: "STANDARD",
        submitted_at: new Date().toISOString(),
      } as Partial<any>, profileId);
      await log(created.id, profileId, "CAMPAIGN_CREATED", `Campaign created: ${segmentLabel} · ${categoryCode}`);
      // Reset
      setDate(""); setTime(""); setSegmentLabel(""); setSegmentName(""); setCategoryCode("");
      setSubCategory(""); setBrand(""); setOffer(""); setBrief(""); setLanding("");
      setExpectedCvr(""); setExpectedRpv(""); setComment(""); setDateTimeBrief("");
      setPnTemplate(""); setCreativeReq(""); setCreativeLink("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create campaign.");
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose}
      title={isUrgent ? "Add Urgent Campaign" : "Add Campaign"}
      sub={isUrgent
        ? "Urgent campaigns go directly to CRM for slot allocation. Fill the Category details below."
        : "Select the scheduling fields, then fill campaign details."}
      width="max-w-3xl">
      <div className="space-y-6">

        {/* CRM Scheduling Section */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-micro font-600 text-indigo-700">CRM SCHEDULING</span>
            <span className="text-micro text-faint">CRM controls these four fields</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Date" required>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time" required>
              <select value={time} onChange={(e) => setTime(e.target.value)}>
                <option value="">Select time slot</option>
                {times.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
              </select>
            </Field>
            <Field label="Segment" required>
              <SearchSelect value={segmentLabel}
                onChange={(v) => { setSegmentLabel(v); setSegmentName(v); setCategoryCode(""); }}
                options={masterData.segments ?? []}
                placeholder="Search segments" />
              {segmentName && (
                <span className="mt-1.5 block font-mono text-micro text-faint">{segmentName}</span>
              )}
            </Field>
            <Field label="Category" required hint={
              pairValid === false
                ? "This combination isn't in the reference pair list — double check it, but you can still submit."
                : validCategories.length > 0
                ? `${validCategories.length} approved categories for this segment`
                : undefined
            } error={pairValid === false}>
              <SearchSelect value={categoryCode}
                onChange={(v) => setCategoryCode(v)}
                options={masterData.categories ?? []}
                placeholder={segmentLabel ? "Search categories" : "Choose segment first"}
                disabled={!segmentLabel} />
            </Field>
          </div>
          {pairValid === false && (
            <div className="mt-3 rounded-lg border border-[#FECDCA] bg-danger-50 px-3.5 py-2.5 text-tiny text-danger-700">
              The combination {segmentLabel} + {categoryCode} isn't in the reference pair list — worth a second look, but this will not block submission.
            </div>
          )}
        </div>

        {/* Category Inputs Section */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-warning-50 px-2 py-0.5 text-micro font-600 text-warning-700">CATEGORY INPUTS</span>
            <span className="text-micro text-faint">Category team fills these fields</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Sub Category"><input value={subCategory} onChange={(e) => setSubCategory(e.target.value)} /></Field>
            <Field label="Brand"><SearchSelect value={brand} onChange={setBrand} options={masterData.brands} placeholder="Search brands" /></Field>
            <Field label="Offer"><SearchSelect value={offer} onChange={setOffer} options={masterData.offers} placeholder="Search offers" /></Field>
            <Field label="Landing Link"><input value={landing} onChange={(e) => setLanding(e.target.value)} /></Field>
            <Field label="Expected CVR"><input value={expectedCvr} onChange={(e) => setExpectedCvr(e.target.value)} placeholder="e.g. 2.5%" /></Field>
            <Field label="Expected RPV"><input value={expectedRpv} onChange={(e) => setExpectedRpv(e.target.value)} placeholder="e.g. ₹450" /></Field>
          </div>
          <div className="mt-4 grid gap-4">
            <Field label="Category Brief"><textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} /></Field>
            <Field label="Comment"><textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <Field label="Date / Time Brief" hint="Optional — note if a brand or offer requires a specific date or time.">
              <input value={dateTimeBrief} onChange={(e) => setDateTimeBrief(e.target.value)} placeholder="e.g. Brand requested evening placement" />
            </Field>
          </div>
        </div>

        {/* CRM Creative Inputs */}
        {isCrm && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded bg-indigo-50 px-2 py-0.5 text-micro font-600 text-indigo-700">CRM CREATIVE</span>
              <span className="text-micro text-faint">CRM provides PN and creative details</span>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="PN Template">
                <select value={pnTemplate} onChange={(e) => setPnTemplate(e.target.value)}>
                  <option value="">Select template</option>
                  {["Basic", "Bezel", "Timer", "Coloured BG"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Creative Requirements"><input value={creativeReq} onChange={(e) => setCreativeReq(e.target.value)} /></Field>
              <Field label="Creative Link"><input value={creativeLink} onChange={(e) => setCreativeLink(e.target.value)} /></Field>
            </div>
          </div>
        )}

        {/* Submit */}
        {error && <div className="rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">{error}</div>}

        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <div className="text-tiny text-muted">
            {canSubmit ? "Ready to create" : "Fill the required scheduling fields to continue"}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!canSubmit || busy} onClick={handleSubmit}>
              {busy ? "Creating" : "Create Campaign"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
