# ClaimWatch — Design Doc

## Thesis

Patent monitoring under $1K/mo today is keyword-alert spam; over $15K/yr it is quote-only enterprise tooling. ClaimWatch occupies the empty middle with the one thing neither end ships: a living claim-evolution dossier where every diff is a deterministic text comparison of canonical USPTO/EPO documents and every synthesized sentence is mechanically checkable against a stored document ID and claim number. The corpus is free, structured, government-published on a fixed Tue/Thu cycle, and unaffected by the web-access lockdown — the cost structure (~70–85% gross margin at $149/mo) is the moat the incumbents cannot follow down.

## Architecture

### Components

```
apps/web              Next.js 15 (App Router, TS strict) — dashboard, dossiers,
                      claim timelines, watchlist management, brief archive,
                      Inngest serve endpoint, Stripe webhooks (M3)
packages/core         Pure TypeScript domain logic, zero IO:
                      claim XML parsing, claim normalization, DETERMINISTIC
                      claim diff engine, diff classification heuristics,
                      citation validator, brief assembly rules
packages/pipeline     Inngest functions: Tue/Thu ingestion crons, backfill jobs,
                      screening (CPC + pgvector + cheap model), synthesis
                      (frontier model), brief render + send (Resend)
packages/db           Drizzle ORM schema + migrations, Postgres 16 + pgvector,
                      append-only claim-version tables per family
```

External: USPTO Open Data Portal (bulk deltas + Patent File Wrapper API), EPO OPS, CourtListener/RECAP (litigation, Pro tier), S3-compatible object storage for raw XML/PDF, Anthropic API, Voyage embeddings, Resend email.

### Scheduler choice: Inngest

**Inngest, not Temporal.** Rationale: a 2–3 person team gets cron triggers aligned to the Tue/Thu publication cycle, durable step functions with retry-per-step (each ingestion stage is an idempotent step), and local dev via `inngest dev` — all co-located with the Next.js app, no extra cluster to operate. Temporal is the documented escape hatch if multi-day backfills or fan-out beyond ~10K steps per run outgrow Inngest; `packages/pipeline` keeps workflow definitions thin over `packages/core` so the engine is swappable.

### Data flow (source → diff → triage → synthesis → surface)

```
USPTO ODP bulk deltas ─┐
USPTO File Wrapper ────┤   Tue/Thu     ┌──────────────┐   append    ┌─────────────────┐
EPO OPS ───────────────┼─► Inngest ──► │ S3 raw XML   │ ──────────► │ documents,      │
CourtListener/RECAP ───┘   crons       │ (immutable)  │   parse     │ claim_versions  │
                                       └──────────────┘             └────────┬────────┘
                                                                             │ deterministic diff
                                                                             ▼
                          ┌──────────────────┐  CPC ∪ pgvector ∪ name  ┌─────────────┐
                          │ screening_result │ ◄────────────────────── │ claim_diffs │
                          │ (Haiku, logged)  │                         └─────────────┘
                          └────────┬─────────┘
                                   │ in-scope items
                                   ▼
                          ┌──────────────────┐  cite-or-omit  ┌──────────────────────┐
                          │ Sonnet synthesis │ ─────────────► │ citation validator    │
                          │ (+ Opus flagged) │                │ (deterministic gate)  │
                          └──────────────────┘                └──────────┬───────────┘
                                                                         │ validated_at set
                                                                         ▼
                                                       weekly brief (Resend email + web + PDF)
```

1. **Source.** Tue (grants) / Thu (pre-grant publications) crons pull USPTO ODP bulk delta files; File Wrapper API fills prosecution events; EPO OPS covers EP family members; CourtListener/RECAP webhooks cover dockets (Pro). Raw XML/JSON lands immutably in S3 keyed by `{source}/{docId}/{fetchedAt}`.
2. **Diff (deterministic).** Parser extracts claims per document; each claim is appended as a new `claim_version` in its family. The diff engine in `packages/core` computes word-level text diffs between consecutive versions — pure function, golden-tested, **no LLM anywhere in this stage**. Heuristics tag structural changes (claim cancelled, dependency rewritten, limitation added).
3. **Triage (cheap).** New documents × active watchlists: CPC-prefix prefilter **unioned** with pgvector similarity against the watchlist's claim-space embedding, then Haiku 4.5 relevance classification (~200–800 docs/week per watchlist, $1–3/wk). Screening can only _downrank_, never delete — every screened-out doc keeps a logged score for recall audits.
4. **Synthesis (frontier, gated).** Sonnet 4.6 updates dossiers and drafts the weekly brief under cite-or-omit grounding: every sentence must carry `(docId, claimNo?, date)` references that the deterministic citation validator resolves against Postgres post-generation; failing sentences are dropped, not paraphrased. An Opus-class pass runs only for flagged prosecution-history reasoning (office action + amendment context, 50–150K tokens/family, $3–10/wk).
5. **Surface.** Weekly email brief (Resend, sent Friday after the Thursday batch settles) is the primary product; the web app is the archive — dossiers, claim timelines rendered as legal blacklines, and "verify" links that open the canonical USPTO/EPO document next to every assertion. Counsel tier adds PDF export.

