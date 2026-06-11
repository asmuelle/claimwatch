# TOOLS.md — Commands, APIs, Env, CI

## just recipes

| Recipe | What it does | When to run |
|---|---|---|
| `just` | List all recipes | Orientation |
| `just setup` | `corepack enable` + `pnpm install` | Fresh clone; after lockfile changes |
| `just dev` | Start Next.js + Inngest dev servers (`pnpm dev`) | Daily development |
| `just db-up` | `docker compose up -d postgres` (pgvector/pgvector:pg16) | Before migrate/test/dev |
| `just db-down` | Stop local services | Done for the day |
| `just migrate` | Apply Drizzle migrations (`packages/db`) to `$DATABASE_URL` | After schema changes; after db-up on fresh volume |
| `just test` | Vitest across all packages | Constantly (TDD); before commit |
| `just e2e` | Playwright e2e against apps/web | Before merging UI/flow changes |
| `just lint` | ESLint all packages | Before commit |
| `just format` | Prettier write | When the format hook hasn't already |
| `just typecheck` | `tsc --noEmit`, strict | Before commit |
| `just build` | Build packages + web app | Verifying production output |
| `just ci` | lint + typecheck + test + build | The merge gate; must be green before PR |

Until M0 bootstrap, recipes exit with a help message (no `package.json` yet) — that is the intended docs-only state.

## External data sources & APIs

| Source | Used for | Auth env var | Cost / limits | Link |
|---|---|---|---|---|
| USPTO Open Data Portal — bulk delta datasets | Tue (grants) / Thu (pre-grant pubs) ingestion; the canonical corpus | `USPTO_ODP_API_KEY` | Free; per-key request throttling — always prefer bulk files over per-document calls | https://data.uspto.gov |
| USPTO Patent File Wrapper API | Prosecution history (office actions, amendments, abandonment); backfill to 2001; daily refresh | `USPTO_ODP_API_KEY` | Free; throttled per key | https://data.uspto.gov/apis/patent-file-wrapper |
| EPO Open Patent Services (OPS) | EP family members, claim texts, legal status | `EPO_OPS_KEY`, `EPO_OPS_SECRET` (OAuth2) | Free tier = 4GB/mo fair use, **pilot-only**; paid tier ~EUR 1–4K/yr at scale — budget before M2 | https://www.epo.org/searching-for-patents/data/web-services/ops.html |
| CourtListener / RECAP API | Litigation dockets (Pro tier, M3) | `COURTLISTENER_API_TOKEN` | Free with token, rate limited; underlying PACER fetches are metered ($0.10/page) — must stay behind `PACER_SPEND_CAP_USD` | https://www.courtlistener.com/api/ |
| Anthropic API | Haiku screening ($1–3/watchlist-week), Sonnet synthesis, Opus-class flagged prosecution reasoning ($3–10/wk) | `ANTHROPIC_API_KEY` | Pay-per-token; per-watchlist weekly budgets enforced in `packages/pipeline` | https://docs.anthropic.com |
| Voyage AI | Claim-space embeddings (voyage-3) into pgvector | `VOYAGE_API_KEY` | Pay-per-token, small line item | https://docs.voyageai.com |
| Resend | Weekly brief email delivery | `RESEND_API_KEY` | Free tier fine through M1 | https://resend.com |
| S3-compatible storage | Immutable raw XML/PDF archive | `S3_ENDPOINT`, `S3_BUCKET_RAW`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Cents/GB (R2/S3) | — |
| Stripe (M3) | Subscriptions + Firm workspace metering + Diligence Snapshot checkout | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Standard fees | https://stripe.com/docs |

WIPO PATENTSCOPE (additional jurisdictions) is deliberately out of scope until after M3 — covered/not-covered is disclosed in every brief (see AGENTS.md invariant 4).

## Required env vars

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres 16 + pgvector connection string |
| `USPTO_ODP_API_KEY` | USPTO Open Data Portal + File Wrapper API |
| `EPO_OPS_KEY` / `EPO_OPS_SECRET` | EPO OPS OAuth2 client credentials |
| `COURTLISTENER_API_TOKEN` | CourtListener/RECAP (Pro tier) |
| `PACER_SPEND_CAP_USD` | Hard per-org cap on metered PACER spend |
| `ANTHROPIC_API_KEY` | Screening + synthesis models |
| `VOYAGE_API_KEY` | Claim embeddings |
| `RESEND_API_KEY` | Brief email delivery |
| `S3_ENDPOINT` / `S3_BUCKET_RAW` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Raw document archive |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Scheduler (production only; dev server needs neither) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing (M3) |
| `NEXT_PUBLIC_APP_URL` | Absolute URLs in emails/verify links |

Values live in `.env` (gitignored); commit `.env.example` with names only. `packages/core` exposes a startup validator that fails fast on missing vars per deploy target.

## Local services

- **Postgres 16 + pgvector** via `docker compose` (`pgvector/pgvector:pg16`), started with `just db-up`. The vector extension is enabled in the first Drizzle migration.
- **Inngest dev server** runs as part of `just dev` for local cron/step execution (no cloud account needed in dev).
- No other local services; S3 can point at R2/MinIO in dev or tests can stub the storage client.

## CI (.github/workflows/ci.yml)

- Triggers on every push and pull request; single job on `ubuntu-latest`.
- Steps: checkout → `extractions/setup-just@v3` → Node 22 + `corepack enable` → **bootstrap guard** → `pnpm install --frozen-lockfile` → `just ci`.
- **Bootstrap guard:** if `package.json` is absent (docs-only scaffold), install/build steps are skipped with a `::notice::` and the run stays green. Once M0 lands, the same workflow runs the full gate with no edits.
- A `pgvector/pgvector:pg16` service container is wired via `DATABASE_URL` (`claimwatch_test` db) for `packages/db` integration tests; it idles before bootstrap.

## AI harness notes (.claude/settings.json)

Active hooks (all no-op until `package.json` exists):

- **PostToolUse on Write|Edit:** Prettier formats edited `.ts/.tsx/.js/.jsx/.json/.css/.md` files; ESLint `--fix` runs on edited `.ts/.tsx`.
- **Stop:** `tsc --noEmit` runs at session end and surfaces the last 20 lines — fix type errors before ending a session.
- **Permissions:** `just`, `pnpm`, `node`, `npx vitest`, `npx playwright`, `docker compose`, and read-only git are pre-allowed; everything else prompts.

Most useful subagents for this repo:

- **tdd-guide** — before any new feature, especially `packages/core` diff/validator work (golden fixtures first).
- **code-reviewer** — after every change set, before commit.
- **security-reviewer** — anything touching auth, billing/Stripe, watchlist data (competitive intelligence is sensitive), or email sending.
- **planner** — milestone-sized work (each DESIGN.md milestone is one plan).
- **build-error-resolver** — when `just ci` breaks after dependency or config changes.
