/**
 * Append-only in-memory store for the fixture-driven M1 slice.
 *
 * Mirrors the packages/db tables without requiring Postgres (tests and the
 * read-only web render run against this). Append-only semantics are enforced
 * at the API surface: there is no update or delete method anywhere.
 */
import type {
  ClaimDiffRow,
  ClaimVersionRow,
  ScreeningResultRow,
  StoredDocument,
} from './types';

export class AppendOnlyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppendOnlyViolationError';
  }
}

export class MemoryStore {
  private readonly documentsByHash = new Map<string, StoredDocument>();
  private readonly documentsById = new Map<string, StoredDocument>();
  private readonly claimVersions: ClaimVersionRow[] = [];
  private readonly claimDiffs: ClaimDiffRow[] = [];
  private readonly screeningResults: ScreeningResultRow[] = [];

  /** True when this content hash has already been ingested (idempotency key). */
  hasContentHash(contentHash: string): boolean {
    return this.documentsByHash.has(contentHash);
  }

  /**
   * Appends a document. A duplicate content hash is an idempotent no-op;
   * a duplicate docId with DIFFERENT content is an append-only violation.
   */
  appendDocument(doc: StoredDocument): { readonly inserted: boolean } {
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

  getDocument(docId: string): StoredDocument | undefined {
    return this.documentsById.get(docId);
  }

  listDocuments(): readonly StoredDocument[] {
    return [...this.documentsById.values()];
  }

  appendClaimVersion(row: Omit<ClaimVersionRow, 'id'>): ClaimVersionRow {
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
  latestClaimVersions(familyId: string): readonly ClaimVersionRow[] {
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

  listClaimVersions(): readonly ClaimVersionRow[] {
    return [...this.claimVersions];
  }

  appendClaimDiff(row: Omit<ClaimDiffRow, 'id'>): ClaimDiffRow {
    const inserted: ClaimDiffRow = { ...row, id: this.claimDiffs.length + 1 };
    this.claimDiffs.push(inserted);
    return inserted;
  }

  listClaimDiffs(): readonly ClaimDiffRow[] {
    return [...this.claimDiffs];
  }

  appendScreeningResult(row: Omit<ScreeningResultRow, 'id'>): ScreeningResultRow {
    const inserted: ScreeningResultRow = { ...row, id: this.screeningResults.length + 1 };
    this.screeningResults.push(inserted);
    return inserted;
  }

  listScreeningResults(): readonly ScreeningResultRow[] {
    return [...this.screeningResults];
  }
}
