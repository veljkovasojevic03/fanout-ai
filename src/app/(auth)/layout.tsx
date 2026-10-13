import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { LanguageSwitcher } from "@/components/shell/language-switcher";

// Auth screens carry tokens in URLs and are useless to search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid" />
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <Link href="/" className="inline-flex rounded-sm">
          <Wordmark />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center px-5 pt-6 pb-16 sm:items-center sm:pt-0">
        {children}
      </main>
    </div>
  );
}
