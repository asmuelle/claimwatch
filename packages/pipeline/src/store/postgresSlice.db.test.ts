/**
 * Live-Postgres integration suite (`just test-db`).
 *
 * Runs the WHOLE M1 slice against a real pgvector/pg16 database through
 * DrizzleSliceStore and proves, on real storage, what the unit suite proves
 * in memory: idempotent re-ingest (zero new rows), byte-identical re-runs,
 * and parity with the in-memory backend. Also proves the DB-level append-only
 * triggers reject UPDATE/DELETE on claim history (product invariant 5).
 *
 * Skipped when DATABASE_URL is absent so `just ci` stays green without
 * Docker. All DB-touching tests live in this one file: vitest runs separate
 * files in parallel, and this suite owns (and truncates) the schema.
 */
import { createDbClient, migrateDb } from '@claimwatch/db';
import type { DbClient } from '@claimwatch/db';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ingestDelta } from '../ingest/ingestDelta';
import { loadDelta } from '../ingest/loadDelta';
import { runSlice } from '../runSlice';
import type { SliceResult } from '../runSlice';
import { USPTO_FIXTURES_DIR } from '../testSupport/fixtures';
import { DrizzleSliceStore } from './drizzleStore';
import { AppendOnlyViolationError } from './memoryStore';
import type { StoredDocument } from './types';

const DATABASE_URL = process.env.DATABASE_URL;
const NOW = '2026-05-15T12:00:00.000Z';

/** Documents sorted for cross-backend comparison (memory lists in insertion order, Postgres by id). */
function withSortedDocuments(slice: SliceResult): SliceResult {
  const documents = [...slice.documents].sort((a, b) => a.docId.localeCompare(b.docId));
  return { ...slice, documents };
}

