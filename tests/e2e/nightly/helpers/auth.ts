import type { Page } from '@playwright/test';

export const E2E_USER = {
  email: process.env.E2E_USER_EMAIL || 'e2e@agentbook.test',
  password: process.env.E2E_USER_PASSWORD || 'e2e-nightly-2026',
};

/**
 * Log in as the dedicated nightly e2e user. After this returns, the page
 * has a valid session cookie and is on /dashboard.
 */
export async function loginAsE2eUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', E2E_USER.email);
  await page.fill('input[type="password"]', E2E_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard|\/agentbook/, { timeout: 15_000 });
}

/**
 * Resets the e2e user via the internal endpoint. Returns false if the
 * endpoint is not enabled (no E2E_RESET_TOKEN secret).
 *
 * NOTE: route path is /api/v1/e2e-test/reset-e2e-user — NOT /__test/...
 * because Next.js App Router excludes underscore-prefixed folders from
 * routing.
 */
export async function resetE2eUser(baseURL: string): Promise<boolean> {
  const token = process.env.E2E_RESET_TOKEN;
  if (!token) return false;
  const res = await fetch(`${baseURL}/api/v1/e2e-test/reset-e2e-user`, {
    method: 'POST',
    headers: { 'x-e2e-reset-token': token },
  });
  return res.ok;
}
