import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, authLinkClass } from "@/components/auth/auth-card";
import { GoogleButton, SignupForm } from "@/components/auth/auth-forms";
import { OrDivider } from "@/components/auth/form-parts";
import { getCurrentUser, isGuest } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  const user = await getCurrentUser();
  // A guest "signing up" should upgrade in place, so their saved content comes along.
  if (user) redirect(isGuest(user) ? "/app/upgrade" : "/app");

  return (
    <AuthCard
      title="Create your account"
      description="Free plan: 5 generations a month, five formats each. No card needed."
      footer={
        <>
          <p>
            Already have an account?{" "}
            <Link href="/login" className={authLinkClass}>
              Log in
            </Link>
          </p>
          <p>
            Just looking?{" "}
            <Link href="/guest" className={authLinkClass}>
              Try as guest
            </Link>
          </p>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <GoogleButton next={next} label="Sign up with Google" />
        <OrDivider>or</OrDivider>
        <SignupForm next={next} />
      </div>
    </AuthCard>
  );
}
