# Fanout AI

**One idea. Five formats.** Give Fanout one idea and it streams five ready-to-publish pieces at
once: a blog post (with SEO meta), a LinkedIn post, an Instagram caption, an email newsletter and
an X thread. UI in English and Serbian.

> **Status: in development.** This is a portfolio project built phase by phase. Phases 0–6 are
> done (foundation, data layer and auth, app shell, generator, library and editor, plans and
> billing, scheduling and publishing); the landing page is not built yet. The full README (demo
> link, architecture diagram, case study) lands in the final phase.

## What exists today

- Next.js 16 (App Router) + TypeScript strict + Tailwind v4, linted, formatted and tested
- A dark, single-accent design system: tokens, fonts, and an accessible component kit
- `/design` — a reference page showing every component in every state
- The full Postgres schema as migrations: RLS on every table, column-level grants, an atomic
  quota function and a rate limiter — with a database test suite that tries to break them
- Auth: email + password, password reset, Google OAuth, guest sessions (anonymous sign-in behind
  Cloudflare Turnstile) and guest → account upgrade that keeps saved content
- `/api/health` (runs a real database query)
- The app shell: sidebar, top bar with usage meter and plan badge, mobile bottom tabs; a dashboard
  with real usage data and quick-start presets; working profile settings
- Complete English and Serbian (Latin) UI — type-checked message keys and `pnpm i18n:check`
- A "Demo is waking up" screen for when the free-tier database is unreachable
- `/design/shell` — the shell and dashboard rendered with sample data, in every state
- The generator: one click streams up to five formats in parallel over SSE, with stop, copy,
  capped regenerate, save to library, live counters and a format check per piece
- Sample mode (hand-written fixtures, streamed) by default; Live mode (Claude) when
  `ANTHROPIC_API_KEY` is set and the global daily cap has room — same UI, same protocol
- A URL source fetcher hardened against SSRF, and prompts that treat fetched text as untrusted
- `/design/generator` — the streaming cards running on the public Sample-mode demo endpoint
- The library: search (title and text), format and tag filters, sorting and pagination
- An editor with a live preview per format, debounced autosave with a visible state, tags with
  autocomplete, duplicate and delete
- Refine — Shorten, Expand, Change tone, Translate — on a selection or the whole piece, streamed
  as a suggestion you accept or discard (and can undo); capped per generation and rate limited
- Export to `.txt`, `.md` and `.docx` (real Word headings, lists and links)
- `/design/library` — the list, the editor and the previews with sample data
- Plans and billing in Stripe **test mode**: Checkout, Customer Portal and a webhook that is the
  only thing able to change a plan — signature verified on the raw body, idempotent, plan derived
  from the subscription status in the database
- `/design/billing` — the pricing cards and Settings → Billing in every subscription state
- Publishing: "Publish now" or "Schedule" from the editor and the library, to your own verified
  email address or a Discord channel; a month calendar in your time zone, a job list with the
  attempt log, reschedule, cancel and Retry
- A dispatcher with two implementations: **n8n** (signed webhook out, signed callback back —
  HMAC-SHA256 over `timestamp.body`, constant-time compare, 5-minute window) and **simulated**
  (the default, and what the public demo uses; everything it touches is labelled "Simulated")
- `POST /api/cron/tick` — claims due jobs atomically (`FOR UPDATE SKIP LOCKED`), dispatches them,
  fails jobs stuck for 10 minutes, and doubles as the Supabase keep-alive; called every five
  minutes by a GitHub Actions workflow
- `n8n/` — docker-compose and two importable workflows for real delivery on your own machine
- `/design/publish` — the calendar, the dialogs and the destinations in every state

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

To try billing locally (Stripe test mode only — a live key is refused):

```bash
# STRIPE_SECRET_KEY=sk_test_… in .env.local, then:
pnpm stripe:setup               # creates the Pro product + $12/month price, prints STRIPE_PRO_PRICE_ID
# prints STRIPE_WEBHOOK_SECRET; recent Stripe CLI versions require the event list
stripe listen --forward-to localhost:3000/api/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed
```

Pay with card `4242 4242 4242 4242`, any future expiry date and any CVC.

Publishing works out of the box in **simulated** mode (nothing is sent, and the UI says so). For
scheduled jobs, set `CRON_SECRET` (at least 16 characters) in `.env.local` and run the local ticker
next to the dev server:

```bash
pnpm cron:dev                   # calls POST /api/cron/tick every 30 seconds
```

For real email and Discord delivery, run n8n with Docker and import the two workflows —
[`n8n/README.md`](n8n/README.md) walks through it.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm i18n:check       # en and sr have the same keys, ICU arguments and rich-text tags
pnpm test:db          # RLS, grants and quota — in-process Postgres, no Docker needed
pnpm test:db:remote   # the same suite against SUPABASE_DB_URL (every test is rolled back)
pnpm smoke            # end-to-end API check against a running app + the real Supabase project;
                      # creates a throwaway user and deletes it again (pnpm smoke http://localhost:3000)
pnpm build
```

## Project docs

- [`FANOUT_AI_PROMPT.md`](FANOUT_AI_PROMPT.md) — the full product and architecture spec
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decisions and their reasons
- [`CLAUDE.md`](CLAUDE.md) — working rules for AI-assisted development on this repo
