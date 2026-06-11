/**
 * Brief assembly rules — deterministic facts first, synthesized prose gated
 * behind the citation validator and the language policy.
 *
 * - Every item always carries a deterministic fact rendering (the blackline).
 * - Synthesized sentences are kept only when every citation validates and no
 *   banned phrase appears (invariants 2 and 4).
 * - `validatedAt` is set ONLY when zero sentences failed; a seeded invalid
 *   citation provably blocks validation (the M2 send-gate reads this field).
 */
import type { DiffHunk } from '../diff/diffWords';
import type { StructuralChange } from '../diff/classifyDiff';
import type {
  CitationContext,
  SentenceValidation,
  SynthesizedSentence,
} from '../citations/citationValidator';
import { validateSentences } from '../citations/citationValidator';
import { COUNSEL_DISCLAIMER, scanBannedPhrases } from '../policy/languagePolicy';

export type BriefFactKind = 'claim-amended' | 'claim-cancelled' | 'new-filing' | 'first-observation';

export interface BriefItemFact {
  readonly kind: BriefFactKind;
  readonly familyId: string;
  readonly docId: string;
  readonly assignee: string;
  readonly publicationDate: string;
  readonly claimNumber?: number;
  readonly change?: StructuralChange;
  readonly hunks?: readonly DiffHunk[];
  /** Deterministic one-line rendering, always safe to ship. */
  readonly headline: string;
}

export interface BriefItemDraft {
  readonly fact: BriefItemFact;
  readonly sentences: readonly SynthesizedSentence[];
}

export interface BriefItem {
  readonly fact: BriefItemFact;
  readonly sentences: readonly SentenceValidation[];
  /** True when no synthesized sentence survived and the item ships facts-only. */
  readonly fallbackUsed: boolean;
}

export interface CoverageDisclosure {
  readonly watched: readonly string[];
  readonly notWatched: readonly string[];
}

export interface Brief {
  readonly watchlistName: string;
  readonly weekOf: string;
  readonly items: readonly BriefItem[];
  readonly quietWeek: boolean;
  readonly coverage: CoverageDisclosure;
  readonly disclaimer: string;
  readonly droppedSentenceCount: number;
  readonly policyViolationCount: number;
  /** Null when any sentence failed validation — the brief may not send (M2 gate). */
  readonly validatedAt: string | null;
}

export interface AssembleBriefInput {
  readonly watchlistName: string;
  readonly weekOf: string;
  readonly drafts: readonly BriefItemDraft[];
  readonly citationContext: CitationContext;
  readonly coverage: CoverageDisclosure;
  /** Injected clock for determinism. */
  readonly nowIso: string;
}

function gateSentences(
  draft: BriefItemDraft,
  context: CitationContext,
): { readonly item: BriefItem; readonly dropped: number; readonly violations: number } {
  const citationChecked = validateSentences(draft.sentences, context);
  let violations = 0;
  const gated = citationChecked.map((validation) => {
    if (!validation.kept) return validation;
    if (scanBannedPhrases(validation.sentence.text).length > 0) {
      violations += 1;
      return { ...validation, kept: false, droppedReason: 'banned-phrase' as const };
    }
    return validation;
  });
  const keptCount = gated.filter((v) => v.kept).length;
  return {
    item: { fact: draft.fact, sentences: gated, fallbackUsed: keptCount === 0 },
    dropped: gated.length - keptCount,
    violations,
  };
}

/** Assembles the weekly brief. Pure function of its inputs. */
export function assembleBrief(input: AssembleBriefInput): Brief {
  const gated = input.drafts.map((draft) => gateSentences(draft, input.citationContext));
  const items = gated.map((g) => g.item);
  const droppedSentenceCount = gated.reduce((sum, g) => sum + g.dropped, 0);
  const policyViolationCount = gated.reduce((sum, g) => sum + g.violations, 0);
  const fullyValidated = droppedSentenceCount === 0 && policyViolationCount === 0;
  return {
    watchlistName: input.watchlistName,
    weekOf: input.weekOf,
    items,
    quietWeek: items.length === 0,
    coverage: input.coverage,
    disclaimer: COUNSEL_DISCLAIMER,
    droppedSentenceCount,
    policyViolationCount,
    validatedAt: fullyValidated ? input.nowIso : null,
  };
}
