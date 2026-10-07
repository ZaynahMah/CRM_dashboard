import { createClient } from "@supabase/supabase-js";

/**
 * Guards for server-side API routes: a session check and a rate limit.
 *
 * Both are deliberately small. No new dependency, no Redis, no middleware
 * framework — `@supabase/supabase-js` is already here and the limiter is a
 * Map.
 */

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/**
 * Validates the caller's Supabase access token and returns their user id.
 *
 * The token arrives in an `Authorization: Bearer` header rather than being
 * read from cookies. `src/lib/supabase.ts` is a "use client" module using
 * createBrowserClient, and nothing in this codebase has ever read a session
 * server-side, so cookie-based reading would be new, untested plumbing.
 * Passing the token the client already holds is deterministic and needs no
 * assumptions about cookie names, domains or SameSite behaviour.
 *
 * getUser(token) verifies the JWT with Supabase itself — this is a real
 * check, not a decode. A forged or expired token fails.
 *
 * Returns null on any failure. The caller decides what to say; this never
 * distinguishes "no header" from "bad token" from "expired token" to the
 * outside world.
 */
export async function getSessionUserId(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Rate limit                                                          */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

/**
 * Sliding-window counter, keyed by user id, held in module scope.
 *
 * IMPORTANT LIMITATION, stated rather than hidden: on Vercel this process
 * is one serverless instance among several, and instances come and go. The
 * counter is therefore per-instance, not global — a determined caller
 * spraying requests across instances can exceed the nominal cap, and a cold
 * start resets the window.
 *
 * That is an acceptable trade for the stated goal. This is a spend guard
 * against a casual abuser or a runaway client loop, and for those it works.
 * It is NOT a hard quota ceiling. A real ceiling needs shared state (Redis,
 * Upstash, or a Postgres table) or a spend cap set in Google Cloud on the
 * Gemini key itself — the latter costs nothing and is worth doing.
 */
const hits = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    const oldest = recent[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)),
    };
  }

  recent.push(now);
  hits.set(userId, recent);

  // Cheap housekeeping so the Map cannot grow without bound on a
  // long-lived instance. Only runs when the map is already large.
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam: clears the window. Not used by the route. */
export function __resetRateLimit() {
  hits.clear();
}

export const RATE_LIMIT = { WINDOW_MS, MAX_PER_WINDOW };
