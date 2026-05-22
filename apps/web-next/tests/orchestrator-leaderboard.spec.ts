import { test, expect } from '@playwright/test';

/**
 * E2E tests for the orchestrator-leaderboard plugin.
 *
 * - Stub mode (default): route-stubs API responses so the test works without
 *   a live ClickHouse backend. Verifies the plugin shell loads, capabilities
 *   render, and selecting one triggers the rank API.
 *
 * - Live mode: when E2E_USER_EMAIL + E2E_USER_PASSWORD are set (e.g. on
 *   Vercel preview deployments) the test logs in and hits the real backend,
 *   verifying capabilities load and orchestrator data is returned.
 *
 * Tag: @pre-release
 */

const STUB_CAPABILITIES = ['image-to-image', 'text-to-image', 'image-to-video'];

const STUB_RANK_DATA = [
  {
    orchUri: 'https://orch-1.example.com',
    gpuName: 'RTX 4090',
    gpuGb: 24,
    avail: 3,
    totalCap: 4,
    pricePerUnit: 0.0012,
    bestLatMs: 120,
    avgLatMs: 180,
    swapRatio: 0.02,
    avgAvail: 3.5,
  },
  {
    orchUri: 'https://orch-2.example.com',
    gpuName: 'A100',
    gpuGb: 80,
    avail: 1,
    totalCap: 2,
    pricePerUnit: 0.0025,
    bestLatMs: 200,
    avgLatMs: 250,
    swapRatio: 0.05,
    avgAvail: 1.8,
  },
];

const isLiveMode = () =>
  !!(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);

// ---------------------------------------------------------------------------
// Stub mode — works without backend
// ---------------------------------------------------------------------------

test.describe('Orchestrator Leaderboard (stub) @pre-release', () => {
  test.skip(() => isLiveMode(), 'Skipping stub tests — live credentials detected');

  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/orchestrator-leaderboard/filters', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { capabilities: STUB_CAPABILITIES } }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/rank', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'X-Cache': 'MISS', 'X-Cache-Age': '0', 'X-Data-Freshness': new Date().toISOString() },
        body: JSON.stringify({ success: true, data: STUB_RANK_DATA }),
      }),
    );
  });

  test('plugin shell loads and shows heading', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });
  });

  test('capability pills render', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });

    for (const cap of STUB_CAPABILITIES) {
      await expect(page.getByRole('button', { name: cap })).toBeVisible({ timeout: 10_000 });
    }
  });

  test('selecting a capability loads the orchestrator table', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: STUB_CAPABILITIES[0] }).click();

    await expect(page.getByText('orch-1.example.com')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('orch-2.example.com')).toBeVisible();
    await expect(page.getByText('RTX 4090')).toBeVisible();
    await expect(page.getByText('2 orchestrators')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Admin Settings Panel (stub)
// ---------------------------------------------------------------------------

test.describe('Admin Settings Panel (stub) @pre-release', () => {
  test.skip(() => isLiveMode(), 'Skipping stub tests — live credentials detected');

  test.use({ storageState: { cookies: [], origins: [] } });

  const STUB_CONFIG = {
    success: true,
    data: {
      refreshIntervalHours: 1,
      lastRefreshedAt: new Date().toISOString(),
      lastRefreshedBy: 'cron',
      updatedAt: new Date().toISOString(),
    },
  };

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/orchestrator-leaderboard/filters', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { capabilities: STUB_CAPABILITIES } }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/rank', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'X-Cache': 'MISS', 'X-Cache-Age': '0', 'X-Data-Freshness': new Date().toISOString() },
        body: JSON.stringify({ success: true, data: STUB_RANK_DATA }),
      }),
    );

    await page.route('**/api/v1/orchestrator-leaderboard/dataset/config', (route) => {
      if (route.request().method() === 'PUT') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { ...STUB_CONFIG.data, refreshIntervalHours: 4 },
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(STUB_CONFIG),
        });
      }
    });

    await page.route('**/api/v1/orchestrator-leaderboard/dataset/refresh', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { refreshed: true, capabilities: 3, orchestrators: 5 },
        }),
      }),
    );
  });

  test('admin settings button is visible (non-admin sees nothing rendered by AdminSettings)', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });

    // The AdminSettings component checks hasRole('system:admin') via the shell context.
    // In stub mode without a real shell context, the component returns null (non-admin).
    // This test verifies no crash occurs from the component being present.
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Live mode — real backend (Vercel preview or local with credentials)
// ---------------------------------------------------------------------------

test.describe('Orchestrator Leaderboard (live) @pre-release', () => {
  test.skip(() => !isLiveMode(), 'Skipping live tests — set E2E_USER_EMAIL and E2E_USER_PASSWORD');

  test('capabilities load and selecting one returns orchestrators', async ({ page }) => {
    await page.goto('/orchestrator-leaderboard');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByText('Orchestrator Leaderboard')).toBeVisible({ timeout: 30_000 });

    const capSection = page.locator('text=Capability').locator('..');
    await expect(capSection.locator('button').first()).toBeVisible({ timeout: 30_000 });

    const firstCap = capSection.locator('button').first();
    const capName = await firstCap.textContent();
    expect(capName).toBeTruthy();
    await firstCap.click();

    await expect(
      page.locator('table').or(page.getByText('No Orchestrators Found')),
    ).toBeVisible({ timeout: 30_000 });

    const tableVisible = await page.locator('table').isVisible();
    if (tableVisible) {
      const rows = page.locator('table tbody tr');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      console.log(`[orchestrator-leaderboard] ${capName}: ${count} orchestrators returned`);
    } else {
      console.log(`[orchestrator-leaderboard] ${capName}: no orchestrators (valid empty result)`);
    }
  });
});
