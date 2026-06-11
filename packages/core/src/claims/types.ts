/** Domain types for parsed canonical patent documents. Pure data, no IO. */

export type ClaimStatus = 'active' | 'cancelled';

export interface ParsedClaim {
  /** Claim number as published (1-based). */
  readonly number: number;
  /** Normalized claim body text, without the leading "N." prefix. */
  readonly text: string;
  readonly status: ClaimStatus;
  /** Claim numbers this claim depends on (from <claim-ref> idrefs). */
  readonly dependsOn: readonly number[];
}

export interface ParsedDocument {
  readonly source: 'USPTO';
  /** Stable internal id, e.g. "US-12790314-B2". */
  readonly docId: string;
  readonly docNumber: string;
  readonly kindCode: string;
  /** US application serial number — used as the patent-family key in the M1 slice. */
  readonly applicationNumber: string;
  /** ISO date (yyyy-mm-dd). */
  readonly publicationDate: string;
  readonly title: string;
  readonly assignee: string;
  /** CPC symbols, e.g. "G06N3/08". */
  readonly cpcCodes: readonly string[];
  readonly claims: readonly ParsedClaim[];
}

/** Builds the canonical internal doc id from its parts. */
export function buildDocId(docNumber: string, kindCode: string): string {
  return `US-${docNumber}-${kindCode}`;
}
