import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard|\/agentbook/);
}

test.describe('Dashboard — Maya happy path', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('forward view + attention + this-month + activity render; sticky bar visible', async ({ page }) => {
    await login(page, 'maya@agentbook.test', 'agentbook123');
    await page.goto(`${BASE}/agentbook`);

    // Forward view present (a $... headline)
    await expect(page.locator('text=/\\$[\\d,]+\\s*(today)?/i').first()).toBeVisible({ timeout: 10_000 });

    // Attention panel header
    await expect(page.locator('text=/Needs your attention/i')).toBeVisible();

    // This-month strip
    await expect(page.locator('text=/This month/i')).toBeVisible();

    // Activity feed
    await expect(page.locator('text=/Recent activity/i')).toBeVisible();

    // Sticky bottom bar at mobile width
    await expect(page.locator('nav[aria-label="Quick actions"]')).toBeVisible();

    // New invoice button routes correctly
    await page.click('a:has-text("New invoice")');
    await page.waitForURL(/\/agentbook\/invoices\/new/);
  });
});

test.describe('Dashboard — empty tenant onboarding', () => {
  test('shows three-step onboarding when brand new', async ({ page }) => {
    const fresh = process.env.E2E_FRESH_USER_EMAIL;
    const freshPw = process.env.E2E_FRESH_USER_PASSWORD;
    test.skip(!fresh || !freshPw, 'No fresh test user available — set E2E_FRESH_USER_EMAIL/PASSWORD');

    await login(page, fresh!, freshPw!);
    await page.goto(`${BASE}/agentbook`);
    await expect(page.locator('text=/Welcome to AgentBook/i')).toBeVisible();
    await expect(page.locator('text=/Link bank account/i')).toBeVisible();
    await expect(page.locator('text=/Add first invoice/i')).toBeVisible();
    await expect(page.locator('text=/Snap a receipt/i')).toBeVisible();
  });
});
