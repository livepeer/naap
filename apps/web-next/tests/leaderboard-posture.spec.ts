import { test, expect } from '@playwright/test';

/**
 * E2E tests for the orchestrator-leaderboard admin-default posture.
 *
 * Validates the six gaps fixed in PR #213:
 *   1. Public plans visible to all signed-in users
 *   2. Non-admins cannot mutate public plans
 *   3. Admin-only GET routes return 403 for non-admins
 *   4. Discovery Plans page loads for users
 *   5. Dataset Settings panel hidden for non-admins
 *   6. Seed Demo button hidden for non-admins
 *
 * Requires E2E_USER_EMAIL + E2E_USER_PASSWORD for non-admin user,
 * and optionally ADMIN_EMAIL + ADMIN_PASSWORD for admin.
 *
 * Tag: @pre-release
 */

const PREVIEW_URL = process.env.PLAYWRIGHT_BASE_URL || '';

const isLiveMode = () =>
  !!(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);

// ---------------------------------------------------------------------------
// API-level tests (use cookie-based auth from storageState)
// ---------------------------------------------------------------------------

test.describe('Leaderboard Posture — API (live) @pre-release', () => {
  test.skip(() => !isLiveMode(), 'Skipping — set E2E_USER_EMAIL/PASSWORD');

  test('GET /plans returns public default plans for non-admin user', async ({ request }) => {
    const res = await request.get('/api/v1/orchestrator-leaderboard/plans');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    const plans = body.data?.plans ?? [];
    expect(plans.length).toBeGreaterThanOrEqual(4);

    const publicPlans = plans.filter(
      (p: { visibility?: string; billingPlanId?: string }) =>
        p.visibility === 'public' || p.billingPlanId?.startsWith('naap-default-'),
    );
    expect(publicPlans.length).toBeGreaterThanOrEqual(4);

    const expectedSlugs = [
      'naap-default-high-perf-video',
      'naap-default-budget-image',
      'naap-default-balanced-stream',
      'naap-default-max-avail',
    ];
    for (const slug of expectedSlugs) {
      const match = publicPlans.find(
        (p: { billingPlanId?: string }) => p.billingPlanId === slug,
      );
      expect(match, `Expected default plan: ${slug}`).toBeTruthy();
    }
  });

  test('GET /plans/:id returns a public plan for non-admin', async ({ request }) => {
    const listRes = await request.get('/api/v1/orchestrator-leaderboard/plans');
    const listBody = await listRes.json();
    const plans = listBody.data?.plans ?? [];
    const publicPlan = plans.find(
      (p: { visibility?: string }) => p.visibility === 'public',
    );
    test.skip(!publicPlan, 'No public plan found to test');

    const res = await request.get(
      `/api/v1/orchestrator-leaderboard/plans/${publicPlan.id}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data?.plan?.id).toBe(publicPlan.id);
  });

  test('PUT /plans/:id on public plan returns 403 for non-admin', async ({ request }) => {
    const listRes = await request.get('/api/v1/orchestrator-leaderboard/plans');
    const listBody = await listRes.json();
    const plans = listBody.data?.plans ?? [];
    const publicPlan = plans.find(
      (p: { visibility?: string }) => p.visibility === 'public',
    );
    test.skip(!publicPlan, 'No public plan found to test');

    const res = await request.put(
      `/api/v1/orchestrator-leaderboard/plans/${publicPlan.id}`,
      { data: { name: 'HACKED NAME' } },
    );
    expect(res.status()).toBe(403);
  });

  test('DELETE /plans/:id on public plan returns 403 for non-admin', async ({ request }) => {
    const listRes = await request.get('/api/v1/orchestrator-leaderboard/plans');
    const listBody = await listRes.json();
    const plans = listBody.data?.plans ?? [];
    const publicPlan = plans.find(
      (p: { visibility?: string }) => p.visibility === 'public',
    );
    test.skip(!publicPlan, 'No public plan found to test');

    const res = await request.delete(
      `/api/v1/orchestrator-leaderboard/plans/${publicPlan.id}`,
    );
    expect(res.status()).toBe(403);
  });

  test('GET /sources returns 403 for non-admin', async ({ request }) => {
    const res = await request.get(
      '/api/v1/orchestrator-leaderboard/sources',
    );
    expect(res.status()).toBe(403);
  });

  test('GET /audits returns 403 for non-admin', async ({ request }) => {
    const res = await request.get(
      '/api/v1/orchestrator-leaderboard/audits',
    );
    expect(res.status()).toBe(403);
  });

  test('GET /dataset/config returns 403 for non-admin', async ({ request }) => {
    const res = await request.get(
      '/api/v1/orchestrator-leaderboard/dataset/config',
    );
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// UI-level tests
// ---------------------------------------------------------------------------

test.describe('Leaderboard Posture — UI (live) @pre-release', () => {
  test.skip(() => !isLiveMode(), 'Skipping — set E2E_USER_EMAIL/PASSWORD');

  test('non-admin sees Discovery Plans page with default plans', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard/plans');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: /Discovery Plans/i })).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByText('High-Performance Video')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Budget Image Generation')).toBeVisible();
    await expect(page.getByText('Balanced Streaming')).toBeVisible();
    await expect(page.getByText('Maximum Availability')).toBeVisible();
  });

  test('non-admin does not see Seed Demo Data button', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard/plans');
    await expect(page.getByRole('heading', { name: /Discovery Plans/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /Seed Demo/i })).not.toBeVisible();
  });

  test('non-admin does not see Dataset Settings panel', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Dataset Settings')).not.toBeVisible();
    await expect(page.getByText('Refresh Interval')).not.toBeVisible();
  });

  test('clicking a public plan opens Plan Detail', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard/plans');
    await expect(page.getByText('High-Performance Video')).toBeVisible({ timeout: 30_000 });

    await page.getByText('High-Performance Video').click();
    await page.waitForURL(/\/plans\//, { timeout: 15_000 });

    await expect(page.getByText('High-Performance Video')).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Admin-specific UI tests
// ---------------------------------------------------------------------------

test.describe('Leaderboard Posture — Admin UI (live) @pre-release', () => {
  test.skip(
    () => !(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD),
    'Skipping — set ADMIN_EMAIL/PASSWORD',
  );
  test.use({ storageState: 'playwright/.auth/admin.json' });

  test('admin sees Seed Demo Data button on Plans page', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard/plans');
    await expect(page.getByRole('heading', { name: /Discovery Plans/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /Seed Demo/i })).toBeVisible();
  });

  test('admin sees Dataset Settings panel', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Dataset Settings')).toBeVisible({ timeout: 10_000 });
  });

  test('admin can access GET /sources', async ({ request }) => {
    const res = await request.get(
      '/api/v1/orchestrator-leaderboard/sources',
    );
    expect(res.status()).toBe(200);
  });

  test('admin can access GET /audits', async ({ request }) => {
    const res = await request.get(
      '/api/v1/orchestrator-leaderboard/audits',
    );
    expect(res.status()).toBe(200);
  });
});
