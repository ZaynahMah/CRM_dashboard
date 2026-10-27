import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side reset of running PNs.
 *
 * The role is checked HERE as well as inside the SQL function, so calling
 * this route directly from any non-CRM session returns 403 rather than
 * relying on the UI hiding a button.
 *
 * No service-role key is used. The route acts as the signed-in user via
 * their cookies, and `reset_running_pns` enforces CRM again in Postgres.
 * There is nothing here a browser could call with elevated rights.
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const res = NextResponse.next();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) =>
        list.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options as never)),
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if ((profile?.role as string) !== "CRM") {
    return NextResponse.json(
      { error: "Only CRM can reset running campaigns." }, { status: 403 });
  }

  let body: { isCrmSelf?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  if (typeof body.isCrmSelf !== "boolean") {
    return NextResponse.json(
      { error: "isCrmSelf must be true or false." }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc("reset_running_pns", { p_is_crm_self: body.isCrmSelf });

  if (error) {
    // A refusal from the function (role, lock, archive mismatch) is the
    // user's answer, not a server fault.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ reset: Number(data ?? 0) });
}
