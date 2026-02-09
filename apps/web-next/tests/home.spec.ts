import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should display the main heading', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('NaaP Platform');
  });

  test('should have navigation links', async ({ page }) => {
    await page.goto('/');

    // Check Get Started link
    const getStartedLink = page.getByRole('link', { name: /Get Started/i });
    await expect(getStartedLink).toBeVisible();
    await expect(getStartedLink).toHaveAttribute('href', '/login');

    // Check Documentation link
    const docsLink = page.getByRole('link', { name: /Documentation/i });
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute('href', '/docs');
  });

  test('should display feature cards', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Gateway Management')).toBeVisible();
    await expect(page.getByText('Plugin Ecosystem')).toBeVisible();
    await expect(page.getByText('Vercel-Ready')).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await expect(page.locator('h1')).toBeVisible();
  });
});
