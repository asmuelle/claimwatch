import { describe, expect, test } from 'vitest';
import { normalizeClaimText, parseClaimBody } from './normalizeClaim';

describe('normalizeClaimText', () => {
  test('collapses whitespace runs and trims', () => {
    expect(normalizeClaimText('  a   method\n\tcomprising ')).toBe('a method comprising');
  });
});

describe('parseClaimBody', () => {
  test('strips the published claim-number prefix', () => {
    expect(parseClaimBody('1. A method for routing.')).toEqual({
      text: 'A method for routing.',
      status: 'active',
    });
  });

  test('detects cancelled claims in both spellings', () => {
    expect(parseClaimBody('2. (canceled)').status).toBe('cancelled');
    expect(parseClaimBody('2. (cancelled)').status).toBe('cancelled');
  });

  test('leaves unnumbered text untouched', () => {
    expect(parseClaimBody('A widget.').text).toBe('A widget.');
  });
});
