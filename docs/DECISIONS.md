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

## Phase 2 — App shell, i18n, dashboard

- **Locale comes from a cookie, not the URL** (`next-intl` without i18n routing) — matches the spec ("stored in profile and in a cookie"), keeps every link and auth redirect locale-free, and avoids a `[locale]` segment around the whole app. Trade-off: one URL per page, so no per-language URLs for search engines; revisit in Phase 7 if hreflang matters.
- **App locale is `en | sr`, Intl locale is `en | sr-Latn`** — plain `sr` makes `Intl` print dates and plurals in Cyrillic. The profile, cookie and file names use `sr`; formatting and `<html lang>` use `sr-Latn`.
- **First visit follows `Accept-Language`; after that the cookie wins** — a Serbian browser gets Serbian without clicking anything, but an explicit choice is never overridden.
- **On sign-in the cookie and `profiles.ui_language` are reconciled** — cookie present: it wins and is saved to the profile; no cookie (new device): the profile's language is applied.
- **Message keys are type-checked** (`AppConfig.Messages = typeof en.json`) — a mistyped or missing key fails `pnpm typecheck`, not at runtime.
- **`pnpm i18n:check` compares ICU arguments and rich-text tags, not just keys** — a translation that drops `{count}` or `<link>` renders wrong while key parity still passes.
- **The check script runs on plain Node (type stripping)** — no `tsx`/build step; hence `"type": "module"` and Node >= 22.18.
- **`global-error.tsx` imports both catalogues and reads the cookie itself** — it replaces the root layout, so the i18n provider does not exist there.
- **Serbian copy avoids gendered past-tense forms** ("Zdravo ponovo", not "Dobro došao") — the app does not know the user's gender.
- **`/design` and `/design/shell` stay English** — internal reference pages, not product UI.
- **Session state has three outcomes: signed in, signed out, unavailable** — a paused database must show "Demo is waking up", never bounce a signed-in user to the login page. The proxy therefore does not redirect when the Auth server is unreachable.
- **"Waking up" retries with `router.refresh()`** rather than polling `/api/health` — the server re-evaluates the real condition, and the screen does not depend on the service-role key being configured.
- **The "waking up" copy admits a paused free-tier project needs a manual restart** — Supabase does not auto-resume paused projects; promising "back in a minute" forever would be a lie.
- **`AppShell` and `DashboardView` are presentational; the layout/page only load data** — keeps data access in one place and lets `/design/shell` render every shell state (free, guest, pro, load error, waking up) with sample data, no session needed.
- **One `getAccount()` feeds every usage number** (top bar, dashboard, settings) — a single definition of "used this period", matching `consume_generation()`'s UTC month.
- **Generate / Library / Calendar are labelled "Not built yet" pages, not hidden nav items** — the shell is complete and honest; `/app/generate?preset=…` already validates the preset and shows what will be prefilled.
- **Preset lengths are clamped to the plan's `max_length`** — a preset can never offer a Free user a Long generation.
- **Content-type icons are generic glyphs, not brand logos** — no third-party trademarks in the product UI.
- **Server-rendered times use UTC** — the server does not know the visitor's time zone; relative times ("2 hours ago") are unaffected, and user-local times arrive with the calendar in Phase 6.
- **Mobile top bar shows the mark only and the dashboard repeats the guest call to action** — the full wordmark and the sidebar do not fit at 375px.

## Phase 3 — Generator (Sample + Live, parallel streaming)

