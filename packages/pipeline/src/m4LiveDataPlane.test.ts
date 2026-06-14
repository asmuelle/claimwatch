import { describe, expect, it } from 'vitest';

import { createFetchers } from './fetch/createFetchers';
import { CourtListenerClient } from './fetch/courtListenerClient';
import { FetchValidationError } from './fetch/fetchTypes';
import { createModelAdapters } from './llm/createModelAdapters';
import { runNightly } from './nightly/runNightly';
import { ResendBriefSender, createBriefSender } from './send/resendSender';
import { M1_WATCHLIST } from './triage/watchlist';

/**
 * M4 live data plane: config gates (model/fetcher/sender), the keyless
 * CourtListener client behind a fetch stub, and the nightly runner ledger.
 * No network: every external call is stubbed; live endpoints are exercised
 * separately (manually), never in `just ci`.
 */

const FIXTURES_DIR = new URL('../../../fixtures/uspto', import.meta.url).pathname;

const stubFetch = (status: number, body: string): typeof fetch =>
  (async () => new Response(body, { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('createModelAdapters — config gate', () => {
  it('returns deterministic mocks when ANTHROPIC_API_KEY is absent', () => {
    const set = createModelAdapters({}, M1_WATCHLIST);
    expect(set.provider).toBe('mock');
  });

  it('returns Anthropic adapters when the key is present, with no network at construction', () => {
    const exploding = (() => {
      throw new Error('no network at construction');
    }) as unknown as typeof fetch;
    const set = createModelAdapters({ ANTHROPIC_API_KEY: 'sk-ant-fake' }, M1_WATCHLIST, {
      fetchImpl: exploding,
    });
    expect(set.provider).toBe('anthropic');
    // Construction touched no network (exploding fetch never called).
  });
});

describe('createFetchers — config gate', () => {
  it('leaves USPTO undefined without a key but always constructs CourtListener', () => {
    const set = createFetchers({});
    expect(set.uspto).toBeUndefined();
    expect(set.courtListener).toBeInstanceOf(CourtListenerClient);
  });

  it('constructs the USPTO client when USPTO_ODP_API_KEY is set', () => {
    const set = createFetchers({ USPTO_ODP_API_KEY: 'odp-fake' });
    expect(set.uspto).toBeDefined();
  });
});

describe('createBriefSender — config gate', () => {
  it('returns the mock sender without RESEND_API_KEY', () => {
    const sender = createBriefSender({});
    expect(sender).not.toBeInstanceOf(ResendBriefSender);
  });

  it('returns the Resend sender when RESEND_API_KEY is present', () => {
    const sender = createBriefSender({ RESEND_API_KEY: 'resend-fake' });
    expect(sender).toBeInstanceOf(ResendBriefSender);
  });

  it('refuses to construct with an empty API key', () => {
    expect(() => new ResendBriefSender({ apiKey: '  ' })).toThrow();
  });
});

describe('CourtListenerClient (keyless) — fetch-stubbed', () => {
  const docketPayload = JSON.stringify({
    results: [
      { id: 101, case_name: 'Acme v. Globex', docket_number: '1:24-cv-001', date_filed: '2024-05-01', court_id: 'ded' },
      { id: 102, case_name: 'No Date Co', docket_number: '1:24-cv-002', date_filed: null, court_id: 'txed' },
    ],
  });

  it('maps dated dockets into the document model and counts dateless ones', async () => {
    const client = new CourtListenerClient({ fetchImpl: stubFetch(200, docketPayload) });
    const result = await client.fetchRecentDockets({ court: 'ded' });

    expect(result.documents).toHaveLength(1);
    expect(result.docketsWithoutDate).toBe(1);
    const doc = result.documents[0];
    expect(doc?.docId).toBe('CL-101');
    expect(doc?.source).toBe('CourtListener');
    expect(doc?.publicationDate).toBe('2024-05-01');
    expect(result.payloadBytes).toBeGreaterThan(0);
  });

  it('rejects a malformed payload at the zod boundary (nothing reaches the store)', async () => {
    const client = new CourtListenerClient({ fetchImpl: stubFetch(200, JSON.stringify({ wrong: 'shape' })) });
    await expect(client.fetchRecentDockets()).rejects.toBeInstanceOf(FetchValidationError);
  });

  it('attaches a bearer-style token only when configured', async () => {
    let authHeader: string | null = null;
    const capturing = (async (_url: string, init: RequestInit) => {
      authHeader = new Headers(init.headers).get('Authorization');
      return new Response(docketPayload, { status: 200 });
    }) as unknown as typeof fetch;
    const client = new CourtListenerClient({ apiToken: 'cl-token', fetchImpl: capturing });
    await client.fetchRecentDockets();
    expect(authHeader).toBe('Token cl-token');
  });
});

describe('runNightly (fixture mode) — deterministic ledger', () => {
  const OPTS = { live: false, fixturesDir: FIXTURES_DIR, env: {}, nowIso: '2026-05-15T06:00:00Z' };

  it('drives the full pipeline and reports a complete ledger with mock models', async () => {
    const { ledger, brief } = await runNightly(OPTS);

    expect(ledger.mode).toBe('fixtures');
    expect(ledger.modelProvider).toBe('mock');
    expect(ledger.sources.length).toBeGreaterThan(0);
    expect(ledger.docsIngested).toBeGreaterThan(0);
    expect(ledger.briefsProduced).toBeGreaterThanOrEqual(1);
    expect(brief.watchlistName).toBe(M1_WATCHLIST.name);
  });

  it('is deterministic across runs', async () => {
    const a = await runNightly(OPTS);
    const b = await runNightly(OPTS);
    expect(b.ledger).toEqual(a.ledger);
  });
});

describe('ResendBriefSender — fetch-stubbed transport, no key leak', () => {
  it('POSTs to the Resend emails endpoint with bearer auth and returns the message id', async () => {
    const { brief } = await runNightly({ live: false, fixturesDir: FIXTURES_DIR, env: {}, nowIso: '2026-05-15T06:00:00Z' });
    let captured: { url: string; init: RequestInit } | null = null;
    const capturing = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: 'resend-xyz' }), { status: 200 });
    }) as unknown as typeof fetch;

    const sender = new ResendBriefSender({ apiKey: 'resend-secret', fetchImpl: capturing });
    const receipt = await sender.send({ to: 'pm@firm.example', subject: 'Weekly brief', brief });

    expect(receipt.messageId).toBe('resend-xyz');
    const { url, init } = captured as unknown as { url: string; init: RequestInit };
    expect(url).toMatch(/resend\.com\/emails$/);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer resend-secret');
  });

  it('never leaks the API key on a non-OK response', async () => {
    const { brief } = await runNightly({ live: false, fixturesDir: FIXTURES_DIR, env: {}, nowIso: '2026-05-15T06:00:00Z' });
    const sender = new ResendBriefSender({ apiKey: 'resend-secret', fetchImpl: stubFetch(403, 'forbidden') });
    await expect(sender.send({ to: 'pm@firm.example', subject: 'x', brief })).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && !e.message.includes('resend-secret'),
    );
  });
});
