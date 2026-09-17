"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { HOME_FOR_ROLE } from "@/types/user";

export default function Home() {
  const { profile, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(profile ? HOME_FOR_ROLE[profile.role] : "/login");
  }, [profile, loading, router]);

  return <div className="grid h-screen place-items-center eyebrow">Loading</div>;
}
