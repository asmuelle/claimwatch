import { describe, expect, test } from 'vitest';
import type { CitationContext } from '../citations/citationValidator';
import type { BriefItemDraft, BriefItemFact } from './assembleBrief';
import { assembleBrief } from './assembleBrief';

const context: CitationContext = {
  documents: new Map([
    ['US-12790314-B2', { publicationDate: '2026-05-12', claimNumbers: new Set([1, 2, 3]) }],
  ]),
};

const fact: BriefItemFact = {
  kind: 'claim-amended',
  familyId: '18123456',
  docId: 'US-12790314-B2',
  assignee: 'Tensor Dynamics, Inc.',
  publicationDate: '2026-05-12',
  claimNumber: 1,
  change: 'narrowed',
  hunks: [
    { op: 'delete', text: 'scores;' },
    { op: 'insert', text: 'scores, wherein the gating network is trained;' },
  ],
  headline: 'Claim 1 amended on 2026-05-12',
};

const NOW = '2026-05-15T18:00:00.000Z';

function brief(drafts: readonly BriefItemDraft[]) {
  return assembleBrief({
    watchlistName: 'Sparse inference watch',
    weekOf: '2026-05-12 – 2026-05-14',
    drafts,
    citationContext: context,
    coverage: { watched: ['USPTO'], notWatched: ['EPO', 'WIPO'] },
    nowIso: NOW,
  });
}

describe('assembleBrief', () => {
  test('sets validatedAt when every sentence passes citation and policy gates', () => {
    const result = brief([
      {
        fact,
        sentences: [
          {
            text: 'Claim 1 adds a training limitation.',
            citations: [{ docId: 'US-12790314-B2', claimNumber: 1, date: '2026-05-12' }],
          },
        ],
      },
    ]);
    expect(result.validatedAt).toBe(NOW);
    expect(result.items[0]?.fallbackUsed).toBe(false);
    expect(result.droppedSentenceCount).toBe(0);
  });

  test('a seeded invalid citation blocks validation and engages the deterministic fallback', () => {
    const result = brief([
      {
        fact,
        sentences: [
          {
            text: 'Claim 7 was amended.',
            citations: [{ docId: 'US-12790314-B2', claimNumber: 7, date: '2026-05-12' }],
          },
        ],
      },
    ]);
    expect(result.validatedAt).toBeNull();
    expect(result.droppedSentenceCount).toBe(1);
    expect(result.items[0]?.fallbackUsed).toBe(true);
    expect(result.items[0]?.fact.headline).toBe('Claim 1 amended on 2026-05-12');
  });

  test('a banned phrase drops the sentence and blocks validation even with valid citations', () => {
    const result = brief([
      {
        fact,
        sentences: [
          {
            text: 'This grant suggests freedom to operate in adjacent space.',
            citations: [{ docId: 'US-12790314-B2', claimNumber: 1, date: '2026-05-12' }],
          },
        ],
      },
    ]);
    expect(result.validatedAt).toBeNull();
    expect(result.policyViolationCount).toBe(1);
    expect(result.items[0]?.sentences[0]?.droppedReason).toBe('banned-phrase');
  });

  test('an empty week assembles a quiet-week brief that still carries coverage and disclaimer', () => {
    const result = brief([]);
    expect(result.quietWeek).toBe(true);
    expect(result.coverage.notWatched).toContain('EPO');
    expect(result.disclaimer.length).toBeGreaterThan(20);
    expect(result.validatedAt).toBe(NOW);
  });
});
