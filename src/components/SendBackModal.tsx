"use client";

import { useState } from "react";
import { Button, Modal, Pill } from "./ui";
import type { Campaign } from "@/types/campaign";
import {
  canSendBack, willResetQc, rememberedName, rememberName,
} from "@/services/sendBack";

/**
 * "Send back to Content" — one PN or many.
 *
 * Reason and name are required; the field is optional. The name is
 * remembered per browser, so it is typed once rather than on every
 * send-back — shared team logins mean it is the only real identity.
 */
export function SendBackModal({ campaigns, open, busy, error, onClose, onConfirm }: {
  campaigns: Campaign[];
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (input: { reason: string; byName: string; field?: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const [field, setField] = useState("");
  const [name, setName] = useState(() => rememberedName());

  const eligible = campaigns.filter((c) => canSendBack(c).ok);
  const blocked = campaigns.filter((c) => !canSendBack(c).ok);
  const resetsQc = eligible.filter(willResetQc);
  const ready = reason.trim() !== "" && name.trim() !== "" && eligible.length > 0;

  return (
    <Modal open={open} onClose={onClose}
      title={campaigns.length === 1 ? "Send back to Content"
        : `Send ${campaigns.length} PNs back to Content`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill dot={false} label={`${eligible.length} will be sent back`} tone="success" />
          {blocked.length > 0 && (
            <Pill dot={false} label={`${blocked.length} cannot`} tone="warning" />
          )}
        </div>

        {resetsQc.length > 0 && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-tiny text-warning-700">
            {resetsQc.length === 1 ? "This PN has passed QC" :
              `${resetsQc.length} of these have passed QC`}. Sending back resets QC to
            pending. The individual QC ticks are kept, so CRM re-checks the copy only.
          </p>
        )}

        {blocked.length > 0 && (
          <div className="rounded-lg bg-[#FCFCFD] px-3 py-2">
            <p className="text-micro font-medium text-heading">Not sent back:</p>
            <ul className="mt-1 space-y-0.5">
              {blocked.slice(0, 8).map((c) => (
                <li key={c.id} className="text-micro text-muted">
                  {c.campaign_name} · {c.launch_date ?? "no date"} · slot{" "}
                  {c.slot_label ?? c.slot_number ?? "—"} — {canSendBack(c).reason}
                </li>
              ))}
              {blocked.length > 8 && (
                <li className="text-micro text-faint">…and {blocked.length - 8} more.</li>
              )}
            </ul>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-tiny font-medium text-body">
            What should Content fix? <span className="text-danger-500">*</span>
          </span>
          <textarea value={reason} rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sub copy mentions the wrong offer" />
        </label>

        <label className="block">
          <span className="mb-1 block text-tiny font-medium text-body">
            Which field? <span className="text-faint">(optional)</span>
          </span>
          <input value={field} onChange={(e) => setField(e.target.value)}
            placeholder="e.g. Sub Copy" />
        </label>

        <label className="block">
          <span className="mb-1 block text-tiny font-medium text-body">
            Your name <span className="text-danger-500">*</span>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Typed once, then remembered on this browser" />
        </label>

        {error && (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-tiny text-danger-700">{error}</p>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !ready}
            onClick={() => {
              rememberName(name);
              onConfirm({ reason: reason.trim(), byName: name.trim(),
                field: field.trim() || undefined });
            }}>
            {busy ? "Sending..." : `Send back (${eligible.length})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
