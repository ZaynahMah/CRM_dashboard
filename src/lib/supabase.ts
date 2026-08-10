"use client";

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Fail loudly at boot rather than silently returning empty data everywhere.
  console.error(
    "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart the dev server."
  );
}

export const supabase = createBrowserClient(url ?? "http://localhost", key ?? "public-anon-key");

export const isSupabaseConfigured = Boolean(url && key);
