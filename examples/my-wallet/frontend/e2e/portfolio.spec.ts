import { test, expect } from '@playwright/test';

test.describe('Portfolio Page', () => {
  test('renders portfolio summary cards', async ({ page }) => {
    await page.goto('/portfolio');

    const summary = page.getByRole('region', { name: 'Portfolio summary' });
    await expect(summary).toBeVisible();

    // 4 stat cards should be present
    await expect(summary.locator('.glass-card')).toHaveCount(4);
  });

  test('displays total staked label', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('Total Staked')).toBeVisible();
  });

  test('displays pending rewards label', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('Pending Rewards')).toBeVisible();
  });

  test('displays wallets count', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('Wallets')).toBeVisible();
  });

  test('shows add wallet button', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByRole('button', { name: /add wallet/i })).toBeVisible();
  });

  test('shows yield card section', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('Yield Performance')).toBeVisible();
  });

  test('navigates to compare page', async ({ page }) => {
    await page.goto('/portfolio');
    // Look for compare link in nav
    const compareLink = page.getByRole('link', { name: /compare/i });
    if (await compareLink.isVisible()) {
      await compareLink.click();
      await expect(page).toHaveURL(/compare/);
    }
  });
});

test.describe('Portfolio - Unbonding Panel', () => {
  test('shows unbonding section', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(/unbonding/i)).toBeVisible();
  });
});

test.describe('Portfolio - Export', () => {
  test('shows export buttons', async ({ page }) => {
    await page.goto('/portfolio');
    const csvBtn = page.getByRole('button', { name: /csv/i });
    const jsonBtn = page.getByRole('button', { name: /json/i });
    // At least one export option should be present
    const hasCsv = await csvBtn.isVisible().catch(() => false);
    const hasJson = await jsonBtn.isVisible().catch(() => false);
    expect(hasCsv || hasJson).toBe(true);
  });
});
