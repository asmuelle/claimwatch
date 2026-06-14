/**
 * Deterministic mock model clients. The slice and the test suite run on these
 * exclusively — same inputs, byte-identical outputs, zero network, zero keys.
 */
import type { BriefItemFact, SynthesizedSentence } from '@claimwatch/core';
import type { StoredDocument } from '../store/types';
import type {
  BriefSynthesizer,
  ClassifierVerdict,
  RelevanceClassifier,
  SynthesisDraft,
} from './types';

/** Deterministic stand-in for pgvector similarity: distinct-term overlap. */
export function termOverlapScore(terms: readonly string[], text: string): number {
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term.toLowerCase())).length;
  return hits / terms.length;
}

const IN_SCOPE_MIN_HITS = 2;

/** Haiku-class screening mock: term-hit thresholds over the document title. */
export class MockRelevanceClassifier implements RelevanceClassifier {
  constructor(private readonly terms: readonly string[]) {}

  classify(doc: StoredDocument, claimSpaceDescription: string): ClassifierVerdict {
    const haystack = doc.title.toLowerCase();
    const matched = this.terms.filter((term) => haystack.includes(term.toLowerCase()));
    const verdict =
      matched.length >= IN_SCOPE_MIN_HITS
        ? ('in-scope' as const)
        : matched.length >= 1
          ? ('adjacent' as const)
          : ('out-of-scope' as const);
    return {
      verdict,
      confidence: Math.min(1, matched.length / IN_SCOPE_MIN_HITS),
      rationale:
        matched.length > 0
          ? `title matches claim-space terms: ${matched.join(', ')}`
          : 'no claim-space term appears in the title',
      tokensUsed: Math.ceil((doc.title.length + claimSpaceDescription.length) / 4),
      model: 'mock-haiku',
      promptVersion: 'screening-v1-mock',
    };
  }
}

function sentenceFor(fact: BriefItemFact): SynthesizedSentence {
  if (fact.claimNumber !== undefined) {
    const marker = `(${fact.docId}, claim ${fact.claimNumber}, ${fact.publicationDate})`;
    return {
      text: `Claim ${fact.claimNumber} of ${fact.docId} was recorded as ${fact.change ?? 'amended'} in the ${fact.publicationDate} publication ${marker}.`,
      citations: [
        { docId: fact.docId, claimNumber: fact.claimNumber, date: fact.publicationDate },
      ],
    };
  }
  const marker = `(${fact.docId}, ${fact.publicationDate})`;
  return {
    text: `${fact.assignee} published ${fact.docId} on ${fact.publicationDate}, a new filing observed in the watch space ${marker}.`,
    citations: [{ docId: fact.docId, date: fact.publicationDate }],
  };
}

/** Sonnet-class synthesis mock: one cited observation sentence per fact. */
export class MockBriefSynthesizer implements BriefSynthesizer {
  draftSentences(fact: BriefItemFact): SynthesisDraft {
    const sentence = sentenceFor(fact);
    return { sentences: [sentence], tokensUsed: Math.ceil(sentence.text.length / 4) };
  }
}

/** Test double: wraps a synthesizer and corrupts output for seeded-fault tests. */
export class FaultInjectingSynthesizer implements BriefSynthesizer {
  constructor(
    private readonly inner: MockBriefSynthesizer,
    private readonly fault: (
      fact: BriefItemFact,
      sentences: readonly SynthesizedSentence[],
    ) => readonly SynthesizedSentence[],
  ) {}

  draftSentences(fact: BriefItemFact): SynthesisDraft {
    const draft = this.inner.draftSentences(fact);
    return { ...draft, sentences: this.fault(fact, draft.sentences) };
  }
}
