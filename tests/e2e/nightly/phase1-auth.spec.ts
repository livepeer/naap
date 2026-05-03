import { test, expect } from '@playwright/test';
import { loginAsE2eUser, resetE2eUser, E2E_USER } from './helpers/auth';
import { api } from './helpers/api';

test.describe('@phase1-auth', () => {
  test.beforeAll(async ({ baseURL }) => {
    await resetE2eUser(baseURL!);
  });

  test('login with valid creds lands on /dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_USER.email);
    await page.fill('input[type="password"]', E2E_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard|\/agentbook/);
    expect(page.url()).toMatch(/\/(dashboard|agentbook)/);
  });

  test('login with bad password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_USER.email);
    await page.fill('input[type="password"]', 'definitely-wrong');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=/invalid|incorrect|wrong/i').first()).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toMatch(/\/login/);
  });

  test('authenticated /agentbook resolves the e2e tenant', async ({ page }) => {
    await loginAsE2eUser(page);
    const overview = await api(page).get('/api/v1/agentbook-core/dashboard/overview');
    expect(overview.status).toBe(200);
    expect(overview.data?.success).toBe(true);
    // brand-new tenants start with isBrandNew: true; the e2e seed creates
    // expenses + invoices, so isBrandNew should be false.
    expect(overview.data?.data?.isBrandNew).toBe(false);
  });

  test('logout clears the session', async ({ page }) => {
    await loginAsE2eUser(page);
    await page.goto('/agentbook');
    // Logout button or link — exact selector depends on the current shell.
    await page.click('button:has-text("Logout"), a:has-text("Logout")').catch(() => {});
    // After logout, a protected route should redirect to /login.
    await page.goto('/agentbook');
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test('unauthenticated visit to /agentbook/tax redirects to /login', async ({ page }) => {
    await page.goto('/agentbook/tax');
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test('refresh after login keeps session', async ({ page }) => {
    await loginAsE2eUser(page);
    await page.goto('/agentbook');
    await page.reload();
    expect(page.url()).toMatch(/\/agentbook/);
  });
});
