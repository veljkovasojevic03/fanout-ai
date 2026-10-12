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
