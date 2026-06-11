/** Upgrade-prompt copy for a structured LimitHit. Pure and unit-tested. */
import type { LimitHit } from '@claimwatch/core';
import { PLANS } from '@claimwatch/core';

export interface LimitCopy {
  readonly title: string;
  readonly detail: string;
}

export function limitCopy(hit: LimitHit): LimitCopy {
  const planLabel = PLANS[hit.plan].label;
  switch (hit.kind) {
    case 'watchlist-count':
      return {
        title: `The ${planLabel} plan includes ${hit.limit} watchlist${hit.limit === 1 ? '' : 's'}`,
        detail: `This would be watchlist ${hit.attempted} for your workspace — pick a higher tier to add it.`,
      };
    case 'competitors-per-watchlist':
      return {
        title: `The ${planLabel} plan names up to ${hit.limit} competitors per watchlist`,
        detail: `This watchlist names ${hit.attempted}. Trim the list or move up a tier.`,
      };
    case 'cpc-classes-per-watchlist':
      return {
        title: `The ${planLabel} plan covers up to ${hit.limit} CPC classes per watchlist`,
        detail: `This watchlist lists ${hit.attempted}. Trim the classes or move up a tier.`,
      };
  }
}
