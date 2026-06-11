import { describe, expect, test } from 'vitest';
import { limitCopy } from './limitCopy';

describe('limitCopy', () => {
  test('watchlist-count copy pluralizes correctly at limit 1', () => {
    const copy = limitCopy({
      kind: 'watchlist-count',
      plan: 'startup',
      limit: 1,
      attempted: 2,
      suggestedPlan: 'pro',
    });
    expect(copy.title).toBe('The Startup plan includes 1 watchlist');
    expect(copy.detail).toContain('watchlist 2');
  });

  test('competitor copy carries both the limit and the attempt', () => {
    const copy = limitCopy({
      kind: 'competitors-per-watchlist',
      plan: 'startup',
      limit: 10,
      attempted: 11,
      suggestedPlan: 'pro',
    });
    expect(copy.title).toContain('10 competitors');
    expect(copy.detail).toContain('11');
  });

  test('cpc copy names CPC classes explicitly', () => {
    const copy = limitCopy({
      kind: 'cpc-classes-per-watchlist',
      plan: 'pro',
      limit: 25,
      attempted: 30,
      suggestedPlan: 'firm',
    });
    expect(copy.title).toContain('CPC classes');
  });
});
