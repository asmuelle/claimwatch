'use server';

/**
 * Watchlist server actions: FormData -> zod-validated input -> plan-limit
 * enforcement (packages/core policy via the pipeline manager) -> store.
 * Every outcome returns a serializable state for the form; a limit hit
 * carries the structured LimitHit for the designed upgrade prompt.
 */
import type { LimitHit, PlanId, WatchlistInputIssue } from '@claimwatch/core';
import { splitListField, splitNameListField } from '@claimwatch/core';
import { createWatchlist, updateWatchlist } from '@claimwatch/pipeline';
import { revalidatePath } from 'next/cache';
import { getWorkspaceStore, resolveDemoOrg } from '../../lib/server/workspace';

export type WatchlistFormState =
  | { readonly status: 'idle' }
  | { readonly status: 'saved'; readonly watchlistName: string }
  | { readonly status: 'invalid'; readonly issues: readonly WatchlistInputIssue[] }
  | {
      readonly status: 'limit';
      readonly hit: LimitHit;
      readonly plan: PlanId;
    }
  | { readonly status: 'no-entitlement' };

function formText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

function rawInputFrom(formData: FormData) {
  return {
    name: formText(formData, 'name'),
    claimSpaceDescription: formText(formData, 'claimSpaceDescription'),
    cpcPrefixes: splitListField(formText(formData, 'cpcPrefixes')),
    competitors: splitNameListField(formText(formData, 'competitors')),
  };
}

function toFormState(
  result: Awaited<ReturnType<typeof createWatchlist>>,
): WatchlistFormState {
  switch (result.status) {
    case 'created':
    case 'updated':
      return { status: 'saved', watchlistName: result.watchlist.name };
    case 'invalid':
      return { status: 'invalid', issues: result.issues };
    case 'limit-exceeded':
      return { status: 'limit', hit: result.hit, plan: result.plan };
    case 'no-entitlement':
      return { status: 'no-entitlement' };
  }
}

export async function createWatchlistAction(
  _previous: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const org = resolveDemoOrg(formText(formData, 'org'));
  const store = await getWorkspaceStore();
  const result = await createWatchlist(
    { store, nowIso: new Date().toISOString() },
    org.slug,
    rawInputFrom(formData),
  );
  if (result.status === 'created') revalidatePath('/watchlists');
  return toFormState(result);
}

export async function updateWatchlistAction(
  _previous: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const watchlistId = formText(formData, 'watchlistId');
  const store = await getWorkspaceStore();
  const existing = await store.getWatchlist(watchlistId);
  if (!existing) {
    return {
      status: 'invalid',
      issues: [{ path: 'watchlistId', message: 'watchlist no longer exists' }],
    };
  }
  const result = await updateWatchlist(
    { store, nowIso: new Date().toISOString() },
    watchlistId,
    rawInputFrom(formData),
  );
  if (result.status === 'updated') {
    revalidatePath('/watchlists');
    revalidatePath(`/watchlists/${watchlistId}/edit`);
  }
  return toFormState(result);
}