### Cost discipline ladder

| Layer                                                    | Tool                                | Cost posture                                   |
| -------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| Claim diffing, citation validation, dedup, CPC filtering | Deterministic TS in `packages/core` | Free, exhaustively unit-tested                 |
| Relevance screening, change-type pre-labels              | Haiku 4.5 / Flash-class             | $1–3 per watchlist-week, budget-capped in code |
| Dossier updates, weekly brief                            | Sonnet 4.6                          | Amortized $12–40/user/mo                       |
| Prosecution-history reasoning                            | Opus-class, flagged families only   | $3–10/wk, hard per-org cap                     |

## Data model sketch

- **org / user / subscription** — workspace, members, Stripe tier, plan limits (watchlists, competitors, client workspaces for Firm tier).
- **watchlist** — org, name, natural-language claim-space description (embedded via voyage-3 into pgvector), CPC class list, named assignees/inventors, jurisdictions covered; the only true user-accumulated state.
- **document** — canonical publication unit: source (USPTO/EPO), doc number + kind code, application number, publication date, CPC codes, assignee, S3 key of raw XML/PDF, content hash. Immutable.
- **patent_family** — family ID, member documents across jurisdictions, earliest priority date, current prosecution status, fee/lapse status.
- **claim_version** — _append-only_: family, source document, claim number, normalized claim text, version sequence, captured_at. The longitudinal core of the product.
- **claim_diff** — from_version → to_version, deterministic word-level hunks (JSON), structural change tags (narrowed/broadened/cancelled/added — heuristic), plus a _separate_ nullable LLM annotation field; the two are never merged.
- **prosecution_event** — family, type (office action, response, amendment, notice of allowance, abandonment, fee lapse, assignment), event date, file-wrapper document reference.
- **screening_result** — document × watchlist, embedding score, model verdict + confidence, decision (surface/downrank), model + prompt version. Audit trail for recall claims.
- **dossier / dossier_section** — living document per family or competitor within a watchlist; each section stores prose plus its citation list and last validation run.
- **brief / brief_item / citation** — weekly brief per watchlist: items reference diffs/events, every citation row stores (assertion span, docId, claimNo, date, validation status); a brief has `validated_at` set before it may send.

## Key flows

### 1. Tuesday/Thursday ingestion run

1. Inngest cron fires (Tue ~06:00 ET grants, Thu ~06:00 ET pre-grant pubs, plus a catch-up retry slot).
2. Step: fetch ODP bulk delta manifest; skip files already recorded by content hash (idempotent re-runs are no-ops).
3. Step: store raw XML in S3, upsert `document` rows keyed by (source, docNumber, kindCode).
4. Step: parse claims; for documents in known families, append `claim_version` rows and compute deterministic `claim_diff` against the prior version.
5. Step: pull File Wrapper deltas for watched families → `prosecution_event` rows.
6. Emit `documents.ingested` event with counts; failures alert (a silently skipped delta file is a recall incident, not a warning).

### 2. Screening a new publication against watchlists

1. On `documents.ingested`, fan out per active watchlist.
2. Candidate set = (CPC prefix match) ∪ (pgvector top-K against the watchlist claim-space embedding) ∪ (named assignee/inventor match). Union, never intersection.
3. Haiku classifies each candidate: in-scope / adjacent / out-of-scope, with one-line rationale.
4. Persist every `screening_result` including rejects; in-scope and adjacent docs queue for the next brief. Named-competitor docs bypass the classifier entirely — they always surface.

