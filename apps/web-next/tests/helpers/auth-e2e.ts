import type { Page } from '@playwright/test';

/**
 * Logs in via /login using env credentials. Returns false if email/password missing.
 */
export async function loginWithEmailPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Continue with email/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
}

export function e2eUserCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_USER_EMAIL?.trim();
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export function e2ePreviewUserCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_PREVIEW_USER_EMAIL?.trim();
  const password = process.env.E2E_PREVIEW_USER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}
