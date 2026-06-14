/** Row types and the storage port shared by the in-memory and Drizzle stores. */
import type { ClaimStatus, DiffHunk, StructuralChange } from '@claimwatch/core';

/**
 * Canonical publication sources the pipeline ingests. 'USPTO' rows carry
 * claims; 'CourtListener' rows are litigation dockets mapped into the same
 * document model (M4) — no claims, kind code 'DOCKET'.
 */
export type DocumentSource = 'USPTO' | 'CourtListener';

export interface StoredDocument {
  readonly docId: string;
  readonly source: DocumentSource;
  readonly docNumber: string;
  readonly kindCode: string;
  readonly applicationNumber: string;
  readonly publicationDate: string;
  readonly title: string;
  readonly assignee: string;
  readonly cpcCodes: readonly string[];
  readonly contentHash: string;
  readonly rawKey: string;
}

export interface ClaimVersionRow {
  readonly id: number;
  readonly familyId: string;
  readonly docId: string;
  readonly claimNumber: number;
  readonly versionSeq: number;
  readonly text: string;
  readonly status: ClaimStatus;
  readonly dependsOn: readonly number[];
}

export interface ClaimDiffRow {
  readonly id: number;
  readonly familyId: string;
  readonly fromVersionId: number | null;
  readonly toVersionId: number;
  readonly claimNumber: number;
  readonly change: StructuralChange;
  readonly hunks: readonly DiffHunk[];
  /** Separate LLM field — never populated by the deterministic pipeline. */
  readonly llmAnnotation: string | null;
}

export type MatchArm = 'cpc-prefix' | 'embedding' | 'named-assignee';

export interface ScreeningResultRow {
  readonly id: number;
  readonly docId: string;
  readonly watchlistName: string;
  readonly embeddingScore: number;
  readonly matchedBy: readonly MatchArm[];
  readonly verdict: 'in-scope' | 'adjacent' | 'out-of-scope';
  readonly confidence: number;
  readonly rationale: string;
  readonly decision: 'surface' | 'downrank';
  readonly model: string;
  readonly promptVersion: string;
}

/**
 * Storage port for the vertical slice (repository pattern). Implemented by
 * MemoryStore (fixture/unit runs) and DrizzleSliceStore (live Postgres).
 *
 * The surface is append-only by construction: there is no update or delete
 * method anywhere (product invariant 5). All methods are async so the same
 * pipeline code runs unchanged against memory and a real database.
 */
export interface SliceStore {
  /** True when this content hash has already been ingested (idempotency key). */
  hasContentHash(contentHash: string): Promise<boolean>;
  /**
   * Appends a document. A duplicate content hash is an idempotent no-op;
   * a duplicate docId with DIFFERENT content is an append-only violation.
   */
  appendDocument(doc: StoredDocument): Promise<{ readonly inserted: boolean }>;
  getDocument(docId: string): Promise<StoredDocument | undefined>;
  listDocuments(): Promise<readonly StoredDocument[]>;
  appendClaimVersion(row: Omit<ClaimVersionRow, 'id'>): Promise<ClaimVersionRow>;
  /** Latest version per claim for a family, ordered by claim number. */
  latestClaimVersions(familyId: string): Promise<readonly ClaimVersionRow[]>;
  listClaimVersions(): Promise<readonly ClaimVersionRow[]>;
  appendClaimDiff(row: Omit<ClaimDiffRow, 'id'>): Promise<ClaimDiffRow>;
  listClaimDiffs(): Promise<readonly ClaimDiffRow[]>;
  appendScreeningResult(row: Omit<ScreeningResultRow, 'id'>): Promise<ScreeningResultRow>;
  listScreeningResults(): Promise<readonly ScreeningResultRow[]>;
}
