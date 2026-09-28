"use client";

import { supabase } from "@/lib/supabase";
import { USERNAME_TO_EMAIL, type Profile } from "@/types/user";

/** The UI collects a username; Supabase Auth receives the mapped email. */
export async function signIn(username: string, password: string) {
  const uname = username.trim().toUpperCase();
  const email = USERNAME_TO_EMAIL[uname];
  if (!email) {
    throw new Error(
      `Unknown username. Use ${Object.keys(USERNAME_TO_EMAIL).join(", ")}.`
    );
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("That username and password do not match.");

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
   * existed. DESIGN is the account this affects, since DESIGN is exactly
   * what migration 08 added.
   *
   * Naming the cause here turns an unexplained bounce into a fixable
   * message. The repair itself is a one-row backfill; see
   * supabase/13_backfill_missing_profiles.sql.
   */
  if (!profile) {
    throw new Error(
      `Signed in as ${uname}, but this account has no profile row, so the app ` +
      `cannot tell which role you are. This happens when the auth user was ` +
      `created before the role existed in the database. Run ` +
      `supabase/13_backfill_missing_profiles.sql to repair it.`
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
