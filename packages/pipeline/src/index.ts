export type {
  StoredDocument,
  ClaimVersionRow,
  ClaimDiffRow,
  ScreeningResultRow,
  MatchArm,
} from './store/types';
export { MemoryStore, AppendOnlyViolationError } from './store/memoryStore';
export { loadDelta, DeltaLoadError } from './ingest/loadDelta';
export type { DeltaManifest, LoadedDelta, DeltaFile } from './ingest/loadDelta';
export { ingestDelta } from './ingest/ingestDelta';
export type { IngestCounts } from './ingest/ingestDelta';
export type {
  RelevanceClassifier,
  BriefSynthesizer,
  ClassifierVerdict,
  SynthesisDraft,
  TokenBudget,
} from './llm/types';
export { BudgetExceededError, spendTokens } from './llm/types';
export {
  MockRelevanceClassifier,
  MockBriefSynthesizer,
  FaultInjectingSynthesizer,
  termOverlapScore,
} from './llm/mocks';
export { M1_WATCHLIST } from './triage/watchlist';
export type { WatchlistConfig } from './triage/watchlist';
export { screenDocuments } from './triage/screen';
export type { ScreeningOutcome } from './triage/screen';
export { renderBlacklineText } from './synth/renderBlackline';
export { synthesizeBrief, pinCitations, buildCitationContext } from './synth/synthesizeBrief';
export type { PinnedCitation, SynthesisResult } from './synth/synthesizeBrief';
export { runSlice } from './runSlice';
export type { RunSliceOptions, SliceResult, FamilyTimeline } from './runSlice';
