/**
 * The billing seam. ALL payment backends sit behind this interface:
 * the deterministic MockBillingProvider carries every test, and the Stripe
 * adapter (apps/web, config-gated on STRIPE_SECRET_KEY) implements the same
 * surface for the live path. No real payment credentials exist in this repo;
 * nothing in core or the tests ever talks to a network.
 */
import type { PlanId } from './plans';
import type { BillingCycle, SubscriptionRecord } from './subscription';

export interface SubscribeInput {
  readonly orgId: string;
  readonly planId: PlanId;
  readonly billingCycle: BillingCycle;
}

export interface BillingProvider {
  /** Which backend this is — surfaced in ops tooling, never branched on. */
  readonly providerName: 'mock' | 'stripe';
  subscribe(input: SubscribeInput): Promise<SubscriptionRecord>;
  /** End-of-period cancellation (proration-free; never refunds mid-cycle). */
  cancel(orgId: string): Promise<SubscriptionRecord>;
  /** Successful renewal at the period boundary. */
  renew(orgId: string): Promise<SubscriptionRecord>;
  /** Upgrade now / downgrade at boundary (see subscription.ts semantics). */
  changePlan(orgId: string, planId: PlanId): Promise<SubscriptionRecord>;
  reportPaymentFailure(orgId: string): Promise<SubscriptionRecord>;
  reportPaymentRecovery(orgId: string): Promise<SubscriptionRecord>;
  getSubscription(orgId: string): Promise<SubscriptionRecord | undefined>;
}

export class UnknownSubscriptionError extends Error {
  constructor(orgId: string) {
    super(`no subscription exists for org ${orgId}`);
    this.name = 'UnknownSubscriptionError';
  }
}
