# Fanout AI

One idea → five formats (blog, LinkedIn, Instagram, email, X thread). Portfolio SaaS, $0 to run.
Full spec: `FANOUT_AI_PROMPT.md`. Built phase by phase — finish one phase, then stop.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · Radix (shadcn-style kit) · Supabase
(Postgres, Auth, RLS, `@supabase/ssr`) · `@anthropic-ai/sdk` · Stripe (test mode) · next-intl ·
zod · Vitest · Playwright · pnpm. Deploy: Vercel Hobby. CI/cron: GitHub Actions.

## Commands

- `pnpm dev` — dev server (`/design` = every component; `/design/{shell,generator,library,billing,publish}` = previews)
- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm i18n:check` · `pnpm build`
- `pnpm test:db` — RLS/grant/quota tests on in-process Postgres (`test:db:remote` = real DB) · `pnpm cron:dev` — local cron tick
- `pnpm format` — Prettier (also sorts Tailwind classes) · `pnpm stripe:setup` — Pro product + price (test mode)

## Folder map

- `src/app/` — routes, layouts, error boundaries, `globals.css` (design tokens)
- `src/components/ui/` — internal kit (Button, Card, Field, Input, Select, Dialog, Toast…)
- `src/components/{brand,layout,shell,auth,…}/` — wordmark, app shell, feature components
- `src/lib/` — `supabase/` `auth/` `generation/` `llm/` `sample/` `source/` `content/` `library/` `refine/` `billing/` `publish/`; server code imports `server-only`
- `src/proxy.ts` — session refresh + first-line redirect for `/app/*` (Next 16 "proxy")
- `supabase/migrations/` — the only place the DB schema changes; covered by `tests/db/`
- `messages/` — `en.json`, `sr.json` (identical keys); `src/i18n/` — locale config and checks
- `docs/DECISIONS.md` — one line per non-obvious decision · `n8n/` — compose + workflows (see its README)

## Rules

- **Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before finishing any task** (+ `test:db` on SQL).
- **All user-facing strings go through i18n** (`en` + `sr` Latin), including errors, toasts, meta.
- **DB changes only via migrations.** Never edit the schema in the dashboard.
- **Never expose the service-role key.** Only modules importing `server-only` may read it.
- **Nothing sensitive in `localStorage`.**
- Do not invent library APIs: check installed types or `node_modules/next/dist/docs`.
- Every screen has loading, empty, and error states. No stubs that pretend to work.
- UI uses the tokens in `globals.css`; add new components to `/design`.

## Security rules (short form of spec §5)

1. `plan`, Stripe fields, usage counters are server-only: RLS + column-level grants.
2. Quota is atomic in SQL: `consume_generation()` (SECURITY DEFINER), service-role only.
3. Global daily cap on live generations → silent fallback to Sample mode.
4. Validate every route input with zod; errors are `{ error: { code, message } }`, `code` is
   i18n-mapped; no raw errors or stack traces to users.
5. Rate limit generate, refine, publish, URL fetch via `check_rate_limit()` in Postgres.
6. Streaming: `POST /api/generate` then one `POST /api/generate/stream` per type (SSE over
   `fetch`); verify ownership, status, and stream-once per (generation, type).
7. URL source = SSRF + prompt-injection surface: https only, block private/loopback/link-local/
   metadata IPs (re-check each redirect, max 3), 8s timeout, 1 MB, text only; wrap in `<source>`
   and tell the model it is untrusted data.
8. n8n ⇄ app calls: HMAC-SHA256 over `timestamp.body`, constant-time compare, 5-min window.
9. Stripe webhook: verify on the raw body, idempotent via `stripe_events`, plan derived from
   subscription status only.
10. Validate model output against the content contracts; warn in UI, never silently truncate.
11. Discord webhook URLs: per-user under RLS, never logged or returned to others.
12. Accessibility: keyboard, visible focus, `aria-live="polite"` on streams, AA contrast, labels.
13. Logs are structured and contain no secrets or full prompts.
