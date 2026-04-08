import { test, expect } from '@playwright/test';
import { assertCapacityPlannerApiHealthy } from './helpers/plugin-preflight';

test.describe('Capacity planner plugin @pre-release', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await assertCapacityPlannerApiHealthy(request, baseURL!);
  }, { timeout: 120_000 });

  test('loads Capacity Requests after authentication', async ({ page, baseURL }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD for authenticated plugin tests');
      return;
    }

    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole('button', { name: /New Request/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('warm navigation to capacity stays under budget', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD');
      return;
    }

    const t0 = Date.now();
    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });
    const first = Date.now() - t0;

    const t1 = Date.now();
    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Capacity Requests' })).toBeVisible({
      timeout: 45_000,
    });
    const second = Date.now() - t1;

    console.log(`\n[capacity-planner] first load ${first}ms, second ${second}ms\n`);
    expect(second).toBeLessThan(120_000);
    expect(first).toBeLessThan(120_000);
  });
});
