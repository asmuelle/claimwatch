import { describe, expect, test } from 'vitest';
import { FaultInjectingSynthesizer, MockBriefSynthesizer } from '../llm/mocks';
import { BudgetExceededError } from '../llm/types';
import { runSlice } from '../runSlice';
import { USPTO_FIXTURES_DIR } from '../testSupport/fixtures';

const NOW = '2026-05-15T12:00:00.000Z';

function happySlice() {
  return runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });
}

describe('brief assembly over the fixture week', () => {
  test('produces six items: four claim changes and two new publications', async () => {
    const slice = await happySlice();

    expect(slice.brief.items.map((i) => [i.fact.docId, i.fact.kind, i.fact.claimNumber])).toEqual([
      ['US-12790314-B2', 'claim-amended', 1],
      ['US-12790314-B2', 'claim-cancelled', 2],
      ['US-12790314-B2', 'claim-amended', 3],
      ['US-12790881-B2', 'claim-amended', 1],
      ['US-20260178442-A1', 'new-filing', undefined],
      ['US-20260179001-A1', 'first-observation', undefined],
    ]);
  });

  test('every item carries a deterministic headline even when prose survives', async () => {
    const slice = await happySlice();

    for (const item of slice.brief.items) {
      expect(item.fact.headline.length).toBeGreaterThan(0);
    }
    const amended = slice.brief.items[0];
    expect(amended?.fact.headline).toContain('Claim 1 amended (narrowed) on 2026-05-12');
    expect(amended?.fact.headline).toContain('[-scores;-]');
  });

  test('a fully cited week validates: validatedAt set, nothing dropped', async () => {
    const slice = await happySlice();

    expect(slice.brief.droppedSentenceCount).toBe(0);
    expect(slice.brief.validatedAt).toBe(NOW);
  });
});

describe('citation span pinning', () => {
  test('every kept sentence has every citation pinned to an exact span', async () => {
    const slice = await happySlice();

    expect(slice.pinnedCitations.length).toBeGreaterThan(0);
    for (const pin of slice.pinnedCitations) {
      expect(pin.start).toBeGreaterThanOrEqual(0);
      expect(pin.sentenceText.slice(pin.start, pin.end)).toBe(pin.marker);
      expect(pin.marker).toContain(pin.ref.docId);
    }
  });

  test('pinned citations reference only documents that exist in the store', async () => {
    const slice = await happySlice();
    const docIds = new Set(slice.documents.map((d) => d.docId));

    for (const pin of slice.pinnedCitations) {
      expect(docIds.has(pin.ref.docId)).toBe(true);
    }
  });
});

describe('cite-or-omit gate (invariant 2)', () => {
  test('a seeded invalid citation blocks validation: validatedAt stays null', async () => {
    const corrupting = new FaultInjectingSynthesizer(
      new MockBriefSynthesizer(),
      (fact, sentences) =>
        fact.docId === 'US-12790881-B2'
          ? sentences.map((s) => ({
              ...s,
              citations: s.citations.map((c) => ({ ...c, date: '1999-01-01' })),
            }))
          : sentences,
    );

    const slice = await runSlice({
      fixturesDir: USPTO_FIXTURES_DIR,
      nowIso: NOW,
      synthesizer: corrupting,
    });

    expect(slice.brief.validatedAt).toBeNull();
    expect(slice.brief.droppedSentenceCount).toBe(1);
    const item = slice.brief.items.find((i) => i.fact.docId === 'US-12790881-B2');
    expect(item?.fallbackUsed).toBe(true);
    expect(item?.sentences[0]?.droppedReason).toBe('invalid-citation');
    // The deterministic fact rendering still ships.
    expect(item?.fact.headline).toContain('Claim 1');
  });

  test('a fabricated document id is caught and the sentence dropped', async () => {
    const fabricating = new FaultInjectingSynthesizer(
      new MockBriefSynthesizer(),
      (fact, sentences) =>
        fact.kind === 'new-filing'
          ? sentences.map((s) => ({
              ...s,
              citations: [{ docId: 'US-99999999-XX', date: fact.publicationDate }],
            }))
          : sentences,
    );

    const slice = await runSlice({
      fixturesDir: USPTO_FIXTURES_DIR,
      nowIso: NOW,
      synthesizer: fabricating,
    });

    expect(slice.brief.validatedAt).toBeNull();
    const item = slice.brief.items.find((i) => i.fact.kind === 'new-filing');
    expect(item?.sentences[0]?.kept).toBe(false);
    expect(item?.sentences[0]?.citations[0]?.status).toBe('unknown-document');
  });

  test('an uncited sentence is dropped, never sent', async () => {
    const uncited = new FaultInjectingSynthesizer(new MockBriefSynthesizer(), (_fact, sentences) =>
      sentences.map((s) => ({ ...s, citations: [] })),
    );

    const slice = await runSlice({
      fixturesDir: USPTO_FIXTURES_DIR,
      nowIso: NOW,
      synthesizer: uncited,
    });

    expect(slice.brief.validatedAt).toBeNull();
    expect(slice.brief.items.every((i) => i.fallbackUsed)).toBe(true);
  });
});

describe('language policy gate (invariant 4)', () => {
  test('a banned phrase in model output fails assembly for that sentence', async () => {
    const opinionated = new FaultInjectingSynthesizer(
      new MockBriefSynthesizer(),
      (fact, sentences) =>
        fact.docId === 'US-12790314-B2' && fact.claimNumber === 1
          ? sentences.map((s) => ({
              ...s,
              text: `${s.text} This suggests freedom to operate in the routing space.`,
            }))
          : sentences,
    );

    const slice = await runSlice({
      fixturesDir: USPTO_FIXTURES_DIR,
      nowIso: NOW,
      synthesizer: opinionated,
    });

    expect(slice.brief.validatedAt).toBeNull();
    expect(slice.brief.policyViolationCount).toBe(1);
    const item = slice.brief.items[0];
    expect(item?.sentences[0]?.droppedReason).toBe('banned-phrase');
  });

  test('the counsel disclaimer and coverage disclosure ride on every brief', async () => {
    const slice = await happySlice();

    expect(slice.brief.disclaimer).toMatch(/not legal advice/);
    expect(slice.brief.coverage.watched.length).toBeGreaterThan(0);
    expect(slice.brief.coverage.notWatched).toEqual(
      expect.arrayContaining(['EPO', 'WIPO/PCT', 'CNIPA', 'JPO']),
    );
  });
});

describe('synthesis budget cap (invariant 7)', () => {
  test('exceeding the synthesis budget halts with an alert error', async () => {
    const watchlist = {
      ...(await happySlice()).watchlist,
      synthesisTokenBudget: 5,
    };

    await expect(
      runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW, watchlist }),
    ).rejects.toThrow(BudgetExceededError);
  });
});
