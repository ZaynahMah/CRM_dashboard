"use client";

import { createBrowserClient } from "@supabase/ssr";

// IMPORTANT: use `||`, not `??`, for these fallbacks. `??` only substitutes
// on null/undefined — it does NOT catch an empty string. If a Vercel
// environment variable exists but was saved with an empty value (a common
// slip when re-adding env vars to a new project during a team/project
// migration), `process.env.NEXT_PUBLIC_SUPABASE_URL` is `""`, not
// `undefined`. `"" ?? "fallback"` evaluates to `""` — the empty string
// passes straight through — and `createBrowserClient("", key)` throws
// `Your project's URL and API key are required to create a Supabase
// client!`, which crashes the build during static generation (this module
// is imported by SessionProvider in the root layout, so every page pulls
// it in, and Next.js evaluates top-level module code in Node.js while
// generating the static shell, even for a "use client" file). `||` treats
// an empty string as falsy and falls through to the placeholder correctly.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "public-anon-key";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  // Fail loudly in the console rather than silently returning empty data
  // everywhere — but never throw here, so a missing/blank env var degrades
  // to "app loads, auth doesn't work" instead of "the entire build fails."
  console.error(
    "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart the dev server."
  );
}

export const supabase = createBrowserClient(url, key);

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);
