import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import "./globals.css";

const geistSans = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    metadataBase: appUrl ? new URL(appUrl) : undefined,
    title: { default: t("title"), template: "%s · Fanout AI" },
    description: t("description"),
    applicationName: "Fanout AI",
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("common")]);

  return (
    <html lang={locale} className={cn(geistSans.variable, jetbrainsMono.variable)}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          {children}
          <Toaster containerAriaLabel={t("notifications")} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
