/**
 * M3 watchlist management flows: create within limits, hit the plan limit,
 * see the designed upgrade prompt (never an error dump), edit in place.
 *
 * Parallel-safety: each test owns its demo org. `startup-demo` is mutated
 * only by the create test; `startup-full` ships seeded at its 1-watchlist
 * Startup limit so the limit test never depends on another test's writes.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const DESCRIPTION =
  'Mixture-of-experts routing, attention cache compression and quantization for embedded inference.';

async function fillWatchlistForm(page: Page, name: string): Promise<void> {
  await page.fill('#name', name);
  await page.fill('#claimSpaceDescription', DESCRIPTION);
  await page.fill('#cpcPrefixes', 'G06N, G06F17/16');
  await page.fill('#competitors', 'Vektor Cognition, Inc.\nTessellate Compute Ltd.');
}

test('create a watchlist, then hit the Startup limit and get the upgrade prompt', async ({
  page,
}) => {
  await page.goto('/watchlists?org=startup-demo');
  await expect(page.locator('h1')).toHaveText('ClaimWatch');
  await expect(page.locator('.usage-line')).toHaveText('0 of 1 watchlist in use');

  // Create the first (and only allowed) Startup watchlist.
  await fillWatchlistForm(page, 'Efficient neural inference');
  await page.getByRole('button', { name: 'Create watchlist' }).click();
  await expect(page.locator('.form-saved')).toContainText('Efficient neural inference');
  await expect(
    page.locator('.watchlist-card h3', { hasText: 'Efficient neural inference' }),
  ).toBeVisible();
  await expect(page.locator('.usage-line')).toHaveText('1 of 1 watchlist in use');

  // The second create hits the limit: designed upgrade prompt, no error dump.
  await fillWatchlistForm(page, 'A second watchlist');
  await page.getByRole('button', { name: 'Create watchlist' }).click();
  const prompt = page.locator('.upgrade-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('The Startup plan includes 1 watchlist');
  await expect(prompt.locator('.tier[data-suggested]')).toContainText('Pro');
  await expect(prompt.locator('.tier[data-suggested]')).toContainText('$399/mo');
  await expect(prompt).toContainText('2 months free billed annually');

  // Nothing was persisted past the limit.
  await expect(page.locator('.watchlist-card')).toHaveCount(1);
});

test('an org seeded at its limit gets the upgrade prompt on any create attempt', async ({
  page,
}) => {
  await page.goto('/watchlists?org=startup-full');
  await expect(page.locator('.usage-line')).toHaveText('1 of 1 watchlist in use');

  await fillWatchlistForm(page, 'One past the limit');
  await page.getByRole('button', { name: 'Create watchlist' }).click();

  const prompt = page.locator('.upgrade-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt.locator('.tier[data-current]')).toContainText('Startup');
  await expect(prompt.locator('.tier[data-suggested]')).toContainText('Pro');
  await expect(page.locator('.watchlist-card')).toHaveCount(1);
});

test('a watchlist can be edited within plan limits', async ({ page }) => {
  await page.goto('/watchlists?org=startup-full');
  await page.locator('.watchlist-card .edit-link').first().click();
  await expect(page.locator('h2')).toHaveText('Edit watchlist');

  const renamed = 'Warehouse robotics grasping (rev. 2)';
  await page.fill('#name', renamed);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.form-saved')).toContainText(renamed);

  await page.goto('/watchlists?org=startup-full');
  await expect(page.locator('.watchlist-card h3', { hasText: renamed })).toBeVisible();
});

test('Pro workspaces show the wider allowance', async ({ page }) => {
  await page.goto('/watchlists?org=pro-demo');
  await expect(page.locator('.plan-line')).toContainText('Pro plan — $399/mo');
  await expect(page.locator('.usage-line')).toHaveText('0 of 5 watchlists in use');
});
