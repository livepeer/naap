import { test, expect } from '@playwright/test';
import { e2eBaseUrl } from './helpers/e2e-base';

/**
 * Google and GitHub OAuth set an httpOnly session cookie and do not populate
 * localStorage until /api/v1/auth/me succeeds on the app origin. These tests
 * guard the regression where /dashboard spun forever (RequireAuth vs middleware loop).
 *
 * Requires E2E_USER_EMAIL / E2E_USER_PASSWORD (same as auth.setup.ts).
 */

async function expectDashboardShell(page: import('@playwright/test').Page) {
  await expect(
    page.getByRole('heading', { name: 'Network Platform', exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('OAuth-equivalent session (httpOnly cookie, no localStorage token)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ mode: 'serial' });

  test('API login: cookie-only context reaches /dashboard without endless loading', async ({
    browser,
  }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    test.skip(!email || !password, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD (see auth.setup.ts)');

    const baseURL = e2eBaseUrl();

    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const loginRes = await context.request.post('/api/v1/auth/login', {
      data: { email, password },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(
      loginRes.ok(),
      `login failed: ${loginRes.status()} ${await loginRes.text().catch(() => '')}`,
    ).toBeTruthy();

    const jar = await context.cookies();
    expect(
      jar.some((c) => c.name === 'naap_auth_token'),
      'login response should set naap_auth_token cookie on the context',
    ).toBeTruthy();

    const page = await context.newPage();
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expectDashboardShell(page);

    await context.close();
  });

  test('UI email login then strip localStorage — /dashboard still loads (OAuth parity)', async ({
    page,
  }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    test.skip(!email || !password, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD (see auth.setup.ts)');

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /Continue with email/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expectDashboardShell(page);

    await page.evaluate(() => {
      localStorage.removeItem('naap_auth_token');
    });

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expectDashboardShell(page);
  });
});
