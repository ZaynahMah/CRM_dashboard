"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/services/auth";
import { useSession } from "@/components/SessionProvider";
import { HOME_FOR_ROLE } from "@/types/user";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Button, Field } from "@/components/ui";
import { Icon } from "@/components/icons";

const ROLES = [
  { user: "CATEGORY", pass: "cat_9090", note: "Fills slots, tracks deadlines" },
  { user: "CRM", pass: "crm_9090", note: "Owns calendar, targeting and QC" },
  { user: "CONTENT", pass: "con_9090", note: "Writes copy, attaches creative" },
  { user: "EXECUTIVE", pass: "exe_9090", note: "Reads operational health" },
];

const HIGHLIGHTS = [
  ["Calendar orchestration", "One date holds seven slots. Category plans against slots CRM opens."],
  ["Live MoEngage segments", "Targeting picks from the real segment library with reachable base counts."],
  ["Deadline that calculates itself", "Category details are due seven days before every launch."],
];

export default function LoginPage() {
  const router = useRouter();
  const { profile, loading } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && profile) router.replace(HOME_FOR_ROLE[profile.role]);
  }, [profile, loading, router]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const p = await signIn(username, password);
      if (p) router.replace(HOME_FOR_ROLE[p.role]);
      else setError("Signed in, but no profile is linked to this account. Run 01_schema.sql, then sign in again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-700 via-indigo-600 to-indigo-500 p-12 lg:flex">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" />

        <div className="relative flex items-center gap-2.5 text-white">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/20">{Icon.bell(18)}</span>
          <span className="font-display text-[16px] font-700">CLiQ Push Ops</span>
        </div>

        <div className="relative">
          <h1 className="max-w-md font-display text-[36px] font-700 leading-[1.15] text-white">
            The push calendar, out of the spreadsheet.
          </h1>
          <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-white/75">
            Category, CRM, Content and leadership working from one board, one deadline
            and one audit trail.
          </p>

          <ul className="mt-9 space-y-4">
            {HIGHLIGHTS.map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20 text-white">
                  {Icon.check(12)}
                </span>
                <div>
                  <div className="text-[13.5px] font-600 text-white">{title}</div>
                  <div className="text-tiny text-white/65">{body}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-micro text-white/50">Tata CLiQ Fashion &amp; Luxury · Internal</div>
      </section>

      {/* Form */}
      <section className="flex flex-col justify-center bg-surface px-6 py-14 lg:px-16">
        <div className="mx-auto w-full max-w-[368px]">
          <h2 className="font-display text-[24px] font-700 text-heading">Sign in</h2>
          <p className="mt-1.5 text-[13.5px] text-muted">Use your team account to continue.</p>

          {!isSupabaseConfigured && (
            <div className="mt-6 rounded-lg border border-[#FEDF89] bg-warning-50 px-4 py-3 text-tiny leading-relaxed text-warning-700">
              Supabase is not configured. Add <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> and{" "}
              <span className="font-mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</span> to{" "}
              <span className="font-mono">.env.local</span>, then restart the server.
            </div>
          )}

          <div className="mt-7 space-y-4">
            <Field label="Username">
              <input value={username} autoCapitalize="characters" autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="CRM" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" />
            </Field>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2.5 text-tiny leading-relaxed text-danger-700">{error}</p>
          )}

          <Button className="mt-6 w-full" disabled={!username || !password || busy} onClick={submit}>
            {busy ? "Signing in" : "Sign in"}
          </Button>

          <div className="mt-9">
            <div className="text-micro font-medium uppercase tracking-wide text-faint">Prototype accounts</div>
            <div className="mt-3 grid gap-2">
              {ROLES.map((r) => (
                <button key={r.user}
                  onClick={() => { setUsername(r.user); setPassword(r.pass); }}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2.5 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50">
                  <span className="text-tiny font-600 text-heading">{r.user}</span>
                  <span className="text-micro text-muted">{r.note}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
