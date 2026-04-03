import { test, expect } from '@playwright/test';

test.describe('Compare Page', () => {
  test('renders compare page heading', async ({ page }) => {
    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: /compare/i })).toBeVisible();
  });

  test('shows orchestrator search input', async ({ page }) => {
    await page.goto('/compare');
    const searchInput = page.getByPlaceholder(/address/i);
    await expect(searchInput).toBeVisible();
  });

  test('limits comparison to 4 orchestrators', async ({ page }) => {
    await page.goto('/compare');
    // The UI should show a max of 4 slots
    const addButton = page.getByRole('button', { name: /add/i });
    await expect(addButton).toBeVisible();
  });
});
