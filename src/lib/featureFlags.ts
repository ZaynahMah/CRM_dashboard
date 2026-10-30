/**
 * Feature flags.
 *
 * `NEXT_PUBLIC_` values are inlined at BUILD time, so flipping one in Vercel
 * needs a redeploy, not just a restart.
 */

/**
 * Batch uploads: add-only `add_upload_batch()` plus "Reset last upload".
 *
 * OFF (the default) keeps the existing upload exactly as it is today —
 * `reset_campaigns_with_archive()`, the replace-running-PNs preview and its
 * wording — and hides the Reset last upload button entirely. One variable to
 * roll back.
 */
export const BATCH_UPLOAD_ENABLED =
  (process.env.NEXT_PUBLIC_BATCH_UPLOAD_ENABLED ?? "").trim().toLowerCase() === "true";
