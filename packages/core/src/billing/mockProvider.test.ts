import { describe, expect, test } from 'vitest';
import { MockBillingProvider } from './mockProvider';
import { UnknownSubscriptionError } from './provider';
import { entitledPlan } from './subscription';

/** Mutable test clock so each test scripts its own deterministic timeline. */
function makeClock(startIso: string) {
  let now = startIso;
  return {
    clock: () => now,
    set: (iso: string) => {
      now = iso;
    },
  };
}

describe('MockBillingProvider', () => {
  test('subscribe -> active subscription with the requested plan and cycle', async () => {
    const { clock } = makeClock('2026-06-01T00:00:00.000Z');
    const billing = new MockBillingProvider(clock);

    const record = await billing.subscribe({
      orgId: 'org-1',
      planId: 'pro',
      billingCycle: 'annual',
    });

    expect(record.status).toBe('active');
    expect(record.planId).toBe('pro');
    expect(record.currentPeriodEnd).toBe('2027-06-01T00:00:00.000Z');
    expect(await billing.getSubscription('org-1')).toEqual(record);
  });

  test('cancel flags end-of-period and the next renewal closes the subscription', async () => {
    const timeline = makeClock('2026-06-01T00:00:00.000Z');
    const billing = new MockBillingProvider(timeline.clock);
    await billing.subscribe({ orgId: 'org-1', planId: 'startup', billingCycle: 'monthly' });

    const canceled = await billing.cancel('org-1');
    expect(canceled.cancelAtPeriodEnd).toBe(true);
    expect(canceled.status).toBe('active'); // still paid through the period

    timeline.set('2026-07-01T00:00:00.000Z');
    const closed = await billing.renew('org-1');
    expect(closed.status).toBe('canceled');
  });

  test('payment failure -> grace -> unrecovered -> lapsed, end to end', async () => {
    const timeline = makeClock('2026-06-01T00:00:00.000Z');
    const billing = new MockBillingProvider(timeline.clock);
    await billing.subscribe({ orgId: 'org-1', planId: 'pro', billingCycle: 'monthly' });

    const grace = await billing.reportPaymentFailure('org-1');
    expect(grace.status).toBe('grace');
    expect(grace.graceUntil).toBe('2026-06-15T00:00:00.000Z');
    // Entitlements survive the grace window (recall is the product; never
    // silently stop watching while the card retries).
    expect(entitledPlan(grace, timeline.clock())).toBe('pro');

    timeline.set('2026-06-20T00:00:00.000Z');
    const lapsed = await billing.getSubscription('org-1');
    expect(lapsed?.status).toBe('lapsed');
    expect(entitledPlan(lapsed, timeline.clock())).toBeNull();
  });

  test('payment failure recovered inside the window returns to active', async () => {
    const timeline = makeClock('2026-06-01T00:00:00.000Z');
    const billing = new MockBillingProvider(timeline.clock);
    await billing.subscribe({ orgId: 'org-1', planId: 'startup', billingCycle: 'monthly' });
    await billing.reportPaymentFailure('org-1');

    timeline.set('2026-06-10T00:00:00.000Z');
    const recovered = await billing.reportPaymentRecovery('org-1');
    expect(recovered.status).toBe('active');
    expect(recovered.graceUntil).toBeNull();
  });

  test('upgrade applies immediately, downgrade waits for the boundary', async () => {
    const timeline = makeClock('2026-06-01T00:00:00.000Z');
    const billing = new MockBillingProvider(timeline.clock);
    await billing.subscribe({ orgId: 'org-1', planId: 'startup', billingCycle: 'monthly' });

    const upgraded = await billing.changePlan('org-1', 'firm');
    expect(upgraded.planId).toBe('firm');

    const scheduled = await billing.changePlan('org-1', 'pro');
    expect(scheduled.planId).toBe('firm');
    expect(scheduled.pendingPlanId).toBe('pro');

    timeline.set('2026-07-01T00:00:00.000Z');
    const renewed = await billing.renew('org-1');
    expect(renewed.planId).toBe('pro');
    expect(renewed.pendingPlanId).toBeNull();
  });

  test('operations on an unknown org throw, never invent state', async () => {
    const billing = new MockBillingProvider(() => '2026-06-01T00:00:00.000Z');
    await expect(billing.renew('org-missing')).rejects.toThrow(UnknownSubscriptionError);
    expect(await billing.getSubscription('org-missing')).toBeUndefined();
  });

  test('identical scripts produce identical records (deterministic)', async () => {
    async function run() {
      const timeline = makeClock('2026-06-01T00:00:00.000Z');
      const billing = new MockBillingProvider(timeline.clock);
      await billing.subscribe({ orgId: 'org-1', planId: 'pro', billingCycle: 'monthly' });
      await billing.reportPaymentFailure('org-1');
      timeline.set('2026-06-08T00:00:00.000Z');
      await billing.reportPaymentRecovery('org-1');
      return billing.getSubscription('org-1');
    }
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });
});
