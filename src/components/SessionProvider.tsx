"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadProfile } from "@/services/auth";
import type { Profile } from "@/types/user";

interface SessionValue {
  profile: Profile | null;
  loading: boolean;
  /** True when the last load FAILED — not when there is no session. */
  reconnecting: boolean;
  refresh: () => Promise<void>;
  /** Called before signOut(), to suppress the banner during a real exit. */
  beginSignOut: () => void;
}

const Ctx = createContext<SessionValue>({
  profile: null, loading: true, reconnecting: false,
  refresh: async () => {}, beginSignOut: () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  /** Set the instant Log out is clicked, so no banner can slip through. */
  const signingOut = useRef(false);

  const refresh = useCallback(async () => {
    const r = await loadProfile();
    if (r.status === "ok") {
      setProfile(r.profile);
      setReconnecting(false);
    } else if (r.status === "error" && !signingOut.current) {
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

      /**
       * SIGNED_OUT is definitive: there is no session, so clear everything
       * at once rather than asking loadProfile. Routing it through a
       * profile fetch is what produced "Reconnecting…" on Log out, because
       * getUser() then returns AuthSessionMissingError.
       */
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setReconnecting(false);
        setLoading(false);
        return;
      }
      refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  /**
   * A deliberate sign-out. The banner is suppressed from this moment on,
   * so nothing can reappear between the click and the navigation.
   */
  const beginSignOut = useCallback(() => {
    signingOut.current = true;
    setProfile(null);
    setReconnecting(false);
  }, []);

  /** Retry quietly while disconnected, so recovery needs no user action. */
  useEffect(() => {
    if (!reconnecting || signingOut.current) return;
    const t = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(t);
  }, [reconnecting, refresh]);

  return (
    <Ctx.Provider value={{ profile, loading, reconnecting, refresh, beginSignOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
