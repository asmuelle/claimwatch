import { describe, expect, test } from 'vitest';
import type { CitationContext, SynthesizedSentence } from './citationValidator';
import { validateCitation, validateSentences } from './citationValidator';

const context: CitationContext = {
  documents: new Map([
    ['US-12790314-B2', { publicationDate: '2026-05-12', claimNumbers: new Set([1, 2, 3]) }],
    ['US-20260178442-A1', { publicationDate: '2026-05-14', claimNumbers: new Set([1, 2]) }],
  ]),
};

describe('validateCitation', () => {
  test('accepts a citation whose doc, claim, and date all resolve', () => {
    expect(
      validateCitation({ docId: 'US-12790314-B2', claimNumber: 1, date: '2026-05-12' }, context),
    ).toBe('valid');
  });

  test('rejects a fabricated document id', () => {
    expect(
      validateCitation({ docId: 'US-99999999-B2', claimNumber: 1, date: '2026-05-12' }, context),
    ).toBe('unknown-document');
  });

  test('rejects an off-by-one claim number', () => {
    expect(
      validateCitation({ docId: 'US-12790314-B2', claimNumber: 4, date: '2026-05-12' }, context),
    ).toBe('unknown-claim');
  });

  test('rejects a stale publication date', () => {
    expect(
      validateCitation({ docId: 'US-12790314-B2', claimNumber: 1, date: '2026-05-13' }, context),
    ).toBe('date-mismatch');
  });

  test('accepts document-level citations without a claim number', () => {
    expect(validateCitation({ docId: 'US-20260178442-A1', date: '2026-05-14' }, context)).toBe(
      'valid',
    );
  });
});

describe('validateSentences — cite-or-omit', () => {
  test('keeps fully-cited sentences and drops uncited ones', () => {
    const sentences: SynthesizedSentence[] = [
      {
        text: 'Claim 1 was amended in the grant.',
        citations: [{ docId: 'US-12790314-B2', claimNumber: 1, date: '2026-05-12' }],
      },
      { text: 'This sentence cites nothing.', citations: [] },
    ];
    const results = validateSentences(sentences, context);
    expect(results[0]?.kept).toBe(true);
    expect(results[1]?.kept).toBe(false);
    expect(results[1]?.droppedReason).toBe('no-citation');
  });

  test('drops a sentence when any one of its citations fails', () => {
    const results = validateSentences(
      [
        {
          text: 'Mixed citations.',
          citations: [
            { docId: 'US-12790314-B2', claimNumber: 1, date: '2026-05-12' },
            { docId: 'US-12790314-B2', claimNumber: 9, date: '2026-05-12' },
          ],
        },
      ],
      context,
    );
    expect(results[0]?.kept).toBe(false);
    expect(results[0]?.droppedReason).toBe('invalid-citation');
    expect(results[0]?.citations.map((c) => c.status)).toEqual(['valid', 'unknown-claim']);
  });
});
