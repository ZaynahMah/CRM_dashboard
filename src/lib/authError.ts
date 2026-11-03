/**
 * Telling "the session is gone" apart from "the call failed".
 *
 * The logout fix in 61ac00f let EVERY `getUser()` error through on the
 * theory that a failed call must never sign anyone out. That is right for a
 * network blip and wrong for an auth error: after `signOut()`, `getUser()`
 * returns AuthSessionMissingError, which was then treated as "reconnecting"
 * — so Log out showed the banner instead of leaving, and a refresh hung
 * because the middleware waved the request through with no session.
 *
 * Only genuinely retryable failures may pass through.
 */

export interface MaybeAuthError {
  message?: string;
  status?: number;
  name?: string;
  code?: string;
}

/**
 * True when the error means the session is gone and the user must sign in
 * again: a missing session, a dead refresh token, 400 or 401.
 */
export function isSessionGone(e: MaybeAuthError | null | undefined): boolean {
  if (!e) return false;
  if (e.status === 400 || e.status === 401 || e.status === 403) return true;

  // Underscores are normalised to spaces: Supabase codes use
  // refresh_token_not_found while messages say "Refresh Token Not Found".
  const text = `${e.name ?? ""} ${e.code ?? ""} ${e.message ?? ""}`
    .toLowerCase().replace(/_/g, " ");
  return /auth session missing/.test(text)
    || /session.{0,12}not found/.test(text)
    || /refresh.{0,12}token.{0,12}(not found|invalid|expired|already used)/.test(text)
    || /invalid.{0,12}refresh.{0,12}token/.test(text)
    || /jwt expired/.test(text)
    || /invalid claim/.test(text)
    || /user from sub claim.{0,20}does not exist/.test(text);
}

/**
 * True when the call failed for a reason that may well succeed next time:
 * a network drop, a timeout, a 5xx, or Supabase's own retryable error.
 * These keep the user exactly where they are.
 */
export function isRetryable(e: MaybeAuthError | null | undefined): boolean {
  if (!e) return false;
  if (isSessionGone(e)) return false;
  if (typeof e.status === "number" && e.status >= 500) return true;
  if (e.status === 0 || e.status === undefined) {
    const text = `${e.name ?? ""} ${e.message ?? ""}`.toLowerCase();
    // An unknown-status error is treated as retryable, which keeps the
    // user on the page. A session error has already been caught above.
    return /fetch|network|timeout|abort|retryable|failed to fetch/.test(text)
      || text.trim() === "";
  }
  return false;
}
