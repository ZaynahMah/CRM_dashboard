"use client";

import { supabase } from "@/lib/supabase";
import type { AppNotification } from "@/types/campaign";
import type { AppRole } from "@/types/user";

export async function listNotifications(role: AppRole) {
  const { data } = await supabase
    .from("notifications").select("*")
    .eq("target_role", role).order("created_at", { ascending: false }).limit(30);
  return (data ?? []) as AppNotification[];
}

export async function markRead(id: string) {
  await supabase.from("notifications").update({ is_read: true }).eq("id", id);
}

export async function markAllRead(role: AppRole) {
  await supabase.from("notifications").update({ is_read: true }).eq("target_role", role).eq("is_read", false);
}
