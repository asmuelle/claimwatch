/**
 * Deterministic citation validator — the cite-or-omit gate (product invariant 2).
 *
 * Every synthesized sentence must resolve to stored (docId, claimNo?, date)
 * tuples. Sentences that fail are DROPPED, never paraphrased, never sent.
 */

export interface CitationRef {
  readonly docId: string;
  readonly claimNumber?: number;
  /** ISO publication date the sentence asserts for the document. */
  readonly date: string;
}

export type CitationStatus = 'valid' | 'unknown-document' | 'unknown-claim' | 'date-mismatch';

export interface CitationRecord {
  readonly ref: CitationRef;
  readonly status: CitationStatus;
}

export interface CitationContextEntry {
  readonly publicationDate: string;
  readonly claimNumbers: ReadonlySet<number>;
}

export interface CitationContext {
  readonly documents: ReadonlyMap<string, CitationContextEntry>;
}

export interface SynthesizedSentence {
  readonly text: string;
  readonly citations: readonly CitationRef[];
}

export type DropReason = 'no-citation' | 'invalid-citation' | 'banned-phrase';

export interface SentenceValidation {
  readonly sentence: SynthesizedSentence;
  readonly citations: readonly CitationRecord[];
  readonly kept: boolean;
  readonly droppedReason?: DropReason;
}

/** Resolves one citation tuple against the stored document snapshot. */
export function validateCitation(ref: CitationRef, context: CitationContext): CitationStatus {
  const doc = context.documents.get(ref.docId);
  if (!doc) return 'unknown-document';
  if (ref.claimNumber !== undefined && !doc.claimNumbers.has(ref.claimNumber)) {
    return 'unknown-claim';
  }
  if (ref.date !== doc.publicationDate) return 'date-mismatch';
  return 'valid';
}

/** Applies cite-or-omit to a list of synthesized sentences. */
export function validateSentences(
  sentences: readonly SynthesizedSentence[],
  context: CitationContext,
): readonly SentenceValidation[] {
  return sentences.map((sentence) => {
    if (sentence.citations.length === 0) {
      return { sentence, citations: [], kept: false, droppedReason: 'no-citation' as const };
    }
    const citations = sentence.citations.map((ref) => ({
      ref,
      status: validateCitation(ref, context),
    }));
    const allValid = citations.every((c) => c.status === 'valid');
    return allValid
      ? { sentence, citations, kept: true }
      : { sentence, citations, kept: false, droppedReason: 'invalid-citation' as const };
  });
}
