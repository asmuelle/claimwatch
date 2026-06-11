/**
 * M2 smoke spec over the M1 fixture slice (DESIGN.md flow 5, the trust loop):
 * the brief page renders the deterministic blackline, every verify link lands
 * on the canonical claim record it cites, and the screening ledger shows the
 * downranked document instead of silently dropping it.
 */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the brief page boots with a validated brief', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('ClaimWatch');
  await expect(page.locator('.validated-stamp')).toContainText('citations validated');
  await expect(page.locator('.blocked-stamp')).toHaveCount(0);
});

test('the brief renders the hand-verified blackline with del/ins semantics', async ({ page }) => {
  const blackline = page.locator('.brief-item .blackline').first();
  await expect(blackline).toBeVisible();

  // Family 18123456 claim 1 (golden fixture): "scores;" struck, the
  // load-balancing limitation inserted.
  await expect(blackline.locator('del')).toContainText('scores;');
  await expect(blackline.locator('ins')).toContainText(
    'wherein the gating network is trained with an auxiliary load-balancing loss',
  );
});

test('verify links anchor to the canonical claim record they cite', async ({ page }) => {
  const verifyLinks = page.locator('a.verify-link');
  expect(await verifyLinks.count()).toBeGreaterThan(0);

  // First brief item cites US-12790314-B2 claim 1.
  const firstLink = verifyLinks.first();
  const href = await firstLink.getAttribute('href');
  expect(href).toBe('#US-12790314-B2-claim-1');

  await firstLink.click();
  expect(new URL(page.url()).hash).toBe('#US-12790314-B2-claim-1');

  const target = page.locator('[id="US-12790314-B2-claim-1"]');
  await expect(target).toBeVisible();
  await expect(target.locator('dt')).toContainText('Claim 1');
  await expect(target.locator('dt')).toContainText('US-12790314-B2');

  // Every verify link on the page resolves to an existing anchor.
  const hrefs = await verifyLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute('href') ?? ''),
  );
  for (const anchor of hrefs) {
    expect(anchor).toMatch(/^#/);
    await expect(page.locator(`[id="${anchor.slice(1)}"]`)).toHaveCount(1);
  }
});

test('the screening ledger shows the downranked document, never deletes it', async ({ page }) => {
  const ledger = page.locator('section[aria-labelledby="screening-heading"]');
  await expect(ledger.locator('tbody tr')).toHaveCount(5);

  const downranked = ledger.locator('tr[data-decision="downrank"]');
  await expect(downranked).toHaveCount(1);
  await expect(downranked).toContainText('US-12790902-B2');
  await expect(downranked).toContainText('out-of-scope');
  await expect(downranked).toContainText('downrank');
});

test('coverage disclosure and counsel disclaimer ride on the page', async ({ page }) => {
  const footer = page.locator('footer');
  await expect(footer).toContainText('Not watched:');
  await expect(footer).toContainText('EPO');
  await expect(footer).toContainText(/not legal advice/i);
});
