import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MemoryStore } from '../store/memoryStore';
import { USPTO_FIXTURES_DIR } from '../testSupport/fixtures';
import { ingestDelta } from './ingestDelta';
import { DeltaLoadError, loadDelta } from './loadDelta';

async function freshStoreWithBackfill(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'backfill'));
  return store;
}

describe('manifest boundary validation', () => {
  test('throws DeltaLoadError when the manifest does not exist', async () => {
    expect(() => loadDelta(USPTO_FIXTURES_DIR, 'no-such-delta')).toThrow(DeltaLoadError);
  });

  test('throws DeltaLoadError when the manifest shape is invalid (zod)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claimwatch-'));
    writeFileSync(join(dir, 'bad.manifest.json'), JSON.stringify({ deltaId: 'x', files: [] }));
    expect(() => loadDelta(dir, 'bad')).toThrow(DeltaLoadError);
  });

  test('throws DeltaLoadError when a listed delta file is missing (recall incident)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claimwatch-'));
    writeFileSync(
      join(dir, 'gap.manifest.json'),
      JSON.stringify({
        deltaId: 'gap',
        cycle: 'backfill',
        published: '2026-05-11',
        files: ['missing.xml'],
      }),
    );
    expect(() => loadDelta(dir, 'gap')).toThrow(DeltaLoadError);
  });
});

describe('ingesting the backfill delta', () => {
  test('stores 2 documents, 5 claim versions, 5 added diffs', async () => {
    const store = new MemoryStore();

    const counts = await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'backfill'));

    expect(counts).toMatchObject({
      documentsAdded: 2,
      documentsSkipped: 0,
      claimVersionsAdded: 5,
      claimDiffsComputed: 5,
    });
    expect(await store.listDocuments()).toHaveLength(2);
    expect((await store.listClaimDiffs()).every((d) => d.change === 'added')).toBe(true);
  });
});

describe('ingesting the Tuesday grant delta on top of backfill', () => {
  test('appends new claim versions and computes amendment diffs', async () => {
    const store = await freshStoreWithBackfill();

    const counts = await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-tue'));

    // Tensor: 3 amended claims; Northcurrent: 1 broadened + 1 unchanged;
    // Lumen: new family with 2 added claims.
    expect(counts).toMatchObject({
      documentsAdded: 3,
      claimVersionsAdded: 7,
      claimDiffsComputed: 6,
    });
  });

  test('produces the hand-verified blackline for family 18123456 claim 1', async () => {
    const store = await freshStoreWithBackfill();
    await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-tue'));

    const diff = (await store.listClaimDiffs()).find(
      (d) => d.familyId === '18123456' && d.claimNumber === 1 && d.fromVersionId !== null,
    );

    expect(diff?.change).toBe('narrowed');
    expect(diff?.hunks).toContainEqual({ op: 'delete', text: 'scores;' });
    expect(diff?.hunks).toContainEqual({
      op: 'insert',
      text: 'scores, wherein the gating network is trained with an auxiliary load-balancing loss;',
    });
    expect(diff?.llmAnnotation).toBeNull();
  });

  test('claim cancellation and dependency rewrite are tagged structurally', async () => {
    const store = await freshStoreWithBackfill();
    await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-tue'));

    const family = (await store.listClaimDiffs()).filter(
      (d) => d.familyId === '18123456' && d.fromVersionId !== null,
    );

    expect(family.find((d) => d.claimNumber === 2)?.change).toBe('cancelled');
    expect(family.find((d) => d.claimNumber === 3)?.change).toBe('dependency-rewritten');
  });

  test('unchanged claims produce a new version but no diff row', async () => {
    const store = await freshStoreWithBackfill();
    await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-tue'));

    const northcurrentDiffs = (await store.listClaimDiffs()).filter(
      (d) => d.familyId === '17998204' && d.fromVersionId !== null,
    );

    expect(northcurrentDiffs.map((d) => d.claimNumber)).toEqual([1]);
    expect(await store.latestClaimVersions('17998204')).toHaveLength(2);
  });
});

describe('idempotent re-runs (invariants 5 and 6)', () => {
  test('re-ingesting the same delta adds zero rows', async () => {
    const store = await freshStoreWithBackfill();
    const delta = loadDelta(USPTO_FIXTURES_DIR, 'delta-tue');
    await ingestDelta(store, delta);
    const docsBefore = (await store.listDocuments()).length;
    const versionsBefore = (await store.listClaimVersions()).length;
    const diffsBefore = (await store.listClaimDiffs()).length;

    const rerun = await ingestDelta(store, delta);

    expect(rerun).toMatchObject({
      documentsAdded: 0,
      documentsSkipped: 3,
      claimVersionsAdded: 0,
      claimDiffsComputed: 0,
    });
    expect(await store.listDocuments()).toHaveLength(docsBefore);
    expect(await store.listClaimVersions()).toHaveLength(versionsBefore);
    expect(await store.listClaimDiffs()).toHaveLength(diffsBefore);
  });
});

describe('determinism (invariant 1)', () => {
  test('two independent runs produce byte-identical diff output', async () => {
    const runOnce = async (): Promise<string> => {
      const store = new MemoryStore();
      await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'backfill'));
      await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-tue'));
      await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'delta-thu'));
      return JSON.stringify(await store.listClaimDiffs());
    };

    expect(await runOnce()).toBe(await runOnce());
  });
});
