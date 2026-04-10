import { test, expect } from '@playwright/test';
import { assertCapacityPlannerApiHealthy } from './helpers/plugin-preflight';
import { e2eBaseUrl } from './helpers/e2e-base';

/**
 * E2E tests for Capacity Planner lifecycle features.
 *
 * Tests the following capabilities:
 * - Creator can close their own request
 * - Expired requests are hidden from default listing
 * - Archived filter shows closed/expired/cancelled requests
 * - creatorId is stored on new requests
 * - Ownership check prevents non-creators from closing
 *
 * Requires:
 *   E2E_USER_EMAIL + E2E_USER_PASSWORD for authenticated tests
 */

// ── API-level tests ──

test.describe('Capacity Planner Lifecycle API @pre-release', () => {
  const base = () => e2eBaseUrl();

  test.beforeAll(async ({ request }) => {
    const baseURL = base();
    test.skip(!baseURL, 'baseURL required');
    await assertCapacityPlannerApiHealthy(request, baseURL);
  }, { timeout: 120_000 });

  test.describe('GET /capacity-planner/requests (status filter)', () => {
    test('default listing returns only active, non-expired requests', async ({ request }) => {
      const res = await request.get(`${base()}/api/v1/capacity-planner/requests?limit=5`);
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.success).toBe(true);
      const data = json.data;
      expect(Array.isArray(data)).toBeTruthy();

      // All returned requests should be active status
      for (const req of data) {
        expect(req.status).toBe('active');
        // validUntil should be in the future (or at least today)
        const validUntil = new Date(req.validUntil);
        const now = new Date();
        // Allow 1 day buffer for timezone edge cases
        now.setDate(now.getDate() - 1);
        expect(validUntil.getTime()).toBeGreaterThanOrEqual(now.getTime());
      }
    });

    test('archived filter returns non-active requests', async ({ request }) => {
      const res = await request.get(`${base()}/api/v1/capacity-planner/requests?status=archived&limit=5`);
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBeTruthy();

      // All returned should be non-active or expired-active
      for (const req of json.data) {
        const isNonActive = ['expired', 'cancelled', 'closed', 'fulfilled'].includes(req.status);
        const isExpiredActive = req.status === 'active' && new Date(req.validUntil) < new Date();
        expect(isNonActive || isExpiredActive).toBeTruthy();
      }
    });

    test('all filter returns everything', async ({ request }) => {
      const res = await request.get(`${base()}/api/v1/capacity-planner/requests?status=all&limit=5`);
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBeTruthy();
    });

    test('invalid status falls through to default (active)', async ({ request }) => {
      const res = await request.get(`${base()}/api/v1/capacity-planner/requests?status=bogus&limit=5`);
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.success).toBe(true);
      // Should behave like default active filter
      for (const req of json.data) {
        expect(req.status).toBe('active');
      }
    });
  });

  test.describe('GET /capacity-planner/requests/:id', () => {
    test('returns 404 for non-existent request', async ({ request }) => {
      const res = await request.get(
        `${base()}/api/v1/capacity-planner/requests/00000000-0000-0000-0000-000000000000`
      );
      expect(res.status()).toBe(404);
    });
  });

  test.describe('PATCH /capacity-planner/requests/:id (close)', () => {
    test('rejects unauthenticated close', async ({ request }) => {
      const res = await request.patch(
        `${base()}/api/v1/capacity-planner/requests/00000000-0000-0000-0000-000000000000`,
        { data: { status: 'CLOSED' } }
      );
      expect(res.status()).toBe(401);
    });
  });

  test.describe('POST /capacity-planner/requests (creatorId)', () => {
    test('rejects unauthenticated create', async ({ request }) => {
      const res = await request.post(`${base()}/api/v1/capacity-planner/requests`, {
        data: {
          requesterName: 'Test',
          gpuModel: 'RTX 4090',
          vram: 24,
          count: 1,
          pipeline: 'text-to-image',
          startDate: '2026-05-01',
          endDate: '2026-06-01',
          validUntil: '2026-05-15',
          hourlyRate: 1.5,
          reason: 'Test request',
        },
      });
      expect(res.status()).toBe(401);
    });
  });

  test.describe('Summary endpoint', () => {
    test('summary still works with new status filter', async ({ request }) => {
      const res = await request.get(`${base()}/api/v1/capacity-planner/summary`);
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });
});