### 3. Weekly brief assembly and send

1. Friday cron gathers the week's claim_diffs, prosecution_events, and screened-in documents per watchlist.
2. Sonnet drafts brief items; the prompt receives only stored facts (diff hunks, event rows, claim text) with their IDs, and must cite per sentence.
3. Citation validator resolves every (docId, claimNo, date) tuple against Postgres and the claim text; invalid sentences are dropped. If a brief item loses its core assertion, the item falls back to the deterministic fact rendering ("Claim 1 amended on 2026-05-12: [blackline]").
4. Quiet weeks compress into a portfolio digest: prosecution status table, upcoming fee windows, expirations in the watch space — never a "nothing happened" email.
5. Brief marked `validated_at`, rendered (web + email), sent via Resend; the email links every assertion to the canonical document viewer.

### 4. Onboarding: watchlist creation and backfill

1. User describes their claim space in natural language, picks CPC classes (suggested from the description), names competitors.
2. Backfill job pulls each named competitor's portfolio via ODP + File Wrapper back to first filing, building families, claim_versions, and the full diff history (the file wrapper is canonical — backfill is complete by construction).
3. Initial dossier is synthesized and validated → the "Day 1 deliverable": a claim-evolution landscape that doubles as the Diligence Snapshot one-off product (M3).
4. First weekly brief follows on the next Friday cycle.

### 5. Counsel-grade verification (the trust loop)

1. Every assertion in app, email, and PDF carries a verify affordance.
2. Clicking opens a split view: assertion left, canonical document right, scrolled to the cited claim with the diff blackline overlaid.
3. Validation runs are stored per dossier section/brief; a public "how we cite" page documents the cite-or-omit pipeline. This is the sales asset against both keyword-alert tools and skeptical in-house counsel.

## Product & visual design direction

**Prosecution blackline** — the visual language of legal redlining, elevated. Paper-warm surfaces (oklch ~97% with a slight warm cast), near-black ink text, and the two semantic colors every patent attorney already reads fluently: struck-through deletions in oxblood red (oklch ~45% 0.13 25), underline-marked insertions in archival blue (oklch ~45% 0.10 255). Accent use is strictly semantic — red/blue mean diff, a single sealing-wax red is reserved for alerts (new filing in your claim space). Typography: a serif with legal-document gravitas for headings and dossier prose (Source Serif 4), IBM Plex Mono for claim text and diff blocks — claims are versioned artifacts and should read like them. Dense, ledger-like tables with generous line-height for prose; no gradients, no glassmorphism. The weekly email uses the same blackline conventions so a forwarded brief looks like a document a firm produced, not a SaaS notification.

## Milestones

### M0 — Bootstrap (make `just ci` green with real code)

- pnpm workspace with `apps/web`, `packages/core`, `packages/pipeline`, `packages/db`; `packageManager` pinned; TS strict everywhere.
- docker-compose.yml with `pgvector/pgvector:pg16` service; Drizzle configured; first migration creates org/watchlist/document tables; `just migrate` works against `just db-up`.
- eslint + prettier wired (`just lint` / `just format`), vitest with one real test per package, Playwright smoke test (app boots, renders heading), `just ci` passes locally and in GitHub Actions (guard flips to bootstrapped path).
- **Accept:** fresh clone → `just setup && just db-up && just migrate && just ci` all green; CI run green on push.

### M1 — Thin vertical slice (one watchlist, one real brief)

- Ingest one real Tuesday grant delta and one Thursday pre-grant delta for a single CPC subclass (pick one, e.g. `G06N` machine learning) end-to-end: S3 raw store → document rows → claim extraction → claim_versions.
- Deterministic diff engine produces a correct blackline for at least 3 hand-verified real families with known amendments (golden fixtures from the File Wrapper API).
- One hardcoded watchlist screens the week's docs (CPC ∪ pgvector ∪ Haiku) and a Sonnet-drafted, citation-validated brief is sent to a dev inbox via Resend, with working verify links.
- **Accept:** a recipient can click every citation in the email and land on the canonical document + claim; re-running the week's ingestion is a no-op; total model spend for the week logged and < $5.

### M2 — Trust layer

