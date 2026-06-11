import { describe, expect, test } from 'vitest';
import { COUNSEL_DISCLAIMER, scanBannedPhrases } from './languagePolicy';

describe('scanBannedPhrases — no-legal-advice invariant', () => {
  test('flags freedom-to-operate phrasing in any casing', () => {
    const violations = scanBannedPhrases('This suggests Freedom To Operate in the space.');
    expect(violations.map((v) => v.phrase)).toContain('freedom to operate');
  });

  test('flags non-infringement and practice-advice phrasing', () => {
    expect(scanBannedPhrases('a non-infringement position')).not.toHaveLength(0);
    expect(scanBannedPhrases('you may practice the claimed method')).not.toHaveLength(0);
    expect(scanBannedPhrases('You may not practice this.')).not.toHaveLength(0);
  });

  test('flags the standalone FTO acronym but not embedded letters', () => {
    expect(scanBannedPhrases('an FTO analysis')).not.toHaveLength(0);
    expect(scanBannedPhrases('the softmax function')).toHaveLength(0);
  });

  test('passes observation-style language untouched', () => {
    const text =
      'Claim 1 of US 12790314 B2 adds the limitation "auxiliary load-balancing loss" ' +
      'relative to the published application.';
    expect(scanBannedPhrases(text)).toHaveLength(0);
  });

  test('the counsel disclaimer itself contains no banned phrasing', () => {
    expect(scanBannedPhrases(COUNSEL_DISCLAIMER)).toHaveLength(0);
  });
});
