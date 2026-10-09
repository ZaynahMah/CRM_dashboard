"use client";

import { supabase } from "@/lib/supabase";
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

export async function getProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", auth.user.id).single();
  if (error) return null;
  return data as Profile;
}

export const signOut = () => supabase.auth.signOut();
