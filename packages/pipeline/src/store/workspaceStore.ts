/**
 * Workspace storage port (M3): orgs, subscriptions, managed watchlists.
 *
 * Same repository pattern as SliceStore — MemoryWorkspaceStore backs unit
 * tests and the fixture-driven web app; DrizzleWorkspaceStore (kept out of
 * the barrel, like DrizzleSliceStore) backs the live Postgres path.
 *
 * Watchlists are the product's mutable user state (DESIGN.md: "the only true
 * user-accumulated state") — update is allowed HERE and only here. Claim
 * history tables remain append-only; nothing in this port touches them.
 */
import type { SubscriptionRecord } from '@claimwatch/core';

export interface OrgRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface WatchlistRecord {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly claimSpaceDescription: string;
  readonly cpcPrefixes: readonly string[];
  readonly competitors: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly createdAt: string;
}

export interface WatchlistPatch {
  readonly name: string;
  readonly claimSpaceDescription: string;
  readonly cpcPrefixes: readonly string[];
  readonly competitors: readonly string[];
}

export class WorkspaceNotFoundError extends Error {
  constructor(kind: 'org' | 'watchlist', id: string) {
    super(`${kind} not found: ${id}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export interface WorkspaceStore {
  ensureOrg(org: OrgRecord): Promise<void>;
  getOrg(orgId: string): Promise<OrgRecord | undefined>;
  /** Upserts the single billing row for an org (mutable billing state). */
  putSubscription(record: SubscriptionRecord): Promise<void>;
  getSubscription(orgId: string): Promise<SubscriptionRecord | undefined>;
  createWatchlist(row: WatchlistRecord): Promise<WatchlistRecord>;
  /** Throws WorkspaceNotFoundError for an unknown id. */
  updateWatchlist(id: string, patch: WatchlistPatch): Promise<WatchlistRecord>;
  getWatchlist(id: string): Promise<WatchlistRecord | undefined>;
  /** Ordered by createdAt then id — stable for entitlement partitioning. */
  listWatchlists(orgId: string): Promise<readonly WatchlistRecord[]>;
  countWatchlists(orgId: string): Promise<number>;
}

function byCreationOrder(a: WatchlistRecord, b: WatchlistRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  private readonly orgs = new Map<string, OrgRecord>();
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly watchlists = new Map<string, WatchlistRecord>();

  async ensureOrg(org: OrgRecord): Promise<void> {
    if (!this.orgs.has(org.id)) this.orgs.set(org.id, org);
  }

  async getOrg(orgId: string): Promise<OrgRecord | undefined> {
    return this.orgs.get(orgId);
  }

  async putSubscription(record: SubscriptionRecord): Promise<void> {
    if (!this.orgs.has(record.orgId)) throw new WorkspaceNotFoundError('org', record.orgId);
    this.subscriptions.set(record.orgId, record);
  }

  async getSubscription(orgId: string): Promise<SubscriptionRecord | undefined> {
    return this.subscriptions.get(orgId);
  }

  async createWatchlist(row: WatchlistRecord): Promise<WatchlistRecord> {
    if (!this.orgs.has(row.orgId)) throw new WorkspaceNotFoundError('org', row.orgId);
    if (this.watchlists.has(row.id)) {
      throw new Error(`watchlist id collision: ${row.id}`);
    }
    this.watchlists.set(row.id, row);
    return row;
  }

  async updateWatchlist(id: string, patch: WatchlistPatch): Promise<WatchlistRecord> {
    const existing = this.watchlists.get(id);
    if (!existing) throw new WorkspaceNotFoundError('watchlist', id);
    const updated: WatchlistRecord = { ...existing, ...patch };
    this.watchlists.set(id, updated);
    return updated;
  }

  async getWatchlist(id: string): Promise<WatchlistRecord | undefined> {
    return this.watchlists.get(id);
  }

  async listWatchlists(orgId: string): Promise<readonly WatchlistRecord[]> {
    return [...this.watchlists.values()].filter((row) => row.orgId === orgId).sort(byCreationOrder);
  }

  async countWatchlists(orgId: string): Promise<number> {
    return (await this.listWatchlists(orgId)).length;
  }
}
