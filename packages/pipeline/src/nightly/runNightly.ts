/**
 * Nightly runner (M4): ingest -> diff -> screen -> synthesize -> validate ->
 * render, against EITHER checked-in fixtures (default) or live sources
 * (--live: only reachable keyless sources; key-gated sources are skipped
 * with a coverage note rendered into the brief).
 *
 * Every run emits a structured run ledger: sources attempted/fetched/
 * skipped/failed, documents ingested, model calls, tokens spent, briefs
 * produced, validation state. A skipped source is RECORDED, never silent
 * (invariant 6).
 *
 * The trust layer is positionally non-bypassable here: synthesis output goes
 * through assembleBrief (citation validator + banned-phrase lint) inside
 * synthesizeBrief, and rendering happens AFTER validation. No flag on this
 * runner can reorder that.
 */
import type { Brief } from '@claimwatch/core';
import { createFetchers } from '../fetch/createFetchers';
import { ingestFetchedDocuments } from '../fetch/ingestFetched';
import { ingestDelta } from '../ingest/ingestDelta';
import { loadDelta } from '../ingest/loadDelta';
import { createModelAdapters } from '../llm/createModelAdapters';
import type { TokenBudget } from '../llm/types';
import { MemoryStore } from '../store/memoryStore';
import type { SliceStore } from '../store/types';
import { screenDocuments } from '../triage/screen';
import { M1_WATCHLIST } from '../triage/watchlist';
import type { WatchlistConfig } from '../triage/watchlist';
import { synthesizeBrief } from '../synth/synthesizeBrief';

export type NightlySourceName = 'uspto-fixtures' | 'uspto-odp' | 'courtlistener';

export interface SourceAttempt {
  readonly source: NightlySourceName;
  readonly status: 'fetched' | 'skipped' | 'failed';
  readonly detail: string;
  readonly docsFetched: number;
}

export interface RunLedger {
  readonly startedAt: string;
  readonly mode: 'fixtures' | 'live';
  readonly watchlist: string;
  readonly sources: readonly SourceAttempt[];
  readonly docsIngested: number;
  readonly docsSkippedDuplicate: number;
  readonly claimVersionsAdded: number;
  readonly claimDiffsComputed: number;
  readonly modelProvider: 'mock' | 'anthropic';
  readonly screeningModelCalls: number;
  readonly synthesisModelCalls: number;
  readonly screeningTokensUsed: number;
  readonly synthesisTokensUsed: number;
  readonly briefsProduced: number;
  readonly briefValidated: boolean;
  readonly coverageNotes: readonly string[];
}

export interface NightlyResult {
  readonly ledger: RunLedger;
  readonly brief: Brief;
  /** Markdown rendering of the validated brief + coverage notes. */
  readonly renderedBrief: string;
}

export interface NightlyOptions {
  readonly live: boolean;
  readonly fixturesDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly watchlist?: WatchlistConfig;
  readonly store?: SliceStore;
  readonly fetchImpl?: typeof fetch;
  readonly nowIso?: string;
}

interface IngestTotals {
  docsIngested: number;
  docsSkippedDuplicate: number;
  claimVersionsAdded: number;
  claimDiffsComputed: number;
}

async function ingestFixtureSources(
  store: SliceStore,
  fixturesDir: string,
  totals: IngestTotals,
  sources: SourceAttempt[],
): Promise<Set<string>> {
  const weekDates = new Set<string>();
  let docsFetched = 0;
  for (const deltaName of ['backfill', 'delta-tue', 'delta-thu']) {
    const delta = loadDelta(fixturesDir, deltaName);
    const counts = await ingestDelta(store, delta);
    totals.docsIngested += counts.documentsAdded;
    totals.docsSkippedDuplicate += counts.documentsSkipped;
    totals.claimVersionsAdded += counts.claimVersionsAdded;
    totals.claimDiffsComputed += counts.claimDiffsComputed;
    docsFetched += counts.filesSeen;
    if (deltaName !== 'backfill') weekDates.add(delta.manifest.published);
  }
  sources.push({
    source: 'uspto-fixtures',
    status: 'fetched',
    detail: 'checked-in USPTO XML deltas (backfill + Tue + Thu)',
    docsFetched,
  });
  return weekDates;
}

