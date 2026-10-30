import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-generated backup of the rows a "Reset last upload" would remove.
 *
 * The CRM role is checked HERE as well as inside `reset_last_upload()`. A
 * Category, Content or Executive session calling this route directly gets
 * 403 — so it cannot obtain the hash the reset requires.
 *
 * Deterministic: rows ordered by id, a fixed column order, and
 * `id:updated_at` per row in the signature, so the hash changes if anything
 * about the set changes between preview and reset.
 *
 * Reads only. This route never writes or deletes.
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
      { error: "Only CRM can download an upload backup." }, { status: 403 });
  }

  let body: { batchId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body.batchId) {
    return NextResponse.json({ error: "batchId is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("campaigns").select("*")
    .eq("upload_batch_id", body.batchId)
    .order("id", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []) as Record<string, unknown>[];
  const cols = Object.keys(rows[0] ?? {}).sort();
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
  ].join("\n");

  const signature = rows.map((r) => `${r.id}:${r.updated_at ?? ""}`).join("|");
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(signature));
  const sha = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  return NextResponse.json({
    csv, sha,
    rowIds: rows.map((r) => String(r.id)),
    fileName: `upload-backup-${body.batchId}.csv`,
  });
}
