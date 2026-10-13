"use client";

import { LogOut, Settings, User, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/lib/auth/actions";

type UserMenuProps = {
  /** Display name or email; null for guests. */
  name: string | null;
  email: string | null;
  guest: boolean;
};

export function UserMenu({ name, email, guest }: UserMenuProps) {
  const t = useTranslations("shell.userMenu");
  const [pending, startTransition] = useTransition();
  const initial = (name ?? email ?? "").trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("open")}
        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-elevated text-[13px] font-semibold text-foreground transition-colors hover:border-accent-ring data-[state=open]:border-accent-ring"
      >
        {initial ? (
          <span aria-hidden="true">{initial}</span>
        ) : (
          <User aria-hidden="true" className="size-4 text-muted" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          {guest ? (
            t("guest")
          ) : (
            <>
              {name ? <span className="block font-medium text-foreground">{name}</span> : null}
              <span className="block max-w-56 truncate">{email}</span>
            </>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {guest ? (
          <DropdownMenuItem asChild>
            <Link href="/app/upgrade">
              <UserPlus aria-hidden="true" />
              {t("upgrade")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings aria-hidden="true" />
            {t("settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={() => startTransition(() => signOutAction())}
        >
          <LogOut aria-hidden="true" />
          {guest ? t("endSession") : t("logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