describe.skipIf(!DATABASE_URL)('M1 slice against live Postgres', () => {
  let client: DbClient;

  beforeAll(async () => {
    client = createDbClient(DATABASE_URL as string);
    await migrateDb(client.db);
  });

  afterAll(async () => {
    await client?.close();
  });

  /** Clean slate with reset serial sequences — re-runs must be byte-identical. */
  async function resetDb(): Promise<void> {
    await client.sql`
      TRUNCATE screening_result, claim_diff, claim_version, document, watchlist, org
      RESTART IDENTITY CASCADE
    `;
  }

  async function rowCounts(): Promise<Record<string, number>> {
    const tables = ['document', 'claim_version', 'claim_diff', 'screening_result'] as const;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [row] = await client.sql`SELECT count(*)::int AS n FROM ${client.sql(table)}`;
      counts[table] = (row as { n: number }).n;
    }
    return counts;
  }

  describe('idempotent re-ingest (invariants 5 and 6)', () => {
    test('re-running all three deltas adds zero rows to any table', async () => {
      await resetDb();
      const store = new DrizzleSliceStore(client.db);
      const deltas = ['backfill', 'delta-tue', 'delta-thu'].map((name) =>
        loadDelta(USPTO_FIXTURES_DIR, name),
      );

      const firstPass = [];
      for (const delta of deltas) {
        firstPass.push(await ingestDelta(store, delta));
      }
      const before = await rowCounts();

      for (const delta of deltas) {
        const rerun = await ingestDelta(store, delta);
        expect(rerun.documentsAdded).toBe(0);
        expect(rerun.documentsSkipped).toBe(rerun.filesSeen);
        expect(rerun.claimVersionsAdded).toBe(0);
        expect(rerun.claimDiffsComputed).toBe(0);
      }

      expect(await rowCounts()).toEqual(before);
      expect(before).toEqual({
        document: firstPass.reduce((sum, c) => sum + c.documentsAdded, 0),
        claim_version: firstPass.reduce((sum, c) => sum + c.claimVersionsAdded, 0),
        claim_diff: firstPass.reduce((sum, c) => sum + c.claimDiffsComputed, 0),
        screening_result: 0,
      });
      expect(before.document).toBe(7);
    });

    test('a duplicate claim_version append is rejected as an append-only violation', async () => {
      await resetDb();
      const store = new DrizzleSliceStore(client.db);
      await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'backfill'));
      const [existing] = await store.listClaimVersions();
      expect(existing).toBeDefined();
      const duplicate = existing as NonNullable<typeof existing>;

      await expect(
        store.appendClaimVersion({
          familyId: duplicate.familyId,
          docId: duplicate.docId,
          claimNumber: duplicate.claimNumber,
          versionSeq: duplicate.versionSeq,
          text: 'tampered text',
          status: duplicate.status,
          dependsOn: duplicate.dependsOn,
        }),
      ).rejects.toThrow(AppendOnlyViolationError);
    });
  });

  describe('byte-identical re-runs (invariant 1 on real storage)', () => {
    test('two slice runs over a reset database serialize identically', async () => {
      await resetDb();
      const first = await runSlice({
        fixturesDir: USPTO_FIXTURES_DIR,
        nowIso: NOW,
        store: new DrizzleSliceStore(client.db),
      });

      await resetDb();
      const second = await runSlice({
        fixturesDir: USPTO_FIXTURES_DIR,
        nowIso: NOW,
        store: new DrizzleSliceStore(client.db),
      });

      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(first.brief.validatedAt).toBe(NOW);
    });

    test('the Postgres-backed slice matches the in-memory slice', async () => {
      await resetDb();
      const postgresSlice = await runSlice({
        fixturesDir: USPTO_FIXTURES_DIR,
        nowIso: NOW,
        store: new DrizzleSliceStore(client.db),
      });
      const memorySlice = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });

      expect(withSortedDocuments(postgresSlice)).toEqual(withSortedDocuments(memorySlice));
    });
  });

  describe('append-only enforced by the DATABASE, not just the API (invariant 5)', () => {
    async function seededDocuments(): Promise<readonly StoredDocument[]> {
      await resetDb();
      const store = new DrizzleSliceStore(client.db);
      await ingestDelta(store, loadDelta(USPTO_FIXTURES_DIR, 'backfill'));
      return store.listDocuments();
    }

    test('UPDATE on claim_version is rejected by trigger', async () => {
      await seededDocuments();
      await expect(
        client.sql`UPDATE claim_version SET text = 'rewritten history' WHERE id = 1`,
      ).rejects.toThrow(/append-only violation: UPDATE on table claim_version/);
    });

    test('DELETE on claim_version is rejected by trigger', async () => {
      await seededDocuments();
      await expect(client.sql`DELETE FROM claim_version WHERE id = 1`).rejects.toThrow(
        /append-only violation: DELETE on table claim_version/,
      );
    });

    test('UPDATE on claim_diff is rejected by trigger', async () => {
      await seededDocuments();
      await expect(
        client.sql`UPDATE claim_diff SET llm_annotation = 'sneaky edit' WHERE id = 1`,
      ).rejects.toThrow(/append-only violation: UPDATE on table claim_diff/);
    });

    test('DELETE on claim_diff is rejected by trigger', async () => {
      await seededDocuments();
      await expect(client.sql`DELETE FROM claim_diff WHERE id = 1`).rejects.toThrow(
        /append-only violation: DELETE on table claim_diff/,
      );
    });

    test('UPDATE and DELETE on document are rejected by trigger', async () => {
      const [doc] = await seededDocuments();
      expect(doc).toBeDefined();
      const docId = (doc as StoredDocument).docId;
      await expect(
        client.sql`UPDATE document SET title = 'tampered' WHERE id = ${docId}`,
      ).rejects.toThrow(/append-only violation: UPDATE on table document/);
      await expect(client.sql`DELETE FROM document WHERE id = ${docId}`).rejects.toThrow(
        /append-only violation: DELETE on table document/,
      );
    });
  });
});
