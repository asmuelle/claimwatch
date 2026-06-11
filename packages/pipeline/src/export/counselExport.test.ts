import { describe, expect, test } from 'vitest';
import { FaultInjectingSynthesizer, MockBriefSynthesizer } from '../llm/mocks';
import { runSlice } from '../runSlice';
import type { SliceResult } from '../runSlice';
import { USPTO_FIXTURES_DIR } from '../testSupport/fixtures';
import {
  ExportBlockedError,
  ExportNotEntitledError,
  assertExportEntitled,
  buildCounselExport,
  cheapestPlanWith,
} from './counselExport';

let cachedSlice: SliceResult | undefined;

/** One deterministic fixture run shared by the read-only export tests. */
async function validatedSlice(): Promise<SliceResult> {
  cachedSlice ??= await runSlice({ fixturesDir: USPTO_FIXTURES_DIR });
  return cachedSlice;
}

describe('export entitlement gating', () => {
  test('Startup has no counsel export — blocked with a Pro suggestion', () => {
    expect(() => assertExportEntitled('startup', 'counsel')).toThrow(ExportNotEntitledError);
    try {
      assertExportEntitled('startup', 'counsel');
    } catch (error) {
      const notEntitled = error as ExportNotEntitledError;
      expect(notEntitled.requiredFeature).toBe('counsel-export');
      expect(notEntitled.suggestedPlan).toBe('pro');
    }
  });

  test('Pro gets counsel export but NOT white-label', () => {
    expect(() => assertExportEntitled('pro', 'counsel')).not.toThrow();
    expect(() => assertExportEntitled('pro', 'white-label')).toThrow(ExportNotEntitledError);
  });

  test('Firm gets both variants', () => {
    expect(() => assertExportEntitled('firm', 'counsel')).not.toThrow();
    expect(() => assertExportEntitled('firm', 'white-label')).not.toThrow();
  });

  test('cheapestPlanWith walks the tier ladder', () => {
    expect(cheapestPlanWith('counsel-export')).toBe('pro');
    expect(cheapestPlanWith('white-label-briefs')).toBe('firm');
  });
});

describe('buildCounselExport (Pro counsel variant)', () => {
  test('exports the validated brief with every sentence citation-pinned', async () => {
    const slice = await validatedSlice();

    const exported = buildCounselExport(slice.brief, slice.pinnedCitations, {
      plan: 'pro',
      variant: 'counsel',
    });

    expect(exported.brand).toBe('ClaimWatch');
    expect(exported.whiteLabel).toBe(false);
    expect(exported.validatedAt).toBe(slice.brief.validatedAt);
    expect(exported.items.length).toBe(slice.brief.items.length);
    expect(exported.omittedSentenceCount).toBe(0);
    const sentences = exported.items.flatMap((item) => item.sentences);
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(sentence.citations.length).toBeGreaterThan(0);
      for (const pin of sentence.citations) {
        expect(pin.start).toBeGreaterThanOrEqual(0);
        expect(sentence.text.slice(pin.start, pin.end)).toBe(pin.marker);
      }
    }
  });

  test('an unvalidated brief is blocked from export exactly like sending', async () => {
    const seeded = await runSlice({
      fixturesDir: USPTO_FIXTURES_DIR,
      synthesizer: new FaultInjectingSynthesizer(new MockBriefSynthesizer(), (_fact, sentences) =>
        sentences.map((sentence) => ({
          ...sentence,
          citations: sentence.citations.map((ref) => ({ ...ref, claimNumber: 99 })),
        })),
      ),
    });
    expect(seeded.brief.validatedAt).toBeNull();

    expect(() =>
      buildCounselExport(seeded.brief, seeded.pinnedCitations, {
        plan: 'pro',
        variant: 'counsel',
      }),
    ).toThrow(ExportBlockedError);
  });

  test('a kept sentence with a missing citation pin is omitted, never paraphrased', async () => {
    const slice = await validatedSlice();
    const allPins = slice.pinnedCitations;
    const victim = allPins[0];
    expect(victim).toBeDefined();
    const sabotagedPins = allPins.filter((pin) => pin !== victim);

    const exported = buildCounselExport(slice.brief, sabotagedPins, {
      plan: 'pro',
      variant: 'counsel',
    });

    expect(exported.omittedSentenceCount).toBe(1);
    const sentences = exported.items.flatMap((item) => item.sentences);
    expect(sentences.some((s) => s.text === victim?.sentenceText)).toBe(false);
    // Deterministic facts still ship for the omitted item — facts-only fallback.
    expect(exported.items.length).toBe(slice.brief.items.length);
  });

  test('export is deterministic: two builds serialize identically', async () => {
    const slice = await validatedSlice();
    const build = () =>
      JSON.stringify(
        buildCounselExport(slice.brief, slice.pinnedCitations, { plan: 'pro', variant: 'counsel' }),
      );
    expect(build()).toBe(build());
  });
});

describe('buildCounselExport (Firm white-label variant)', () => {
  const FIRM = 'Harrow & Vance LLP';

  test('carries the firm brand and zero product branding', async () => {
    const slice = await validatedSlice();

    const exported = buildCounselExport(slice.brief, slice.pinnedCitations, {
      plan: 'firm',
      variant: 'white-label',
      firmName: FIRM,
    });

    expect(exported.brand).toBe(FIRM);
    expect(exported.whiteLabel).toBe(true);
    expect(JSON.stringify(exported).toLowerCase()).not.toContain('claimwatch');
  });

  test('keeps the counsel disclaimer and coverage disclosure (invariant 4)', async () => {
    const slice = await validatedSlice();

    const exported = buildCounselExport(slice.brief, slice.pinnedCitations, {
      plan: 'firm',
      variant: 'white-label',
      firmName: FIRM,
    });

    expect(exported.disclaimer).toContain('not legal advice');
    expect(exported.disclaimer).toContain(FIRM);
    expect(exported.coverage.notWatched.length).toBeGreaterThan(0);
  });

  test('white-label without a firm name is blocked', async () => {
    const slice = await validatedSlice();
    expect(() =>
      buildCounselExport(slice.brief, slice.pinnedCitations, {
        plan: 'firm',
        variant: 'white-label',
      }),
    ).toThrow(ExportBlockedError);
  });

  test('gating runs before anything else: Startup white-label never builds', async () => {
    const slice = await validatedSlice();
    expect(() =>
      buildCounselExport(slice.brief, slice.pinnedCitations, {
        plan: 'startup',
        variant: 'white-label',
        firmName: FIRM,
      }),
    ).toThrow(ExportNotEntitledError);
  });
});
