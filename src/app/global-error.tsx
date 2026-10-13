"use client"; // Error boundaries must be Client Components

import { useEffect, useState } from "react";

import en from "../../messages/en.json";
import sr from "../../messages/sr.json";

/*
 * Replaces the root layout when it fails, so it cannot rely on globals.css,
 * fonts, or any provider — including the i18n provider. Styles are inlined with
 * the raw token values, and the language is read straight from the cookie.
 */
const COPY = {
  en: { ...en.globalError, tryAgain: en.common.tryAgain, reference: en.error.reference },
  sr: { ...sr.globalError, tryAgain: sr.common.tryAgain, reference: sr.error.reference },
};

// Must match LOCALE_COOKIE in src/i18n/config.ts.
const isSerbian = () =>
  typeof document !== "undefined" && /(?:^|;\s*)FANOUT_LOCALE=sr(?:;|$)/.test(document.cookie);

const styles = {
  body: {
    margin: 0,
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "#0a0a0b",
    color: "#ededef",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    textAlign: "center",
  },
  wrap: { maxWidth: 420 },
  title: { margin: "0 0 12px", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" },
  text: { margin: "0 0 24px", color: "#8b8b94", lineHeight: 1.6 },
  button: {
    height: 40,
    padding: "0 18px",
    border: 0,
    borderRadius: 10,
    background: "#b6ff3b",
    color: "#0a0a0b",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  ref: {
    marginTop: 20,
    color: "#5d5d66",
    fontSize: 12,
    fontFamily: "ui-monospace, 'SFMono-Regular', monospace",
  },
} satisfies Record<string, React.CSSProperties>;

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [locale] = useState<"en" | "sr">(() => (isSerbian() ? "sr" : "en"));
  const copy = COPY[locale];

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={locale === "sr" ? "sr-Latn" : "en"} suppressHydrationWarning>
      <body style={styles.body}>
        <title>{copy.metaTitle}</title>
        <main style={styles.wrap} suppressHydrationWarning>
          <h1 style={styles.title} suppressHydrationWarning>
            {copy.title}
          </h1>
          <p style={styles.text} suppressHydrationWarning>
            {copy.description}
          </p>
          <button
            type="button"
            style={styles.button}
            onClick={() => retry()}
            suppressHydrationWarning
          >
            {copy.tryAgain}
          </button>
          {error.digest ? (
            <p style={styles.ref} suppressHydrationWarning>
              {copy.reference.replace("{id}", error.digest)}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
