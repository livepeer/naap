import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginWithEmailPassword } from './helpers/auth-e2e';

const authFile = 'playwright/.auth/user.json';
const adminAuthFile = 'playwright/.auth/admin.json';

/**
 * Authentication setup for E2E tests
 * When E2E_USER_EMAIL + E2E_USER_PASSWORD are set, performs a real login so
 * storageState includes a session (required for production plugin/team tests).
 * Otherwise saves anonymous state from the public landing page.
 */
setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL?.trim();
  const password = process.env.E2E_USER_PASSWORD;

  if (email && password) {
    await loginWithEmailPassword(page, email, password);
  } else {
    await page.goto('/');
    await expect(page).toHaveTitle(/Livepeer|Dashboard/);
  }
  await page.context().storageState({ path: authFile });
});

/**
 * Admin authentication setup.
 * Uses ADMIN_EMAIL / ADMIN_PASSWORD env vars to log in as an admin user.
 * When credentials are missing, creates a minimal empty storage state so that
 * test files referencing admin.json don't crash with a file-not-found error
 * (they will still fail/skip on the first admin-only page redirect).
 */
setup('authenticate as admin', async ({ page }) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    fs.mkdirSync(path.dirname(adminAuthFile), { recursive: true });
    fs.writeFileSync(adminAuthFile, JSON.stringify({ cookies: [], origins: [] }));
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
