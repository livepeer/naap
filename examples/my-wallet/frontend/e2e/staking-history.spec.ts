import { test, expect } from '@playwright/test';

test.describe('Staking History Tab', () => {
  test('shows staking history content or empty state (not blank)', async ({ page }) => {
    await page.goto('/wallet');
    const reportsTab = page.getByRole('tab', { name: /reports/i }).or(page.getByText('Reports'));
    if (await reportsTab.isVisible()) {
      await reportsTab.click();
    }

    // Look for staking history content or a meaningful empty state
    const content = page
      .getByText('Staking History')
      .or(page.getByText('No staking activity'))
      .or(page.getByText('Connect wallet'));
    await expect(content.first()).toBeVisible({ timeout: 10000 });
  });

  test('P&L summary shows cards', async ({ page }) => {
    await page.goto('/wallet');
    const reportsTab = page.getByRole('tab', { name: /reports/i }).or(page.getByText('Reports'));
    if (await reportsTab.isVisible()) {
      await reportsTab.click();
    }

    // P&L tab or default view should show summary cards
    const pnlTab = page.getByRole('button', { name: /p.?l|profit/i }).or(page.getByText(/P.?L/));
    if (await pnlTab.isVisible()) {
      await pnlTab.click();
    }

    // Should show content (cards or connect wallet prompt)
    const visible = page
      .getByText(/total staked/i)
      .or(page.getByText(/connect wallet/i))
      .or(page.getByText(/no.*data/i));
    await expect(visible.first()).toBeVisible({ timeout: 10000 });
  });
});