- **`start_generation()` does quota, plan gating, the daily cap and the insert in one SQL function** — one transaction, so a failed insert rolls the quota back and a refused request (wrong length, bad source) never costs a generation. It calls `consume_generation()` internally, which stays the single place the counter moves.
- **The URL source is fetched before `start_generation()`** — a page that cannot be read must not use up a generation.
- **New table `generation_streams` with primary key `(generation_id, type)`** — "each piece streams once" is a database guarantee, not an in-memory check that two server instances could both pass.
- **Regenerate is a separate endpoint and shares the 10-per-generation budget with refine** (`generations.refinements_used`) — checked and incremented under a row lock on the generation.
- **A retry after a dropped connection goes through the regenerate path** — the first stream was already claimed; the client switches path by itself once if the two get out of step.
- **A live generation takes one slot of the global daily cap, whatever number of formats it has** — matches "one click = one generation"; worst case is 5 streams + 10 regenerations per slot, each with a small `max_tokens`.
- **Mode is decided once, at `POST /api/generate`, and stored** — every stream of a generation is the same mode; if the API key disappears later, streams fall back to sample and `meta.mode` says so.
- **Sample and live output go through the same `createStreamResponse()`** — that single code path is why the UI cannot tell them apart except for `meta.mode`.
- **Contract warnings are computed on the server and sent in the `done` event**; the live counters in the card use the same pure functions from `lib/content/contracts.ts`, so the two cannot disagree.
- **Blog word-target is not checked for sample output** — fixtures are written at one (Short) length whatever the slider says; every other contract rule is enforced on them by tests.
- **Fixtures answer three of the dashboard presets**, matched by normalised topic text in either UI language; any other topic gets a template that says outright it is a sample and never pretends to be a finished piece about the topic.
- **Three preset topics were made concrete** (habit tracker, ship weekly, pricing workshop) — a hand-written fixture needs a specific subject to be good.
- **Streaming text is rendered as plain pre-wrapped text, not Markdown** — rendering Markdown on every token for five cards is wasteful; the Markdown preview arrives with the editor in Phase 4.
- **Deltas are batched per animation frame on the client** — five parallel streams would otherwise re-render on every token.
- **The stream region is `aria-live="polite"` with `aria-busy` while streaming** — a screen reader announces the finished piece once, not every word.
- **The first stream is started on a zero-delay timer** — React's development double-mount would otherwise send it twice and burn a regeneration.
- **SSRF: allow-list global unicast instead of block-listing bad ranges, vet every resolved address, then connect to exactly that address** (pinned `lookup`) — closes DNS rebinding; unparseable addresses fail closed. Redirects are followed manually and re-vetted.
- **`node:https` for the source fetch, not `fetch`** — pinning the resolved IP needs a custom `lookup`; `Accept-Encoding: identity` so a small compressed body cannot inflate past the 1 MB cap.
- **Only port 443 and no credentials in source URLs** — nothing legitimate needs more, and other ports are how SSRF reaches internal services.
- **`<source>` wrapping plus `neutraliseSource()`** — the model is told the block is untrusted, and the text cannot close the tag to escape it. User text never enters the system prompt.
- **Models: `claude-haiku-4-5` (Free/guest) and `claude-sonnet-5-5` (Pro)**, as the spec's plan routing requires; the spec's `claude-haiku-5-5` does not exist. Thinking-capable models get `effort: "low"` and extra token headroom; Haiku 4.5 gets neither (it rejects `effort`).
- **No server-side refusal fallback** (`fallbacks`) — it is a beta parameter tied to specific models, and the model here is configurable per deployment. A refusal is handled as the `llm_refused` error with a retry.
- **Rate limits fail closed** — if `check_rate_limit` cannot be reached the request is refused, not let through unmetered.
- **`POST /api/demo/stream` is public but can only replay fixtures chosen by id** — no free text, no DB write, no model call; still rate limited per hashed IP. Built now so the cards can be verified without a session; the landing page reuses it in Phase 7.
- **`pnpm smoke` creates and deletes a throwaway user with the service-role key** — CAPTCHA blocks scripted sign-in, and an API-level end-to-end run (real cookies, RLS, RPCs, streaming) catches what unit tests cannot.
- **Save-to-library is a Server Action running as the user** — RLS allows the insert only for themselves and only linked to their own generation; title and word count are derived on the server.

## Phase 4 — Library, editor, refine, tags, export

