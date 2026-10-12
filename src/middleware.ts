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
  "/overview":    ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/campaigns":   ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/calendar":    ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/sla":         ["CATEGORY", "CRM", "CONTENT", "EXECUTIVE"],
  "/emergency":   ["CATEGORY", "CRM", "CONTENT"],
  "/changes":     ["CATEGORY", "CRM"],
  "/performance": ["CRM", "EXECUTIVE"],
  "/segments":    ["CRM"],
  "/final-view":  ["CRM"],
  "/qc":          ["CRM"],
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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirectToLogin(req);

  // The role lives in profiles, not in the JWT, so it has to be read.
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();

  const role = profile?.role as string | undefined;
  if (!role) return redirectToLogin(req);

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
    return NextResponse.redirect(to);
  }

  return res;
}

function redirectToLogin(req: NextRequest) {
  const to = req.nextUrl.clone();
  to.pathname = "/login";
  to.search = "";
  return NextResponse.redirect(to);
}

/**
 * Only the authenticated app routes. /login, /api, static assets and the
 * Next internals are deliberately excluded — /api guards itself with a
 * bearer token (see lib/apiGuard.ts).
 */
export const config = {
  matcher: [
    "/overview/:path*", "/campaigns/:path*", "/calendar/:path*",
    "/emergency/:path*", "/changes/:path*", "/performance/:path*", "/sla/:path*",
    "/segments/:path*", "/final-view/:path*", "/qc/:path*",
  ],
};
