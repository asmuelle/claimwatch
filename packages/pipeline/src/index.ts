export type {
  StoredDocument,
  ClaimVersionRow,
  ClaimDiffRow,
  ScreeningResultRow,
  MatchArm,
  SliceStore,
} from './store/types';
export { MemoryStore, AppendOnlyViolationError } from './store/memoryStore';
// NOTE: DrizzleSliceStore is deliberately NOT re-exported here. apps/web
// consumes this barrel and must never bundle the Postgres driver; DB-aware
// composition (tests, future Inngest workers) imports the module directly:
//   import { DrizzleSliceStore } from '@claimwatch/pipeline/src/store/drizzleStore'

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
export {
  sendValidatedBrief,
  SendBlockedError,
  MockBriefSender,
  RecordingPager,
} from './send/sendBrief';
export type {
  BriefSender,
  BriefSendRequest,
  BriefSendReceipt,
  OperatorPager,
  SendIncident,
  SendBriefInput,
} from './send/sendBrief';
export { evaluateScreening, loadGroundTruth, GroundTruthLoadError } from './eval/screeningEval';
export type { GroundTruthEntry, GroundTruthFile, ScreeningEvalReport } from './eval/screeningEval';
