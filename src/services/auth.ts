"use client";

import { supabase } from "@/lib/supabase";
import { USERNAME_TO_EMAIL, type Profile } from "@/types/user";

/** The UI collects a username; Supabase Auth receives the mapped email. */
export async function signIn(username: string, password: string) {
  const email = USERNAME_TO_EMAIL[username.trim().toUpperCase()];
  if (!email) throw new Error("Unknown username. Use CATEGORY, CRM, CONTENT or EXECUTIVE.");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("That username and password do not match.");

  return getProfile();
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
