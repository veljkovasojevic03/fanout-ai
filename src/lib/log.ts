import "server-only";

type Fields = Record<string, string | number | boolean | null | undefined>;

/**
 * Structured server logs: one JSON object per line, easy to filter in Vercel.
 *
 * Only pass identifiers, codes and counts. Never pass secrets, tokens, emails,
 * webhook URLs, prompts or generated content — the `Fields` type is restricted
 * to primitives on purpose, to make dumping whole objects awkward.
 */
function write(level: "warn" | "error", event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.warn(line);
}

export const log = {
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
