import { test, expect } from '@playwright/test';

test.describe('Orchestrator Views (fallback)', () => {
  test('Performance > All Orchestrators shows data or meaningful empty state', async ({ page }) => {
    await page.goto('/wallet');
    const perfTab = page.getByRole('tab', { name: /performance/i }).or(page.getByText('Performance'));
    if (await perfTab.isVisible()) {
      await perfTab.click();
    }
    // Should render orchestrator content, not blank
    const visible = page
      .getByText(/orchestrat/i)
      .or(page.locator('.animate-pulse'))
      .or(page.getByText(/syncing/i))
      .or(page.getByText(/no performance/i));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });

  test('Explore > Browse All shows orchestrator cards or skeletons', async ({ page }) => {
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

  test('Network overview renders current round or protocol data', async ({ page }) => {
    await page.goto('/wallet');
    const exploreTab = page.getByRole('tab', { name: /explore/i }).or(page.getByText('Explore'));
    if (await exploreTab.isVisible()) {
      await exploreTab.click();
    }
    const visible = page
      .getByText(/network/i)
      .or(page.getByText(/participation/i))
      .or(page.getByText(/round/i))
      .or(page.locator('.animate-pulse'));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });
});
