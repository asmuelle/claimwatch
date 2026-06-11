/**
 * M3 counsel-ready export gating: Startup is prompted to upgrade, Pro gets
 * the branded print artifact, Firm gets the white-label variant with zero
 * ClaimWatch marks. Read-only over the seeded demo orgs — parallel-safe.
 */
import { expect, test } from '@playwright/test';

test('Startup orgs are gated with the designed upgrade prompt', async ({ page }) => {
  await page.goto('/export?org=startup-demo');

  await expect(page.locator('.upgrade-prompt')).toBeVisible();
  await expect(page.locator('.upgrade-prompt')).toContainText(
    'Counsel-ready export is a Pro feature',
  );
  await expect(page.locator('.upgrade-prompt .tier[data-suggested]')).toContainText('Pro');
  await expect(page.locator('.export-brief')).toHaveCount(0);
});

test('the default export route (no org) is the gated Startup demo', async ({ page }) => {
  await page.goto('/export');
  await expect(page.locator('.upgrade-prompt')).toBeVisible();
  await expect(page.locator('.export-brief')).toHaveCount(0);
});

test('Pro orgs get the counsel-ready artifact with pinned citations', async ({ page }) => {
  await page.goto('/export?org=pro-demo');

  const artifact = page.locator('.export-brief');
  await expect(artifact).toBeVisible();
  await expect(artifact).toHaveAttribute('data-variant', 'counsel');
  await expect(artifact.locator('.export-brand')).toHaveText('ClaimWatch');
  await expect(artifact.locator('.validated-stamp')).toContainText('citations validated');

  // The deterministic blackline rides along (prosecution-blackline direction).
  await expect(artifact.locator('.blackline del').first()).toBeVisible();
  await expect(artifact.locator('.blackline ins').first()).toBeVisible();

  // Every synthesized sentence carries its pinned citation reference.
  const sentenceCount = await artifact.locator('.export-sentence').count();
  expect(sentenceCount).toBeGreaterThan(0);
  expect(
    await artifact.locator('.export-sentence .export-citation').count(),
  ).toBeGreaterThanOrEqual(sentenceCount);

  // Counsel disclaimer and coverage disclosure are non-negotiable.
  await expect(artifact.locator('.export-footer')).toContainText(/not legal advice/i);
  await expect(artifact.locator('.export-footer')).toContainText('Not watched:');
});

test('Firm orgs get the white-label variant with zero product branding', async ({ page }) => {
  await page.goto('/export?org=firm-demo');

  const artifact = page.locator('.export-brief');
  await expect(artifact).toBeVisible();
  await expect(artifact).toHaveAttribute('data-variant', 'white-label');
  await expect(artifact.locator('.export-brand')).toHaveText('Harrow & Vance LLP');

  // No ClaimWatch branding anywhere in the rendered page body.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.toLowerCase()).not.toContain('claimwatch');

  // The counsel disclaimer survives re-branding (invariant 4).
  await expect(artifact.locator('.export-footer')).toContainText(/not legal advice/i);
  await expect(artifact.locator('.export-footer')).toContainText('Harrow & Vance LLP');
});

test('print media hides the site chrome — the artifact is the deliverable', async ({ page }) => {
  await page.goto('/export?org=pro-demo');
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('.site-nav')).toBeHidden();
  await expect(page.locator('.export-brief')).toBeVisible();
});
