import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';
const adminAuthFile = 'playwright/.auth/admin.json';

/**
 * Authentication setup for E2E tests
 * This creates storage states that can be reused across tests
 */
setup('authenticate', async ({ page }) => {
  // For now, just create an empty auth state
  // In Phase 3, this will be updated to handle actual authentication

  // Navigate to a page that doesn't require auth
  await page.goto('/');

  // Wait for the page to load
  await expect(page).toHaveTitle(/NaaP/);

  // Save the storage state
  await page.context().storageState({ path: authFile });
});

/**
 * Admin authentication setup.
 * Uses ADMIN_EMAIL / ADMIN_PASSWORD env vars to log in as an admin user.
 * Falls back to regular auth state if admin credentials are not configured.
 */
setup('authenticate as admin', async ({ page }) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    await page.goto('/login');
    await page.fill('input[name="email"], input[type="email"]', adminEmail);
    await page.fill('input[name="password"], input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|admin)/, { timeout: 15000 });
  } else {
    await page.goto('/');
    await expect(page).toHaveTitle(/NaaP/);
  }

  await page.context().storageState({ path: adminAuthFile });
});
