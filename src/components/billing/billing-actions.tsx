"use client";

import { CircleCheck, Info, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toBillingErrorCode, type BillingErrorCode } from "@/lib/billing/errors";

type BillingButtonProps = Pick<ButtonProps, "variant" | "size" | "className"> & {
  /** `checkout` starts a Pro subscription; `portal` opens Stripe's Customer Portal. */
  action: "checkout" | "portal";
  children: React.ReactNode;
};

/**
 * Asks the server for a Stripe-hosted page and goes there. The browser never
 * sees a key and never decides a plan: it only follows the URL it is given.
 */
export function BillingButton({ action, children, ...button }: BillingButtonProps) {
  const t = useTranslations("billing");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingErrorCode | null>(null);

  async function go() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST" });
      const body: unknown = await response.json().catch(() => null);
      const url = (body as { url?: unknown } | null)?.url;

      if (response.ok && typeof url === "string") {
        // Stays "pending" on purpose: the page is about to be replaced.
        window.location.assign(url);
        return;
      }
      setError(toBillingErrorCode((body as { error?: { code?: unknown } } | null)?.error?.code));
    } catch {
      setError("network_error");
    }
    setPending(false);
  }

  return (
    <>
      <Button {...button} onClick={go} loading={pending}>
        {pending ? t("actions.redirecting") : children}
      </Button>
      {error ? <FormAlert tone="error">{t(`errors.${error}`)}</FormAlert> : null}
    </>
  );
}

const POLL_MS = 2500;
const MAX_POLLS = 8;

type BillingReturnNoticeProps = {
  /** `?billing=` from the URL Stripe sent the user back to. */
  outcome: "success" | "cancelled";
  /** Whether the account is Pro in the data this page was rendered with. */
  isPro: boolean;
};

/**
 * Shown after coming back from Checkout. Paying does not make the account Pro
 * — the webhook does, usually a moment later — so on success this re-renders
 * the page until the plan has changed, and says so honestly if it takes long.
 */
export function BillingReturnNotice({ outcome, isPro }: BillingReturnNoticeProps) {
  const t = useTranslations("billing.return");
  const router = useRouter();
  const [polls, setPolls] = useState(0);

  const waiting = outcome === "success" && !isPro && polls < MAX_POLLS;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => {
      setPolls((count) => count + 1);
      router.refresh();
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, polls, router]);

  if (outcome === "cancelled") {
    return (
      <p
        role="status"
        className="flex items-start gap-2.5 rounded-md border border-border bg-white/[0.03] px-3 py-2.5 text-[13px] leading-snug text-muted"
      >
        <Info aria-hidden="true" className="mt-px size-4 shrink-0" />
        {t("cancelled")}
      </p>
    );
  }

  if (isPro) return <FormAlert tone="success">{t("confirmed")}</FormAlert>;

  return (
    <p
      role="status"
      className="flex items-start gap-2.5 rounded-md border border-accent-ring bg-accent-soft px-3 py-2.5 text-[13px] leading-snug"
    >
      {waiting ? (
        <LoaderCircle
          aria-hidden="true"
          className="mt-px size-4 shrink-0 animate-spin text-accent"
        />
      ) : (
        <CircleCheck aria-hidden="true" className="mt-px size-4 shrink-0 text-muted" />
      )}
      {waiting ? t("confirming") : t("slow")}
    </p>
  );
}
