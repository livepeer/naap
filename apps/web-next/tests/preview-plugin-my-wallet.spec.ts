import { test, expect } from '@playwright/test';

/**
 * E2E / smoke around preview allowlist + My Wallet marketplace package.
 *
 * Unit tests cover allowlist filtering; here we smoke the registry API.
 * With a fresh `npm run db:seed`, `myWallet` is listed as a published package.
 */

test.describe('My Wallet / preview plugin APIs', () => {
  test('registry packages returns success and array shape', async ({ request }) => {
    const res = await request.get('/api/v1/registry/packages?pageSize=20');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    const pkgs = json.data?.packages ?? json.packages ?? [];
    expect(Array.isArray(pkgs)).toBeTruthy();
  });

  test('authenticated registry returns packages when session exists', async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(!baseURL, 'baseURL required');
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(
        true,
        'Set E2E_USER_EMAIL / E2E_USER_PASSWORD to exercise authenticated registry'
      );
      return;
    }
    const token = await page.evaluate(() => localStorage.getItem('naap_auth_token'));
    test.skip(!token, 'No auth token in storage');
    const res = await request.get(`${baseURL}/api/v1/registry/packages?pageSize=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    const names = (json.data?.packages ?? []).map((p: { name: string }) => p.name);
    expect(names.length).toBeGreaterThan(0);
  });
});
