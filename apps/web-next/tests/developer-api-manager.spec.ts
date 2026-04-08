import { test, expect } from '@playwright/test';
import { assertDeveloperApiReachable } from './helpers/plugin-preflight';

test.describe('Developer API manager @pre-release', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await assertDeveloperApiReachable(request, baseURL!);
  }, { timeout: 120_000 });

  test('API models authorized after session; plugin route not 404', async ({ page, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Set E2E_USER_EMAIL / E2E_USER_PASSWORD (or run setup with those vars)');
      return;
    }

    const res = await page.request.get(`${baseURL}/api/v1/developer/models?limit=1`);
    expect(res.ok(), `developer models API got ${res.status()}`).toBeTruthy();

    await page.goto('/developer');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();
    const cdn = page.getByText('CDN', { exact: true }).first();
    const pluginError = page.getByRole('heading', { name: 'Plugin Error' });
    await expect(cdn.or(pluginError)).toBeVisible({ timeout: 45_000 });
  });
});
