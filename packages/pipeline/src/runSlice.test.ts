import { describe, expect, test } from 'vitest';
import { runSlice } from './runSlice';
import { USPTO_FIXTURES_DIR } from './testSupport/fixtures';

const NOW = '2026-05-15T12:00:00.000Z';

describe('the M1 slice end to end', () => {
  test('ingests 7 documents across backfill and the Tue/Thu deltas', async () => {
    const slice = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });

    expect(slice.documents).toHaveLength(7);
    expect(slice.ingest.map((c) => c.documentsAdded)).toEqual([2, 3, 2]);
    expect(slice.screening).toHaveLength(5);
    expect(slice.brief.quietWeek).toBe(false);
    expect(slice.brief.validatedAt).toBe(NOW);
  });

  test('builds claim timelines for all five families', async () => {
    const slice = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });

    expect(slice.timelines.map((t) => t.familyId)).toEqual([
      '17998204',
      '18123456',
      '18345001',
      '19111222',
      '19204410',
    ]);
    const tensor = slice.timelines.find((t) => t.familyId === '18123456');
    expect(tensor?.versions).toHaveLength(6); // 3 claims x 2 captures
    expect(tensor?.assignee).toBe('Tensor Dynamics, Inc.');
  });

  test('logs model spend for the week under the configured budgets', async () => {
    const slice = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });

    expect(slice.screeningTokensUsed).toBeGreaterThan(0);
    expect(slice.screeningTokensUsed).toBeLessThanOrEqual(slice.watchlist.screeningTokenBudget);
    expect(slice.synthesisTokensUsed).toBeGreaterThan(0);
    expect(slice.synthesisTokensUsed).toBeLessThanOrEqual(slice.watchlist.synthesisTokenBudget);
  });

  test('the whole slice is deterministic: two runs are byte-identical', async () => {
    const a = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });
    const b = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('runs without any model API key in the environment', async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const slice = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });
    expect(slice.brief.validatedAt).not.toBeNull();
  });
});