- Citation validator is a hard send-gate (brief without `validated_at` cannot send; failure pages the operator, never degrades silently).
- Recall eval harness: hand-labeled ground-truth set of ≥100 in-scope/out-of-scope publications for the pilot CPC vertical; screening recall and precision reported per release; recall regression fails CI for `packages/pipeline`.
- Coverage disclosure: every brief states covered jurisdictions and explicitly lists what ClaimWatch does not watch (e.g. CNIPA/JPO pre-M3).
- Language-policy lint: banned-phrase checks (no "freedom to operate", "non-infringement", "you may/may not practice") run over every synthesized output; counsel disclaimer on every surface.
- **Accept:** published eval numbers reproducible from `just test`; a seeded broken citation provably blocks a brief from sending.

### M3 — Monetization wiring

- Stripe: Startup $149/mo (annual push), Pro $399/mo, Firm $1,250/mo base + $99/client-workspace metered (per README revenue analysis); plan limits enforced in `packages/core` policy functions.
- Counsel-tier PDF export (white-label header for Firm workspaces) reusing the blackline rendering.
- Diligence Snapshot: the M1 backfill dossier packaged as a $1,500–2,500 one-off checkout for episodic (fundraising) buyers.
- Pro litigation feed via CourtListener/RECAP with metered PACER spend behind a hard per-org cap.
- **Accept:** test-mode checkout → provisioned watchlist limits → first brief; Firm workspace meter produces a correct Stripe usage record; PACER spend cap demonstrably halts fetching.

### M4 — live data plane / go-live readiness

Real-world I/O behind the trust layer: live USPTO/litigation fetchers, real Anthropic adapters, the nightly runner, and email delivery — all config-gated, with the deterministic gates non-bypassable.

- **Live fetchers in `packages/pipeline/src/fetch`.** (a) USPTO Open Data Portal client (`UsptoOdpClient`): full Patent Search API implementation (X-API-KEY auth, declared User-Agent, zod-validated responses, bibliographic results mapped into the existing document model with sha-256 content hashes); config-gated on `USPTO_ODP_API_KEY` — without the key the source is *skipped and recorded*, never half-configured. (b) CourtListener/RECAP litigation client (`CourtListenerClient`): keyless REST v4 docket fetch with declared User-Agent (optional `COURTLISTENER_API_TOKEN`), dockets mapped into the same document model (`source: 'CourtListener'`, kind `DOCKET`). Every fetcher output passes the zod boundary and then the existing content-hash idempotent ingest; a malformed payload throws `FetchValidationError` at the boundary and ingests nothing.
- **Real Anthropic adapter** (`AnthropicRelevanceClassifier` + `AnthropicBriefSynthesizer`) over the Messages API with Batch-ready request shapes (`buildClassifyParams`/`buildSynthesisParams` + `toBatchRequest`), retry/backoff on 429/529, refusal handling that yields *uncited* output so the existing cite-or-omit gate drops it. Config-gated on `ANTHROPIC_API_KEY` via `createModelAdapters`; the deterministic mocks remain the default everywhere. The citation validator runs on adapter output identically to mock output — the trust layer is provider-independent and not bypassable by config.
- **Nightly runner** (`just nightly [--live]`): ingest → diff → screen → synthesize → validate → render against fixtures (default) or live sources (`--live`: only reachable keyless sources; key-gated sources are skipped with a coverage note rendered into the brief). Emits a structured run ledger (sources attempted/fetched/skipped, docs ingested/duplicate-skipped, model calls, tokens, briefs produced, validation state) to `out/nightly/`. Schedulable entrypoint documented in TOOLS.md (cron + Inngest shape, not started).
- **Resend email adapter** (`ResendBriefSender`) for the validated-brief send path, config-gated on `RESEND_API_KEY` via `createBriefSender` (absent → deterministic mock). The M2 send-gate fires *before* the adapter: an unvalidated brief pages the operator and throws `SendBlockedError` with zero HTTP calls made.

**Accept:**

- `just ci` green with no Docker and no network: all adapters unit-tested against injected fetch stubs; live suites self-skip without `RUN_LIVE=1`.
- `just test-live` runs the keyless CourtListener smoke against the real endpoint (one tiny query, declared User-Agent, graceful skip offline) and records the USPTO ODP skip when no key is present.
- A malformed live payload is provably rejected at the zod boundary with zero rows ingested; a duplicate fetch is a content-hash no-op.
- A fabricated citation from the real adapter is dropped by the same validator path as from the mock (provider-independence test); a refusal yields a fallback-rendered item, and the resulting brief cannot send.
- `just nightly` (fixtures) produces a validated brief + ledger; `just nightly --live` produces a ledger recording CourtListener fetched and USPTO/Anthropic/Resend skipped, with the coverage note in the rendered brief.

