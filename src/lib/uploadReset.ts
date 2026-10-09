import type { Campaign } from "@/types/campaign";
import type { AppRole } from "@/types/user";

/**
 * The upload-reset rules from migration 18, expressed once in TypeScript so
 * they are testable and so the client and the RPC cannot drift apart.
 *
 * BUSINESS RULE: an upload is a FULL FRESH START. Every PN is removed —
 * both flows, every status, including Calendar. Nothing is kept. What makes
 * that safe is that everything is archived first, in the same transaction.
 *
 * Postgres is the real enforcement; this mirrors it.
 */

export interface ResetPreview {
  total: number;
  at_category: number;
  with_content: number;
  in_qc: number;
  on_calendar: number;
  emergencies: number;
  change_requests: number;
}

/** Mirrors `upload_reset_preview()`. */
export function previewReset(rows: Campaign[], changeRequests = 0): ResetPreview {
  const live = (c: Campaign) => c.calendar_status !== "UPDATED";
  return {
    total: rows.length,
    at_category: rows.filter((c) => live(c) && c.content_status === "NOT_ASSIGNED").length,
    with_content: rows.filter((c) => live(c)
      && (c.content_status === "PENDING" || c.content_status === "NEEDS_CHANGES")).length,
    in_qc: rows.filter((c) => live(c) && c.content_status === "SUBMITTED").length,
    on_calendar: rows.filter((c) => c.calendar_status === "UPDATED").length,
    emergencies: rows.filter((c) => c.is_emergency).length,
    change_requests: changeRequests,
  };
}

/** Which rows a reset deletes. Every one — the point of the rule. */
export function rowsToDelete(rows: Campaign[]): Campaign[] {
  return rows;
}

export interface ResetOutcome {
  ok: boolean;
  error?: string;
  campaigns: Campaign[];
  archive: Campaign[];
  archiveBatchId?: string;
}

/**
 * Mirrors `reset_campaigns_with_archive()`, including its abort conditions.
 * A failure returns the ORIGINAL rows untouched, which is what the
 * transaction rollback guarantees in Postgres.
 */
export function applyReset(opts: {
  role: AppRole;
  existing: Campaign[];
  incoming: Campaign[];
  existingArchive?: Campaign[];
  /** Simulates a mid-transaction failure, to prove nothing is deleted. */
  failAt?: "archive" | "delete" | "insert";
}): ResetOutcome {
  const { role, existing, incoming, existingArchive = [], failAt } = opts;
  const unchanged = (error: string): ResetOutcome =>
    ({ ok: false, error, campaigns: existing, archive: existingArchive });

  // The CRM check is the first statement in the RPC, before SECURITY
  // DEFINER rights reach anything destructive.
  if (role !== "CRM") return unchanged("Only CRM can reset campaigns.");

  // Wiping everything and inserting nothing is indistinguishable from an
  // upstream parse failure, so it is refused.
  if (incoming.length === 0) {
    return unchanged("Refusing to reset: the uploaded sheet contains no rows.");
  }

  if (failAt === "archive") return unchanged("Archive failed.");

  const archive = [...existingArchive, ...existing];
  // Archive is verified against the live count BEFORE anything is deleted.
  if (archive.length - existingArchive.length !== existing.length) {
    return unchanged("Archive incomplete. Aborting.");
  }

  if (failAt === "delete") return unchanged("Delete failed.");
  if (failAt === "insert") return unchanged("Insert incomplete. Aborting.");

  return {
    ok: true,
    campaigns: [...incoming],
    archive,
    archiveBatchId: "batch-1",
  };
}
