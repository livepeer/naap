import { test, expect } from '@playwright/test';

/**
 * Lightweight reachability checks for production (or any PLAYWRIGHT_BASE_URL).
 */
test.describe('Production smoke @pre-release', () => {
  test('landing responds', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.ok()).toBeTruthy();
  });

  test('login page responds (or redirects to dashboard when already signed in)', async ({ page }) => {
    const res = await page.goto('/login');
    expect(res?.ok()).toBeTruthy();
    const signIn = page.getByRole('heading', { name: /Sign in to your account/i });
    const dashboard = page.locator('h1').filter({ hasText: 'Network Platform' });
    await expect(signIn.or(dashboard)).toBeVisible({ timeout: 10_000 });
  });

  test('docs responds', async ({ page }) => {
    const res = await page.goto('/docs');
    expect(res?.ok()).toBeTruthy();
  });
});