**Status notes (delivered vs deferred):** Delivered as above. Deferred: bulk-XML delta download via ODP (live claim-text ingest — live fetchers currently carry bibliographic/docket data only, so claim diffs still come from the fixture/bulk path); EPO OPS client; Anthropic Message *Batches* submission endpoint (request shapes are batch-ready, the batch poller is not built); Inngest functions running in production (entrypoint + config documented, not started); real send of a live brief (no `RESEND_API_KEY` exists in this environment).

## Decision log

| Decision                | Choice                                                                                                                                                                                                                                                                                                        | Rationale / revisit trigger                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduler               | **Inngest** over Temporal                                                                                                                                                                                                                                                                                     | Cron + durable steps co-located with Next.js, zero extra infra for 2–3 people. Revisit if backfills exceed step limits or need multi-day workflows.                                                                                                                                                                                                                                                  |
| Email                   | **Resend** over Postmark                                                                                                                                                                                                                                                                                      | React Email templates share the blackline components with the web app. Revisit if deliverability to law-firm domains underperforms.                                                                                                                                                                                                                                                                  |
| Embeddings              | **voyage-3** over text-embedding-3-large                                                                                                                                                                                                                                                                      | README's first choice; strong retrieval quality per dollar on long legal text. Swappable behind one interface in `packages/db`.                                                                                                                                                                                                                                                                      |
| Jurisdictions at launch | USPTO + EPO only; **no WIPO/CNIPA/JPO**                                                                                                                                                                                                                                                                       | Coverage honesty beats false breadth — disclosed in every brief (invariant 4). Add WIPO via vendor post-M3 when Firm-tier demand pays for it.                                                                                                                                                                                                                                                        |
| Diff classification     | Deterministic heuristics tag structure; LLM annotates meaning in a **separate field**                                                                                                                                                                                                                         | Keeps the checkable layer and the interpretive layer permanently distinguishable in data and UI. Never merge them.                                                                                                                                                                                                                                                                                   |
| M1 verification harness | **Checked-in USPTO XML fixtures + deterministic mock models** (`packages/pipeline` runs ingest → diff → triage → synthesis against `fixtures/uspto`, model calls behind `RelevanceClassifier`/`BriefSynthesizer` interfaces)                                                                                  | The whole gate (`just ci`) is green offline with no API key and no Postgres; the in-memory store mirrors the Drizzle schema. Swap in live ODP/Anthropic/Resend clients behind the same interfaces when M1 goes live; Inngest wiring and the Resend send remain open M1 work.                                                                                                                         |
| M2 storage port         | **Async `SliceStore` interface with two backends**: `MemoryStore` (unit/fixture runs) and `DrizzleSliceStore` (live pgvector/pg16, host port 5433) running the identical pipeline code                                                                                                                        | `just test-db` proves idempotent re-ingest (zero new rows), byte-identical re-runs, and memory/Postgres parity on real storage. Append-only is enforced IN the database via UPDATE/DELETE-rejecting triggers on `document`/`claim_version`/`claim_diff` (migration 0001), not just at the API surface. `DrizzleSliceStore` stays out of the pipeline barrel so apps/web never bundles the DB driver. |
| M2 trust gates          | **Hard send-gate + published recall eval**: `sendValidatedBrief` pages the operator and throws on `validatedAt === null` (Resend stays behind `BriefSender`); `fixtures/eval/screening-groundtruth.json` (120 hand-labeled publications, error budget documented per entry) scored by the real screening path | Published figures (recall 58/60 ≈ 0.967, precision 58/61 ≈ 0.951) are exact-value test assertions in `packages/pipeline`; any screening regression fails `just ci`. Revisit the labeled set per new CPC vertical before any recall marketing claim (risk register #2).                                                                                                                               |
| M3 billing seam         | **`BillingProvider` interface in `packages/core` + deterministic `MockBillingProvider` carrying every test; Stripe adapter skeleton in apps/web, config-gated on `STRIPE_SECRET_KEY`** (absent → mock, always). Plan policy + the subscribe/renew/payment-failure→14-day-grace→lapse state machine are pure functions in `packages/core`; Stripe is an event source, never a second source of truth. Proration-free semantics: upgrades immediate (no credit/charge mid-cycle), downgrades at the renewal boundary | No real payment credentials exist in the repo; webhook translation (`applyStripeWebhookEvent`) is pure and unit-tested. Live wiring (checkout UI, webhook endpoint, durable provider-ref storage, Firm workspace meter, Diligence Snapshot checkout, PACER cap) lands when a test-mode key exists.                                                                                                   |
| M3 workspace storage    | **`WorkspaceStore` port (orgs, `subscription` table via migration 0003, mutable watchlists) with Memory + Drizzle backends**, mirroring the M2 SliceStore pattern; apps/web composes the seeded memory backend (pre-auth demo orgs, one per tier), the Drizzle backend is proven by `just test-db`. Watchlists are the documented mutable exception to append-only; claim history tables stay trigger-guarded. On downgrade nothing is deleted: over-limit watchlists freeze read-only (`partitionWatchlistsByEntitlement`) | Web→Postgres composition arrives with auth (apps/web still never bundles the DB driver). Counsel export reuses the brief pipeline: Pro+ print-optimized blackline artifact, Firm white-label variant provably free of product branding, both hard-gated on `validatedAt` exactly like sending.                                                                                                       |

| M4 live data plane      | **Config-gated real adapters behind the existing seams; gates stay outboard.** Fetchers (`UsptoOdpClient`, `CourtListenerClient`) validate every payload with zod and feed the same content-hash ingest as fixtures; `RelevanceClassifier`/`BriefSynthesizer` become sync-or-async (`T \| Promise<T>`) so the Anthropic Messages adapter slots in without touching the gate code; `createModelAdapters`/`createBriefSender` select mock vs real on env keys only. Live smoke tests live in `*.live.test.ts`, self-skip unless `RUN_LIVE=1` (mirrors the `DATABASE_URL` pattern), and run via `just test-live` — never in `just ci`. `tsx` added as a pipeline devDependency solely to run the nightly CLI from source (packages are type-checked, not emitted). | Citation/span validation and the send-gate sit BETWEEN adapter output and anything user-visible, by call order in `synthesizeBrief`/`sendValidatedBrief` — no config flag can route around them. Revisit when Message Batches submission and bulk-XML deltas land.                                                                                                                  |

## Risks & mitigations (from the adversarial review)

1. **Patlytics/Solve ship monitoring down-market** ($65M/$55M raised, law-firm distribution). _Mitigation:_ speed into the synthesis-under-$1K gap they ignore while selling drafting tools upmarket; make the Firm brief format the deliverable firms standardize on (M3 white-label) — switching the format clients receive is the real lock-in, since the data moat is admitted to be reproducible.
2. **A single recall miss kills the account and brand** (claim-space recall realistically 70–90% and unprovable without work). _Mitigation:_ recall-biased union screening that can downrank but never drop; named competitors bypass screening entirely; M2 hand-labeled eval set per vertical _before_ any retention or recall marketing claim; explicit coverage disclosure in every brief so misses outside scope are contractual, not betrayals.
3. **UPL / liability: synthesis drifts into legal opinion** ("this opens design space" ≈ FTO advice). _Mitigation:_ observation-not-opinion language policy enforced by the M2 banned-phrase lint, counsel-review framing and disclaimer on every brief/PDF, and positioning the counsel tier as making the attorney faster rather than replacing review.
4. **Structural churn: report-shaped value at subscription pricing** (subscribe at diligence, see quiet briefs, cancel month 4–6). _Mitigation:_ quiet-week briefs carry deterministic always-true content (status table, fee windows, expirations); Diligence Snapshot one-off captures episodic buyers instead of churning them; annual-billing push at Startup tier; Firm tier (multi-client, perpetual need) is the revenue engine.
5. **The claim-evolution data moat is reproducible** (file wrapper is a complete public archive). _Mitigation:_ treat data as table stakes; the accumulated assets are watchlist configs, the screening_result corpus (training/eval data competitors lack), the eval ground truth, and the trust brand of mechanically validated citations — invest there, never market "proprietary data".

Secondary cost risks tracked in TOOLS.md: EPO OPS free tier (4GB/mo) is pilot-only — budget the paid tier before M2 scale; PACER is metered and must stay behind the per-org cap.
