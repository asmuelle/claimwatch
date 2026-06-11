# AGENTS.md — Operating Manual for AI Coding Agents

## Project snapshot

**ClaimWatch** is a patent/IP radar for IP-heavy startups and boutique patent law firms: a weekly pipeline over canonical USPTO/EPO/litigation feeds that maintains living claim-evolution dossiers per family and competitor, and ships a weekly email brief where **every assertion is mechanically checkable** against the source document, claim number, and date.

- **Who pays:** founders/CTOs/in-house counsel at deeptech, biotech, hardware, and AI startups ($149–399/mo), and boutique IP firms reselling white-label briefs ($1,250/mo + per-workspace meter).
- **Status:** Tier 1 candidate (#1 of 12 finalists, survived adversarial platform-risk review). M0 (bootstrap), M1 (fixture-driven vertical slice), and M2 (trust layer: live Postgres path, DB-level append-only triggers, hard send-gate, recall eval, Playwright e2e) are landed. Next: live ODP/Anthropic/Resend clients + Inngest wiring, then DESIGN.md milestone M3.

## Read first

1. **README.md** — research dossier: concept, market evidence, adversarial review, unit economics. Do not contradict it.
2. **DESIGN.md** — architecture, data model, key flows, milestones (M0–M3), risk register. The build order lives here.
3. **TOOLS.md** — every command, external API, env var, and CI behavior.

## Commands

`just` is the single source of truth. **Use just recipes, never raw pnpm/docker commands**, so local and CI behavior stay identical.

| Recipe                        | What it does                                                            |
| ----------------------------- | ----------------------------------------------------------------------- |
| `just`                        | List recipes                                                            |
| `just setup`                  | corepack enable + pnpm install                                          |
| `just dev`                    | Next.js + Inngest dev servers                                           |
| `just db-up` / `just db-down` | Start/stop local Postgres 16 + pgvector (host port 5433)                |
| `just migrate`                | Apply Drizzle migrations                                                |
| `just test`                   | Vitest unit tests, all packages (DB suites skip without `DATABASE_URL`) |
| `just test-db`                | DB integration suite against live Postgres (`just db-up` first)         |
| `just e2e`                    | Playwright e2e (builds + serves apps/web, chromium)                     |
| `just lint` / `just format`   | ESLint / Prettier                                                       |
| `just typecheck`              | tsc --noEmit, strict                                                    |
| `just build`                  | Build all packages + web app                                            |
| `just ci`                     | lint + typecheck + test + build (the merge gate)                        |

Before bootstrap (M0), recipes fail with a pointer to DESIGN.md — that is expected.

## Architecture summary

A pnpm-workspace research pipeline: Inngest crons aligned to the USPTO Tue/Thu publication cycle ingest bulk deltas into immutable raw storage and Postgres; a **deterministic** diff engine appends claim versions and computes blacklines; cheap-model screening triages new documents against watchlists; a frontier-model pass synthesizes dossiers and the weekly brief under cite-or-omit grounding with post-generation citation validation; Resend delivers the brief, and the Next.js app is the archive and verification surface.

| Module              | Responsibility                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | Next.js 15 App Router: dashboard, dossiers, claim timelines, watchlists, brief archive, Inngest endpoint                  |
| `packages/core`     | Pure TS, zero IO: claim parsing/normalization, deterministic diff, diff heuristics, citation validator, plan-limit policy |
| `packages/pipeline` | Inngest functions: ingestion, backfill, screening, synthesis, brief render/send                                           |
| `packages/db`       | Drizzle schema + migrations, pgvector queries, append-only claim_version tables                                           |

Dependency direction: `apps/web` and `packages/pipeline` depend on `core` and `db`; `core` depends on nothing with IO.

## Coding standards

- TypeScript strict mode everywhere; no `any` without an inline justification comment.
- Files < 800 lines, functions < 50 lines; organize by feature/domain, not by type.
- Immutability by default — return new objects; append-only tables stay append-only.
- Explicit error handling at every boundary (API client, parser, queue step, route handler). Pipeline steps must distinguish retryable from fatal; a swallowed ingestion error is a recall incident.
- Validate all external data at the boundary with schemas (zod): USPTO/EPO XML, API responses, user input. Never trust feed data shape.
- No hardcoded secrets — env vars only, validated at startup (see TOOLS.md table).
- Conventional commits: `feat:` `fix:` `refactor:` `docs:` `test:` `chore:`.

## Testing policy

- **TDD**: write the failing test first, then implement. Target 80%+ coverage; `packages/core` should be near 100%.
- AAA pattern (Arrange–Act–Assert); descriptive behavior names.
- What matters most for THIS product, in order:
  1. **Golden-fixture tests for the deterministic diff engine** — real claim sets from the File Wrapper API with hand-verified expected blacklines. This is the product's credibility.
  2. **Citation validator tests** — valid, stale, fabricated, and off-by-one claim-number citations must be caught.
  3. **Parser fixture tests** — USPTO/EPO XML edge cases (multi-dependent claims, cancelled claims, chemical/markush formatting).
  4. **Idempotency tests** — re-running an ingestion delta produces zero new rows.
  5. **Recall eval harness (M2)** — screening recall against the hand-labeled set; regressions fail CI.
  6. Playwright e2e: watchlist creation → brief render → verify-link round trip.

## PRODUCT INVARIANTS (non-negotiable)

1. **Deterministic before LLM.** Claim diffs are computed by the deterministic diff engine in `packages/core` from canonical text. No LLM ever generates, edits, or "fixes" diff content. LLM annotations live in separate fields and never overwrite deterministic output. _Test: diff output is a pure function of the two claim texts; byte-identical across runs._
2. **Cite-or-omit.** Every synthesized sentence in a dossier or brief resolves to a stored (docId, claimNo, date) via the citation validator, post-generation. Failing sentences are dropped — never paraphrased, never sent. _Test: a seeded invalid citation blocks the brief (`validated_at` stays null)._
3. **Never silently drop a candidate.** Screening is recall-biased: CPC ∪ embedding ∪ name match (union, not intersection); models may downrank, never delete; every screened-out doc keeps a logged `screening_result`. Named competitors bypass screening entirely. _Test: a doc matching a named assignee always appears in the brief queue._
4. **No legal advice.** Output is research observation, never an FTO/infringement opinion. Banned-phrase lint runs on every synthesized output; every brief/PDF carries the counsel disclaimer and a coverage disclosure (jurisdictions watched and NOT watched). _Test: banned phrases in model output fail the assembly step._
5. **Raw documents are immutable; claim history is append-only.** Raw XML/PDF stored once in S3 with content hash; `document` and `claim_version` rows are never updated or deleted, only appended. _Test: schema has no UPDATE path for claim_version; ingestion re-run is a no-op._
6. **Idempotent, cycle-aligned ingestion.** Crons align to the Tue/Thu publication cycle; every step keys on source IDs/content hashes so retries and re-runs are no-ops; a skipped delta file raises an alert, not a log line.
7. **Cost ladder is enforced in code.** Haiku-class for screening, Sonnet for synthesis, Opus-class only for flagged prosecution reasoning — with per-watchlist weekly token budgets and a hard per-org PACER spend cap. _Test: exceeding a budget halts the step with an alert, not an overrun._
8. **No secrets in the repo.** Env vars only (TOOLS.md table); `.env*` is gitignored; startup validation fails fast when required vars are missing.

## Working style in this repo

- **Build in milestone order.** M0 → M1 → M2 → M3 (DESIGN.md). Do not start screening or synthesis code before deterministic ingestion + diffing is golden-tested — the product's trust story collapses in reverse order.
- **No partial bootstrap.** M0 lands as one coherent change: workspace, compose file, first migration, and a green `just ci`. Until then, leave the docs-only guard intact.
- **Dependencies are deliberate.** Prefer the stack already chosen (Drizzle, Inngest, zod, Resend, vitest, Playwright). Adding a new dependency requires a one-line justification in the PR and a DESIGN.md decision-log entry if it's architectural.
- **Real fixtures over mocks.** For parsers and the diff engine, commit small real USPTO/EPO XML excerpts as fixtures (public-domain government data) instead of hand-invented samples.
- **When the dossier and code disagree**, README/DESIGN win — stop and reconcile rather than coding around them.

## Definition of done

- [ ] Failing test written first; now green; coverage ≥ 80% on touched code
- [ ] `just ci` passes locally (lint + typecheck + test + build)
- [ ] No product invariant violated (check the list above explicitly)
- [ ] External data validated at the boundary; errors handled, not swallowed
- [ ] No new env var without a TOOLS.md table entry; no secrets committed
- [ ] DESIGN.md updated if architecture, data model, or milestone scope changed
- [ ] Conventional commit message; code-reviewer pass on the diff (security-reviewer if auth/billing/user data touched)
