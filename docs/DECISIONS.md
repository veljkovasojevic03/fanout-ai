# Decisions

One line per non-obvious decision: what was chosen and why. Newest at the bottom of each phase.

## Phase 0 — Foundation & design system

- **TypeScript 6.0.x, not 7.x** — `typescript-eslint` 8 (pulled in by `eslint-config-next`) only supports `<6.1.0`; a linter that cannot parse the code is worse than a newer compiler.
- **ESLint 9.x, not 10.x** — `eslint-plugin-react`, `-import` and `-jsx-a11y` (dependencies of `eslint-config-next`) do not declare ESLint 10 support yet; revisit when they do.
- **Scaffolded by hand instead of `create-next-app`** — the folder name ("Fanout Ai") is not a valid npm package name, and a hand-written scaffold contains only what the project uses.
- **Own git repository in the project folder** — the folder sat inside an unrelated, commit-less repo rooted at the user's home directory; committing there would have tracked personal files.
- **pnpm installed with `npm i -g pnpm`** — `corepack enable` needs admin rights to write into `Program Files\nodejs` on this machine.
- **`unrs-resolver` build script denied** (`pnpm-workspace.yaml`) — its postinstall only downloads a native binary that the optional platform package already provides; fewer install scripts is the safer default.
- **shadcn/ui patterns ported by hand, no `components.json`/CLI** — same recipe (Radix primitives + `cva` + `cn`, `data-slot` attributes), but written directly against Fanout's own token names, so there is no generated code to restyle.
- **Token names follow spec §8 (`surface`, `elevated`, `muted`, `accent`…), not shadcn's** — in shadcn `accent` means "hover surface"; here it is the single brand color, and one meaning per name avoids mistakes.
- **Unified `radix-ui` package** instead of per-primitive `@radix-ui/react-*` packages — one dependency and one version to keep in sync.
- **Toast = `sonner`** — it is what shadcn/ui itself ships for toasts; accessible live region, promise toasts, tiny API.
- **Fonts: Geist + JetBrains Mono through `next/font/google`** — self-hosted at build time (no runtime request to Google, no layout shift); `latin-ext` subset is included for Serbian Latin (č ć ž š đ).
- **`Field` component with context** — label, hint and error are wired to the control (`id`, `aria-describedby`, `aria-invalid`) automatically, so accessible forms are the default rather than a per-form chore.
- **`Dialog` requires a `closeLabel` prop** — the close button's accessible name must be translated, so the kit refuses to hard-code it.
- **`global-error.tsx` uses inline styles** — it replaces the root layout when that layout fails, so it must not depend on `globals.css`, fonts or providers.
- **`typedRoutes` enabled; `pnpm typecheck` runs `next typegen` first** — internal links are checked at compile time, and typecheck works on a clean checkout (CI) without a prior build.
- **Wordmark is an SVG mark plus HTML text, not one SVG with `<text>`** — text inside a standalone SVG depends on fonts the viewer may not have; composing it in HTML keeps it crisp and correctly spaced.
- **`motion` is not installed yet** — nothing in Phase 0 needs it (dialog/select transitions are CSS); it is added in the phase that first animates with it.
- **Phase 0 screens (home placeholder, 404, error, `/design`) have English strings in code** — `next-intl` arrives in Phase 2, which moves every user-facing string into `messages/`; `/design` is an internal page and stays English.
- **`LLM_MODEL_FREE` default is `claude-haiku-4-5-20251001`** — the spec's `claude-haiku-5-5` does not exist; current models are Sonnet 5.5 / Opus 5.5 / Haiku 4.5. To be re-verified against Anthropic's docs in Phase 3.
- **The `frontend-design` skill named in spec §8 is not available in this environment** — the design system was built directly from the §8 references and tokens instead.

## Phase 1 — Database, RLS, auth, guest mode

- **`pnpm test:db` runs on PGlite (Postgres compiled to WASM) by default** — no Docker on the dev machine and none needed in CI; the same suite runs against a real Supabase database with `pnpm test:db:remote` (`SUPABASE_DB_URL`), inside transactions that are rolled back.
- **The PGlite harness reproduces Supabase's permissive defaults** (ALL on new public tables/functions for `anon`/`authenticated`) — so the tests prove the migrations lock things down themselves instead of passing because the sandbox was strict.
- **Every table: revoke all, then grant back explicitly, on top of RLS** — a forgotten policy or a changed platform default then fails closed. Server-only columns are protected by column-level `GRANT UPDATE (...)`, so `update profiles set plan='pro'` is refused by Postgres before any policy runs.
- **`consume_generation` is one conditional `UPDATE ... WHERE generations < limit`** rather than `SELECT ... FOR UPDATE` then update — check and increment are a single statement, so there is no window between them; the row lock is implicit.
- **`check_rate_limit` is a fixed window** (one upsert per call) — simplest thing that is correct under concurrency; a burst at a window edge can reach 2× the limit, acceptable for abuse protection. `prune_rate_limits()` is called from the Phase 6 cron tick.
- **`publish_destinations.config` is validated by a CHECK constraint** — an email destination may carry no address (it always goes to the account's own email) and a Discord destination must match the webhook URL pattern exactly, so an invalid destination cannot be stored even by a client that bypasses the UI.
- **Guests cannot insert `publish_destinations` (RLS)** — "guests cannot publish" is enforced in the database, not only in the UI.
- **`generations.source_text` column added** (not in the spec's column list) — the per-type stream requests arrive after `POST /api/generate` and need the extracted source text.
- **`generations.status` is `pending | completed | failed`** — the spec names the column but not its values; per-type "streamed once" tracking is added with the generator in Phase 3.
- **Auth mutations are Server Actions with zod validation**, not browser-side `supabase.auth.*` calls — one place validates input, maps Supabase errors to stable UI codes, and sanitises `next` redirects.
- **Session-dependent pages call `connection()`** — they must never be prerendered, even in a build made without Supabase env vars (which would otherwise bake a static redirect into `/app`).
- **`getUser()` in the `/app` layout, `getClaims()` in the proxy** — the proxy only refreshes cookies and does a cheap first redirect; the layout verifies the user against the Auth server.
- **One `/auth/callback` handles `?code=` (PKCE) and `?token_hash=&type=`** — works with Supabase's default email templates today and with custom cross-device templates later, without a second route.
- **Guest → email upgrade is two steps: confirm email, then set password** — Supabase only accepts a password for a verified email; the user id never changes, so saved content stays attached.
- **Turnstile token is a controlled hidden field and the widget is remounted after each submit** — tokens are single-use; a failed attempt must not resubmit a spent token.
- **No widget when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is empty** — keeps local development possible with CAPTCHA switched off in Supabase.
- **Password reset always answers "if an account exists…"** — no account enumeration through the reset form.
- **The Supabase client is untyped for now; rows read on the server are parsed with zod** — generated `Database` types need a linked project (`supabase gen types`), which does not exist yet.
- **Auth screens and `/app` have English strings in code** — same as Phase 0: `next-intl` moves them into `messages/` in Phase 2. All auth errors are already code-based, so only the dictionaries move.
- **A minimal `/app` frame instead of the app shell** — the sidebar, usage meter and language switcher are Phase 2; this phase only needs a protected area that proves the session, plan and usage are real.
