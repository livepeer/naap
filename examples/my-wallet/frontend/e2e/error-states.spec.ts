import { test, expect } from '@playwright/test';

test.describe('Error States', () => {
  test('Performance tab does not show blank — shows data or empty state', async ({ page }) => {
    await page.goto('/wallet');
    const perfTab = page.getByRole('tab', { name: /performance/i }).or(page.getByText('Performance'));
    if (await perfTab.isVisible()) {
      await perfTab.click();
    }
    // Should show either data, loading skeleton, or meaningful empty state
    const visible = page
      .getByText(/orchestrat/i)
      .or(page.locator('.animate-pulse'))
      .or(page.getByText(/no performance/i))
      .or(page.getByText(/failed to load/i));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });

  test('Explore tab does not show blank', async ({ page }) => {
    await page.goto('/wallet');
    const exploreTab = page.getByRole('tab', { name: /explore/i }).or(page.getByText('Explore'));
    if (await exploreTab.isVisible()) {
      await exploreTab.click();
    }
    const visible = page
      .getByText(/orchestrat/i)
      .or(page.locator('.animate-pulse'))
      .or(page.getByText(/failed to load/i));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });

  test('Reports tab does not show blank', async ({ page }) => {
    await page.goto('/wallet');
    const reportsTab = page.getByRole('tab', { name: /reports/i }).or(page.getByText('Reports'));
    if (await reportsTab.isVisible()) {
      await reportsTab.click();
    }
    const visible = page
      .getByText(/staking/i)
      .or(page.getByText(/connect wallet/i))
      .or(page.getByText(/error/i))
      .or(page.locator('.animate-pulse'));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });
});
