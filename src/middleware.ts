import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side access control (#9).
 *
 * Until now the only guard was `AppShell`, which redirects in the browser —
 * so an unauthenticated or wrong-role user still received the page and could
 * read it before the redirect ran. This refuses the request before anything
 * renders.
 *
 * It is a guard, not the security boundary: RLS in Postgres is. A user who
 * calls Supabase directly never passes through here, which is why the read
 * policies were tightened in migration 17 as well. This stops the easy case
 * (typing a URL); RLS stops the real one.
 */

/** Which roles may reach which route prefix. Mirrors the nav in AppShell. */
const ROUTE_ROLES: Record<string, readonly string[]> = {
  /*
   * REMOVED PAGES. Listed with NO roles rather than deleted from this map:
   * an unlisted path falls through to "allowed", so removing the entry
   * would have opened /qc and /audience to everyone instead of blocking
   * them. An empty list matches no role, so every visit is turned away.
   */
  "/qc":          [],
  "/audience":    [],
  "/overview":    ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/campaigns":   ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/calendar":    ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  // Operational management view: CRM and leadership only.
  "/sla":         ["CRM", "EXECUTIVE"],
  "/storage":     ["CRM"],
  "/emergency":   ["CATEGORY", "CRM", "CONTENT"],
  "/changes":     ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/performance": ["CRM", "EXECUTIVE"],
  "/segments":    ["CRM"],
  "/final-view":  ["CRM"],
};

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Without configuration there is no session to read. Fail closed for app
  // routes rather than silently letting everything through.
  if (!url || !key) return redirectToLogin(req);

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) =>
        list.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options as never)),
    },
  });

  /**
   * NEVER treat a FAILED call as "signed out".
   *
   * `getUser()` is a network call. Its error was previously discarded, so a
   * timeout, a rate limit or a brief Supabase hiccup produced `user: null`
   * — indistinguishable from genuinely unauthenticated — and the person was
   * redirected to /login mid-work. Under concurrent load that call fails
   * more often, which is exactly when people were being logged out.
   *
   * Only `user === null` WITH NO ERROR means unauthenticated. An error lets
   * the request through untouched; the page's own guards still apply.
   */
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) return withRefreshedCookies(res, NextResponse.next());
  const user = userData.user;
  if (!user) return redirectToLogin(req, res);

  // The role lives in profiles, not in the JWT, so it has to be read.
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();

  // Same rule: a failed read is not a missing role.
  if (profileError) return res;

  const role = profile?.role as string | undefined;
  if (!role) return redirectToLogin(req, res);

  const allowed = Object.entries(ROUTE_ROLES)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"))?.[1];

  // Unknown app route: let it 404 normally rather than inventing a rule.
  if (!allowed) return res;

  if (!allowed.includes(role)) {
    // Sent to their own dashboard, not to login — they are signed in, just
    // in the wrong place.
    const to = req.nextUrl.clone();
    to.pathname = "/overview";
    to.search = "";
    return withRefreshedCookies(res, NextResponse.redirect(to));
  }

  return res;
}

/**
 * Carries any cookies Supabase refreshed during this request onto the
 * response that is actually returned.
 *
 * THE SILENT LOGOUT: `getUser()` can rotate the refresh token, and the new
 * value is written to `res`. Every redirect path used to return a FRESH
 * `NextResponse.redirect(...)`, dropping those cookies. The browser kept the
 * old refresh token, Supabase had already rotated it, and the next refresh
 * failed for real — a genuine logout with no network fault involved. Two
 * tabs refreshing at once hit the same loss.
 */
function withRefreshedCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
  return to;
}

function redirectToLogin(req: NextRequest, res?: NextResponse) {
  const to = req.nextUrl.clone();
  to.pathname = "/login";
  to.search = "";
  const redirect = NextResponse.redirect(to);
  return res ? withRefreshedCookies(res, redirect) : redirect;
}

/**
 * Only the authenticated app routes. /login, /api, static assets and the
 * Next internals are deliberately excluded — /api guards itself with a
 * bearer token (see lib/apiGuard.ts).
 */
export const config = {
  matcher: [
    "/overview/:path*", "/campaigns/:path*", "/calendar/:path*",
    "/emergency/:path*", "/changes/:path*", "/performance/:path*", "/sla/:path*", "/audience/:path*",
    "/segments/:path*", "/final-view/:path*", "/qc/:path*",
  ],
};
