/**
 * Plan definitions + entitlement policy (DESIGN.md M3).
 *
 * Pricing per README revenue analysis: Startup $149/mo (1 watchlist,
 * 10 competitors / 10 CPC classes), Pro $399/mo (5 watchlists, litigation
 * docket monitoring, counsel-ready export), Firm $1,250/mo base +
 * $99/client-workspace metered (multi-client workspaces, white-label briefs).
 * Annual billing is pushed hard: every tier prices the year at 10 months
 * (2 months free), anchored by the README's $1,490/yr Startup figure.
 *
 * Pure policy functions, zero IO. Every limit check returns a structured
 * verdict (never throws on a limit hit) so the UI can render the designed
 * upgrade prompt instead of an error dump.
 */

export type PlanId = 'startup' | 'pro' | 'firm';

export type PlanFeature =
  | 'litigation-docket-monitoring'
  | 'counsel-export'
  | 'white-label-briefs'
  | 'multi-client-workspaces';

export interface PlanLimits {
  readonly watchlists: number;
  readonly competitorsPerWatchlist: number;
  readonly cpcClassesPerWatchlist: number;
}

export interface PlanDefinition {
  readonly id: PlanId;
  readonly label: string;
  readonly monthlyUsd: number;
  /** Annual price = 10 × monthly (2 months free) — the annual push. */
  readonly annualUsd: number;
  readonly limits: PlanLimits;
  readonly features: readonly PlanFeature[];
  /** Firm tier only: metered $/client-workspace/month. */
  readonly workspaceMeterUsdPerMonth: number | null;
}

const ANNUAL_MONTHS_CHARGED = 10;

function annualOf(monthlyUsd: number): number {
  return monthlyUsd * ANNUAL_MONTHS_CHARGED;
}

/**
 * Pro/Firm structural limits beyond the README's Startup numbers are
 * operational guardrails (abuse control), not marketed quotas; revisit with
 * pricing before publishing them.
 */
export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  startup: {
    id: 'startup',
    label: 'Startup',
    monthlyUsd: 149,
    annualUsd: annualOf(149), // $1,490/yr per README
    limits: { watchlists: 1, competitorsPerWatchlist: 10, cpcClassesPerWatchlist: 10 },
    features: [],
    workspaceMeterUsdPerMonth: null,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    monthlyUsd: 399,
    annualUsd: annualOf(399),
    limits: { watchlists: 5, competitorsPerWatchlist: 25, cpcClassesPerWatchlist: 25 },
    features: ['litigation-docket-monitoring', 'counsel-export'],
    workspaceMeterUsdPerMonth: null,
  },
  firm: {
    id: 'firm',
    label: 'Firm',
    monthlyUsd: 1250,
    annualUsd: annualOf(1250),
    limits: { watchlists: 25, competitorsPerWatchlist: 50, cpcClassesPerWatchlist: 50 },
    features: [
      'litigation-docket-monitoring',
      'counsel-export',
      'white-label-briefs',
      'multi-client-workspaces',
    ],
    workspaceMeterUsdPerMonth: 99,
  },
};

/** Tier order for upgrade suggestions. */
export const PLAN_ORDER: readonly PlanId[] = ['startup', 'pro', 'firm'];

export function hasFeature(plan: PlanId, feature: PlanFeature): boolean {
  return PLANS[plan].features.includes(feature);
}

export type LimitKind = 'watchlist-count' | 'competitors-per-watchlist' | 'cpc-classes-per-watchlist';

/** A limit hit, shaped for the upgrade prompt (never an error dump). */
export interface LimitHit {
  readonly kind: LimitKind;
  readonly plan: PlanId;
  readonly limit: number;
  readonly attempted: number;
  /** Cheapest higher tier that satisfies the attempt; null when none does. */
  readonly suggestedPlan: PlanId | null;
}

export type LimitVerdict = { readonly allowed: true } | { readonly allowed: false; readonly hit: LimitHit };

function limitFor(plan: PlanId, kind: LimitKind): number {
  const limits = PLANS[plan].limits;
  switch (kind) {
    case 'watchlist-count':
      return limits.watchlists;
    case 'competitors-per-watchlist':
      return limits.competitorsPerWatchlist;
    case 'cpc-classes-per-watchlist':
      return limits.cpcClassesPerWatchlist;
  }
}

function suggestPlan(current: PlanId, kind: LimitKind, attempted: number): PlanId | null {
  const start = PLAN_ORDER.indexOf(current) + 1;
  for (const candidate of PLAN_ORDER.slice(start)) {
    if (attempted <= limitFor(candidate, kind)) return candidate;
  }
  return null;
}

function checkLimit(plan: PlanId, kind: LimitKind, attempted: number): LimitVerdict {
  const limit = limitFor(plan, kind);
  if (attempted <= limit) return { allowed: true };
  return {
    allowed: false,
    hit: { kind, plan, limit, attempted, suggestedPlan: suggestPlan(plan, kind, attempted) },
  };
}

/** May the org create one more watchlist on this plan? */
export function checkWatchlistCreate(plan: PlanId, currentCount: number): LimitVerdict {
  return checkLimit(plan, 'watchlist-count', currentCount + 1);
}

export interface WatchlistShape {
  readonly competitorCount: number;
  readonly cpcClassCount: number;
}

/** Does a watchlist's competitor/CPC shape fit the plan? First hit wins. */
export function checkWatchlistShape(plan: PlanId, shape: WatchlistShape): LimitVerdict {
  const competitors = checkLimit(plan, 'competitors-per-watchlist', shape.competitorCount);
  if (!competitors.allowed) return competitors;
  return checkLimit(plan, 'cpc-classes-per-watchlist', shape.cpcClassCount);
}

/**
 * After a downgrade an org may hold more watchlists than the plan allows.
 * Nothing is ever deleted: the oldest rows (by createdAt, id tie-break) stay
 * active up to the plan limit; the rest are frozen (read-only) until the org
 * upgrades again or retires watchlists.
 */
export function partitionWatchlistsByEntitlement<
  T extends { readonly id: string; readonly createdAt: string },
>(plan: PlanId, watchlists: readonly T[]): { readonly active: readonly T[]; readonly frozen: readonly T[] } {
  const limit = PLANS[plan].limits.watchlists;
  const ordered = [...watchlists].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return { active: ordered.slice(0, limit), frozen: ordered.slice(limit) };
}
