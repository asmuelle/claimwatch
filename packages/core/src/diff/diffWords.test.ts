import { describe, expect, test } from 'vitest';
import { countDiffTokens, diffClaimTexts } from './diffWords';

describe('diffClaimTexts', () => {
  test('returns a single equal hunk for identical texts', () => {
    const hunks = diffClaimTexts('a method comprising a widget', 'a method comprising a widget');
    expect(hunks).toEqual([{ op: 'equal', text: 'a method comprising a widget' }]);
  });

  test('detects a pure insertion', () => {
    const hunks = diffClaimTexts('a method comprising a widget', 'a method comprising a red widget');
    expect(hunks).toEqual([
      { op: 'equal', text: 'a method comprising a' },
      { op: 'insert', text: 'red' },
      { op: 'equal', text: 'widget' },
    ]);
  });

  test('detects a pure deletion', () => {
    const hunks = diffClaimTexts('a method comprising a red widget', 'a method comprising a widget');
    expect(hunks).toEqual([
      { op: 'equal', text: 'a method comprising a' },
      { op: 'delete', text: 'red' },
      { op: 'equal', text: 'widget' },
    ]);
  });

  test('renders a replacement as delete-then-insert (blackline convention)', () => {
    const hunks = diffClaimTexts('the first widget', 'the second widget');
    expect(hunks).toEqual([
      { op: 'equal', text: 'the' },
      { op: 'delete', text: 'first' },
      { op: 'insert', text: 'second' },
      { op: 'equal', text: 'widget' },
    ]);
  });

  test('handles empty inputs', () => {
    expect(diffClaimTexts('', '')).toEqual([]);
    expect(diffClaimTexts('', 'added text')).toEqual([{ op: 'insert', text: 'added text' }]);
    expect(diffClaimTexts('gone text', '')).toEqual([{ op: 'delete', text: 'gone text' }]);
  });

  test('is byte-identical across repeated runs (product invariant 1)', () => {
    const from =
      'selecting a subset of the expert subnetworks based on the routing scores; and generating an output';
    const to =
      'selecting a subset of the expert subnetworks based on the routing scores, wherein the gating network is trained; and generating an output';
    const first = JSON.stringify(diffClaimTexts(from, to));
    for (let i = 0; i < 25; i += 1) {
      expect(JSON.stringify(diffClaimTexts(from, to))).toBe(first);
    }
  });
});

describe('countDiffTokens', () => {
  test('counts inserted and deleted tokens across hunks', () => {
    const counts = countDiffTokens([
      { op: 'equal', text: 'the same' },
      { op: 'delete', text: 'old words here' },
      { op: 'insert', text: 'new words' },
    ]);
    expect(counts).toEqual({ inserted: 2, deleted: 3 });
  });
});
