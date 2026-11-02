import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-generated backup of one day's PNs and every child row.
 *
 * The CRM role is checked HERE as well as inside `delete_finished_day`, so a
 * Category, Content or Executive session calling this route directly gets
 * 403 and never obtains the signature the delete requires.
 *
 * Reads only. This route never writes or deletes.
 */
const CHILD_TABLES = [
  "activity_logs", "notifications", "qc_checklists", "change_requests",
  "crm_decisions", "content_change_sets", "content_submissions",
] as const;

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
      { error: "Only CRM can download a day backup." }, { status: 403 });
  }

  let body: { day?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body.day || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
    return NextResponse.json({ error: "A day in YYYY-MM-DD form is required." },
      { status: 400 });
  }

  const { data: pns, error } = await supabase
    .from("campaigns").select("*")
    .eq("launch_date", body.day)
    .order("id", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (pns ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    return NextResponse.json({ error: `No PNs exist for ${body.day}.` }, { status: 400 });
  }
  const ids = rows.map((r) => String(r.id));

  // Every child row, so the backup is the whole picture, not just the PNs.
  const children: Record<string, unknown[]> = {};
  for (const t of CHILD_TABLES) {
    const { data } = await supabase.from(t).select("*").in("campaign_id", ids);
    children[t] = data ?? [];
  }

  /**
   * The signature must match `day_delete_signature()` byte for byte:
   * `id:updated_at` per row, joined by "|" in id order, SHA-256 hex.
   */
  const signature = rows
    .map((r) => `${r.id}:${r.updated_at ?? ""}`)
    .join("|");
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(signature));
  const sha = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  return NextResponse.json({
    day: body.day,
    sha,
    counts: {
      campaigns: rows.length,
      ...Object.fromEntries(CHILD_TABLES.map((t) => [t, children[t].length])),
    },
    fileName: `pn-backup-${body.day}.json`,
    backup: { day: body.day, generated_at: new Date().toISOString(),
              campaigns: rows, children },
  });
}
