"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { FanoutMark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

const RETRY_SECONDS = 10;
/** After this many failed checks we stop implying it will be back in a moment. */
const PATIENCE_ATTEMPTS = 6;

/**
 * Shown instead of the app when the database or auth server cannot be reached
 * (free-tier Supabase projects pause when idle). Re-renders the route every few
 * seconds; as soon as the server can reach the backend again, the layout renders
 * the real app in place of this screen.
 */
export function WakingUp() {
  const t = useTranslations("wakingUp");
  const router = useRouter();
  const [seconds, setSeconds] = useState(RETRY_SECONDS);
  const [attempts, setAttempts] = useState(0);
  const [checking, startCheck] = useTransition();
  // The countdown lives in a ref so the interval callback stays a plain event
  // handler (no state updates nested inside state updaters).
  const remaining = useRef(RETRY_SECONDS);

  const check = useCallback(() => {
    remaining.current = RETRY_SECONDS;
    setSeconds(RETRY_SECONDS);
    setAttempts((count) => count + 1);
    startCheck(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      remaining.current -= 1;
      if (remaining.current <= 0) check();
      else setSeconds(remaining.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [check]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="relative flex size-16 items-center justify-center rounded-2xl border border-border bg-surface">
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ping rounded-2xl border border-accent-ring opacity-40 [animation-duration:2.4s]"
          />
          <FanoutMark className="size-8" />
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="leading-relaxed text-muted">{t("description")}</p>
        </div>
        <p role="status" aria-live="polite" className="counter text-sm text-muted">
          {checking ? t("checking") : t("nextCheck", { seconds })}
        </p>
        {attempts >= PATIENCE_ATTEMPTS ? (
          <p className="rounded-md border border-warn/25 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
            {t("stillDown")}
          </p>
        ) : null}
        <Button variant="secondary" onClick={check} loading={checking}>
          {t("checkNow")}
        </Button>
      </div>
    </div>
  );
}
