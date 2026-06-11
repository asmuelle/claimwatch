/**
 * Golden-fixture blackline tests over real-format USPTO XML excerpts.
 *
 * Three families with hand-verified prosecution outcomes:
 *  - Family 18123456 (Tensor Dynamics): claim 1 narrowed, claim 2 cancelled,
 *    claim 3 dependency rewritten from claim 2 to claim 1.
 *  - Family 17998204 (Northcurrent Labs): claim 1 broadened, claim 2 unchanged.
 *  - Family 19204410 (Vektor Cognition): brand-new filing, claims added.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseUsptoXml } from '../claims/parseUsptoXml';
import { classifyClaimDiff } from './classifyDiff';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', '..', 'fixtures', 'uspto');

function load(relativePath: string) {
  return parseUsptoXml(readFileSync(join(FIXTURES, relativePath), 'utf8'));
}

describe('golden blacklines — family 18123456 (A1 -> B2)', () => {
  const a1 = load('backfill/US20240123456-A1.xml');
  const b2 = load('delta-tue/US12790314-B2.xml');

  test('claim 1: load-balancing limitation added during prosecution (narrowed)', () => {
    const result = classifyClaimDiff({ fromClaim: a1.claims[0], toClaim: b2.claims[0]! });
    expect(result.change).toBe('narrowed');
    expect(result.hunks).toEqual([
      {
        op: 'equal',
        text:
          'A method for routing inference requests in a neural network system, the method ' +
          'comprising: receiving an input token sequence at a gating network; computing, by the ' +
          'gating network, a routing score for each expert subnetwork of a plurality of expert ' +
          'subnetworks; selecting a subset of the expert subnetworks based on the routing',
      },
      { op: 'delete', text: 'scores;' },
      {
        op: 'insert',
        text:
          'scores, wherein the gating network is trained with an auxiliary load-balancing loss;',
      },
      {
        op: 'equal',
        text: 'and generating an output by combining results from the selected subset.',
      },
    ]);
  });

  test('claim 2: cancelled in the grant', () => {
    const result = classifyClaimDiff({ fromClaim: a1.claims[1], toClaim: b2.claims[1]! });
    expect(result.change).toBe('cancelled');
    expect(result.hunks).toEqual([
      {
        op: 'delete',
        text: 'The method of claim 1, wherein the subset consists of exactly two expert subnetworks.',
      },
    ]);
  });

  test('claim 3: dependency rewritten from claim 2 to claim 1', () => {
    const result = classifyClaimDiff({ fromClaim: a1.claims[2], toClaim: b2.claims[2]! });
    expect(result.change).toBe('dependency-rewritten');
    expect(result.hunks).toEqual([
      { op: 'equal', text: 'The method of claim' },
      { op: 'delete', text: '2,' },
      { op: 'insert', text: '1,' },
      { op: 'equal', text: 'wherein the routing scores are normalized with a softmax function.' },
    ]);
  });
});

describe('golden blacklines — family 17998204 (A1 -> B2)', () => {
  const a1 = load('backfill/US20230301877-A1.xml');
  const b2 = load('delta-tue/US12790881-B2.xml');

  test('claim 1: four-bit limitation removed during prosecution (broadened)', () => {
    const result = classifyClaimDiff({ fromClaim: a1.claims[0], toClaim: b2.claims[0]! });
    expect(result.change).toBe('broadened');
    expect(result.hunks).toEqual([
      {
        op: 'equal',
        text:
          'A memory controller for a transformer model, comprising: a quantization unit ' +
          'configured to compress key-value cache',
      },
      { op: 'delete', text: 'entries to a four-bit representation;' },
      { op: 'insert', text: 'entries;' },
      {
        op: 'equal',
        text:
          'and an eviction unit configured to discard cache entries older than a fixed ' +
          'attention window.',
      },
    ]);
  });

  test('claim 2: textually identical claims classify as unchanged', () => {
    const result = classifyClaimDiff({ fromClaim: a1.claims[1], toClaim: b2.claims[1]! });
    expect(result.change).toBe('unchanged');
  });
});

describe('golden blacklines — family 19204410 (new filing)', () => {
  test('claim 1 of a first publication classifies as added', () => {
    const a1 = load('delta-thu/US20260178442-A1.xml');
    const result = classifyClaimDiff({ toClaim: a1.claims[0]! });
    expect(result.change).toBe('added');
    expect(result.hunks[0]?.op).toBe('insert');
  });
});
