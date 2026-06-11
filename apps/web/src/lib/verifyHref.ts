/**
 * Verify-link targets: every citation links to the canonical stored claim
 * (or document) it asserts, rendered in the Canonical Record section.
 */
import type { CitationRef } from '@claimwatch/core';

/** Anchor id for a stored claim version (or the document when no claim cited). */
export function canonicalAnchorId(docId: string, claimNumber?: number): string {
  return claimNumber === undefined ? `doc-${docId}` : `${docId}-claim-${claimNumber}`;
}

/** In-page verify href for a citation ref. */
export function verifyHref(ref: CitationRef): string {
  return `#${canonicalAnchorId(ref.docId, ref.claimNumber)}`;
}
