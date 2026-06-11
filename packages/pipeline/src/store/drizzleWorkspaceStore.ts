/**
 * Drizzle/Postgres implementation of the WorkspaceStore port.
 *
 * Deliberately NOT exported from the pipeline barrel (same rule as
 * DrizzleSliceStore): apps/web must never bundle the Postgres driver.
 * DB-aware composition imports this module directly.
 *
 * Mirrors MemoryWorkspaceStore semantics exactly: same ordering, same
 * not-found errors, same record shapes (ISO strings at the boundary).
 */
import type { SubscriptionRecord } from '@claimwatch/core';
import { org, subscription, watchlist } from '@claimwatch/db';
import type { Db } from '@claimwatch/db';
import { asc, count, eq } from 'drizzle-orm';
import type {
  OrgRecord,
  WatchlistPatch,
  WatchlistRecord,
  WorkspaceStore,
} from './workspaceStore';
import { WorkspaceNotFoundError } from './workspaceStore';

type WatchlistRow = typeof watchlist.$inferSelect;
type SubscriptionRow = typeof subscription.$inferSelect;

function toWatchlistRecord(row: WatchlistRow): WatchlistRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    claimSpaceDescription: row.claimSpaceDescription,
    cpcPrefixes: row.cpcPrefixes,
    competitors: row.namedAssignees,
    jurisdictions: row.jurisdictions,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    orgId: row.orgId,
    planId: row.planId,
    billingCycle: row.billingCycle,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    graceUntil: row.graceUntil?.toISOString() ?? null,
    pendingPlanId: row.pendingPlanId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    provider: row.provider,
    providerRef: row.providerRef,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleWorkspaceStore implements WorkspaceStore {
  constructor(private readonly db: Db) {}

  async ensureOrg(record: OrgRecord): Promise<void> {
    await this.db
      .insert(org)
      .values({ id: record.id, name: record.name, createdAt: new Date(record.createdAt) })
      .onConflictDoNothing({ target: org.id });
  }

  async getOrg(orgId: string): Promise<OrgRecord | undefined> {
    const [row] = await this.db.select().from(org).where(eq(org.id, orgId)).limit(1);
    if (!row) return undefined;
    return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
  }

  async putSubscription(record: SubscriptionRecord): Promise<void> {
    const values = {
      orgId: record.orgId,
      planId: record.planId,
      billingCycle: record.billingCycle,
      status: record.status,
      currentPeriodEnd: new Date(record.currentPeriodEnd),
      graceUntil: record.graceUntil === null ? null : new Date(record.graceUntil),
      pendingPlanId: record.pendingPlanId,
      cancelAtPeriodEnd: record.cancelAtPeriodEnd,
      provider: record.provider,
      providerRef: record.providerRef,
      updatedAt: new Date(record.updatedAt),
    };
    await this.db
      .insert(subscription)
      .values(values)
      .onConflictDoUpdate({ target: subscription.orgId, set: values });
  }

  async getSubscription(orgId: string): Promise<SubscriptionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(subscription)
      .where(eq(subscription.orgId, orgId))
      .limit(1);
    return row ? toSubscriptionRecord(row) : undefined;
  }

  async createWatchlist(row: WatchlistRecord): Promise<WatchlistRecord> {
    await this.db.insert(watchlist).values({
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      claimSpaceDescription: row.claimSpaceDescription,
      cpcPrefixes: row.cpcPrefixes,
      namedAssignees: row.competitors,
      jurisdictions: row.jurisdictions,
      createdAt: new Date(row.createdAt),
    });
    return row;
  }

  async updateWatchlist(id: string, patch: WatchlistPatch): Promise<WatchlistRecord> {
    const [updated] = await this.db
      .update(watchlist)
      .set({
        name: patch.name,
        claimSpaceDescription: patch.claimSpaceDescription,
        cpcPrefixes: patch.cpcPrefixes,
        namedAssignees: patch.competitors,
      })
      .where(eq(watchlist.id, id))
      .returning();
    if (!updated) throw new WorkspaceNotFoundError('watchlist', id);
    return toWatchlistRecord(updated);
  }

  async getWatchlist(id: string): Promise<WatchlistRecord | undefined> {
    const [row] = await this.db.select().from(watchlist).where(eq(watchlist.id, id)).limit(1);
    return row ? toWatchlistRecord(row) : undefined;
  }

  async listWatchlists(orgId: string): Promise<readonly WatchlistRecord[]> {
    const rows = await this.db
      .select()
      .from(watchlist)
      .where(eq(watchlist.orgId, orgId))
      .orderBy(asc(watchlist.createdAt), asc(watchlist.id));
    return rows.map(toWatchlistRecord);
  }

  async countWatchlists(orgId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(watchlist)
      .where(eq(watchlist.orgId, orgId));
    return row?.value ?? 0;
  }
}
