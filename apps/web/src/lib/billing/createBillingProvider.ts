/**
 * Billing provider factory — the config gate for the billing seam.
 *
 * STRIPE_SECRET_KEY absent (every dev, test, and CI environment in this
 * repo): the deterministic MockBillingProvider. Present: the Stripe adapter.
 * The key is read from the environment only — never hardcoded, never
 * defaulted, never logged.
 */
import type { BillingProvider } from '@claimwatch/core';
import { MockBillingProvider } from '@claimwatch/core';
import { StripeBillingProvider } from './stripeProvider';

type EnvShape = Readonly<Record<string, string | undefined>>;

export function createBillingProvider(
  env: EnvShape,
  clock: () => string = () => new Date().toISOString(),
): BillingProvider {
  const secretKey = env['STRIPE_SECRET_KEY']?.trim();
  if (!secretKey) {
    return new MockBillingProvider(clock);
  }
  return new StripeBillingProvider({ secretKey, clock });
}
