/**
 * The M1 thin vertical slice: backfill + one Tuesday grant delta + one
 * Thursday pre-grant delta -> deterministic diffs -> screening -> validated
 * weekly brief. Fixture-driven, mock-model-driven, fully deterministic.
 */
import type { Brief } from '@claimwatch/core';
import { ingestDelta } from './ingest/ingestDelta';
import type { IngestCounts } from './ingest/ingestDelta';
import { loadDelta } from './ingest/loadDelta';
import { MockBriefSynthesizer, MockRelevanceClassifier } from './llm/mocks';
import type { BriefSynthesizer, RelevanceClassifier, TokenBudget } from './llm/types';
import { MemoryStore } from './store/memoryStore';
import type {
  ClaimDiffRow,
  ClaimVersionRow,
  ScreeningResultRow,
  StoredDocument,
} from './store/types';
import { screenDocuments } from './triage/screen';
import { M1_WATCHLIST } from './triage/watchlist';
import type { WatchlistConfig } from './triage/watchlist';
import { synthesizeBrief } from './synth/synthesizeBrief';
import type { PinnedCitation } from './synth/synthesizeBrief';

export interface FamilyTimeline {
  readonly familyId: string;
  readonly assignee: string;
  readonly versions: readonly ClaimVersionRow[];
  readonly diffs: readonly ClaimDiffRow[];
}

export interface SliceResult {
  readonly watchlist: WatchlistConfig;
  readonly ingest: readonly IngestCounts[];
  readonly documents: readonly StoredDocument[];
  readonly screening: readonly ScreeningResultRow[];
  readonly brief: Brief;
  readonly pinnedCitations: readonly PinnedCitation[];
  readonly timelines: readonly FamilyTimeline[];
  readonly screeningTokensUsed: number;
  readonly synthesisTokensUsed: number;
}

export interface RunSliceOptions {
  readonly fixturesDir: string;
  readonly watchlist?: WatchlistConfig;
  readonly classifier?: RelevanceClassifier;
  readonly synthesizer?: BriefSynthesizer;
  /** Injected clock for determinism. */
  readonly nowIso?: string;
}

function buildTimelines(store: MemoryStore): readonly FamilyTimeline[] {
  const familyIds = [...new Set(store.listClaimVersions().map((row) => row.familyId))].sort();
  return familyIds.map((familyId) => {
    const versions = store
      .listClaimVersions()
      .filter((row) => row.familyId === familyId)
      .sort((a, b) => a.claimNumber - b.claimNumber || a.versionSeq - b.versionSeq);
    const diffs = store.listClaimDiffs().filter((row) => row.familyId === familyId);
    const firstDoc = versions[0] ? store.getDocument(versions[0].docId) : undefined;
    return { familyId, assignee: firstDoc?.assignee ?? 'unknown', versions, diffs };
  });
}

/** Runs the whole M1 slice against checked-in fixtures. Pure of network and DB. */
export function runSlice(options: RunSliceOptions): SliceResult {
  const watchlist = options.watchlist ?? M1_WATCHLIST;
  const classifier = options.classifier ?? new MockRelevanceClassifier(watchlist.claimSpaceTerms);
  const synthesizer = options.synthesizer ?? new MockBriefSynthesizer();
  const nowIso = options.nowIso ?? '2026-05-15T12:00:00.000Z';

  const store = new MemoryStore();
  const backfill = loadDelta(options.fixturesDir, 'backfill');
  const tuesday = loadDelta(options.fixturesDir, 'delta-tue');
  const thursday = loadDelta(options.fixturesDir, 'delta-thu');

  const ingest = [
    ingestDelta(store, backfill),
    ingestDelta(store, tuesday),
    ingestDelta(store, thursday),
  ];

  const weekDates = new Set([tuesday.manifest.published, thursday.manifest.published]);
  const weekDocs = store
    .listDocuments()
    .filter((doc) => weekDates.has(doc.publicationDate));

  const screeningBudget: TokenBudget = { limit: watchlist.screeningTokenBudget, used: 0 };
  const screening = screenDocuments(store, watchlist, weekDocs, classifier, screeningBudget);

  const synthesis = synthesizeBrief({
    store,
    watchlist,
    weekDocs,
    surfaced: screening.surfaced,
    synthesizer,
    budget: { limit: watchlist.synthesisTokenBudget, used: 0 },
    weekOf: tuesday.manifest.published,
    nowIso,
  });

  return {
    watchlist,
    ingest,
    documents: store.listDocuments(),
    screening: screening.results,
    brief: synthesis.brief,
    pinnedCitations: synthesis.pinnedCitations,
    timelines: buildTimelines(store),
    screeningTokensUsed: screening.budget.used,
    synthesisTokensUsed: synthesis.budget.used,
  };
}
