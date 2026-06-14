/**
 * USPTO Open Data Portal client (M4) — Patent Search API.
 *
 * Full implementation, config-gated on USPTO_ODP_API_KEY (X-API-KEY header).
 * Responses are zod-validated at the boundary; validated bibliographic
 * records map into the existing StoredDocument model with a sha-256 content
 * hash over the raw record, feeding the standard idempotent ingest.
 *
 * Bibliographic search results carry no claim text: documents fetched here
 * land without claim versions. Bulk-XML delta download (live claim ingest)
 * is deferred — see DESIGN.md M4 status notes.
 *
 * API reference: https://data.uspto.gov (Open Data Portal, api.uspto.gov).
 */
import { z } from 'zod';
import type { StoredDocument } from '../store/types';
import { contentHashOf, DEFAULT_USER_AGENT, FetchHttpError, FetchValidationError } from './fetchTypes';

export const USPTO_ODP_BASE_URL = 'https://api.uspto.gov';

const SEARCH_PATH = '/api/v1/patent/applications/search';

const applicationMetaDataSchema = z.object({
  inventionTitle: z.string().min(1),
  earliestPublicationNumber: z.string().optional(),
  earliestPublicationDate: z.string().optional(),
  firstApplicantName: z.string().optional(),
  cpcClassificationBag: z.array(z.string()).optional(),
});

const fileWrapperSchema = z.object({
  applicationNumberText: z.string().min(1),
  applicationMetaData: applicationMetaDataSchema,
});

const searchResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  patentFileWrapperDataBag: z.array(fileWrapperSchema),
});

export type UsptoSearchResponse = z.infer<typeof searchResponseSchema>;
type FileWrapperRecord = z.infer<typeof fileWrapperSchema>;

/** ODP query for a CPC prefix, e.g. `G06N` -> publications in that subclass. */
export function cpcPrefixQuery(cpcPrefix: string): string {
  return `applicationMetaData.cpcClassificationBag:(${cpcPrefix}*)`;
}

/** "US20240123456A1" -> { docNumber: "20240123456", kindCode: "A1" }. */
const PUBLICATION_NUMBER_RE = /^US(\d+)([A-Z]\d?)$/;

export interface UsptoFetchResult {
  readonly documents: readonly StoredDocument[];
  /** Records skipped because they carry no publication number/date yet. */
  readonly recordsWithoutPublication: number;
  readonly totalCount: number;
}

export interface UsptoOdpClientOptions {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly userAgent?: string;
  readonly baseUrl?: string;
}

export interface UsptoSearchOptions {
  /** ODP query string; see cpcPrefixQuery for the common case. */
  readonly query: string;
  readonly limit?: number;
  readonly offset?: number;
}

const DEFAULT_LIMIT = 25;

export class UsptoOdpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly baseUrl: string;

  constructor(private readonly options: UsptoOdpClientOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('UsptoOdpClient requires a non-empty API key (USPTO_ODP_API_KEY)');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.baseUrl = options.baseUrl ?? USPTO_ODP_BASE_URL;
  }

  /**
   * Searches published applications and maps each published record into the
   * document model. Throws FetchValidationError on a malformed payload —
   * nothing partially parsed ever reaches the caller.
   */
  async searchPublishedApplications(search: UsptoSearchOptions): Promise<UsptoFetchResult> {
    const url = new URL(SEARCH_PATH, this.baseUrl);
    url.searchParams.set('q', search.query);
    url.searchParams.set('limit', String(search.limit ?? DEFAULT_LIMIT));
    url.searchParams.set('offset', String(search.offset ?? 0));

    const response = await this.fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'X-API-KEY': this.options.apiKey,
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
    });
    if (!response.ok) {
      throw new FetchHttpError('uspto-odp', response.status, url.toString());
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new FetchValidationError('uspto-odp', `response is not JSON: ${String(cause)}`);
    }
    const parsed = searchResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new FetchValidationError(
        'uspto-odp',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const documents: StoredDocument[] = [];
    let recordsWithoutPublication = 0;
    for (const record of parsed.data.patentFileWrapperDataBag) {
      const mapped = toStoredDocument(record);
      if (mapped === undefined) {
        recordsWithoutPublication += 1;
        continue;
      }
      documents.push(mapped);
    }
    return { documents, recordsWithoutPublication, totalCount: parsed.data.count };
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Maps one validated file-wrapper record; undefined when not yet published. */
function toStoredDocument(record: FileWrapperRecord): StoredDocument | undefined {
  const meta = record.applicationMetaData;
  if (meta.earliestPublicationNumber === undefined || meta.earliestPublicationDate === undefined) {
    return undefined;
  }
  const match = PUBLICATION_NUMBER_RE.exec(meta.earliestPublicationNumber);
  const docNumber = match?.[1];
  const kindCode = match?.[2];
  if (docNumber === undefined || kindCode === undefined || !ISO_DATE_RE.test(meta.earliestPublicationDate)) {
    throw new FetchValidationError(
      'uspto-odp',
      `unparseable publication reference for application ${record.applicationNumberText}: ` +
        `${meta.earliestPublicationNumber} / ${meta.earliestPublicationDate}`,
    );
  }
  return {
    docId: `US-${docNumber}-${kindCode}`,
    source: 'USPTO',
    docNumber,
    kindCode,
    applicationNumber: record.applicationNumberText,
    publicationDate: meta.earliestPublicationDate,
    title: meta.inventionTitle,
    assignee: meta.firstApplicantName ?? 'unknown',
    cpcCodes: meta.cpcClassificationBag ?? [],
    contentHash: contentHashOf(JSON.stringify(record)),
    rawKey: `uspto-odp/US-${docNumber}-${kindCode}/${meta.earliestPublicationDate}/search.json`,
  };
}
