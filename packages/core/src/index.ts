export type { ClaimStatus, ParsedClaim, ParsedDocument } from './claims/types';
export { buildDocId } from './claims/types';
export { normalizeClaimText, parseClaimBody } from './claims/normalizeClaim';
export type { ClaimBody } from './claims/normalizeClaim';
export { parseUsptoXml, decodeXmlEntities, UsptoParseError } from './claims/parseUsptoXml';
export type { DiffOp, DiffHunk } from './diff/diffWords';
export { diffClaimTexts, countDiffTokens } from './diff/diffWords';
export type { StructuralChange, ClaimChange } from './diff/classifyDiff';
export { classifyClaimDiff } from './diff/classifyDiff';
export type {
  CitationRef,
  CitationStatus,
  CitationRecord,
  CitationContext,
  CitationContextEntry,
  SynthesizedSentence,
  SentenceValidation,
  DropReason,
} from './citations/citationValidator';
export { validateCitation, validateSentences } from './citations/citationValidator';
export {
  BANNED_PHRASES,
  COUNSEL_DISCLAIMER,
  counselDisclaimerFor,
  scanBannedPhrases,
} from './policy/languagePolicy';
export type { PolicyViolation } from './policy/languagePolicy';
export type {
  Brief,
  BriefItem,
  BriefItemDraft,
  BriefItemFact,
  BriefFactKind,
  CoverageDisclosure,
  AssembleBriefInput,
} from './brief/assembleBrief';
export { assembleBrief } from './brief/assembleBrief';
export type { DeployTarget, EnvReport } from './env';
export { validateEnv, isLlmConfigured, EnvValidationError } from './env';
export type {
  PlanId,
  PlanFeature,
  PlanLimits,
  PlanDefinition,
  LimitKind,
  LimitHit,
  LimitVerdict,
  WatchlistShape,
} from './billing/plans';
export {
  PLANS,
  PLAN_ORDER,
  hasFeature,
  checkWatchlistCreate,
  checkWatchlistShape,
  partitionWatchlistsByEntitlement,
} from './billing/plans';
export type {
  BillingCycle,
  SubscriptionStatus,
  SubscriptionRecord,
  StartSubscriptionInput,
  PlanChangeKind,
  PlanChangeResult,
} from './billing/subscription';
export {
  GRACE_PERIOD_DAYS,
  SubscriptionTransitionError,
  startSubscription,
  renewSubscription,
  recordPaymentFailure,
  recordPaymentRecovery,
  expireGraceIfDue,
  cancelSubscription,
  changePlan,
  entitledPlan,
} from './billing/subscription';
export type { BillingProvider, SubscribeInput } from './billing/provider';
export { UnknownSubscriptionError } from './billing/provider';
export { MockBillingProvider } from './billing/mockProvider';
export type {
  WatchlistInput,
  WatchlistInputIssue,
  WatchlistInputResult,
} from './watchlists/watchlistInput';
export {
  watchlistInputSchema,
  parseWatchlistInput,
  splitListField,
  splitNameListField,
} from './watchlists/watchlistInput';
