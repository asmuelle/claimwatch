/**
 * CourtListener / RECAP litigation feed client (M4) — REST API v4 dockets.
 *
 * KEYLESS by design: anonymous reads are allowed (rate-limited); when
 * COURTLISTENER_API_TOKEN is present it is sent as `Authorization: Token`.
 * Requests always declare a contact User-Agent. Responses are zod-validated
 * at the boundary; validated dockets map into the existing StoredDocument
 * model (source 'CourtListener', kind 'DOCKET') with a sha-256 content hash
 * over the raw docket record, feeding the standard idempotent ingest.
 *
 * API reference: https://www.courtlistener.com/help/api/rest/
 */
import { z } from 'zod';
import type { StoredDocument } from '../store/types';
import { contentHashOf, DEFAULT_USER_AGENT, FetchHttpError, FetchValidationError } from './fetchTypes';

export const COURTLISTENER_BASE_URL = 'https://www.courtlistener.com';

const DOCKETS_PATH = '/api/rest/v4/dockets/';

const docketSchema = z
  .object({
    id: z.number().int().positive(),
    case_name: z.string(),
    docket_number: z.string().nullable().optional(),
    date_filed: z.string().nullable().optional(),
    court_id: z.string().optional(),
    court: z.string().optional(),
    nature_of_suit: z.string().nullable().optional(),
  })
  .passthrough();

const docketListSchema = z.object({
  results: z.array(docketSchema),
});

type DocketRecord = z.infer<typeof docketSchema>;

export interface CourtListenerFetchResult {
  readonly documents: readonly StoredDocument[];
  /** Dockets skipped because they carry no filing date (no stable pub date). */
  readonly docketsWithoutDate: number;
  /** Raw payload size in bytes, recorded for the live-smoke ledger. */
  readonly payloadBytes: number;
}

export interface CourtListenerClientOptions {
  /** Optional API token — the client is fully functional without one. */
  readonly apiToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly userAgent?: string;
  readonly baseUrl?: string;
}

export interface DocketQueryOptions {
  /** CourtListener court id, e.g. 'txed' (E.D. Tex.) or 'ded' (D. Del.). */
  readonly court?: string;
  readonly pageSize?: number;
  readonly orderBy?: string;
}

const DEFAULT_PAGE_SIZE = 5;

export class CourtListenerClient {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly baseUrl: string;

  constructor(private readonly options: CourtListenerClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.baseUrl = options.baseUrl ?? COURTLISTENER_BASE_URL;
  }

  /**
   * Fetches recent dockets (one small request) and maps them into the
   * document model. Throws FetchValidationError on a malformed payload.
   */
  async fetchRecentDockets(query: DocketQueryOptions = {}): Promise<CourtListenerFetchResult> {
    const url = new URL(DOCKETS_PATH, this.baseUrl);
    if (query.court !== undefined) url.searchParams.set('court', query.court);
    url.searchParams.set('order_by', query.orderBy ?? '-date_filed');
    url.searchParams.set('page_size', String(query.pageSize ?? DEFAULT_PAGE_SIZE));

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    if (this.options.apiToken !== undefined && this.options.apiToken.trim() !== '') {
      headers['Authorization'] = `Token ${this.options.apiToken}`;
    }

    const response = await this.fetchImpl(url.toString(), { method: 'GET', headers });
    if (!response.ok) {
      throw new FetchHttpError('courtlistener', response.status, url.toString());
    }

    const rawBody = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch (cause) {
      throw new FetchValidationError('courtlistener', `response is not JSON: ${String(cause)}`);
    }
    const parsed = docketListSchema.safeParse(payload);
    if (!parsed.success) {
      throw new FetchValidationError(
        'courtlistener',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const documents: StoredDocument[] = [];
    let docketsWithoutDate = 0;
    for (const docket of parsed.data.results) {
      const mapped = toStoredDocument(docket);
      if (mapped === undefined) {
        docketsWithoutDate += 1;
        continue;
      }
      documents.push(mapped);
    }
    return { documents, docketsWithoutDate, payloadBytes: Buffer.byteLength(rawBody, 'utf8') };
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ".../api/rest/v4/courts/txed/" -> "txed" (court_id fallback). */
function courtIdFromUrl(courtUrl: string | undefined): string | undefined {
  if (courtUrl === undefined) return undefined;
  const m = /\/courts\/([^/]+)\/?$/.exec(courtUrl);
  return m?.[1];
}

/** Maps one validated docket; undefined when it has no filing date yet. */
function toStoredDocument(docket: DocketRecord): StoredDocument | undefined {
  if (docket.date_filed === undefined || docket.date_filed === null) {
    return undefined;
  }
  if (!ISO_DATE_RE.test(docket.date_filed)) {
    throw new FetchValidationError(
      'courtlistener',
      `docket ${docket.id} has unparseable date_filed: ${docket.date_filed}`,
    );
  }
  const docId = `CL-${docket.id}`;
  const title =
    docket.case_name.trim() !== ''
      ? docket.case_name
      : `Docket ${docket.docket_number ?? docket.id}`;
  return {
    docId,
    source: 'CourtListener',
    docNumber: docket.docket_number ?? String(docket.id),
    kindCode: 'DOCKET',
    applicationNumber: docId, // family key: one family per docket
    publicationDate: docket.date_filed,
    title,
    assignee: docket.court_id ?? courtIdFromUrl(docket.court) ?? 'unknown-court',
    cpcCodes: [],
    contentHash: contentHashOf(JSON.stringify(docket)),
    rawKey: `courtlistener/${docId}/${docket.date_filed}/docket.json`,
  };
}
