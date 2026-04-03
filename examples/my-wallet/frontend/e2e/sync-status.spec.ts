import { test, expect } from '@playwright/test';

test.describe('Sync Status UI', () => {
  test('views do not show blank — they show data, loading, or sync banner', async ({ page }) => {
    await page.goto('/wallet');

    // Performance tab
    const perfTab = page.getByRole('tab', { name: /performance/i }).or(page.getByText('Performance'));
    if (await perfTab.isVisible()) {
      await perfTab.click();
    }

    const visible = page
      .getByText(/orchestrat/i)
      .or(page.getByText(/syncing/i))
      .or(page.locator('.animate-pulse'))
      .or(page.getByText(/no performance/i))
      .or(page.getByText(/failed/i));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });

  test('explore tab shows data or sync banner', async ({ page }) => {
    await page.goto('/wallet');
    const exploreTab = page.getByRole('tab', { name: /explore/i }).or(page.getByText('Explore'));
    if (await exploreTab.isVisible()) {
      await exploreTab.click();
    }

    const visible = page
      .getByText(/orchestrat/i)
      .or(page.getByText(/syncing/i))
      .or(page.locator('.animate-pulse'))
      .or(page.getByText(/failed/i));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });
});
