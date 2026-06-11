/**
 * Subscription lifecycle state machine — pure functions over an immutable
 * SubscriptionRecord. Every billing backend (deterministic mock now, Stripe
 * behind the BillingProvider seam later) drives THESE transitions so the
 * entitlement semantics cannot drift between providers.
 *
 * PRORATION-FREE SEMANTICS (documented policy, enforced here):
 * - Upgrades take effect immediately. The current period keeps its paid-through
 *   date; no mid-cycle charge, no credit. The new rate bills from next renewal.
 * - Downgrades are scheduled: `pendingPlanId` is set and applied at the next
 *   renewal boundary. Entitlements keep the higher tier until then.
 * - Payment failure opens a 14-day grace window with full entitlements;
 *   recovery returns to active; expiry lapses the subscription (entitlements
 *   revoked, data retained — nothing is ever deleted).
 */
import type { PlanId } from './plans';
import { PLAN_ORDER } from './plans';

export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'grace' | 'lapsed' | 'canceled';

export const GRACE_PERIOD_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionRecord {
  readonly orgId: string;
  readonly planId: PlanId;
  readonly billingCycle: BillingCycle;
  readonly status: SubscriptionStatus;
  /** Paid-through date; renewals extend it by one cycle. */
  readonly currentPeriodEnd: string;
  /** Set while status === 'grace'; payment must recover before this instant. */
  readonly graceUntil: string | null;
  /** Scheduled downgrade target, applied at the next renewal boundary. */
  readonly pendingPlanId: PlanId | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly provider: 'mock' | 'stripe';
  readonly providerRef: string | null;
  readonly updatedAt: string;
}

export class SubscriptionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionTransitionError';
  }
}

function addCycle(fromIso: string, cycle: BillingCycle): string {
  const from = new Date(fromIso);
  const next = new Date(from);
  if (cycle === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  }
  return next.toISOString();
}

export interface StartSubscriptionInput {
  readonly orgId: string;
  readonly planId: PlanId;
  readonly billingCycle: BillingCycle;
  readonly nowIso: string;
  readonly provider: 'mock' | 'stripe';
  readonly providerRef?: string;
}

/** Creates a fresh active subscription paid through one full cycle. */
export function startSubscription(input: StartSubscriptionInput): SubscriptionRecord {
  return {
    orgId: input.orgId,
    planId: input.planId,
    billingCycle: input.billingCycle,
    status: 'active',
    currentPeriodEnd: addCycle(input.nowIso, input.billingCycle),
    graceUntil: null,
    pendingPlanId: null,
    cancelAtPeriodEnd: false,
    provider: input.provider,
    providerRef: input.providerRef ?? null,
    updatedAt: input.nowIso,
  };
}

/**
 * Successful renewal: extends the period one cycle from the previous
 * paid-through date and applies any scheduled downgrade or cancellation.
 */
export function renewSubscription(record: SubscriptionRecord, nowIso: string): SubscriptionRecord {
  if (record.status === 'lapsed' || record.status === 'canceled') {
    throw new SubscriptionTransitionError(`cannot renew a ${record.status} subscription`);
  }
  if (record.cancelAtPeriodEnd) {
    return { ...record, status: 'canceled', graceUntil: null, updatedAt: nowIso };
  }
  return {
    ...record,
    planId: record.pendingPlanId ?? record.planId,
    pendingPlanId: null,
    status: 'active',
    graceUntil: null,
    currentPeriodEnd: addCycle(record.currentPeriodEnd, record.billingCycle),
    updatedAt: nowIso,
  };
}

/** Payment failure: active -> grace with a 14-day recovery window. */
export function recordPaymentFailure(
  record: SubscriptionRecord,
  nowIso: string,
): SubscriptionRecord {
  if (record.status !== 'active') {
    throw new SubscriptionTransitionError(
      `payment failure only transitions an active subscription (status: ${record.status})`,
    );
  }
  const graceUntil = new Date(new Date(nowIso).getTime() + GRACE_PERIOD_DAYS * DAY_MS).toISOString();
  return { ...record, status: 'grace', graceUntil, updatedAt: nowIso };
}

/** Payment recovered inside the grace window: grace -> active. */
export function recordPaymentRecovery(
  record: SubscriptionRecord,
  nowIso: string,
): SubscriptionRecord {
  if (record.status !== 'grace') {
    throw new SubscriptionTransitionError(
      `payment recovery only applies in grace (status: ${record.status})`,
    );
  }
  return { ...record, status: 'active', graceUntil: null, updatedAt: nowIso };
}

/**
 * Clock tick: a grace window past its deadline lapses the subscription.
 * Idempotent — safe to call on every state read.
 */
export function expireGraceIfDue(record: SubscriptionRecord, nowIso: string): SubscriptionRecord {
  if (record.status !== 'grace' || record.graceUntil === null) return record;
  if (nowIso < record.graceUntil) return record;
  return { ...record, status: 'lapsed', graceUntil: null, updatedAt: nowIso };
}

/** Cancellation is end-of-period (proration-free): flags, never refunds. */
export function cancelSubscription(record: SubscriptionRecord, nowIso: string): SubscriptionRecord {
  if (record.status === 'lapsed' || record.status === 'canceled') {
    throw new SubscriptionTransitionError(`cannot cancel a ${record.status} subscription`);
  }
  return { ...record, cancelAtPeriodEnd: true, updatedAt: nowIso };
}

export type PlanChangeKind = 'upgrade' | 'downgrade-scheduled' | 'no-change';

export interface PlanChangeResult {
  readonly kind: PlanChangeKind;
  readonly record: SubscriptionRecord;
}

/**
 * Proration-free plan change: upgrades apply immediately (paid-through date
 * untouched), downgrades are scheduled for the renewal boundary.
 */
export function changePlan(
  record: SubscriptionRecord,
  targetPlanId: PlanId,
  nowIso: string,
): PlanChangeResult {
  if (record.status === 'lapsed' || record.status === 'canceled') {
    throw new SubscriptionTransitionError(
      `cannot change plan on a ${record.status} subscription — resubscribe instead`,
    );
  }
  if (targetPlanId === record.planId) {
    // Re-choosing the current plan clears any scheduled downgrade.
    if (record.pendingPlanId !== null) {
      return { kind: 'no-change', record: { ...record, pendingPlanId: null, updatedAt: nowIso } };
    }
    return { kind: 'no-change', record };
  }
  const isUpgrade = PLAN_ORDER.indexOf(targetPlanId) > PLAN_ORDER.indexOf(record.planId);
  if (isUpgrade) {
    return {
      kind: 'upgrade',
      record: { ...record, planId: targetPlanId, pendingPlanId: null, updatedAt: nowIso },
    };
  }
  return {
    kind: 'downgrade-scheduled',
    record: { ...record, pendingPlanId: targetPlanId, updatedAt: nowIso },
  };
}

/**
 * The single entitlement question: which plan's limits/features does this org
 * hold right now? Grace keeps full entitlements; lapsed/canceled/no
 * subscription holds none (read-only archive, nothing deleted).
 */
export function entitledPlan(
  record: SubscriptionRecord | undefined,
  nowIso: string,
): PlanId | null {
  if (!record) return null;
  const current = expireGraceIfDue(record, nowIso);
  if (current.status === 'active' || current.status === 'grace') return current.planId;
  return null;
}
