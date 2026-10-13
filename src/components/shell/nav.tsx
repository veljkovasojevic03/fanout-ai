"use client";

import {
  CalendarDays,
  LayoutDashboard,
  Library,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

type NavKey = "dashboard" | "generate" | "library" | "calendar" | "settings";

const NAV_ITEMS: readonly { key: NavKey; href: Route; icon: LucideIcon }[] = [
  { key: "dashboard", href: "/app", icon: LayoutDashboard },
  { key: "generate", href: "/app/generate", icon: Sparkles },
  { key: "library", href: "/app/library", icon: Library },
  { key: "calendar", href: "/app/calendar", icon: CalendarDays },
  { key: "settings", href: "/app/settings", icon: Settings },
];

/** The dashboard is only active on its exact path; sections also match their sub-pages. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Vertical navigation for the desktop sidebar. */
export function SidebarNav() {
  const t = useTranslations("shell");
  const pathname = usePathname();

  return (
    <nav aria-label={t("navLabel")}>
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
          const active = isNavItemActive(href, pathname);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-white/[0.07] text-foreground"
                    : "text-muted hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("size-4 shrink-0", active && "text-accent")}
                />
                {t(`nav.${key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Fixed bottom tab bar for small screens. */
export function BottomNav() {
  const t = useTranslations("shell");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("navLabel")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 px-1.5">
        {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
          const active = isNavItemActive(href, pathname);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 rounded-md text-[10.5px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className={cn("size-5", active && "text-accent")} />
                <span className="max-w-full truncate px-1">{t(`nav.${key}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
