/**
 * Append-only in-memory store for the fixture-driven slice.
 *
 * Mirrors the packages/db tables without requiring Postgres (unit tests and
 * the read-only web render run against this). Append-only semantics are
 * enforced at the API surface: there is no update or delete method anywhere.
 * Implements the same async SliceStore port as the Drizzle repository so the
 * pipeline code is byte-identical across both backends.
 */
import type {
  ClaimDiffRow,
  ClaimVersionRow,
  ScreeningResultRow,
  SliceStore,
  StoredDocument,
} from './types';

export class AppendOnlyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppendOnlyViolationError';
  }
}

export class MemoryStore implements SliceStore {
  private readonly documentsByHash = new Map<string, StoredDocument>();
  private readonly documentsById = new Map<string, StoredDocument>();
  private readonly claimVersions: ClaimVersionRow[] = [];
  private readonly claimDiffs: ClaimDiffRow[] = [];
  private readonly screeningResults: ScreeningResultRow[] = [];

  /** True when this content hash has already been ingested (idempotency key). */
  async hasContentHash(contentHash: string): Promise<boolean> {
    return this.documentsByHash.has(contentHash);
  }

  /**
   * Appends a document. A duplicate content hash is an idempotent no-op;
   * a duplicate docId with DIFFERENT content is an append-only violation.
   */
  async appendDocument(doc: StoredDocument): Promise<{ readonly inserted: boolean }> {
    if (this.documentsByHash.has(doc.contentHash)) {
      return { inserted: false };
    }
    if (this.documentsById.has(doc.docId)) {
      throw new AppendOnlyViolationError(
        `document ${doc.docId} already stored with different content — documents are immutable`,
      );
    }
    this.documentsByHash.set(doc.contentHash, doc);
    this.documentsById.set(doc.docId, doc);
    return { inserted: true };
  }

  async getDocument(docId: string): Promise<StoredDocument | undefined> {
    return this.documentsById.get(docId);
  }

  async listDocuments(): Promise<readonly StoredDocument[]> {
    return [...this.documentsById.values()];
  }

  async appendClaimVersion(row: Omit<ClaimVersionRow, 'id'>): Promise<ClaimVersionRow> {
    const duplicate = this.claimVersions.some(
      (existing) =>
        existing.familyId === row.familyId &&
        existing.claimNumber === row.claimNumber &&
        existing.versionSeq === row.versionSeq,
    );
    if (duplicate) {
      throw new AppendOnlyViolationError(
        `claim_version (${row.familyId}, claim ${row.claimNumber}, seq ${row.versionSeq}) exists — history is append-only`,
      );
    }
    const inserted: ClaimVersionRow = { ...row, id: this.claimVersions.length + 1 };
    this.claimVersions.push(inserted);
    return inserted;
  }

  /** Latest version per claim for a family, ordered by claim number. */
  async latestClaimVersions(familyId: string): Promise<readonly ClaimVersionRow[]> {
    const latest = new Map<number, ClaimVersionRow>();
    for (const row of this.claimVersions) {
      if (row.familyId !== familyId) continue;
      const current = latest.get(row.claimNumber);
      if (!current || row.versionSeq > current.versionSeq) {
        latest.set(row.claimNumber, row);
      }
    }
    return [...latest.values()].sort((a, b) => a.claimNumber - b.claimNumber);
  }

  async listClaimVersions(): Promise<readonly ClaimVersionRow[]> {
    return [...this.claimVersions];
  }

  async appendClaimDiff(row: Omit<ClaimDiffRow, 'id'>): Promise<ClaimDiffRow> {
    const inserted: ClaimDiffRow = { ...row, id: this.claimDiffs.length + 1 };
    this.claimDiffs.push(inserted);
    return inserted;
  }

  async listClaimDiffs(): Promise<readonly ClaimDiffRow[]> {
    return [...this.claimDiffs];
  }

  async appendScreeningResult(row: Omit<ScreeningResultRow, 'id'>): Promise<ScreeningResultRow> {
    const inserted: ScreeningResultRow = { ...row, id: this.screeningResults.length + 1 };
    this.screeningResults.push(inserted);
    return inserted;
  }

  async listScreeningResults(): Promise<readonly ScreeningResultRow[]> {
    return [...this.screeningResults];
  }
}
