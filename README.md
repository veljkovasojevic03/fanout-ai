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

## Run locally

Requires Node.js 22.12+ and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:3000 — design system at /design
```

No environment variables are needed yet. `.env.example` lists the ones later phases use.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Project docs

- [`FANOUT_AI_PROMPT.md`](FANOUT_AI_PROMPT.md) — the full product and architecture spec
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decisions and their reasons
- [`CLAUDE.md`](CLAUDE.md) — working rules for AI-assisted development on this repo
