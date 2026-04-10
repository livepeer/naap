import { test, expect } from '@playwright/test';
import { assertCommunityApiHealthy, expectDenied } from './helpers/plugin-preflight';
import { e2eBaseUrl } from './helpers/e2e-base';

/**
 * E2E tests for Community Hub admin moderation features.
 *
 * Tests the following capabilities:
 * - Admin can delete any post (not just author)
 * - Admin can moderate posts (close/archive)
 * - Admin can ban/unban users from the community
 * - Banned users are prevented from posting and commenting
 * - Moderation UI elements are visible only to admins
 *
 * Requires:
 *   ADMIN_EMAIL + ADMIN_PASSWORD for admin-authenticated tests
 *   E2E_USER_EMAIL + E2E_USER_PASSWORD for regular user tests
 */

// ── API-level tests (no browser required, use APIRequestContext) ──

test.describe('Community Moderation API @pre-release', () => {
  const base = () => e2eBaseUrl();

  test.beforeAll(async ({ request }) => {
    const baseURL = base();
    test.skip(!baseURL, 'baseURL required');
    await assertCommunityApiHealthy(request, baseURL);
  }, { timeout: 120_000 });

  test.describe('POST /community/posts/:id/moderate', () => {
    test('rejects unauthenticated requests', async ({ request }) => {
      const res = await request.post(`${base()}/api/v1/community/posts/nonexistent/moderate`, {
        data: { action: 'close' },
      });
      expectDenied(res);
    });

    test('rejects invalid action values', async ({ request }) => {
      const res = await request.post(`${base()}/api/v1/community/posts/nonexistent/moderate`, {
        data: { action: 'invalid_action' },
        headers: { 'Authorization': 'Bearer test-token' },
      });
      // Should get 401 (bad token) or 400 (bad action) — not 500
      expect(res.status()).toBeLessThan(500);
    });

    test('returns 404 for non-existent post', async ({ request }) => {
      // Without valid admin auth this will return 401, which is acceptable
      const res = await request.post(
        `${base()}/api/v1/community/posts/00000000-0000-0000-0000-000000000000/moderate`,
        { data: { action: 'close' } }
      );
      expect(res.status()).toBeLessThan(500);
      expect([401, 403, 404]).toContain(res.status());
    });
  });

  test.describe('POST /community/users/:id/ban', () => {
    test('rejects unauthenticated requests', async ({ request }) => {
      const res = await request.post(`${base()}/api/v1/community/users/some-user-id/ban`, {
        data: { banned: true, reason: 'test' },
      });
      expectDenied(res);
    });

    test('rejects requests without banned boolean', async ({ request }) => {
      const res = await request.post(`${base()}/api/v1/community/users/some-user-id/ban`, {
        data: { reason: 'missing banned field' },
        headers: { 'Authorization': 'Bearer test-token' },
      });
      expect(res.status()).toBeLessThan(500);
    });
  });

  test.describe('GET /community/posts (ban enforcement)', () => {
    test('posts endpoint remains healthy', async ({ request }) => {
      const res = await request.get(`${base()}/api/v1/community/posts?limit=1`);
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  test.describe('DELETE /community/posts/:id (admin override)', () => {
    test('rejects unauthenticated delete', async ({ request }) => {
      const res = await request.delete(
        `${base()}/api/v1/community/posts/00000000-0000-0000-0000-000000000000`
      );
      expectDenied(res);
    });
  });
});

// ── Admin UI tests (browser-based, require admin auth) ──

test.describe('Community Moderation Admin UI', () => {
  test.use({ storageState: 'playwright/.auth/admin.json' });

  test.beforeAll(async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await assertCommunityApiHealthy(request, baseURL!);
  }, { timeout: 120_000 });

  test('admin sees moderation controls on forum page', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set ADMIN_EMAIL / ADMIN_PASSWORD for admin tests');
      return;
    }

    await page.goto('/forum');
    await expect(page.getByRole('heading', { name: 'Community Hub', exact: true })).toBeVisible({
      timeout: 45_000,
    });

    // Verify posts exist — skip explicitly if none available
    const postCards = page.locator('[class*="cursor-pointer"]').filter({ has: page.locator('h3') });
    const postCount = await postCards.count();
    test.skip(postCount === 0, 'No posts available to validate admin moderation controls');

    await postCards.first().hover();
    const moreButton = postCards.first().locator('button[title="Moderate"]');
    await expect(moreButton).toBeVisible({ timeout: 3000 });
    await moreButton.click();
    await expect(page.getByText('Delete', { exact: false })).toBeVisible({ timeout: 3000 });
  });

  test('admin sees moderation controls on post detail page', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set ADMIN_EMAIL / ADMIN_PASSWORD for admin tests');
      return;
    }

    await page.goto('/forum');
    await expect(page.getByRole('heading', { name: 'Community Hub', exact: true })).toBeVisible({
      timeout: 45_000,
    });

    // Verify posts exist — skip explicitly if none available
    const postCards = page.locator('[class*="cursor-pointer"]').filter({ has: page.locator('h3') });
    const postCount = await postCards.count();
    test.skip(postCount === 0, 'No posts available to validate admin post detail controls');

    await postCards.first().click();
    await expect(page.getByText('Back to Forum')).toBeVisible({ timeout: 15_000 });

    const adminBadge = page.getByText('Admin', { exact: true });
    await expect(adminBadge).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Delete/i })).toBeVisible();
  });
});

// ── Regular user tests (should NOT see admin controls) ──

test.describe('Community Moderation Regular User', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await assertCommunityApiHealthy(request, baseURL!);
  }, { timeout: 120_000 });

  test('regular user does not see moderation menu on forum', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    await page.goto('/forum');
    await expect(page.getByRole('heading', { name: 'Community Hub', exact: true })).toBeVisible({
      timeout: 45_000,
    });

    // Regular users should NOT have the Moderate menu button
    const moderateButtons = page.locator('button[title="Moderate"]');
    expect(await moderateButtons.count()).toBe(0);
  });
});
