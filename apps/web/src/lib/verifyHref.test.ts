import { describe, expect, test } from 'vitest';
import { canonicalAnchorId, verifyHref } from './verifyHref';

describe('verify links', () => {
  test('a claim citation links to the stored claim anchor', () => {
    expect(verifyHref({ docId: 'US-12790314-B2', claimNumber: 1, date: '2026-05-12' })).toBe(
      '#US-12790314-B2-claim-1',
    );
  });

  test('a document-level citation links to the document anchor', () => {
    expect(verifyHref({ docId: 'US-20260178442-A1', date: '2026-05-14' })).toBe(
      '#doc-US-20260178442-A1',
    );
  });

  test('anchor ids match between citation and canonical record rendering', () => {
    expect(canonicalAnchorId('US-12790881-B2', 2)).toBe('US-12790881-B2-claim-2');
    expect(canonicalAnchorId('US-12790881-B2')).toBe('doc-US-12790881-B2');
  });
});
