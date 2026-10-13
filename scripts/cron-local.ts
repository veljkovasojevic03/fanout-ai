/**
 * pnpm cron:dev [base-url] — the local stand-in for .github/workflows/cron.yml.
 *
 * Calls POST /api/cron/tick every 30 seconds with the CRON_SECRET from
 * .env.local, so scheduled jobs go out while you develop. Prints a line only
 * when a tick did something. Stop it with Ctrl+C.
 */
export {};

const INTERVAL_MS = 30_000;

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the secret may come from the environment instead.
}

const secret = process.env.CRON_SECRET?.trim();
if (!secret || secret.length < 16) {
  console.error("cron:dev: CRON_SECRET is not set in .env.local (at least 16 characters).");
  process.exit(1);
}

const base = (process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const url = `${base}/api/cron/tick`;

type Summary = Record<string, number | boolean>;

async function tick(): Promise<void> {
  const at = new Date().toLocaleTimeString();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await response.json().catch(() => null)) as
      (Summary & { error?: { code?: string } }) | null;

    if (!response.ok) {
      console.error(`${at}  tick failed: HTTP ${response.status} ${body?.error?.code ?? ""}`);
      return;
    }
    const { claimed = 0, published = 0, failed = 0, accepted = 0, stuck = 0 } = body ?? {};
    if (claimed || stuck) {
      console.warn(
        `${at}  claimed ${claimed} — published ${published}, handed to n8n ${accepted}, failed ${failed}, stuck ${stuck}`,
      );
    }
  } catch (error) {
    console.error(`${at}  tick failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

console.warn(`cron:dev: calling ${url} every ${INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
await tick();
setInterval(() => void tick(), INTERVAL_MS);
