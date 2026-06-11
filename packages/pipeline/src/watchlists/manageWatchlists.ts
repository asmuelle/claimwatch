/**
 * Watchlist management (M3): validated input -> plan-limit enforcement ->
 * persisted via the WorkspaceStore port. The web server actions are a thin
 * shell over these functions; every outcome is a structured result so the UI
 * renders the designed upgrade prompt on a limit hit, never an error dump.
 */
import type { LimitHit, PlanId, WatchlistInput, WatchlistInputIssue } from '@claimwatch/core';
import {
  checkWatchlistCreate,
  checkWatchlistShape,
  entitledPlan,
  parseWatchlistInput,
} from '@claimwatch/core';
import type { WatchlistRecord, WorkspaceStore } from '../store/workspaceStore';
import { WorkspaceNotFoundError } from '../store/workspaceStore';

/** USPTO-only at launch — coverage honesty is invariant 4. */
const JURISDICTIONS_WATCHED: readonly string[] = [
  'USPTO (US grants Tue / pre-grant publications Thu)',
];

export type WatchlistMutationResult =
  | { readonly status: 'created' | 'updated'; readonly watchlist: WatchlistRecord }
  | { readonly status: 'invalid'; readonly issues: readonly WatchlistInputIssue[] }
  | { readonly status: 'limit-exceeded'; readonly hit: LimitHit; readonly plan: PlanId }
  | { readonly status: 'no-entitlement' };

export interface ManageWatchlistsDeps {
  readonly store: WorkspaceStore;
  readonly nowIso: string;
  /** Injectable for deterministic tests; defaults to crypto.randomUUID. */
  readonly idFactory?: () => string;
}

async function resolvePlan(store: WorkspaceStore, orgId: string, nowIso: string): Promise<PlanId | null> {
  const record = await store.getSubscription(orgId);
  return entitledPlan(record, nowIso);
}

function shapeOf(value: WatchlistInput) {
  return { competitorCount: value.competitors.length, cpcClassCount: value.cpcPrefixes.length };
}

/** Validates, enforces plan limits, and creates a watchlist for the org. */
export async function createWatchlist(
  deps: ManageWatchlistsDeps,
  orgId: string,
  rawInput: unknown,
): Promise<WatchlistMutationResult> {
  const org = await deps.store.getOrg(orgId);
  if (!org) throw new WorkspaceNotFoundError('org', orgId);

  const parsed = parseWatchlistInput(rawInput);
  if (!parsed.ok) return { status: 'invalid', issues: parsed.issues };

  const plan = await resolvePlan(deps.store, orgId, deps.nowIso);
  if (plan === null) return { status: 'no-entitlement' };

  const countVerdict = checkWatchlistCreate(plan, await deps.store.countWatchlists(orgId));
  if (!countVerdict.allowed) return { status: 'limit-exceeded', hit: countVerdict.hit, plan };

  const shapeVerdict = checkWatchlistShape(plan, shapeOf(parsed.value));
  if (!shapeVerdict.allowed) return { status: 'limit-exceeded', hit: shapeVerdict.hit, plan };

  const idFactory = deps.idFactory ?? (() => crypto.randomUUID());
  const record: WatchlistRecord = {
    id: `wl-${idFactory()}`,
    orgId,
    name: parsed.value.name,
    claimSpaceDescription: parsed.value.claimSpaceDescription,
    cpcPrefixes: parsed.value.cpcPrefixes,
    competitors: parsed.value.competitors,
    jurisdictions: JURISDICTIONS_WATCHED,
    createdAt: deps.nowIso,
  };
  return { status: 'created', watchlist: await deps.store.createWatchlist(record) };
}

/** Validates, enforces shape limits, and updates an existing watchlist. */
export async function updateWatchlist(
  deps: ManageWatchlistsDeps,
  watchlistId: string,
  rawInput: unknown,
): Promise<WatchlistMutationResult> {
  const existing = await deps.store.getWatchlist(watchlistId);
  if (!existing) throw new WorkspaceNotFoundError('watchlist', watchlistId);

  const parsed = parseWatchlistInput(rawInput);
  if (!parsed.ok) return { status: 'invalid', issues: parsed.issues };

  const plan = await resolvePlan(deps.store, existing.orgId, deps.nowIso);
  if (plan === null) return { status: 'no-entitlement' };

  // Edits cannot smuggle a watchlist past the per-watchlist shape limits.
  const shapeVerdict = checkWatchlistShape(plan, shapeOf(parsed.value));
  if (!shapeVerdict.allowed) return { status: 'limit-exceeded', hit: shapeVerdict.hit, plan };

  const updated = await deps.store.updateWatchlist(watchlistId, {
    name: parsed.value.name,
    claimSpaceDescription: parsed.value.claimSpaceDescription,
    cpcPrefixes: parsed.value.cpcPrefixes,
    competitors: parsed.value.competitors,
  });
  return { status: 'updated', watchlist: updated };
}
