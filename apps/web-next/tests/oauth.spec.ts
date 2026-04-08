import { test, expect } from '@playwright/test';

/**
 * OAuth provider redirects are flaky in CI (Google/GitHub bot detection).
 * Run explicitly: `RUN_OAUTH_E2E=1 npx playwright test oauth.spec.ts`
 * Default `npx playwright test` skips these when RUN_OAUTH_E2E is unset.
 * In CI, tests matching @oauth are also excluded via playwright.config.ts grepInvert.
 */
test.describe('OAuth entrypoints @oauth', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(({ }, testInfo) => {
    test.skip(
      !process.env.RUN_OAUTH_E2E,
      'Set RUN_OAUTH_E2E=1 to run OAuth redirect checks (see tests/E2E-OAUTH-MANUAL.md)',
    );
  });

  test('Google button navigates toward Google OAuth', async ({ page }) => {
    await page.goto('/login');
    const btn = page.getByRole('button', { name: 'Google' });
    await expect(btn).toBeEnabled();
    const nav = page.waitForURL(/google\.com|accounts\.google\./i, { timeout: 20_000 });
    await Promise.all([nav, btn.click()]);
    expect(page.url()).toMatch(/google/i);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
  });

  test('GitHub button navigates toward GitHub OAuth', async ({ page }) => {
    await page.goto('/login');
    const btn = page.getByRole('button', { name: 'GitHub' });
    await expect(btn).toBeEnabled();
    const nav = page.waitForURL(/github\.com/i, { timeout: 20_000 });
    await Promise.all([nav, btn.click()]);
    expect(page.url()).toMatch(/github/i);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
  });

  test('Register: Google button navigates toward Google OAuth', async ({ page }) => {
    await page.goto('/register');
    const btn = page.getByRole('button', { name: 'Google' });
    await expect(btn).toBeEnabled();
    const nav = page.waitForURL(/google\.com|accounts\.google\./i, { timeout: 20_000 });
    await Promise.all([nav, btn.click()]);
    expect(page.url()).toMatch(/google/i);
  });

  test('Register: GitHub button navigates toward GitHub OAuth', async ({ page }) => {
    await page.goto('/register');
    const btn = page.getByRole('button', { name: 'GitHub' });
    await expect(btn).toBeEnabled();
    const nav = page.waitForURL(/github\.com/i, { timeout: 20_000 });
    await Promise.all([nav, btn.click()]);
    expect(page.url()).toMatch(/github/i);
  });
});
