import { recordPaymentFailure, startSubscription } from '@claimwatch/core';
import { describe, expect, test } from 'vitest';
import { createBillingProvider } from './createBillingProvider';
import { applyStripeWebhookEvent } from './stripeProvider';

const NOW = '2026-06-01T00:00:00.000Z';
const clock = () => NOW;

describe('createBillingProvider (config gate)', () => {
  test('without STRIPE_SECRET_KEY the deterministic mock carries billing', () => {
    expect(createBillingProvider({}, clock).providerName).toBe('mock');
    expect(createBillingProvider({ STRIPE_SECRET_KEY: undefined }, clock).providerName).toBe(
      'mock',
    );
  });

  test('a blank key degrades gracefully to the mock, never a half-configured adapter', () => {
    expect(createBillingProvider({ STRIPE_SECRET_KEY: '   ' }, clock).providerName).toBe('mock');
  });

  test('a present key selects the Stripe adapter (no network at construction)', () => {
    const provider = createBillingProvider(
      { STRIPE_SECRET_KEY: 'sk_test_placeholder_for_unit_test' },
      clock,
    );
    expect(provider.providerName).toBe('stripe');
  });

  test('the mock provider is immediately usable end to end', async () => {
    const billing = createBillingProvider({}, clock);
    const record = await billing.subscribe({
      orgId: 'org-1',
      planId: 'startup',
      billingCycle: 'annual',
    });
    expect(record.status).toBe('active');
    expect(record.provider).toBe('mock');
  });
});

describe('applyStripeWebhookEvent (pure translation, zero network)', () => {
  const active = startSubscription({
    orgId: 'org-1',
    planId: 'pro',
    billingCycle: 'monthly',
    nowIso: NOW,
    provider: 'stripe',
    providerRef: 'sub_stub',
  });

  test('invoice.paid renews through the core state machine', () => {
    const renewed = applyStripeWebhookEvent(active, 'invoice.paid', '2026-07-01T00:00:00.000Z');
    expect(renewed.status).toBe('active');
    expect(renewed.currentPeriodEnd).toBe('2026-08-01T00:00:00.000Z');
  });

  test('invoice.payment_failed opens the grace window', () => {
    const grace = applyStripeWebhookEvent(active, 'invoice.payment_failed', NOW);
    expect(grace.status).toBe('grace');
    expect(grace.graceUntil).toBe('2026-06-15T00:00:00.000Z');
  });

  test('a retry success recovers from grace', () => {
    const grace = recordPaymentFailure(active, NOW);
    const recovered = applyStripeWebhookEvent(
      grace,
      'invoice.payment_succeeded_after_retry',
      '2026-06-05T00:00:00.000Z',
    );
    expect(recovered.status).toBe('active');
  });

  test('subscription deletion cancels', () => {
    const canceled = applyStripeWebhookEvent(active, 'customer.subscription.deleted', NOW);
    expect(canceled.status).toBe('canceled');
  });
});
