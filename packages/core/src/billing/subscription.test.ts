import { describe, expect, test } from 'vitest';
import {
  GRACE_PERIOD_DAYS,
  SubscriptionTransitionError,
  cancelSubscription,
  changePlan,
  entitledPlan,
  expireGraceIfDue,
  recordPaymentFailure,
  recordPaymentRecovery,
  renewSubscription,
  startSubscription,
} from './subscription';

const NOW = '2026-06-01T00:00:00.000Z';

function activeStartup() {
  return startSubscription({
    orgId: 'org-1',
    planId: 'startup',
    billingCycle: 'monthly',
    nowIso: NOW,
    provider: 'mock',
  });
}

describe('startSubscription', () => {
  test('creates an active subscription paid through one monthly cycle', () => {
    const record = activeStartup();
    expect(record.status).toBe('active');
    expect(record.currentPeriodEnd).toBe('2026-07-01T00:00:00.000Z');
    expect(record.graceUntil).toBeNull();
    expect(record.pendingPlanId).toBeNull();
  });

  test('annual billing pays through a full year', () => {
    const record = startSubscription({
      orgId: 'org-1',
      planId: 'pro',
      billingCycle: 'annual',
      nowIso: NOW,
      provider: 'mock',
    });
    expect(record.currentPeriodEnd).toBe('2027-06-01T00:00:00.000Z');
  });
});

describe('renewSubscription', () => {
  test('extends the paid-through date by one cycle from the previous boundary', () => {
    const renewed = renewSubscription(activeStartup(), '2026-07-01T00:00:00.000Z');
    expect(renewed.currentPeriodEnd).toBe('2026-08-01T00:00:00.000Z');
    expect(renewed.status).toBe('active');
  });

  test('applies a scheduled downgrade at the renewal boundary', () => {
    const pro = startSubscription({
      orgId: 'org-1',
      planId: 'pro',
      billingCycle: 'monthly',
      nowIso: NOW,
      provider: 'mock',
    });
    const { record: scheduled } = changePlan(pro, 'startup', NOW);
    expect(scheduled.planId).toBe('pro'); // still entitled until the boundary
    const renewed = renewSubscription(scheduled, '2026-07-01T00:00:00.000Z');
    expect(renewed.planId).toBe('startup');
    expect(renewed.pendingPlanId).toBeNull();
  });

  test('a cancel-at-period-end subscription renews into canceled', () => {
    const canceled = renewSubscription(
      cancelSubscription(activeStartup(), NOW),
      '2026-07-01T00:00:00.000Z',
    );
    expect(canceled.status).toBe('canceled');
  });

  test('renewing a lapsed subscription is a transition error', () => {
    const lapsed = { ...activeStartup(), status: 'lapsed' as const };
    expect(() => renewSubscription(lapsed, NOW)).toThrow(SubscriptionTransitionError);
  });
});

describe('payment failure -> grace -> downgrade state machine', () => {
  test('payment failure opens a 14-day grace window', () => {
    const grace = recordPaymentFailure(activeStartup(), NOW);
    expect(grace.status).toBe('grace');
    expect(grace.graceUntil).toBe('2026-06-15T00:00:00.000Z');
    expect(GRACE_PERIOD_DAYS).toBe(14);
  });

  test('recovery inside the window returns to active', () => {
    const grace = recordPaymentFailure(activeStartup(), NOW);
    const recovered = recordPaymentRecovery(grace, '2026-06-05T00:00:00.000Z');
    expect(recovered.status).toBe('active');
    expect(recovered.graceUntil).toBeNull();
  });

  test('the window expiring lapses the subscription', () => {
    const grace = recordPaymentFailure(activeStartup(), NOW);
    const lapsed = expireGraceIfDue(grace, '2026-06-15T00:00:00.000Z');
    expect(lapsed.status).toBe('lapsed');
    expect(lapsed.graceUntil).toBeNull();
  });

  test('before the deadline the grace record is untouched (idempotent tick)', () => {
    const grace = recordPaymentFailure(activeStartup(), NOW);
    expect(expireGraceIfDue(grace, '2026-06-14T23:59:59.000Z')).toBe(grace);
  });

  test('failure on a non-active subscription is a transition error', () => {
    const grace = recordPaymentFailure(activeStartup(), NOW);
    expect(() => recordPaymentFailure(grace, NOW)).toThrow(SubscriptionTransitionError);
  });

  test('recovery outside grace is a transition error', () => {
    expect(() => recordPaymentRecovery(activeStartup(), NOW)).toThrow(SubscriptionTransitionError);
  });
});

describe('changePlan (proration-free)', () => {
  test('an upgrade applies immediately and leaves the paid-through date alone', () => {
    const before = activeStartup();
    const { kind, record } = changePlan(before, 'pro', '2026-06-10T00:00:00.000Z');
    expect(kind).toBe('upgrade');
    expect(record.planId).toBe('pro');
    expect(record.currentPeriodEnd).toBe(before.currentPeriodEnd);
  });

  test('a downgrade is scheduled, not applied', () => {
    const pro = startSubscription({
      orgId: 'org-1',
      planId: 'firm',
      billingCycle: 'monthly',
      nowIso: NOW,
      provider: 'mock',
    });
    const { kind, record } = changePlan(pro, 'pro', NOW);
    expect(kind).toBe('downgrade-scheduled');
    expect(record.planId).toBe('firm');
    expect(record.pendingPlanId).toBe('pro');
  });

  test('re-choosing the current plan clears a scheduled downgrade', () => {
    const firm = startSubscription({
      orgId: 'org-1',
      planId: 'firm',
      billingCycle: 'monthly',
      nowIso: NOW,
      provider: 'mock',
    });
    const { record: scheduled } = changePlan(firm, 'pro', NOW);
    const { kind, record } = changePlan(scheduled, 'firm', NOW);
    expect(kind).toBe('no-change');
    expect(record.pendingPlanId).toBeNull();
  });

  test('changing plan on a canceled subscription is a transition error', () => {
    const canceled = { ...activeStartup(), status: 'canceled' as const };
    expect(() => changePlan(canceled, 'pro', NOW)).toThrow(SubscriptionTransitionError);
  });
});

describe('entitledPlan', () => {
  test('active and grace subscriptions hold their plan entitlements', () => {
    const active = activeStartup();
    expect(entitledPlan(active, NOW)).toBe('startup');
    const grace = recordPaymentFailure(active, NOW);
    expect(entitledPlan(grace, '2026-06-10T00:00:00.000Z')).toBe('startup');
  });

  test('an expired grace window evaluates as no entitlements', () => {
    const grace = recordPaymentFailure(activeStartup(), NOW);
    expect(entitledPlan(grace, '2026-07-01T00:00:00.000Z')).toBeNull();
  });

  test('no subscription means no entitlements', () => {
    expect(entitledPlan(undefined, NOW)).toBeNull();
  });
});