- **Library filters live in the URL** (`?q=&type=&tag=&sort=&page=`) and the list is rendered on the server — a filtered view can be bookmarked and survives the back button; the filter bar only rewrites the query string (search is debounced 300 ms).
- **Search is a prefix `to_tsquery` built from letters and digits only** (`pric` → `pric:*`, words joined with `&`) — search-as-you-type needs prefix matches, and stripping everything else means tsquery operators typed by the user can neither change the query nor make it fail to parse. Config `simple` does not fold diacritics, so `sta` does not find `šta`; acceptable for now.
- **Tags are normalised in the app (lower case, single spaces, no leading `#`, 32 chars, 20 per piece) and their shape is also a CHECK constraint** (`tags_are_valid`) — `contents` is writable by the user under RLS, so a client that skips the app must still not be able to store junk. Lower-casing stays out of the database: JS and Postgres disagree on case-folding for a few characters, and a save must never fail on that.
- **Tag autocomplete is a native `<datalist>`** fed by `content_tags()` (SECURITY INVOKER, so RLS scopes it) — keyboard and screen-reader support for free instead of a hand-rolled combobox.
- **Library mutations are Server Actions running as the user; the service-role key is not involved** — RLS is the ownership check, so another user's id simply matches no row.
- **Autosave does not call `revalidatePath`** — it would re-render the open editor after every save. Pages under `/app` are dynamic, so the next navigation is fresh; only the browser's back button can show a list that is a few seconds old.
- **One save at a time, and a failed save is not retried in a loop** — the status stays "Not saved" with a Retry button until the next edit; the browser warns before closing a tab with unsaved changes.
- **A duplicate keeps its `generation_id`** — otherwise "duplicate, then refine the copy" would be a way around the 10-per-generation refine cap.
- **Refine sends the editor's text, not the saved text; the content id is what is authorised** — the editor may hold unsaved changes. `claim_refinement()` checks ownership, the cap and the mode in one transaction before the first byte is streamed.
- **Refine and regenerate share one counter** (`generations.refinements_used`, 10 per generation), as the spec says. Pieces without a generation have no such cap, so refine also has a per-user daily rate limit (60) on top of the burst limit (10/min).
- **Live refinements have their own global daily cap** (`app_counters.real_refinements`, `DAILY_REAL_REFINE_CAP`, default 5 × the generation cap) — they are paid model calls too, and an uncapped piece would otherwise be a way to drain the API budget. Over the cap, refine silently becomes a sample transformation, like generation does.
- **Sample-mode refine is rule-based and says so** — Shorten keeps the first half of each paragraph's sentences, Expand appends one canned sentence per paragraph, Change tone prepends a canned opener. They leave structure alone (front block, headings, Subject/Preheader, post numbers, hashtags), so an accepted sample suggestion still passes the format check.
- **Sample mode refuses to translate arbitrary text** (`sample_unsupported`, not counted) — a fake translation would be a stub that pretends to work. It does translate the built-in demo pieces, whose other-language version is already written.
- **The refine prompt treats the piece as data** — the task is built from enums only, the text sits in `<text>` and is run through `neutraliseSource()`; a saved piece may have started as a fetched web page.
- **Refine token usage is logged, not stored** — there is no per-refine row to put it on, and adding it to the generation's totals would mix two different things.
- **Accept replaces exactly the range that was sent; the editor is read-only while a suggestion is open** — offsets cannot go stale. Undo is an explicit button with its own stack, because replacing a textarea's value from code wipes the browser's native undo history.
- **Translating the whole piece flips its `language`; translating a passage does not.**
- **Preview: Markdown only for blog and email bodies** — LinkedIn, Instagram and X pieces are plain text whose line breaks matter, so they are shown as written (X as one card per post with its count). SEO meta, Subject and Preheader are shown apart from the text.
- **`react-markdown` without raw HTML, links with `rel="noopener noreferrer nofollow"`, images not loaded** — a preview must not execute anything or make requests to addresses found in the text.
- **Export is built on the server** (`GET /api/contents/[id]/export`) from the saved row — keeps `docx` out of the browser bundle and makes RLS the ownership check. The editor flushes autosave first.
- **All three export formats come from one list of blocks** (mdast → blocks → txt/docx) — a heading in the editor is a `Heading N` style in Word. Only `http(s)`/`mailto` links become hyperlinks; control characters XML cannot hold are dropped.
- **Export file names are ASCII slugs** (`č → c`, `đ → dj`) — nothing from the title reaches the `Content-Disposition` header unescaped.
- **`@parcel/watcher` and `@swc/core` build scripts denied** (`pnpm-workspace.yaml`) — pnpm 12 fails an install on undecided build scripts; both ship prebuilt binaries, same reasoning as `unrs-resolver`.

## Phase 5 — Plans, limits, Stripe (test mode)