async function ingestLiveSources(
  store: SliceStore,
  options: NightlyOptions,
  totals: IngestTotals,
  sources: SourceAttempt[],
  coverageNotes: string[],
): Promise<Set<string>> {
  const fetchers = createFetchers(options.env, options.fetchImpl);
  const weekDates = new Set<string>();

  if (fetchers.uspto === undefined) {
    sources.push({
      source: 'uspto-odp',
      status: 'skipped',
      detail: 'USPTO_ODP_API_KEY not set — source skipped, not silently dropped',
      docsFetched: 0,
    });
    coverageNotes.push('USPTO ODP live fetch SKIPPED this run (no API key configured).');
  } else {
    try {
      const result = await fetchers.uspto.searchPublishedApplications({
        query: 'applicationMetaData.cpcClassificationBag:(G06N*)',
        limit: 5,
      });
      const counts = await ingestFetchedDocuments(store, result.documents);
      totals.docsIngested += counts.docsIngested;
      totals.docsSkippedDuplicate += counts.docsSkippedDuplicate;
      for (const doc of result.documents) weekDates.add(doc.publicationDate);
      sources.push({
        source: 'uspto-odp',
        status: 'fetched',
        detail: `patent search returned ${result.documents.length} published of ${result.totalCount} total`,
        docsFetched: result.documents.length,
      });
    } catch (cause) {
      sources.push({
        source: 'uspto-odp',
        status: 'failed',
        detail: String(cause),
        docsFetched: 0,
      });
      coverageNotes.push('USPTO ODP live fetch FAILED this run — see ledger; coverage incomplete.');
    }
  }

  try {
    const result = await fetchers.courtListener.fetchRecentDockets({ court: 'txed', pageSize: 5 });
    const counts = await ingestFetchedDocuments(store, result.documents);
    totals.docsIngested += counts.docsIngested;
    totals.docsSkippedDuplicate += counts.docsSkippedDuplicate;
    for (const doc of result.documents) weekDates.add(doc.publicationDate);
    sources.push({
      source: 'courtlistener',
      status: 'fetched',
      detail: `dockets fetched (keyless, declared UA); ${result.docketsWithoutDate} without filing date skipped`,
      docsFetched: result.documents.length,
    });
  } catch (cause) {
    sources.push({
      source: 'courtlistener',
      status: 'failed',
      detail: String(cause),
      docsFetched: 0,
    });
    coverageNotes.push('CourtListener live fetch FAILED this run — see ledger; coverage incomplete.');
  }

  return weekDates;
}

function renderBriefMarkdown(brief: Brief, coverageNotes: readonly string[]): string {
  const lines: string[] = [
    `# ClaimWatch brief — ${brief.watchlistName}`,
    '',
    `Week of ${brief.weekOf} · ${brief.validatedAt !== null ? `validated at ${brief.validatedAt}` : 'NOT validated — must not send'}`,
    '',
  ];
  for (const item of brief.items) {
    lines.push(`## ${item.fact.headline}`);
    for (const validation of item.sentences) {
      if (validation.kept) lines.push(`> ${validation.sentence.text}`);
    }
    if (item.fallbackUsed) lines.push('_Facts-only item (no synthesized sentence survived the gate)._');
    lines.push('');
  }
  if (brief.quietWeek) lines.push('_Quiet week: no in-scope changes observed._', '');
  lines.push('### Coverage');
  lines.push(`- Watched: ${brief.coverage.watched.join('; ')}`);
  lines.push(`- Not watched: ${brief.coverage.notWatched.join('; ')}`);
  for (const note of coverageNotes) lines.push(`- ${note}`);
  lines.push('', `_${brief.disclaimer}_`, '');
  return lines.join('\n');
}

/** Runs one nightly cycle. Pure of process.exit and the filesystem (CLI owns IO). */
export async function runNightly(options: NightlyOptions): Promise<NightlyResult> {
  const watchlist = options.watchlist ?? M1_WATCHLIST;
  const nowIso = options.nowIso ?? new Date().toISOString();
  const store = options.store ?? new MemoryStore();
  const sources: SourceAttempt[] = [];
  const coverageNotes: string[] = [];
  const totals: IngestTotals = {
    docsIngested: 0,
    docsSkippedDuplicate: 0,
    claimVersionsAdded: 0,
    claimDiffsComputed: 0,
  };

  const weekDates = options.live
    ? await ingestLiveSources(store, options, totals, sources, coverageNotes)
    : await ingestFixtureSources(store, options.fixturesDir, totals, sources);

  const adapters = createModelAdapters(options.env, watchlist, {
    fetchImpl: options.fetchImpl,
  });
  if (options.live && adapters.provider === 'mock') {
    coverageNotes.push(
      'Anthropic adapter SKIPPED this run (no API key) — deterministic mock models used.',
    );
  }

  const weekDocs = (await store.listDocuments()).filter((doc) =>
    weekDates.has(doc.publicationDate),
  );
  const screeningBudget: TokenBudget = { limit: watchlist.screeningTokenBudget, used: 0 };
  const screening = await screenDocuments(
    store,
    watchlist,
    weekDocs,
    adapters.classifier,
    screeningBudget,
  );
  const screeningModelCalls = screening.results.filter(
    (row) => row.model !== 'bypass' && row.model !== 'deterministic-prefilter',
  ).length;

  const weekOf = [...weekDates].sort()[0] ?? nowIso.slice(0, 10);
  const synthesis = await synthesizeBrief({
    store,
    watchlist,
    weekDocs,
    surfaced: screening.surfaced,
    synthesizer: adapters.synthesizer,
    budget: { limit: watchlist.synthesisTokenBudget, used: 0 },
    weekOf,
    nowIso,
  });

  const ledger: RunLedger = {
    startedAt: nowIso,
    mode: options.live ? 'live' : 'fixtures',
    watchlist: watchlist.name,
    sources,
    docsIngested: totals.docsIngested,
    docsSkippedDuplicate: totals.docsSkippedDuplicate,
    claimVersionsAdded: totals.claimVersionsAdded,
    claimDiffsComputed: totals.claimDiffsComputed,
    modelProvider: adapters.provider,
    screeningModelCalls,
    synthesisModelCalls: synthesis.brief.items.length,
    screeningTokensUsed: screening.budget.used,
    synthesisTokensUsed: synthesis.budget.used,
    briefsProduced: 1,
    briefValidated: synthesis.brief.validatedAt !== null,
    coverageNotes,
  };

  return {
    ledger,
    brief: synthesis.brief,
    renderedBrief: renderBriefMarkdown(synthesis.brief, coverageNotes),
  };
}
