/**
 * Stripe adapter for the BillingProvider seam (M3 live path, config-gated).
 *
 * No real Stripe credentials exist in this repo: the adapter is constructed
 * ONLY when STRIPE_SECRET_KEY is present in the environment (see
 * createBillingProvider). Every entitlement decision still flows through the
 * pure state machine in @claimwatch/core — Stripe is a payment event source,
 * never a second source of truth for plan semantics.
 *
 * Renewals and payment failures are WEBHOOK-driven in Stripe (invoice.paid /
 * invoice.payment_failed); the pure translation lives in
 * applyStripeWebhookEvent so it is testable with zero network.
 */
import type { BillingProvider, PlanId, SubscribeInput, SubscriptionRecord } from '@claimwatch/core';
import {
  UnknownSubscriptionError,
  cancelSubscription,
  changePlan,
  recordPaymentFailure,
  recordPaymentRecovery,
  renewSubscription,
  startSubscription,
} from '@claimwatch/core';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/** Stable lookup keys; created in the Stripe dashboard for the live account. */
export function stripePriceLookupKey(planId: PlanId, cycle: 'monthly' | 'annual'): string {
  return `claimwatch_${planId}_${cycle}`;
}

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Stripe API error (${status}): ${message}`);
    this.name = 'StripeApiError';
  }
}

export type StripeBillingEventType =
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.payment_succeeded_after_retry'
  | 'customer.subscription.deleted';

/**
 * Pure webhook translation: Stripe lifecycle events -> core state machine
 * transitions. The webhook route (live wiring) verifies the signature with
 * STRIPE_WEBHOOK_SECRET, loads the org's SubscriptionRecord, applies this,
 * and persists the result.
 */
export function applyStripeWebhookEvent(
  record: SubscriptionRecord,
  eventType: StripeBillingEventType,
  nowIso: string,
): SubscriptionRecord {
  switch (eventType) {
    case 'invoice.paid':
      return renewSubscription(record, nowIso);
    case 'invoice.payment_failed':
      return recordPaymentFailure(record, nowIso);
    case 'invoice.payment_succeeded_after_retry':
      return recordPaymentRecovery(record, nowIso);
    case 'customer.subscription.deleted':
      return { ...record, status: 'canceled', graceUntil: null, updatedAt: nowIso };
  }
}

export interface StripeBillingProviderOptions {
  readonly secretKey: string;
  /** Injected clock keeps record timestamps deterministic in tests. */
  readonly clock: () => string;
  /** Injectable for tests; defaults to global fetch. Never called in CI. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Skeleton adapter: compiles, holds the request plumbing and the org ->
 * Stripe subscription mapping, and drives the same core transitions as the
 * mock. Live wiring (checkout session UI, webhook endpoint, durable mapping
 * storage) lands when a real test-mode key exists.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly providerName = 'stripe' as const;
  /** TODO(live wiring): persist this mapping; in-memory is dev-only. */
  private readonly records = new Map<string, SubscriptionRecord>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: StripeBillingProviderOptions) {
    if (options.secretKey.trim() === '') {
      throw new Error('StripeBillingProvider requires a non-empty secret key');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async subscribe(input: SubscribeInput): Promise<SubscriptionRecord> {
    const response = await this.request('/subscriptions', {
      'metadata[orgId]': input.orgId,
      'items[0][price_data][lookup_key]': stripePriceLookupKey(input.planId, input.billingCycle),
      'payment_behavior': 'default_incomplete',
    });
    const record = startSubscription({
      orgId: input.orgId,
      planId: input.planId,
      billingCycle: input.billingCycle,
      nowIso: this.options.clock(),
      provider: 'stripe',
      providerRef: typeof response.id === 'string' ? response.id : undefined,
    });
    this.records.set(input.orgId, record);
    return record;
  }

  async cancel(orgId: string): Promise<SubscriptionRecord> {
    const record = this.require(orgId);
    await this.request(`/subscriptions/${record.providerRef}`, {
      'cancel_at_period_end': 'true',
    });
    return this.store(cancelSubscription(record, this.options.clock()));
  }

  async renew(orgId: string): Promise<SubscriptionRecord> {
    // Stripe renewals arrive via invoice.paid webhooks, not client calls;
    // this direct path exists for parity with the mock in dev tooling.
    return this.store(renewSubscription(this.require(orgId), this.options.clock()));
  }

  async changePlan(orgId: string, planId: PlanId): Promise<SubscriptionRecord> {
    const record = this.require(orgId);
    await this.request(`/subscriptions/${record.providerRef}`, {
      'items[0][price_data][lookup_key]': stripePriceLookupKey(planId, record.billingCycle),
      'proration_behavior': 'none', // proration-free semantics (core policy)
    });
    return this.store(changePlan(record, planId, this.options.clock()).record);
  }

  async reportPaymentFailure(orgId: string): Promise<SubscriptionRecord> {
    return this.store(
      applyStripeWebhookEvent(this.require(orgId), 'invoice.payment_failed', this.options.clock()),
    );
  }

  async reportPaymentRecovery(orgId: string): Promise<SubscriptionRecord> {
    return this.store(
      applyStripeWebhookEvent(
        this.require(orgId),
        'invoice.payment_succeeded_after_retry',
        this.options.clock(),
      ),
    );
  }

  async getSubscription(orgId: string): Promise<SubscriptionRecord | undefined> {
    return this.records.get(orgId);
  }

  private require(orgId: string): SubscriptionRecord {
    const record = this.records.get(orgId);
    if (!record) throw new UnknownSubscriptionError(orgId);
    return record;
  }

  private store(record: SubscriptionRecord): SubscriptionRecord {
    this.records.set(record.orgId, record);
    return record;
  }

  private async request(
    path: string,
    params: Readonly<Record<string, string>>,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!response.ok) {
      throw new StripeApiError(response.status, await response.text());
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