- **The plan is derived from the subscription status inside the database** (`apply_stripe_event()`: `active | trialing` → pro, anything else → free) — "plan from status only" is then a guarantee of the one function that may write it, not a convention its callers must follow. `planForStatus()` in TypeScript is the same rule for the UI; both are tested against the same table of statuses.
- **Idempotency and the profile update are one transaction** — the event id is inserted into `stripe_events` first, inside `apply_stripe_event()`. A replay returns `duplicate`; a failure rolls the insert back, so Stripe's retry is a clean first attempt. The route also checks `stripe_events` up front, only to skip a pointless Stripe call.
- **The webhook applies the subscription's current state, not the event's snapshot** — the event only says which subscription changed; it is then retrieved from Stripe. Stripe does not deliver events in order, so a late `created` must not be able to undo a `deleted`.
- **An inactive subscription cannot overwrite a different, newer one** (`ignored`) — covers the late `deleted` of an old subscription after the user subscribed again.
- **The user is found through `profiles.stripe_customer_id`**; our own user id (Checkout's `client_reference_id`, the subscription's `metadata.user_id`, both set by the server) is only used to link a customer that is not linked yet, and only if it is a UUID. A customer already linked to someone else is never re-pointed.
- **Failed payment = Free** — `past_due` and `unpaid` are not Pro, as the spec's rule says; Settings explains it and offers the portal to fix the card. Pro comes back with the next successful payment.
- **`profiles.cancel_at_period_end` added** — "Cancels on <date>" and "Renews on <date>" need different copy; the spec's column list cannot tell them apart. True for either `cancel_at_period_end` or a `cancel_at` date, whichever way the portal expressed it.
- **Period end is read from the subscription items** — current Stripe API versions moved `current_period_end` there; the old top-level field is kept as a fallback.
- **Test mode only, enforced in code** — a key that is not `sk_test_…`/`rk_test_…` is treated as "billing not configured", the setup script refuses to run with it, and a `livemode` event is acknowledged but never applied. A wrong environment variable cannot make the demo charge real cards.
- **Checkout and portal routes take no input** — everything comes from the session, so there is nothing to validate and nothing to tamper with. They cannot change a plan; they only return a Stripe-hosted URL.
- **Guests are refused twice** — in the route (before rate limiting, the database or Stripe are touched) and again in `startCheckout()` on either signal (anonymous session, or `plan = 'guest'`). `link_stripe_customer()` and `apply_stripe_event()` also never act on a guest.
- **A Stripe customer is created once per user** — idempotency key per user id on the Stripe call, and `link_stripe_customer()` is set-once and returns whichever customer is linked, so two racing requests end up with the same one.
- **The billing logic takes Stripe and the database as arguments** (`lib/billing/checkout.ts`, `webhook.ts`) — the rules are unit-tested without either; the webhook route is additionally tested with real signature verification, using payloads signed by Stripe's own test helper.
- **After Checkout the page waits for the webhook** — paying does not make the account Pro, the signed event does. Settings re-renders every 2.5 s for about 20 s, then says plainly that Stripe has not confirmed yet.
- **Pricing cards read `plan_limits`** (service role, with the seeded values as a fallback) — the cards cannot promise something other than what `consume_generation()` enforces.
- **`pnpm stripe:setup` is idempotent through fixed identifiers** — product id `fanout_pro`, price lookup key `fanout_pro_monthly`; a changed amount creates a new price that takes over the key, because Stripe prices are immutable.
- **The webhook route is excluded from the proxy** — it has no session; it is authenticated by its signature.

## Phase 6 — Calendar, publishing, n8n, cron tick

