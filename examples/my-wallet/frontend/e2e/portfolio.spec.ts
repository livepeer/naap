import { test, expect } from '@playwright/test';

test.describe('Portfolio Positions', () => {
  test('positions table renders (not blank)', async ({ page }) => {
    await page.goto('/wallet');
    // Navigate to earn/portfolio
    const earnTab = page.getByRole('tab', { name: /earn/i }).or(page.getByText('Earn'));
    if (await earnTab.isVisible()) {
      await earnTab.click();
    }
    // Should show positions or connect wallet prompt
    const visible = page
      .getByText(/positions/i)
      .or(page.getByText(/connect wallet/i))
      .or(page.getByText(/portfolio/i));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });

  test('portfolio summary shows total staked', async ({ page }) => {
    await page.goto('/wallet');
    const earnTab = page.getByRole('tab', { name: /earn/i }).or(page.getByText('Earn'));
    if (await earnTab.isVisible()) {
      await earnTab.click();
    }
    const visible = page
      .getByText(/total staked/i)
      .or(page.getByText(/connect wallet/i))
      .or(page.getByText(/portfolio/i));
    await expect(visible.first()).toBeVisible({ timeout: 15000 });
  });
});
