"use client";

import { supabase } from "@/lib/supabase";
import { isSessionGone } from "@/lib/authError";
import { USERNAME_TO_EMAIL, type Profile } from "@/types/user";

/** The UI collects a username; Supabase Auth receives the mapped email. */
export async function signIn(username: string, password: string) {
  const uname = username.trim().toUpperCase();
  const email = USERNAME_TO_EMAIL[uname];

  /**
   * One message for every failure, whatever the cause.
   *
   * The previous version said "Unknown username. Use CATEGORY, CRM, ..." —
   * which printed the full list of valid accounts to anyone who guessed
   * wrong — and used a different message for a bad password. Between them
   * those two behaviours let anyone enumerate who exists and then confirm a
   * username by watching which error came back. An unknown username and a
   * wrong password are now indistinguishable from outside.
   */
  const GENERIC = "Invalid username or password.";

  if (!email) throw new Error(GENERIC);

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(GENERIC);

  const profile = await getProfile();

  /**
   * Authentication can succeed while the profiles row is missing, and that
   * combination used to fail silently: getProfile() returned null, the app
   * shell saw no profile and bounced straight back to /login, with nothing
   * on screen to say why.
   *
   * It happens when an auth user was created BEFORE migration 08 taught
   * handle_new_auth_user() about that role — the trigger only fires on
   * INSERT into auth.users, so it never ran for accounts that already
   * existed. It affected the DESIGN account, which has since been removed
   * from the app; the backfill remains for any other role added later.
   *
   * Naming the cause here turns an unexplained bounce into a fixable
   * message. The repair itself is a one-row backfill; see
   * supabase/13_backfill_missing_profiles.sql.
   */
  if (!profile) {
    // Reached only AFTER the password has been verified, so this reveals
    // nothing to someone who is not already authenticated. Kept detailed
    // because it is the one failure an admin has to act on.
    throw new Error(
      "Signed in, but this account has no profile and no role. " +
      "Ask an administrator to repair it before continuing."
    );
  }

  return profile;
}

/**
 * The outcome of loading the signed-in profile.
 *
 * "no session" and "the call failed" used to collapse into `null`, so a
 * network blip looked exactly like a sign-out and `AppShell` redirected to
 * /login — losing any unsaved grid edits. They are now distinct.
 */
export type ProfileResult =
  | { status: "ok"; profile: Profile }
  | { status: "no-session" }
  | { status: "error"; message: string };

export async function loadProfile(): Promise<ProfileResult> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) {
    /**
     * An auth error means the session is GONE — sign the user out properly.
     * Only a retryable failure keeps them where they are. Treating
     * AuthSessionMissingError as "reconnecting" is what stopped Log out
     * from working.
     */
    if (isSessionGone(authError)) return { status: "no-session" };
    return { status: "error", message: authError.message };
  }
  if (!auth.user) return { status: "no-session" };

  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", auth.user.id).single();
  if (error) {
    // A missing row is a real "no profile"; anything else is a failed call.
    if (error.code === "PGRST116") return { status: "no-session" };
    if (isSessionGone(error)) return { status: "no-session" };
    return { status: "error", message: error.message };
  }
  return { status: "ok", profile: data as Profile };
}

/** Back-compat wrapper. Prefer `loadProfile` — it keeps the distinction. */
export async function getProfile(): Promise<Profile | null> {
  const r = await loadProfile();
  return r.status === "ok" ? r.profile : null;
}

/**
 * A deliberate sign-out.
 *
 * `scope: "local"` clears this browser's stored session even when the
 * server call fails, so a network problem can never leave someone stuck
 * signed in. The caller then hard-navigates, which drops all React state.
 */
export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignored on purpose: the local session is cleared either way and the
    // caller is leaving the app.
  }
}
