import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, authLinkClass } from "@/components/auth/auth-card";
import { GoogleButton, LoginForm } from "@/components/auth/auth-forms";
import { OrDivider } from "@/components/auth/form-parts";
import { isAuthErrorCode } from "@/lib/auth/errors";
import { getCurrentUser, isGuest } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const initialError = isAuthErrorCode(params.error) ? params.error : undefined;

  // Guests may still log in to an existing account; everyone else is already in.
  const user = await getCurrentUser();
  if (user && !isGuest(user)) redirect("/app");

  return (
    <AuthCard
      title="Welcome back"
      description="Log in to your Fanout workspace."
      footer={
        <>
          <p>
            New here?{" "}
            <Link href="/signup" className={authLinkClass}>
              Create an account
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
        <GoogleButton next={next} label="Continue with Google" />
        <OrDivider>or</OrDivider>
        <LoginForm next={next} initialError={initialError} />
        <Link href="/reset-password" className={`${authLinkClass} self-center text-sm`}>
          Forgot your password?
        </Link>
      </div>
    </AuthCard>
  );
}
