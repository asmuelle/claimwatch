/**
 * DESIGN.md M2 acceptance: "published eval numbers reproducible from `just
 * test`" and "recall regression fails CI for packages/pipeline".
 *
 * The exact-value assertions below ARE the published numbers. Any screening
 * change that moves them breaks this suite and must update the figures (and
 * the ground-truth notes) consciously — never silently.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { M1_WATCHLIST } from '../triage/watchlist';
import { evaluateScreening, loadGroundTruth, GroundTruthLoadError } from './screeningEval';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GROUND_TRUTH_PATH = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'eval',
  'screening-groundtruth.json',
);

/** CI gates: a screening change that drops below these FAILS the build. */
const MIN_RECALL = 0.95;
const MIN_PRECISION = 0.9;

describe('the hand-labeled ground-truth set', () => {
  test('has at least 100 labeled publications for the pilot vertical', () => {
    const groundTruth = loadGroundTruth(GROUND_TRUTH_PATH);

    expect(groundTruth.entries.length).toBeGreaterThanOrEqual(100);
    expect(groundTruth.watchlist).toBe(M1_WATCHLIST.name);
    const labels = new Set(groundTruth.entries.map((entry) => entry.label));
    expect(labels).toEqual(new Set(['in-scope', 'out-of-scope']));
  });

  test('rejects a malformed ground-truth file loudly', () => {
    expect(() => loadGroundTruth(join(HERE, 'no-such-file.json'))).toThrow(GroundTruthLoadError);
  });
});

describe('screening recall/precision on the pilot vertical (published numbers)', () => {
  test('every labeled publication keeps a logged screening result (invariant 3)', async () => {
    const groundTruth = loadGroundTruth(GROUND_TRUTH_PATH);

    const report = await evaluateScreening(groundTruth, M1_WATCHLIST);

    expect(report.datasetSize).toBe(120);
    expect(report.inScopeCount).toBe(60);
  });

  test('published figures: recall 58/60, precision 58/61 — exact and reproducible', async () => {
    const groundTruth = loadGroundTruth(GROUND_TRUTH_PATH);

    const report = await evaluateScreening(groundTruth, M1_WATCHLIST);

    // The error budget is documented entry-by-entry in the fixture notes.
    expect(report.truePositives).toBe(58);
    expect(report.falseNegatives).toEqual(['US-2026007077-A1', 'US-2026007177-A1']);
    expect(report.falsePositives).toEqual([
      'US-2026014077-A1',
      'US-2026014177-A1',
      'US-2026014277-A1',
    ]);
    expect(report.recall).toBe(58 / 60);
    expect(report.precision).toBe(58 / 61);
  });

  test(`release gate: recall ≥ ${MIN_RECALL} and precision ≥ ${MIN_PRECISION}`, async () => {
    const groundTruth = loadGroundTruth(GROUND_TRUTH_PATH);

    const report = await evaluateScreening(groundTruth, M1_WATCHLIST);

    expect(report.recall).toBeGreaterThanOrEqual(MIN_RECALL);
    expect(report.precision).toBeGreaterThanOrEqual(MIN_PRECISION);
  });

  test('the eval is deterministic: two runs produce identical reports', async () => {
    const groundTruth = loadGroundTruth(GROUND_TRUTH_PATH);

    const a = await evaluateScreening(groundTruth, M1_WATCHLIST);
    const b = await evaluateScreening(groundTruth, M1_WATCHLIST);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
