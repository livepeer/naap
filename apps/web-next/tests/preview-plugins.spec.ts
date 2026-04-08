import { test, expect } from '@playwright/test';
import {
  assertGatewayApiReachable,
  assertWalletApiReachable,
} from './helpers/plugin-preflight';
import { e2ePreviewUserCredentials, loginWithEmailPassword } from './helpers/auth-e2e';

test.describe('Preview plugins Wallet and Gateway @appendix-preview', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ request, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    await assertWalletApiReachable(request, baseURL!);
    await assertGatewayApiReachable(request, baseURL!);
  }, { timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    const creds = e2ePreviewUserCredentials();
    test.skip(!creds, 'E2E_PREVIEW_USER_EMAIL / E2E_PREVIEW_USER_PASSWORD required');
    await loginWithEmailPassword(page, creds!.email, creds!.password);
  });

  test('wallet plugin shell loads', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();
  });

  test('service gateway plugin shell loads', async ({ page }) => {
    await page.goto('/gateway');
    await expect(page.getByText('Loading plugins...')).toBeHidden({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).not.toBeVisible();
  });
});
