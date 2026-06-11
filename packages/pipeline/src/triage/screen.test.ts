import { describe, expect, test } from 'vitest';
import { ingestDelta } from '../ingest/ingestDelta';
import { loadDelta } from '../ingest/loadDelta';
import { MockRelevanceClassifier } from '../llm/mocks';
import { BudgetExceededError } from '../llm/types';
import type { ClassifierVerdict, RelevanceClassifier } from '../llm/types';
import { MemoryStore } from '../store/memoryStore';
import type { StoredDocument } from '../store/types';
import { USPTO_FIXTURES_DIR } from '../testSupport/fixtures';
import { screenDocuments } from './screen';
import { M1_WATCHLIST } from './watchlist';

function ingestedWeek(): { store: MemoryStore; weekDocs: readonly StoredDocument[] } {
  const store = new MemoryStore();
  ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'backfill'));
  ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-tue'));
  ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-thu'));
  const weekDates = new Set(['2026-05-12', '2026-05-14']);
  return {
    store,
    weekDocs: store.listDocuments().filter((d) => weekDates.has(d.publicationDate)),
  };
}

const classifier = new MockRelevanceClassifier(M1_WATCHLIST.claimSpaceTerms);
const budget = { limit: 4_000, used: 0 };

/** Hostile classifier: rejects everything — used to prove the bypass invariant. */
class RejectAllClassifier implements RelevanceClassifier {
  classify(): ClassifierVerdict {
    return {
      verdict: 'out-of-scope',
      confidence: 1,
      rationale: 'hostile test classifier',
      tokensUsed: 10,
      model: 'reject-all',
      promptVersion: 'test',
    };
  }
}

describe('screening logs every document (invariant 3: never silently drop)', () => {
  test('all 5 week documents get a screening_result row, including rejects', () => {
    const { store, weekDocs } = ingestedWeek();

    const outcome = screenDocuments(store, M1_WATCHLIST, weekDocs, classifier, budget);

    expect(outcome.results).toHaveLength(5);
    expect(store.listScreeningResults()).toHaveLength(5);
  });

  test('a non-candidate (Lumen Photonics, H01S) is logged as downranked, not deleted', () => {
    const { store, weekDocs } = ingestedWeek();

    const outcome = screenDocuments(store, M1_WATCHLIST, weekDocs, classifier, budget);

    const lumen = outcome.results.find((r) => r.docId === 'US-12790902-B2');
    expect(lumen).toMatchObject({
      matchedBy: [],
      decision: 'downrank',
      verdict: 'out-of-scope',
      model: 'deterministic-prefilter',
    });
  });
});

describe('union routing: CPC ∪ embedding ∪ named assignee', () => {
  test('a doc outside the CPC space still surfaces via the embedding arm (Helix)', () => {
    const { store, weekDocs } = ingestedWeek();

    const outcome = screenDocuments(store, M1_WATCHLIST, weekDocs, classifier, budget);

    const helix = outcome.results.find((r) => r.docId === 'US-20260179001-A1');
    expect(helix?.matchedBy).toEqual(['embedding']);
    expect(helix?.verdict).toBe('adjacent');
    expect(helix?.decision).toBe('surface');
  });

  test('CPC-matched G06N grants are classified in-scope and surfaced', () => {
    const { store, weekDocs } = ingestedWeek();

    const outcome = screenDocuments(store, M1_WATCHLIST, weekDocs, classifier, budget);

    for (const docId of ['US-12790314-B2', 'US-12790881-B2']) {
      const row = outcome.results.find((r) => r.docId === docId);
      expect(row?.matchedBy).toContain('cpc-prefix');
      expect(row?.verdict).toBe('in-scope');
      expect(row?.decision).toBe('surface');
    }
  });
});

describe('named-competitor bypass (invariant 3)', () => {
  test('a named assignee surfaces even when the classifier rejects everything', () => {
    const { store, weekDocs } = ingestedWeek();

    const outcome = screenDocuments(
      store,
      M1_WATCHLIST,
      weekDocs,
      new RejectAllClassifier(),
      budget,
    );

    const vektor = outcome.results.find((r) => r.docId === 'US-20260178442-A1');
    expect(vektor?.decision).toBe('surface');
    expect(vektor?.model).toBe('bypass');
    expect(outcome.surfaced.map((d) => d.docId)).toContain('US-20260178442-A1');
  });

  test('a hostile classifier downranks candidates but every row stays logged', () => {
    const { store, weekDocs } = ingestedWeek();

    const outcome = screenDocuments(
      store,
      M1_WATCHLIST,
      weekDocs,
      new RejectAllClassifier(),
      budget,
    );

    expect(outcome.results).toHaveLength(5);
    const downranked = outcome.results.filter((r) => r.decision === 'downrank');
    expect(downranked.map((r) => r.docId).sort()).toEqual([
      'US-12790314-B2',
      'US-12790881-B2',
      'US-12790902-B2',
      'US-20260179001-A1',
    ]);
  });
});

describe('screening budget cap (invariant 7)', () => {
  test('exceeding the weekly token budget halts the step with an alert error', () => {
    const { store, weekDocs } = ingestedWeek();

    expect(() =>
      screenDocuments(store, M1_WATCHLIST, weekDocs, classifier, { limit: 10, used: 0 }),
    ).toThrow(BudgetExceededError);
  });

  test('classifier spend is tracked and stays under the M1 budget', () => {
    const { store, weekDocs } = ingestedWeek();

    const outcome = screenDocuments(store, M1_WATCHLIST, weekDocs, classifier, budget);

    expect(outcome.budget.used).toBeGreaterThan(0);
    expect(outcome.budget.used).toBeLessThanOrEqual(outcome.budget.limit);
  });
});
