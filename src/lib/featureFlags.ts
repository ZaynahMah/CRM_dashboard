/**
 * Feature flags.
 *
 * `NEXT_PUBLIC_` values are inlined at BUILD time, so changing one in Vercel
 * needs a redeploy, not just a restart.
 */

/**
 * The LEGACY upload: `reset_campaigns_with_archive()`, which replaced a
 * stream's running PNs on every upload.
 *
 * OFF by default and intended to stay off. Add-only is now the only path the
 * UI offers; this exists solely as an escape hatch if something about the
 * batch upload turns out to be wrong in production, and even then it must be
 * enabled deliberately.
 */
export const LEGACY_UPLOAD_ENABLED =
  (process.env.NEXT_PUBLIC_LEGACY_UPLOAD_ENABLED ?? "").trim().toLowerCase() === "true";

/**
 * Add-only batch upload — now the DEFAULT, with no variable needed.
 *
 * Uploads insert and nothing else, so an upload can never change or remove a
 * PN another team is working on.
 */
export const BATCH_UPLOAD_ENABLED = !LEGACY_UPLOAD_ENABLED;
