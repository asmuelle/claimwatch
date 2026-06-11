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
export { BANNED_PHRASES, COUNSEL_DISCLAIMER, scanBannedPhrases } from './policy/languagePolicy';
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