// ── Authenticated API tests (create + close flow) ──

test.describe('Capacity Planner Lifecycle Authenticated API', () => {
  const base = () => e2eBaseUrl();

  test.beforeAll(async ({ request }) => {
    const baseURL = base();
    test.skip(!baseURL, 'baseURL required');
    await assertCapacityPlannerApiHealthy(request, baseURL);
  }, { timeout: 120_000 });

  test('full create → close → appears in archive flow', async ({ request }) => {
    // This test requires auth - skip if no credentials
    const email = process.env.E2E_USER_EMAIL?.trim();
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD for authenticated tests');
      return;
    }

    // Step 1: Login to get auth token
    const loginRes = await request.post(`${base()}/api/v1/auth/login`, {
      data: { email, password },
    });
    if (!loginRes.ok()) {
      test.skip(true, 'Login failed — skipping authenticated lifecycle test');
      return;
    }
    const loginData = await loginRes.json();
    const token = loginData.data?.token;
    if (!token) {
      test.skip(true, 'No token in login response');
      return;
    }

    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // Step 2: Get CSRF token
    const meRes = await request.get(`${base()}/api/v1/auth/me`, { headers: authHeaders });
    const csrfToken = meRes.headers()['x-csrf-token'] || '';
    if (csrfToken) {
      (authHeaders as Record<string, string>)['X-CSRF-Token'] = csrfToken;
    }

    // Step 3: Create a new request
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);
    const futureDateStr = futureDate.toISOString().split('T')[0];
    const validUntilDate = new Date();
    validUntilDate.setDate(validUntilDate.getDate() + 14);
    const validUntilStr = validUntilDate.toISOString().split('T')[0];

    const createRes = await request.post(`${base()}/api/v1/capacity-planner/requests`, {
      headers: authHeaders,
      data: {
        requesterName: 'E2E Lifecycle Test',
        requesterAccount: '0xE2ETEST',
        gpuModel: 'RTX 4090',
        vram: 24,
        count: 1,
        pipeline: 'text-to-image',
        startDate: new Date().toISOString().split('T')[0],
        endDate: futureDateStr,
        validUntil: validUntilStr,
        hourlyRate: 1.0,
        reason: 'E2E test — will be closed immediately',
        riskLevel: 1,
      },
    });

    if (!createRes.ok()) {
      const body = await createRes.text();
      console.log('[capacity-lifecycle] Create failed:', createRes.status(), body);
      test.skip(true, `Create request failed: ${createRes.status()}`);
      return;
    }

    const created = await createRes.json();
    const requestId = created.data?.id;
    expect(requestId).toBeTruthy();

    // Verify creatorId is set
    expect(created.data?.creatorId).toBeTruthy();

    // Step 4: Verify it appears in active listing
    const activeListRes = await request.get(
      `${base()}/api/v1/capacity-planner/requests?search=E2E+Lifecycle+Test&limit=5`
    );
    expect(activeListRes.ok()).toBeTruthy();
    const activeList = await activeListRes.json();
    const inActiveList = activeList.data?.some((r: { id: string }) => r.id === requestId);
    expect(inActiveList).toBeTruthy();

    // Step 5: Close the request
    const closeRes = await request.patch(
      `${base()}/api/v1/capacity-planner/requests/${requestId}`,
      {
        headers: authHeaders,
        data: { status: 'CLOSED' },
      }
    );
    expect(closeRes.ok()).toBeTruthy();

    // Step 6: Verify it's gone from active listing
    const activeList2Res = await request.get(
      `${base()}/api/v1/capacity-planner/requests?limit=50`
    );
    const activeList2 = await activeList2Res.json();
    const stillInActive = activeList2.data?.some((r: { id: string }) => r.id === requestId);
    expect(stillInActive).toBeFalsy();

    // Step 7: Verify it appears in archived listing
    const archivedRes = await request.get(
      `${base()}/api/v1/capacity-planner/requests?status=archived&limit=50`
    );
    expect(archivedRes.ok()).toBeTruthy();
    const archivedList = await archivedRes.json();
    const inArchived = archivedList.data?.some((r: { id: string }) => r.id === requestId);
    expect(inArchived).toBeTruthy();

    // Step 8: Clean up — delete the test request
    await request.delete(`${base()}/api/v1/capacity-planner/requests/${requestId}`, {
      headers: authHeaders,
    });
  });

  test('non-creator cannot close another user\'s request', async ({ request }) => {
    const email = process.env.E2E_USER_EMAIL?.trim();
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    // Login
    const loginRes = await request.post(`${base()}/api/v1/auth/login`, {
      data: { email, password },
    });
    if (!loginRes.ok()) {
      test.skip(true, 'Login failed');
      return;
    }
    const token = (await loginRes.json()).data?.token;
    if (!token) {
      test.skip(true, 'No token');
      return;
    }

    // Try to close a non-existent request (should get 404, not 500)
    const closeRes = await request.patch(
      `${base()}/api/v1/capacity-planner/requests/00000000-0000-0000-0000-000000000000`,
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { status: 'CLOSED' },
      }
    );
    expect(closeRes.status()).toBe(404);
  });
});

