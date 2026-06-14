/**
 * Config gate for the live fetchers (M4). Mirrors createBillingProvider:
 * keys come from the environment only — never hardcoded, never logged.
 *
 * - USPTO ODP requires USPTO_ODP_API_KEY: absent -> `uspto` is undefined and
 *   the caller records the source as SKIPPED (a coverage note, never a
 *   silent half-configuration).
 * - CourtListener is always constructed; COURTLISTENER_API_TOKEN is attached
 *   when present. NOTE (verified live 2026-06): the v4 REST API now returns
 *   HTTP 401 to anonymous requests, so a token is required for live fetches —
 *   without one the nightly runner records the source as FAILED with a
 *   coverage note (never a silent drop) and still produces the brief.
 */
import { CourtListenerClient } from './courtListenerClient';
import { UsptoOdpClient } from './usptoOdpClient';

type EnvShape = Readonly<Record<string, string | undefined>>;

export interface FetcherSet {
  /** Undefined when USPTO_ODP_API_KEY is not configured. */
  readonly uspto: UsptoOdpClient | undefined;
  readonly courtListener: CourtListenerClient;
}

export function createFetchers(env: EnvShape, fetchImpl?: typeof fetch): FetcherSet {
  const usptoKey = env['USPTO_ODP_API_KEY']?.trim();
  const courtListenerToken = env['COURTLISTENER_API_TOKEN']?.trim();
  return {
    uspto: usptoKey ? new UsptoOdpClient({ apiKey: usptoKey, fetchImpl }) : undefined,
    courtListener: new CourtListenerClient({
      apiToken: courtListenerToken === '' ? undefined : courtListenerToken,
      fetchImpl,
    }),
  };
}
