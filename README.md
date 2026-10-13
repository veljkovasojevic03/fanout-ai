# Fanout AI

**One idea. Five formats.** Give Fanout one idea and it streams five ready-to-publish pieces at
once: a blog post (with SEO meta), a LinkedIn post, an Instagram caption, an email newsletter and
an X thread. UI in English and Serbian.

> **Status: in development.** This is a portfolio project built phase by phase. Phase 0
> (foundation and design system) is done; the generator, library, billing and publishing are not
> built yet. The full README (demo link, architecture diagram, case study) lands in the final phase.

## What exists today

- Next.js 16 (App Router) + TypeScript strict + Tailwind v4, linted, formatted and tested
- A dark, single-accent design system: tokens, fonts, and an accessible component kit
- `/design` — a reference page showing every component in every state
- The full Postgres schema as migrations: RLS on every table, column-level grants, an atomic
  quota function and a rate limiter — with a database test suite that tries to break them
- Auth: email + password, password reset, Google OAuth, guest sessions (anonymous sign-in behind
  Cloudflare Turnstile) and guest → account upgrade that keeps saved content
- A protected `/app` area and `/api/health` (runs a real database query)

## Run locally

Requires Node.js 22.12+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then fill in the Supabase values
pnpm dev                     # http://localhost:3000 — design system at /design
```

Without Supabase keys the app still runs: the auth screens explain what is missing and
`/api/health` answers `503 not_configured`.

To connect a Supabase project:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <your-project-ref>
pnpm exec supabase db push      # applies supabase/migrations
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db          # RLS, grants and quota — in-process Postgres, no Docker needed
pnpm test:db:remote   # the same suite against SUPABASE_DB_URL (every test is rolled back)
pnpm build
```

## Project docs

- [`FANOUT_AI_PROMPT.md`](FANOUT_AI_PROMPT.md) — the full product and architecture spec
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decisions and their reasons
- [`CLAUDE.md`](CLAUDE.md) — working rules for AI-assisted development on this repo
