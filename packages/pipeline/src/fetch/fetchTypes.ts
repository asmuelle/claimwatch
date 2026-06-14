/**
 * Shared plumbing for the M4 live fetchers (USPTO ODP, CourtListener).
 *
 * Every fetcher:
 *  - identifies itself with a declared User-Agent (polite API citizenship),
 *  - validates the raw payload with zod AT THE BOUNDARY — a malformed payload
 *    throws FetchValidationError and nothing reaches the store,
 *  - maps validated records into the existing StoredDocument model with a
 *    sha-256 content hash over the raw record, so the standard content-hash
 *    idempotent ingest applies unchanged (invariant 6).
 */
import { createHash } from 'node:crypto';

/** Declared contact UA for all outbound government/API requests. */
export const DEFAULT_USER_AGENT =
  'claimwatch-pipeline/0.1 (patent-monitoring dev; contact: herban.mueller@gmail.com)';

/** Raised when a live payload fails zod validation at the boundary. */
export class FetchValidationError extends Error {
  constructor(
    readonly source: 'uspto-odp' | 'courtlistener',
    message: string,
  ) {
    super(`${source} payload failed boundary validation: ${message}`);
    this.name = 'FetchValidationError';
  }
}

/** Raised on a non-2xx HTTP response from a live source. */
export class FetchHttpError extends Error {
  constructor(
    readonly source: 'uspto-odp' | 'courtlistener',
    readonly status: number,
    readonly url: string,
  ) {
    super(`${source} request failed with HTTP ${status}: ${url}`);
    this.name = 'FetchHttpError';
  }
}

/** sha-256 hex digest — the idempotency key for fetched records. */
export function contentHashOf(rawRecordJson: string): string {
  return createHash('sha256').update(rawRecordJson, 'utf8').digest('hex');
}
