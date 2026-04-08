import { test, expect } from '@playwright/test';

test.describe('Auth flows (browser) @pre-release', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    test.setTimeout(60_000);
    const submit = page.getByRole('button', { name: /Continue with email/i });
    await page.getByLabel('Email').fill('e2e-invalid-not-a-user@example.com');
    await page.getByLabel('Password', { exact: true }).fill('wrong-pass-xx');
    await submit.click();
    await expect(submit).toBeEnabled({ timeout: 55_000 });
    await expect(page.getByText('Invalid email or password')).toBeVisible();
  });

  test('forgot password flow shows confirmation UI', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('qiang@livepeer.org');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: /Check your email/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('verify-email page shows instructions without token', async ({ page }) => {
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('link', { name: 'Back to login' })).toBeVisible();
  });

  test('register with mismatched passwords shows validation', async ({ page }) => {
    await page.goto('/register');
    await page.locator('input[name="email"]').fill('e2e-mismatch@example.com');
    await page.locator('input[name="password"]').fill('password-one');
    await page.locator('input[name="confirmPassword"]').fill('password-two');
    await page.locator('input[name="displayName"]').fill('E2E User');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test('full login and logout via settings when E2E_USER credentials set', async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    test.skip(!email || !password, 'E2E_USER_EMAIL / E2E_USER_PASSWORD required');

    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: /Continue with email/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.goto('/settings');
    await page.getByRole('button', { name: /^Sign Out$/i }).click();
    await expect(page.locator('h1').filter({ hasText: 'Network Platform' })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
