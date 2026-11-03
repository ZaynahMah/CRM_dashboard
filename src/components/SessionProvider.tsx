"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadProfile } from "@/services/auth";
import type { Profile } from "@/types/user";

interface SessionValue {
  profile: Profile | null;
  loading: boolean;
  /** True when the last load FAILED — not when there is no session. */
  reconnecting: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue>({
  profile: null, loading: true, reconnecting: false, refresh: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

  const refresh = useCallback(async () => {
    const r = await loadProfile();
    if (r.status === "ok") {
      setProfile(r.profile);
      setReconnecting(false);
    } else if (r.status === "error") {
      /**
       * The call failed. KEEP the profile we already have so the page stays
       * exactly as it is — unsaved grid edits included — and show the
       * banner instead of redirecting.
       */
      setReconnecting(true);
    } else {
      setProfile(null);
      setReconnecting(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    /**
     * TOKEN_REFRESHED and INITIAL_SESSION are ignored: a silent background
     * refresh must not re-fetch the profile, and re-fetching on every token
     * rotation was both wasteful and a chance for a transient failure to
     * surface as a redirect.
     */
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
      refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  /** Retry quietly while disconnected, so recovery needs no user action. */
  useEffect(() => {
    if (!reconnecting) return;
    const t = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(t);
  }, [reconnecting, refresh]);

  return (
    <Ctx.Provider value={{ profile, loading, reconnecting, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
