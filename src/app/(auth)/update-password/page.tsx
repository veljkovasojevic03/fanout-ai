import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { UpdatePasswordForm } from "@/components/auth/auth-forms";
import { getCurrentUser, isGuest } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Set a password" };

/*
 * Reached from an emailed link (password recovery, or confirming the email of a
 * guest who is upgrading). The link has already been exchanged for a session by
 * /auth/callback, so a visitor without one has an expired or reused link.
 */
export default async function UpdatePasswordPage() {
  const user = await getCurrentUser();
  if (isSupabaseConfigured()) {
    if (!user) redirect("/login?error=link_expired");
    // A guest has no email to attach a password to yet.
    if (isGuest(user)) redirect("/app/upgrade");
  }

  return (
    <AuthCard
      title="Set a password"
      description="Choose a password for your account. You'll use it with your email to log in."
    >
      <UpdatePasswordForm />
    </AuthCard>
  );
}
