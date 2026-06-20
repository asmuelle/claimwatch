# ClaimWatch

[![CI](https://github.com/asmuelle/claimwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/asmuelle/claimwatch/actions/workflows/ci.yml)

> Patent and IP radar for IP-heavy startups: a weekly agent over USPTO/EPO/WIPO bulk feeds maintains living dossiers per technology area and competitor — alerting on new filings in your claim space, claim amendments, assignments, and lapses, with every assertion checkable against the canonical document.

**Category:** LLM wiki / auto-research (living documents + delta alerts, à la Karpathy) 

## Concept

Patent and IP radar for IP-heavy startups: a weekly agent over USPTO/EPO/WIPO bulk feeds maintains living dossiers per technology area and competitor — alerting on new filings in your claim space, claim amendments, assignments, and lapses, with every assertion checkable against the canonical document.

## Target User

Founders, CTOs, and in-house counsel at deeptech, biotech, hardware, and AI startups whose valuation rests on IP (fundraising diligence and freedom-to-operate anxiety are board-level issues), plus boutique patent law firms managing many small clients who want a $400/hr associate's monitoring work turned into a reviewable brief.

## Auto-Research Mechanic (the living document + delta engine)

Built on free, structured, canonical government data: USPTO full-text and assignment feeds, EPO OPS, WIPO PATENTSCOPE, litigation dockets — refreshed on the official Tuesday/Thursday publication cycle (cadence matches the data). Watchlists defined as CPC classes plus natural-language claim-space descriptions and named competitors/inventors. Cheap-model screening of new publications and amendments; frontier pass updates living dossiers: per-family claim-evolution timelines, assignment changes, prosecution status, fee lapses and expirations. Weekly brief reasons over prosecution history: 'Competitor X's continuation narrowed claim 1 after rejection — this opens design space in Y.' Every assertion links to document, claim number, and publication date — the highest-citation-trust vertical possible because every citation is mechanically checkable.

## Product Surface

Web SaaS (dossiers, claim timelines, watchlist management) + weekly email brief as primary touchpoint — patent monitoring is inherently weekly-cadence and the brief gets forwarded to boards and outside counsel. Counsel tier adds PDF brief export formatted for client files.

## Why Now (2026 timing)

Patent watch explicitly identified as an under-disrupted niche with quote-only incumbents and zero cheap challengers. LLMs only recently became capable of meaningfully reading claim language and prosecution histories — and the corpus is free, structured, and crawl-unrestricted, so the access constraints hardening across the general web in 2026 don't apply at all.

## Proposed Monetization

$149/mo Startup (1 technology-area watchlist, 10 competitors/CPC classes), $399/mo Pro (5 watchlists, litigation-docket monitoring, counsel-ready export), $799/mo Firm (multi-client workspaces, white-label briefs). The entire sub-$1K/mo tier is empty under PatSnap/Clarivate/Questel's $20K+ quote-only floor; COGS is a few dollars per watchlist on free data.

## Competition & Gap

PatSnap/Clarivate/Questel (enterprise, quote-only database access plus analyst tooling), Google Patents (free search, zero monitoring or synthesis), keyword-matching alert services. None maintain a living claim-evolution dossier or explain what an amendment means for your design space.

## Claimed Moat

(1) Claim-language extraction and prosecution-history reasoning is deep vertical NLP on a corpus horizontal chatbots don't index conversationally — a scheduled ChatGPT task cannot diff claim amendments across a patent family. (2) The longitudinal claim-evolution graph is accumulated state: two years of watching how a rival's claims narrowed is retroactively irreproducible. (3) Law-firm tier creates distribution lock-in as firms standardize client deliverables on the brief format. (4) Provable accuracy in the one research domain where every citation is mechanically verifiable builds a trust brand that survives any incumbent feature launch.

---

# Evaluation (multi-agent adversarial review)


## Comparables

- PatSnap — quote-only, ~$15K/yr single-seat to $40K-$80K+/yr enterprise; $100M ARR (2023, +20% YoY), $352M raised, $1B valuation
- Questel — ~$750M annual revenue (2025), enterprise IP software and services, PE-owned
- Clarivate — $2.56B total revenue (2024); divested its IP product group in 2024, signaling incumbent retreat from the segment
- Patlytics — AI patent platform, $40M Series B (Apr 2026), ~$65M total raised, 40% of Am Law 100 as customers; nearest well-funded threat
- Solve Intelligence — AI patent drafting/prosecution, $40M Series B (Dec 2025), $55M total, eight-figure ARR up 10x YoY; 60% law firms / 40% corporate IP
- IamIP — patent search and monitoring from $99/mo; proves a low-cost tier exists but is keyword-alert grade, no claim-evolution synthesis
- XLPat — free patent alerts (keyword matching); price-anchor pressure at the bottom of the market
- Boutique IP firm subscription services — $2K-$10K/mo per client; one firm reports $2.4M/yr from 30 subscription clients (validates Firm-tier white-label economics)
- Patent attorney hourly rates — $200-$800/hr; the inferior 'alternative' startups currently pay for monitoring/FTO work

## Tech Stack & Unit Economics

Ingestion: USPTO Open Data Portal bulk delta datasets (daily) + Patent File Wrapper API (free), EPO OPS paid tier (~EUR 1-4K/yr at scale; free 4GB/mo fair-use tier insufficient beyond pilot), WIPO PATENTSCOPE via vendor or constrained scraping, CourtListener/RECAP + metered PACER (or Docket Alarm API) for the litigation tier; cron aligned to the Tue (grants) / Thu (pre-grant pubs) cycle, Temporal or pg_cron workers. Storage: Postgres + pgvector (claim embeddings via voyage-3 or text-embedding-3-large), S3 for raw XML/PDF, claim-version tables per family. Critical design rule: claim diffing is deterministic XML text diff — never LLM-generated. Screening: CPC prefilter then Haiku 4.5 / Gemini Flash relevance classification of ~200-800 docs/week per watchlist (~1-3M tokens/wk, $1-3/wk). Synthesis: Sonnet 4.6 dossier updates + weekly brief with cite-or-omit grounding — every sentence must resolve to a stored doc ID + claim number and is mechanically validated post-generation; Opus-class pass only for flagged prosecution-history reasoning over office-action context (50-150K tokens/family, $3-10/wk). App: Next.js + Postgres SaaS, Resend/Postmark email brief, PDF export for counsel tier. Unit economics: Startup tier COGS ~$20-40/user/mo (screening $5-12, frontier synthesis $12-40 across 4 weekly briefs amortized, embeddings/infra $3-5) against $149 = ~70-85% gross margin; Pro litigation-docket tier adds $30-150/mo PACER/docket exposure and must be metered or it eats margin. Team of 2-3 can ship an MVP in roughly one quarter; the hard 20% is claim-space recall evaluation, which needs a hand-labeled ground-truth set per vertical before any retention claim is believable.
