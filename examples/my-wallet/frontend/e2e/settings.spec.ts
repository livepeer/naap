import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test('renders settings heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });

  test('shows USD price toggle', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/USD/i)).toBeVisible();
  });
});
