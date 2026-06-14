/**
 * Drizzle/Postgres implementation of the SliceStore port.
 *
 * Mirrors MemoryStore semantics exactly so the pipeline produces identical
 * results on both backends:
 * - append-only API surface (no update/delete anywhere);
 * - duplicate content hash = idempotent no-op, duplicate docId with different
 *   content = AppendOnlyViolationError;
 * - deterministic read ordering (documents by id, serial tables by insert id);
 * - row objects built in the same key order MemoryStore produces, so
 *   JSON-serialized slices are comparable byte-for-byte.
 */
import type { StructuralChange } from '@claimwatch/core';
import { claimDiff, claimVersion, document, org, screeningResult, watchlist } from '@claimwatch/db';
import type { Db } from '@claimwatch/db';
import { asc, eq } from 'drizzle-orm';
import { AppendOnlyViolationError } from './memoryStore';
import type {
  ClaimDiffRow,
  ClaimVersionRow,
  MatchArm,
  ScreeningResultRow,
  SliceStore,
  StoredDocument,
} from './types';

/** Postgres unique_violation, possibly wrapped by the drizzle query layer. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === '23505') return true;
  return isUniqueViolation((error as { cause?: unknown }).cause);
}

/** Deterministic id for pilot org/watchlist rows ensured by this store. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const PILOT_ORG_ID = 'org-pilot';

export class DrizzleSliceStore implements SliceStore {
  private readonly ensuredWatchlists = new Map<string, string>();

  constructor(private readonly db: Db) {}

  async hasContentHash(contentHash: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: document.id })
      .from(document)
      .where(eq(document.contentHash, contentHash))
      .limit(1);
    return rows.length > 0;
  }

  async appendDocument(doc: StoredDocument): Promise<{ readonly inserted: boolean }> {
    if (await this.hasContentHash(doc.contentHash)) {
      return { inserted: false };
    }
    const existing = await this.db
      .select({ id: document.id })
      .from(document)
      .where(eq(document.id, doc.docId))
      .limit(1);
    if (existing.length > 0) {
      throw new AppendOnlyViolationError(
        `document ${doc.docId} already stored with different content — documents are immutable`,
      );
    }
    await this.db.insert(document).values({
      id: doc.docId,
      source: doc.source,
      docNumber: doc.docNumber,
      kindCode: doc.kindCode,
      applicationNumber: doc.applicationNumber,
      publicationDate: doc.publicationDate,
      title: doc.title,
      assignee: doc.assignee,
      cpcCodes: doc.cpcCodes,
      s3Key: doc.rawKey,
      contentHash: doc.contentHash,
    });
    return { inserted: true };
  }

  async getDocument(docId: string): Promise<StoredDocument | undefined> {
    const rows = await this.db.select().from(document).where(eq(document.id, docId)).limit(1);
    const row = rows[0];
    return row ? toStoredDocument(row) : undefined;
  }

  async listDocuments(): Promise<readonly StoredDocument[]> {
    const rows = await this.db.select().from(document).orderBy(asc(document.id));
    return rows.map(toStoredDocument);
  }

  async appendClaimVersion(row: Omit<ClaimVersionRow, 'id'>): Promise<ClaimVersionRow> {
    try {
      const inserted = await this.db
        .insert(claimVersion)
        .values({
          familyId: row.familyId,
          documentId: row.docId,
          claimNumber: row.claimNumber,
          versionSeq: row.versionSeq,
          text: row.text,
          status: row.status,
          dependsOn: row.dependsOn,
        })
        .returning({ id: claimVersion.id });
      const insertedRow = inserted[0];
      if (!insertedRow) {
        throw new Error('claim_version insert returned no row');
      }
      return { ...row, id: insertedRow.id };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppendOnlyViolationError(
          `claim_version (${row.familyId}, claim ${row.claimNumber}, seq ${row.versionSeq}) exists — history is append-only`,
        );
      }
      throw error;
    }
  }

  async latestClaimVersions(familyId: string): Promise<readonly ClaimVersionRow[]> {
    const rows = await this.db
      .select()
      .from(claimVersion)
      .where(eq(claimVersion.familyId, familyId))
      .orderBy(asc(claimVersion.id));
    const latest = new Map<number, ClaimVersionRow>();
    for (const row of rows.map(toClaimVersionRow)) {
      const current = latest.get(row.claimNumber);
      if (!current || row.versionSeq > current.versionSeq) {
        latest.set(row.claimNumber, row);
      }
    }
    return [...latest.values()].sort((a, b) => a.claimNumber - b.claimNumber);
  }

  async listClaimVersions(): Promise<readonly ClaimVersionRow[]> {
    const rows = await this.db.select().from(claimVersion).orderBy(asc(claimVersion.id));
    return rows.map(toClaimVersionRow);
  }

  async appendClaimDiff(row: Omit<ClaimDiffRow, 'id'>): Promise<ClaimDiffRow> {
    const inserted = await this.db
      .insert(claimDiff)
      .values({
        fromVersionId: row.fromVersionId,
        toVersionId: row.toVersionId,
        change: row.change,
        hunks: row.hunks,
        llmAnnotation: row.llmAnnotation,
      })
      .returning({ id: claimDiff.id });
    const insertedRow = inserted[0];
    if (!insertedRow) {
      throw new Error('claim_diff insert returned no row');
    }
    return { ...row, id: insertedRow.id };
  }

  async listClaimDiffs(): Promise<readonly ClaimDiffRow[]> {
    // family_id and claim_number are not denormalized onto claim_diff; they
    // are recovered from the to-version, which is what ingestion derived them
    // from in the first place.
    const rows = await this.db
      .select({
        id: claimDiff.id,
        familyId: claimVersion.familyId,
        fromVersionId: claimDiff.fromVersionId,
        toVersionId: claimDiff.toVersionId,
        claimNumber: claimVersion.claimNumber,
        change: claimDiff.change,
        hunks: claimDiff.hunks,
        llmAnnotation: claimDiff.llmAnnotation,
      })
      .from(claimDiff)
      .innerJoin(claimVersion, eq(claimDiff.toVersionId, claimVersion.id))
      .orderBy(asc(claimDiff.id));
    return rows.map((row) => ({
      familyId: row.familyId,
      fromVersionId: row.fromVersionId,
      toVersionId: row.toVersionId,
      claimNumber: row.claimNumber,
      // Written exclusively from typed StructuralChange values by this store.
      change: row.change as StructuralChange,
      hunks: row.hunks,
      llmAnnotation: row.llmAnnotation,
      id: row.id,
    }));
  }

  async appendScreeningResult(row: Omit<ScreeningResultRow, 'id'>): Promise<ScreeningResultRow> {
    const watchlistId = await this.ensureWatchlist(row.watchlistName);
    const inserted = await this.db
      .insert(screeningResult)
      .values({
        documentId: row.docId,
        watchlistId,
        embeddingScore: row.embeddingScore,
        matchedBy: row.matchedBy,
        verdict: row.verdict,
        confidence: row.confidence,
        rationale: row.rationale,
        decision: row.decision,
        model: row.model,
        promptVersion: row.promptVersion,
      })
      .returning({ id: screeningResult.id });
    const insertedRow = inserted[0];
    if (!insertedRow) {
      throw new Error('screening_result insert returned no row');
    }
    return { ...row, id: insertedRow.id };
  }

  async listScreeningResults(): Promise<readonly ScreeningResultRow[]> {
    const rows = await this.db
      .select({
        id: screeningResult.id,
        docId: screeningResult.documentId,
        watchlistName: watchlist.name,
        embeddingScore: screeningResult.embeddingScore,
        matchedBy: screeningResult.matchedBy,
        verdict: screeningResult.verdict,
        confidence: screeningResult.confidence,
        rationale: screeningResult.rationale,
        decision: screeningResult.decision,
        model: screeningResult.model,
        promptVersion: screeningResult.promptVersion,
      })
      .from(screeningResult)
      .innerJoin(watchlist, eq(screeningResult.watchlistId, watchlist.id))
      .orderBy(asc(screeningResult.id));
    return rows.map((row) => ({
      docId: row.docId,
      watchlistName: row.watchlistName,
      embeddingScore: row.embeddingScore,
      // Written exclusively from typed MatchArm values by this store.
      matchedBy: row.matchedBy as readonly MatchArm[],
      verdict: row.verdict,
      confidence: row.confidence,
      rationale: row.rationale,
      decision: row.decision,
      model: row.model,
      promptVersion: row.promptVersion,
      id: row.id,
    }));
  }

  /** Idempotently creates the pilot org + a watchlist row for FK integrity. */
  private async ensureWatchlist(name: string): Promise<string> {
    const cached = this.ensuredWatchlists.get(name);
    if (cached !== undefined) return cached;
    const watchlistId = `watchlist-${slugify(name)}`;
    await this.db
      .insert(org)
      .values({ id: PILOT_ORG_ID, name: 'ClaimWatch pilot' })
      .onConflictDoNothing();
    await this.db
      .insert(watchlist)
      .values({
        id: watchlistId,
        orgId: PILOT_ORG_ID,
        name,
        claimSpaceDescription: '',
        cpcPrefixes: [],
        namedAssignees: [],
        jurisdictions: [],
      })
      .onConflictDoNothing();
    this.ensuredWatchlists.set(name, watchlistId);
    return watchlistId;
  }
}

type DocumentRow = typeof document.$inferSelect;
type ClaimVersionDbRow = typeof claimVersion.$inferSelect;

function toStoredDocument(row: DocumentRow): StoredDocument {
  if (row.source !== 'USPTO' && row.source !== 'CourtListener') {
    throw new Error(
      `document ${row.id} has source ${row.source}; the slice store handles USPTO and CourtListener only`,
    );
  }
  return {
    docId: row.id,
    source: row.source,
    docNumber: row.docNumber,
    kindCode: row.kindCode,
    applicationNumber: row.applicationNumber,
    publicationDate: row.publicationDate,
    title: row.title,
    assignee: row.assignee,
    cpcCodes: row.cpcCodes,
    contentHash: row.contentHash,
    rawKey: row.s3Key,
  };
}

function toClaimVersionRow(row: ClaimVersionDbRow): ClaimVersionRow {
  return {
    familyId: row.familyId,
    docId: row.documentId,
    claimNumber: row.claimNumber,
    versionSeq: row.versionSeq,
    text: row.text,
    status: row.status,
    dependsOn: row.dependsOn,
    id: row.id,
  };
}
