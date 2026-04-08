import { test, expect } from '@playwright/test';
import { assertCommunityApiHealthy } from './helpers/plugin-preflight';

test.describe('Community hub plugin @pre-release', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await assertCommunityApiHealthy(request, baseURL!);
  }, { timeout: 120_000 });

  test('loads Community Hub and sort controls', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/forum');
    await expect(page.getByRole('heading', { name: 'Community Hub', exact: true })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole('button', { name: 'New Post' })).toBeVisible();
    await expect(page.getByPlaceholder('Search discussions...')).toBeVisible();
    await page.getByRole('button', { name: 'Popular' }).click();
    await expect(page.getByRole('button', { name: 'Popular' })).toBeVisible();

    if (consoleErrors.length > 0) {
      console.log('[community-hub] console errors:', consoleErrors);
    }
  });
});
