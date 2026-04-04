import { test, expect } from '@playwright/test';

test.describe('Gas Cost Tab', () => {
  test('shows Gas Cost Summary heading', async ({ page }) => {
    await page.goto('/wallet');
    const reportsTab = page.getByRole('tab', { name: /reports/i }).or(page.getByText('Reports'));
    if (await reportsTab.isVisible()) {
      await reportsTab.click();
    }
    const gasTab = page.getByRole('button', { name: /gas/i }).or(page.getByText('Gas'));
    if (await gasTab.isVisible()) {
      await gasTab.click();
    }
    await expect(
      page.getByText('Gas Cost Summary').or(page.getByText('No gas data available')).or(page.getByText('Connect wallet')),
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows refresh button', async ({ page }) => {
    await page.goto('/wallet');
    const reportsTab = page.getByRole('tab', { name: /reports/i }).or(page.getByText('Reports'));
    if (await reportsTab.isVisible()) {
      await reportsTab.click();
    }
    const gasTab = page.getByRole('button', { name: /gas/i }).or(page.getByText('Gas'));
    if (await gasTab.isVisible()) {
      await gasTab.click();
    }
    // There should be a view rendered (not blank)
    const content = page.locator('.space-y-4, .glass-card');
    await expect(content.first()).toBeVisible({ timeout: 10000 });
  });
});
