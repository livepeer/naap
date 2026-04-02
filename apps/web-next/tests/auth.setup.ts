import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';
const adminAuthFile = 'playwright/.auth/admin.json';

/**
 * Authentication setup for E2E tests
 * This creates storage states that can be reused across tests
 */
setup('authenticate', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Livepeer|Dashboard/);
  await page.context().storageState({ path: authFile });
});

/**
 * Admin authentication setup.
 * Uses ADMIN_EMAIL / ADMIN_PASSWORD env vars to log in as an admin user.
 * Skips when admin credentials are not configured so that tests using the
 * admin storage state don't silently run against an unauthenticated session.
 */
setup('authenticate as admin', async ({ page }) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    setup.skip();
    return;
  }

  await page.goto('/login');
  await page.fill('input[name="email"], input[type="email"]', adminEmail);
  await page.fill('input[name="password"], input[type="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 15000 });
  await page.context().storageState({ path: adminAuthFile });
});
