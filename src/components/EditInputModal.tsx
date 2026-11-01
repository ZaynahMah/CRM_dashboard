"use client";

import { useMemo, useState } from "react";
import { Button, Modal } from "./ui";
import type { Campaign } from "@/types/campaign";
import {
  editableFieldsFor, FIELD_LABEL, validateRequest, changedFields,
  raiseChangeRequest, rememberedRequestName, rememberRequestName,
} from "@/services/changeRequests";

/**
 * "Edit input" — Category and Content propose changes to a PN they have
 * already submitted.
 *
 * Nothing on the PN changes here. The save creates ONE multi-field change
 * request; CRM accepts or rejects it on the Changes page.
 */
export function EditInputModal({ campaign, role, open, onClose, onRaised }: {
  campaign: Campaign;
  role: string;
  open: boolean;
  onClose: () => void;
  onRaised: () => void;
}) {
  const fields = useMemo(() => editableFieldsFor(role), [role]);

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const f of editableFieldsFor(role)) {
      d[f] = String((campaign as unknown as Record<string, unknown>)[f] ?? "");
    }
    return d;
  });
  const [name, setName] = useState(() => rememberedRequestName());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = changedFields(campaign, draft);
  const problems = validateRequest(changed, role);
  const ready = Object.keys(changed).length > 0
    && problems.length === 0 && name.trim() !== "";

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await raiseChangeRequest(campaign.id, changed, name, reason);
      rememberRequestName(name);
      onRaised();
      onClose();
    } catch (e) {
      // The server's own wording, shown as-is: it is more specific than
      // anything restated here.
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} z="z-[90]"
      title="Edit input"
      sub="This asks CRM to approve the change. The PN does not change until they accept.">
      <div className="space-y-4">
        {fields.map((f) => {
          const isLong = f === "brief" || f === "sub_copy_text"
            || f === "additional_notes" || f === "date_time_brief";
          const limit = f === "header" ? 60 : f === "sub_copy_text" ? 200 : null;
          const v = draft[f] ?? "";
          return (
            <label key={f} className="block">
              <span className="mb-1 flex items-center gap-2 text-tiny font-medium text-body">
                {FIELD_LABEL[f] ?? f}
                {changed[f] !== undefined && (
                  <span className="text-micro text-indigo-700">changed</span>
                )}
                {limit && (
                  <span className={`ml-auto text-micro ${
                    v.length > limit ? "text-danger-700" : "text-faint"}`}>
                    {v.length} / {limit}
                  </span>
                )}
              </span>
              {isLong ? (
                <textarea rows={3} value={v}
                  onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} />
              ) : (
                <input value={v}
                  onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} />
              )}
            </label>
          );
        })}

        <label className="block">
          <span className="mb-1 block text-tiny font-medium text-body">
            Why? <span className="text-faint">(optional)</span>
          </span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>

        <label className="block">
          <span className="mb-1 block text-tiny font-medium text-body">
            Your name <span className="text-danger-500">*</span>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Typed once, then remembered on this browser" />
        </label>

        {problems.length > 0 && (
          <ul className="rounded-lg bg-danger-50 px-3 py-2">
            {problems.map((p) => (
              <li key={p} className="text-tiny text-danger-700">{p}</li>
            ))}
          </ul>
        )}

        {error && (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={submit}>
            {busy ? "Sending..."
              : `Request ${Object.keys(changed).length || ""} change${
                  Object.keys(changed).length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