- **Every status change of a publish job is a SQL function** (`create_`, `update_`, `cancel_`, `retry_`, `claim_`, `finish_`, `fail_stuck_…`; SECURITY DEFINER, service-role only) — the state machine lives in one place, each transition is one transaction, and `pnpm test:db` exercises it without the app. Each function checks the owner itself; the user id always comes from the verified session.
- **A claim opens a `publish_attempts` row, and a job can only be finished while it is `processing` and that attempt is open** — a replayed callback, a late callback and an attempt id from another job all return `stale` and change nothing. Idempotency comes from the state, so the callback needs no "seen ids" table.
- **`claim_due_publish_jobs` uses `FOR UPDATE SKIP LOCKED`; "Publish now" claims its one job with the same conditional update** — two ticks at once, or a tick racing a click, cannot both take a job. PGlite is single-connection, so the tests cover the transitions and the "claimed once" rule, not real concurrency.
- **`publish_jobs.processing_at` added** — "stuck for more than 10 minutes" has to be measured from the claim, not from the scheduled time.
- **`last_error` and `publish_attempts.detail` hold a machine code (`delivery_failed:429`), enforced by a CHECK** — nothing free-form from n8n, SMTP or Discord is stored or shown, so a webhook URL or an address inside an upstream error message cannot leak into the UI. The UI translates the code.
- **The cron endpoint uses `Authorization: Bearer <CRON_SECRET>`** (as Phase 6.5 says), compared in constant time over SHA-256 digests — the HMAC scheme is for requests that have a body worth signing; the tick has none. Secrets shorter than 16 characters are treated as not set, for the cron secret and the n8n secret alike.
- **Signature format: `X-Signature: sha256=<hex>` over `"<X-Timestamp>.<raw body>"`** — the timestamp is inside the signed string, so it cannot be refreshed on a captured request. The signature is checked before the age, so an unsigned request learns nothing about the window.
- **n8n answers the webhook only after its own signature check** (Webhook → Verify → "Accept" 202 → send → signed callback) — a request n8n would refuse is a visible `n8n_rejected` failure at once, not a job that hangs until the 10-minute timeout.
- **The workflows' Code nodes are executed by a unit test** (`n8n-workflows.test.ts`) against requests signed by the app's own code, and the callback they build is checked with the app's own verifier — the two halves of the scheme are written in two places and must not drift. Docker is not installed on the dev machine, so the workflows have not been run inside n8n itself yet.
- **n8n verifies the raw body, with `JSON.stringify(parsed body)` as a fallback** — the app builds the body with `JSON.stringify`, so both give the same bytes; the fallback only matters if the Webhook node's raw-body option is switched off.
- **The email address is read from Supabase Auth at send time, never stored on the destination** (`config = {}` by CHECK), and only if it is confirmed — an email destination cannot be pointed at someone else, and changing the account's address moves the destination with it.
- **Discord webhook URLs are masked on the server** (`discord.com/…/5678/••••1234`) — once saved, the full URL is never sent to a browser again; only claimed jobs (service role) carry it.
- **Copied webhook URLs are normalised** (`discordapp.com`, `canary.`/`ptb.`, `/api/v10/`, trailing slash, query string) to the one form the CHECK constraint accepts; a unit test compares the app's pattern with the migration's, character for character.
- **"Send test message" goes straight from the app to Discord, and only when n8n is configured** — a test has no job for a callback to report to; on a simulated deployment nothing is sent and the toast says so. The URL is re-checked against the strict pattern and redirects are refused.
- **Simulated when n8n has an address but no usable secret** — never unsigned requests; the "Simulated" badges make the misconfiguration visible.
- **Long pieces go to Discord as several messages (≤ 1900 characters, at most 10), split at paragraph breaks; more than that fails with `content_too_long`** — never truncated. Posts carry `allowed_mentions: { parse: [] }`, so `@everyone` in a piece pings nobody.
- **Email is plain text** (the `.txt` export builder) — no Markdown-to-HTML renderer to trust with user content; an `email` piece is sent under its own `Subject:` line, everything else under its title. Subjects are forced onto one line.
- **What is sent is the saved version at send time**, not a snapshot taken when scheduling — editing a scheduled piece is the expected way to fix it. The dialog says so, and the editor saves before publishing.
- **Retry puts the job back to `scheduled` (due now) and then claims it** — one path for first send and retry. At most 5 attempts per job; a retry counts against the publish rate limits (10/min, 100/day per user).
- **A failed job can be dismissed (`failed → cancelled`)** — otherwise a job that is out of retries would sit under "Needs attention" for ever. Its error and attempt log are kept.
- **Deleting a destination deletes its jobs** (FK cascade, as designed in Phase 1) — the confirmation dialog says so.
- **Mutations are Server Actions, the two machine endpoints are routes** — the browser never calls `/api/publish/callback` or `/api/cron/tick`; both are excluded from the session proxy and authenticated by signature / bearer secret.
- **The user's time zone is a cookie (`FANOUT_TZ`) set by `<TimeZoneSync>` and fed to next-intl** — the server renders the same times the client would (no hydration mismatch), and every `format.dateTime` in the app is now local. Usage reset dates stay pinned to UTC, because that is when they happen.
- **Instants and wall-clock values are kept apart in `lib/publish/time.ts`** (`@date-fns/tz`) — every conversion takes the zone as an argument; a time skipped by a DST change moves forward. The page computes each job's day in the user's zone and asks the database only for the instants the month view covers.
- **The month lives in the URL (`?month=YYYY-MM`)**, like the library filters — bookmarkable, back button works. Weeks start on Sunday in English and Monday in Serbian.
- **Calendar cells are a list of buttons, not an ARIA grid** — a grid role promises arrow-key navigation; plain buttons with full labels ("Tuesday, June 15, 1 item") are honest and work everywhere. Status is in every label, never colour alone. On phones a cell shows dots and the day's jobs are listed below.
- **While a job is `processing` the calendar re-renders every 3 s (up to 2 minutes)** — same approach as the post-checkout wait in Phase 5.
- **TanStack Query is not installed** — the spec lists it, but nothing needs a client cache: reads are server components, writes are Server Actions that revalidate.
- **`pnpm cron:dev`** calls the tick every 30 s locally — GitHub Actions cannot reach `localhost`. GitHub's schedule is best-effort (late by minutes) and is disabled after 60 days without repository activity; both are noted in the workflow file.
- **n8n image pinned to `2.44.0`**; the compose file sets `NODE_FUNCTION_ALLOW_BUILTIN=crypto` and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, which the Code nodes need, and binds the port to 127.0.0.1.