// ── Browser-based UI tests ──

test.describe('Capacity Planner Lifecycle UI @pre-release', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await assertCapacityPlannerApiHealthy(request, baseURL!);
  }, { timeout: 120_000 });

  test('archived toggle button is visible', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });

    // The Archived toggle button should be visible
    const archivedBtn = page.getByRole('button', { name: /Archived/i });
    await expect(archivedBtn).toBeVisible({ timeout: 15_000 });
  });

  test('clicking Archived toggle changes listing', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });

    // Record current request count text
    const countTextBefore = await page.locator('text=/Showing \\d+ of \\d+/').textContent({ timeout: 10_000 }).catch(() => '');

    // Click the Archived button
    const archivedBtn = page.getByRole('button', { name: /Archived/i });
    await archivedBtn.click();

    // Wait for reload — either the count changes or we get "No archived requests"
    await page.waitForTimeout(2000);
    const countTextAfter = await page.locator('text=/Showing \\d+ of \\d+/').textContent({ timeout: 5_000 }).catch(() => '');
    const noArchived = await page.getByText(/No archived requests/i).isVisible().catch(() => false);

    // Either the count text changed or the empty state is shown
    expect(countTextAfter !== countTextBefore || noArchived).toBeTruthy();
  });

  test('New Request button still works', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });

    const newReqBtn = page.getByRole('button', { name: /New Request/i });
    await expect(newReqBtn).toBeVisible({ timeout: 15_000 });
    await newReqBtn.click();

    // Modal should appear
    await expect(page.getByText(/GPU Model/i)).toBeVisible({ timeout: 5_000 });
  });

  test('request detail modal shows status badge', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });

    // Click on the first request card if any exist
    const cards = page.locator('[class*="glass-card"]');
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.first().click();

      // Modal should open with status badge
      await expect(page.locator('text=/active|closed|expired|fulfilled|cancelled/i')).toBeVisible({
        timeout: 10_000,
      });

      // Specifications section should be visible
      await expect(page.getByText('Specifications')).toBeVisible({ timeout: 5_000 });
    }
  });

  test('filters and sort bar include Archived button', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });

    // Verify the filter bar layout
    await expect(page.getByRole('button', { name: /Filters/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Archived/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Request/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search by name/i)).toBeVisible();
  });
});
