import { startSubscription } from '@claimwatch/core';
import { describe, expect, test } from 'vitest';
import { MemoryWorkspaceStore, WorkspaceNotFoundError } from '../store/workspaceStore';
import { createWatchlist, updateWatchlist } from './manageWatchlists';

const NOW = '2026-06-10T12:00:00.000Z';

const VALID_INPUT = {
  name: 'Efficient neural inference',
  claimSpaceDescription:
    'Mixture-of-experts routing, attention cache compression and quantization for embedded inference.',
  cpcPrefixes: ['G06N'],
  competitors: ['Vektor Cognition, Inc.'],
};

async function seededStore(plan: 'startup' | 'pro' | 'firm' = 'startup') {
  const store = new MemoryWorkspaceStore();
  await store.ensureOrg({ id: 'org-1', name: 'Aperture Devices, Inc.', createdAt: NOW });
  await store.putSubscription(
    startSubscription({
      orgId: 'org-1',
      planId: plan,
      billingCycle: 'monthly',
      nowIso: NOW,
      provider: 'mock',
    }),
  );
  return store;
}

function deps(store: MemoryWorkspaceStore) {
  let n = 0;
  return { store, nowIso: NOW, idFactory: () => `test-${(n += 1)}` };
}

describe('createWatchlist', () => {
  test('creates a validated watchlist within plan limits', async () => {
    const store = await seededStore();

    const result = await createWatchlist(deps(store), 'org-1', VALID_INPUT);

    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    expect(result.watchlist.id).toBe('wl-test-1');
    expect(result.watchlist.competitors).toEqual(['Vektor Cognition, Inc.']);
    expect(await store.countWatchlists('org-1')).toBe(1);
  });

  test('the second Startup watchlist hits the count limit with an upgrade suggestion', async () => {
    const store = await seededStore();
    const d = deps(store);
    await createWatchlist(d, 'org-1', VALID_INPUT);

    const result = await createWatchlist(d, 'org-1', { ...VALID_INPUT, name: 'Second list' });

    expect(result.status).toBe('limit-exceeded');
    if (result.status !== 'limit-exceeded') throw new Error('unreachable');
    expect(result.hit.kind).toBe('watchlist-count');
    expect(result.hit.suggestedPlan).toBe('pro');
    expect(await store.countWatchlists('org-1')).toBe(1); // nothing persisted
  });

  test('an 11-competitor watchlist on Startup hits the shape limit', async () => {
    const store = await seededStore();
    const competitors = Array.from({ length: 11 }, (_, i) => `Competitor ${i + 1}`);

    const result = await createWatchlist(deps(store), 'org-1', { ...VALID_INPUT, competitors });

    expect(result.status).toBe('limit-exceeded');
    if (result.status !== 'limit-exceeded') throw new Error('unreachable');
    expect(result.hit.kind).toBe('competitors-per-watchlist');
    expect(result.hit.limit).toBe(10);
  });

  test('the same 11-competitor watchlist is fine on Pro', async () => {
    const store = await seededStore('pro');
    const competitors = Array.from({ length: 11 }, (_, i) => `Competitor ${i + 1}`);

    const result = await createWatchlist(deps(store), 'org-1', { ...VALID_INPUT, competitors });

    expect(result.status).toBe('created');
  });

  test('invalid input returns structured issues, persists nothing', async () => {
    const store = await seededStore();

    const result = await createWatchlist(deps(store), 'org-1', {
      ...VALID_INPUT,
      cpcPrefixes: ['NOT-A-CPC'],
    });

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    expect(result.issues[0]?.path).toContain('cpcPrefixes');
    expect(await store.countWatchlists('org-1')).toBe(0);
  });

  test('an org without an entitled subscription cannot create watchlists', async () => {
    const store = new MemoryWorkspaceStore();
    await store.ensureOrg({ id: 'org-1', name: 'No plan org', createdAt: NOW });

    const result = await createWatchlist(deps(store), 'org-1', VALID_INPUT);

    expect(result.status).toBe('no-entitlement');
  });

  test('an unknown org is a hard error (route bug), not a soft result', async () => {
    const store = new MemoryWorkspaceStore();
    await expect(createWatchlist(deps(store), 'org-missing', VALID_INPUT)).rejects.toThrow(
      WorkspaceNotFoundError,
    );
  });
});

describe('updateWatchlist', () => {
  test('updates name, description, CPC classes and competitors', async () => {
    const store = await seededStore();
    const d = deps(store);
    const created = await createWatchlist(d, 'org-1', VALID_INPUT);
    if (created.status !== 'created') throw new Error('setup failed');

    const result = await updateWatchlist(d, created.watchlist.id, {
      ...VALID_INPUT,
      name: 'Renamed pilot watchlist',
      competitors: ['Vektor Cognition, Inc.', 'Tessellate Compute Ltd.'],
    });

    expect(result.status).toBe('updated');
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.watchlist.name).toBe('Renamed pilot watchlist');
    expect(result.watchlist.competitors).toHaveLength(2);
    expect(result.watchlist.createdAt).toBe(created.watchlist.createdAt);
  });

  test('an edit cannot push a watchlist over the plan shape limit', async () => {
    const store = await seededStore();
    const d = deps(store);
    const created = await createWatchlist(d, 'org-1', VALID_INPUT);
    if (created.status !== 'created') throw new Error('setup failed');

    const result = await updateWatchlist(d, created.watchlist.id, {
      ...VALID_INPUT,
      cpcPrefixes: Array.from({ length: 11 }, (_, i) => `G06N${i + 1}`),
    });

    expect(result.status).toBe('limit-exceeded');
    const unchanged = await store.getWatchlist(created.watchlist.id);
    expect(unchanged?.cpcPrefixes).toEqual(['G06N']);
  });

  test('updating an unknown watchlist throws', async () => {
    const store = await seededStore();
    await expect(updateWatchlist(deps(store), 'wl-missing', VALID_INPUT)).rejects.toThrow(
      WorkspaceNotFoundError,
    );
  });
});
