/**
 * Ingest step for live-fetched documents (M4). Identical idempotency contract
 * to the fixture path: content-hash keyed, append-only, re-runs are no-ops.
 *
 * Live fetchers currently carry bibliographic/docket data only — no claim
 * text — so this step appends document rows without claim versions. Claim
 * diffs continue to come from the bulk-XML path (see DESIGN.md M4 status).
 */
import type { SliceStore, StoredDocument } from '../store/types';

export interface FetchIngestCounts {
  readonly docsSeen: number;
  readonly docsIngested: number;
  readonly docsSkippedDuplicate: number;
}

/** Appends fetched documents; duplicates (by content hash) are no-ops. */
export async function ingestFetchedDocuments(
  store: SliceStore,
  docs: readonly StoredDocument[],
): Promise<FetchIngestCounts> {
  let docsIngested = 0;
  let docsSkippedDuplicate = 0;
  for (const doc of docs) {
    if (await store.hasContentHash(doc.contentHash)) {
      docsSkippedDuplicate += 1;
      continue;
    }
    await store.appendDocument(doc);
    docsIngested += 1;
  }
  return { docsSeen: docs.length, docsIngested, docsSkippedDuplicate };
}
