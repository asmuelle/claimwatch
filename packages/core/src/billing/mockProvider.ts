/**
 * Deterministic in-memory BillingProvider: drives the pure subscription
 * state machine with an injected clock. Carries every billing test and the
 * dev/e2e path — byte-identical behavior across runs, zero IO.
 */
import type { BillingProvider, SubscribeInput } from './provider';
import { UnknownSubscriptionError } from './provider';
import type { PlanId } from './plans';
import type { SubscriptionRecord } from './subscription';
import {
  cancelSubscription,
  changePlan,
  expireGraceIfDue,
  recordPaymentFailure,
  recordPaymentRecovery,
  renewSubscription,
  startSubscription,
} from './subscription';

export class MockBillingProvider implements BillingProvider {
  readonly providerName = 'mock' as const;
  private readonly records = new Map<string, SubscriptionRecord>();

  /** Injected clock keeps every transition timestamp deterministic. */
  constructor(private readonly clock: () => string) {}

  async subscribe(input: SubscribeInput): Promise<SubscriptionRecord> {
    const record = startSubscription({
      orgId: input.orgId,
      planId: input.planId,
      billingCycle: input.billingCycle,
      nowIso: this.clock(),
      provider: 'mock',
      providerRef: `mock_sub_${input.orgId}`,
    });
    this.records.set(input.orgId, record);
    return record;
  }

  async cancel(orgId: string): Promise<SubscriptionRecord> {
    return this.transition(orgId, (record, now) => cancelSubscription(record, now));
  }

  async renew(orgId: string): Promise<SubscriptionRecord> {
    return this.transition(orgId, (record, now) => renewSubscription(record, now));
  }

  async changePlan(orgId: string, planId: PlanId): Promise<SubscriptionRecord> {
    return this.transition(orgId, (record, now) => changePlan(record, planId, now).record);
  }

  async reportPaymentFailure(orgId: string): Promise<SubscriptionRecord> {
    return this.transition(orgId, (record, now) => recordPaymentFailure(record, now));
  }

  async reportPaymentRecovery(orgId: string): Promise<SubscriptionRecord> {
    return this.transition(orgId, (record, now) => recordPaymentRecovery(record, now));
  }

  /** Reads apply the grace-expiry tick so a lapsed org never keeps entitlements. */
  async getSubscription(orgId: string): Promise<SubscriptionRecord | undefined> {
    const record = this.records.get(orgId);
    if (!record) return undefined;
    const current = expireGraceIfDue(record, this.clock());
    if (current !== record) this.records.set(orgId, current);
    return current;
  }

  private transition(
    orgId: string,
    apply: (record: SubscriptionRecord, nowIso: string) => SubscriptionRecord,
  ): SubscriptionRecord {
    const record = this.records.get(orgId);
    if (!record) throw new UnknownSubscriptionError(orgId);
    const now = this.clock();
    const next = apply(expireGraceIfDue(record, now), now);
    this.records.set(orgId, next);
    return next;
  }
}
