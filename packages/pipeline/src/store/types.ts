/** Row types for the in-memory slice store (mirrors packages/db tables). */
import type { ClaimStatus, DiffHunk, StructuralChange } from '@claimwatch/core';

export interface StoredDocument {
  readonly docId: string;
  readonly source: 'USPTO';
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
