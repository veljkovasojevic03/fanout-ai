"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

/*
 * Replaces the root layout when it fails, so it cannot rely on globals.css,
 * fonts, or any provider. Styles are inlined with the raw token values.
 */
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
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={styles.body}>
        <title>Something went wrong · Fanout AI</title>
        <main style={styles.wrap}>
          <h1 style={styles.title}>Fanout AI hit a snag.</h1>
          <p style={styles.text}>
            The app failed to load. Trying again usually fixes it — your saved content is safe.
          </p>
          <button type="button" style={styles.button} onClick={() => retry()}>
            Try again
          </button>
          {error.digest ? <p style={styles.ref}>ref: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
