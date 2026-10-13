import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, authLinkClass } from "@/components/auth/auth-card";
import { GuestForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Try as guest" };

const INCLUDED = [
  "3 generations, five formats each",
  "Save pieces to your library",
  "Edit and export",
];
const NOT_INCLUDED = ["Publishing and scheduling", "Upgrading to Pro"];

export default async function GuestPage() {
  if (await getCurrentUser()) redirect("/app");

  return (
    <AuthCard
      title="Try Fanout as a guest"
      description="No email, no password. You can turn the guest session into a real account later and keep everything you made."
      footer={
        <p>
          Rather have an account?{" "}
          <Link href="/signup" className={authLinkClass}>
            Sign up free
          </Link>{" "}
          or{" "}
          <Link href="/login" className={authLinkClass}>
            log in
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col gap-2 text-sm">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />
              {item}
            </li>
          ))}
          {NOT_INCLUDED.map((item) => (
            <li key={item} className="flex items-center gap-2.5 text-muted">
              <X aria-hidden="true" className="size-4 shrink-0 text-subtle" />
              <span>
                <span className="sr-only">Not included: </span>
                {item}
              </span>
            </li>
          ))}
        </ul>
        <GuestForm />
      </div>
    </AuthCard>
  );
}
