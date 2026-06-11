/**
 * Server-side workspace composition for the pre-auth demo surface.
 *
 * The web app runs on the memory-backed WorkspaceStore seeded with demo orgs
 * (one per tier) so every plan-gated surface is exercisable without Postgres
 * or auth — the same store port the live path implements with
 * DrizzleWorkspaceStore (proven in `just test-db`). The singleton lives on
 * globalThis so server actions and page renders share one store across
 * Next.js module instantiations.
 */
import type { PlanId, SubscriptionRecord } from '@claimwatch/core';
import { startSubscription } from '@claimwatch/core';
import { MemoryWorkspaceStore } from '@claimwatch/pipeline';
import type { OrgRecord } from '@claimwatch/pipeline';

const SEED_NOW = '2026-06-01T00:00:00.000Z';

export interface DemoOrg {
  readonly slug: string;
  readonly name: string;
  readonly plan: PlanId;
}

/** One demo org per tier, plus a Startup org pre-seeded at its limit. */
export const DEMO_ORGS: readonly DemoOrg[] = [
  { slug: 'startup-demo', name: 'Aperture Devices, Inc.', plan: 'startup' },
  { slug: 'startup-full', name: 'Northbeam Robotics, Inc.', plan: 'startup' },
  { slug: 'pro-demo', name: 'Coherent Photonics LLC', plan: 'pro' },
  { slug: 'firm-demo', name: 'Harrow & Vance LLP', plan: 'firm' },
];

export const DEFAULT_ORG_SLUG = 'startup-demo';

function subscriptionFor(org: DemoOrg): SubscriptionRecord {
  return startSubscription({
    orgId: org.slug,
    planId: org.plan,
    billingCycle: 'annual', // the annual push is the default posture
    nowIso: SEED_NOW,
    provider: 'mock',
    providerRef: `mock_sub_${org.slug}`,
  });
}

async function seedStore(): Promise<MemoryWorkspaceStore> {
  const store = new MemoryWorkspaceStore();
  for (const org of DEMO_ORGS) {
    const record: OrgRecord = { id: org.slug, name: org.name, createdAt: SEED_NOW };
    await store.ensureOrg(record);
    await store.putSubscription(subscriptionFor(org));
  }
  // startup-full sits AT its 1-watchlist Startup limit: the limit-hit and
  // upgrade-prompt flows are demonstrable without mutating other orgs.
  await store.createWatchlist({
    id: 'wl-seed-northbeam',
    orgId: 'startup-full',
    name: 'Warehouse robotics grasping',
    claimSpaceDescription:
      'Robotic grasping and manipulation planning for warehouse automation: suction arrays, ' +
      'force-feedback grippers, bin-picking pose estimation.',
    cpcPrefixes: ['B25J'],
    competitors: ['Vektor Cognition, Inc.'],
    jurisdictions: ['USPTO (US grants Tue / pre-grant publications Thu)'],
    createdAt: SEED_NOW,
  });
  return store;
}

const globalCache = globalThis as typeof globalThis & {
  __claimwatchWorkspaceStore?: Promise<MemoryWorkspaceStore>;
};

/** Shared workspace store: one instance per server process. */
export function getWorkspaceStore(): Promise<MemoryWorkspaceStore> {
  globalCache.__claimwatchWorkspaceStore ??= seedStore();
  return globalCache.__claimwatchWorkspaceStore;
}

/** Resolves a demo org from an ?org= search param; unknown slugs fall back. */
export function resolveDemoOrg(slug: string | undefined): DemoOrg {
  return DEMO_ORGS.find((org) => org.slug === slug) ?? (DEMO_ORGS[0] as DemoOrg);
}
