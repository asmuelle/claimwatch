import { describe, expect, test } from 'vitest';
import type { ParsedClaim } from '../claims/types';
import { classifyClaimDiff } from './classifyDiff';

function claim(partial: Partial<ParsedClaim> & { text: string }): ParsedClaim {
  return { number: 1, status: 'active', dependsOn: [], ...partial };
}

describe('classifyClaimDiff', () => {
  test('classifies a first-seen claim as added', () => {
    const result = classifyClaimDiff({ toClaim: claim({ text: 'a new independent claim' }) });
    expect(result.change).toBe('added');
    expect(result.hunks).toEqual([{ op: 'insert', text: 'a new independent claim' }]);
  });

  test('classifies an active-to-cancelled transition as cancelled', () => {
    const result = classifyClaimDiff({
      fromClaim: claim({ text: 'the method of claim 1 with a widget' }),
      toClaim: claim({ text: '(canceled)', status: 'cancelled' }),
    });
    expect(result.change).toBe('cancelled');
    expect(result.hunks).toEqual([{ op: 'delete', text: 'the method of claim 1 with a widget' }]);
  });

  test('classifies a dependency change as dependency-rewritten before narrowing', () => {
    const result = classifyClaimDiff({
      fromClaim: claim({ text: 'The method of claim 2, wherein x.', dependsOn: [2] }),
      toClaim: claim({ text: 'The method of claim 1, wherein x.', dependsOn: [1] }),
    });
    expect(result.change).toBe('dependency-rewritten');
  });

  test('classifies insertion-only amendments as narrowed', () => {
    const result = classifyClaimDiff({
      fromClaim: claim({ text: 'a widget comprising a frame' }),
      toClaim: claim({ text: 'a widget comprising a titanium frame' }),
    });
    expect(result.change).toBe('narrowed');
  });

  test('classifies deletion-only amendments as broadened', () => {
    const result = classifyClaimDiff({
      fromClaim: claim({ text: 'a widget comprising a titanium frame' }),
      toClaim: claim({ text: 'a widget comprising a frame' }),
    });
    expect(result.change).toBe('broadened');
  });

  test('classifies balanced replacements as amended', () => {
    const result = classifyClaimDiff({
      fromClaim: claim({ text: 'a frame made of steel' }),
      toClaim: claim({ text: 'a frame made of brass' }),
    });
    expect(result.change).toBe('amended');
  });

  test('classifies identical texts as unchanged', () => {
    const result = classifyClaimDiff({
      fromClaim: claim({ text: 'a widget' }),
      toClaim: claim({ text: 'a widget' }),
    });
    expect(result.change).toBe('unchanged');
  });
});
