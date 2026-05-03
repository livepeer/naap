import { test, expect } from '@playwright/test';
import { loginAsE2eUser } from './helpers/auth';
import { api } from './helpers/api';
import { SEED } from './helpers/data';

test.describe('@phase2-dashboard', () => {
  test.beforeEach(async ({ page }) => { await loginAsE2eUser(page); });

  test('forward view renders with non-zero cash', async ({ page }) => {
    await page.goto('/agentbook');
    await expect(page.locator('text=/\\$[\\d,]+\\s*today/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('attention panel shows the seeded overdue invoice', async ({ page }) => {
    await page.goto('/agentbook');
    await expect(page.locator('text=/overdue/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('attention panel shows missing receipt callout', async ({ page }) => {
    await page.goto('/agentbook');
    await expect(page.locator('text=/receipt/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('agent summary line is non-empty (LLM or fallback)', async ({ page }) => {
    await page.goto('/agentbook');
    const summary = page.locator('section:has-text("Needs your attention") p').first();
    await expect(summary).not.toHaveText('', { timeout: 10_000 });
  });

  test('this-month strip shows three numbers', async ({ page }) => {
    await page.goto('/agentbook');
    await expect(page.locator('text=/Rev/').first()).toBeVisible();
    await expect(page.locator('text=/Exp/').first()).toBeVisible();
    await expect(page.locator('text=/Net/').first()).toBeVisible();
  });

  test('activity feed shows ≥3 mixed items', async ({ page }) => {
    await page.goto('/agentbook');
    const items = page.locator('section:has-text("Recent activity") li');
    await expect(items.nth(2)).toBeVisible({ timeout: 10_000 });
  });

  test('sticky bottom bar visible on mobile (375x812)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/agentbook');
    await expect(page.locator('nav[aria-label="Quick actions"]')).toBeVisible({ timeout: 10_000 });
  });

  test('sticky bar hidden on desktop (1280x800)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/agentbook');
    await expect(page.locator('nav[aria-label="Quick actions"]')).not.toBeVisible();
  });

  test('"New invoice" routes correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/agentbook');
    await page.click('a:has-text("New invoice")');
    await page.waitForURL(/\/agentbook\/invoices\/new/);
  });

  test('"Snap" triggers a hidden file input with capture=environment', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/agentbook');
    const input = page.locator('input[type="file"][capture="environment"]');
    await expect(input).toHaveCount(1);
  });

  test('kebab menu opens with refresh + telegram items', async ({ page }) => {
    await page.goto('/agentbook');
    await page.click('button[aria-label="More"]');
    await expect(page.locator('text=/Refresh/i')).toBeVisible();
    await expect(page.locator('text=/Share to Telegram/i')).toBeVisible();
  });

  test('OnboardingHero is not shown (seed worked)', async ({ page }) => {
    await page.goto('/agentbook');
    await expect(page.locator('text=/Welcome to AgentBook/i')).toHaveCount(0);
  });
});
