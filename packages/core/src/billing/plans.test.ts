import { describe, expect, test } from 'vitest';
import {
  PLANS,
  PLAN_ORDER,
  checkWatchlistCreate,
  checkWatchlistShape,
  hasFeature,
  partitionWatchlistsByEntitlement,
} from './plans';

describe('plan definitions (README pricing)', () => {
  test('prices match the README revenue analysis', () => {
    expect(PLANS.startup.monthlyUsd).toBe(149);
    expect(PLANS.pro.monthlyUsd).toBe(399);
    expect(PLANS.firm.monthlyUsd).toBe(1250);
    expect(PLANS.firm.workspaceMeterUsdPerMonth).toBe(99);
  });

  test('annual billing is 10 months (2 free), anchored at $1,490 Startup', () => {
    expect(PLANS.startup.annualUsd).toBe(1490);
    expect(PLANS.pro.annualUsd).toBe(3990);
    expect(PLANS.firm.annualUsd).toBe(12500);
  });

  test('Startup limits are 1 watchlist, 10 competitors, 10 CPC classes', () => {
    expect(PLANS.startup.limits).toEqual({
      watchlists: 1,
      competitorsPerWatchlist: 10,
      cpcClassesPerWatchlist: 10,
    });
  });

  test('feature ladder: litigation and export are Pro+, white-label and workspaces are Firm', () => {
    expect(hasFeature('startup', 'litigation-docket-monitoring')).toBe(false);
    expect(hasFeature('startup', 'counsel-export')).toBe(false);
    expect(hasFeature('pro', 'litigation-docket-monitoring')).toBe(true);
    expect(hasFeature('pro', 'counsel-export')).toBe(true);
    expect(hasFeature('pro', 'white-label-briefs')).toBe(false);
    expect(hasFeature('pro', 'multi-client-workspaces')).toBe(false);
    expect(hasFeature('firm', 'counsel-export')).toBe(true);
    expect(hasFeature('firm', 'white-label-briefs')).toBe(true);
    expect(hasFeature('firm', 'multi-client-workspaces')).toBe(true);
  });

  test('every higher tier strictly widens limits and features', () => {
    for (let i = 1; i < PLAN_ORDER.length; i += 1) {
      const lower = PLANS[PLAN_ORDER[i - 1] as keyof typeof PLANS];
      const higher = PLANS[PLAN_ORDER[i] as keyof typeof PLANS];
      expect(higher.limits.watchlists).toBeGreaterThan(lower.limits.watchlists);
      expect(higher.limits.competitorsPerWatchlist).toBeGreaterThan(
        lower.limits.competitorsPerWatchlist,
      );
      expect(higher.limits.cpcClassesPerWatchlist).toBeGreaterThan(
        lower.limits.cpcClassesPerWatchlist,
      );
      for (const feature of lower.features) {
        expect(higher.features).toContain(feature);
      }
    }
  });
});

describe('checkWatchlistCreate', () => {
  test('allows creating the first watchlist on Startup', () => {
    expect(checkWatchlistCreate('startup', 0)).toEqual({ allowed: true });
  });

  test('blocks the second Startup watchlist and suggests Pro', () => {
    const verdict = checkWatchlistCreate('startup', 1);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.hit).toEqual({
      kind: 'watchlist-count',
      plan: 'startup',
      limit: 1,
      attempted: 2,
      suggestedPlan: 'pro',
    });
  });

  test('blocks the sixth Pro watchlist and suggests Firm', () => {
    const verdict = checkWatchlistCreate('pro', 5);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.hit.suggestedPlan).toBe('firm');
  });

  test('over the Firm ceiling there is no upgrade to suggest', () => {
    const verdict = checkWatchlistCreate('firm', PLANS.firm.limits.watchlists);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.hit.suggestedPlan).toBeNull();
  });
});

describe('checkWatchlistShape', () => {
  test('a 10-competitor, 10-class watchlist fits Startup exactly', () => {
    expect(
      checkWatchlistShape('startup', { competitorCount: 10, cpcClassCount: 10 }),
    ).toEqual({ allowed: true });
  });

  test('an 11th competitor on Startup hits the limit and suggests Pro', () => {
    const verdict = checkWatchlistShape('startup', { competitorCount: 11, cpcClassCount: 3 });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.hit).toEqual({
      kind: 'competitors-per-watchlist',
      plan: 'startup',
      limit: 10,
      attempted: 11,
      suggestedPlan: 'pro',
    });
  });

  test('an 11th CPC class on Startup hits the CPC limit', () => {
    const verdict = checkWatchlistShape('startup', { competitorCount: 2, cpcClassCount: 11 });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.hit.kind).toBe('cpc-classes-per-watchlist');
  });
});

describe('partitionWatchlistsByEntitlement (downgrade semantics)', () => {
  const rows = [
    { id: 'wl-c', createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'wl-a', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'wl-b', createdAt: '2026-02-01T00:00:00.000Z' },
  ];

  test('after Pro -> Startup the oldest watchlist stays active, the rest freeze', () => {
    const { active, frozen } = partitionWatchlistsByEntitlement('startup', rows);
    expect(active.map((row) => row.id)).toEqual(['wl-a']);
    expect(frozen.map((row) => row.id)).toEqual(['wl-b', 'wl-c']);
  });

  test('nothing is ever dropped: active + frozen partitions the full input', () => {
    const { active, frozen } = partitionWatchlistsByEntitlement('startup', rows);
    expect(active.length + frozen.length).toBe(rows.length);
  });

  test('within the plan limit nothing freezes', () => {
    const { active, frozen } = partitionWatchlistsByEntitlement('pro', rows);
    expect(active).toHaveLength(3);
    expect(frozen).toHaveLength(0);
  });
});
