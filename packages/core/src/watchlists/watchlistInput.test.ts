import { describe, expect, test } from 'vitest';
import { parseWatchlistInput, splitListField, splitNameListField } from './watchlistInput';

const VALID = {
  name: 'Efficient neural inference',
  claimSpaceDescription:
    'Mixture-of-experts routing, attention cache compression and quantization for embedded inference.',
  cpcPrefixes: ['G06N', 'g06n3/0455'],
  competitors: ['Vektor Cognition, Inc.'],
};

describe('parseWatchlistInput', () => {
  test('accepts a well-formed watchlist and normalizes CPC case', () => {
    const result = parseWatchlistInput(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.cpcPrefixes).toEqual(['G06N', 'G06N3/0455']);
    expect(result.value.competitors).toEqual(['Vektor Cognition, Inc.']);
  });

  test('rejects a too-short claim-space description with a path-tagged issue', () => {
    const result = parseWatchlistInput({ ...VALID, claimSpaceDescription: 'too short' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues.some((issue) => issue.path === 'claimSpaceDescription')).toBe(true);
  });

  test('rejects malformed CPC symbols', () => {
    for (const bad of ['NOPE', '6G0N', 'G6', 'G06N3/4', 'Z01A']) {
      const result = parseWatchlistInput({ ...VALID, cpcPrefixes: [bad] });
      expect(result.ok, `expected ${bad} to be rejected`).toBe(false);
    }
  });

  test('requires at least one CPC class', () => {
    const result = parseWatchlistInput({ ...VALID, cpcPrefixes: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues[0]?.path).toBe('cpcPrefixes');
  });

  test('never trusts shape: a non-object input fails safely', () => {
    const result = parseWatchlistInput('drop table watchlist');
    expect(result.ok).toBe(false);
  });

  test('allows an empty competitor list (CPC/embedding arms still screen)', () => {
    const result = parseWatchlistInput({ ...VALID, competitors: [] });
    expect(result.ok).toBe(true);
  });
});

describe('splitListField', () => {
  test('splits on newlines, commas and semicolons, trimming blanks', () => {
    expect(splitListField('G06N\n G06F,H04L9/40;\n\n')).toEqual(['G06N', 'G06F', 'H04L9/40']);
  });

  test('de-duplicates entries preserving first occurrence', () => {
    expect(splitListField('Acme\nAcme\nBaxter')).toEqual(['Acme', 'Baxter']);
  });

  test('an empty field yields an empty list', () => {
    expect(splitListField('   \n ')).toEqual([]);
  });
});

describe('splitNameListField', () => {
  test('keeps commas inside legal entity names', () => {
    expect(splitNameListField('Vektor Cognition, Inc.\nHarrow & Vance LLP')).toEqual([
      'Vektor Cognition, Inc.',
      'Harrow & Vance LLP',
    ]);
  });

  test('splits on semicolons and newlines', () => {
    expect(splitNameListField('Acme, Inc.; Baxter Labs')).toEqual(['Acme, Inc.', 'Baxter Labs']);
  });
});
