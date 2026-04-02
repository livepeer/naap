import { test, expect } from '@playwright/test';

/**
 * E2E tests for Admin Launch Experience Configuration
 *
 * Tests the admin plugins page with visibility toggles for plugins and templates.
 * Requires admin authentication (uses playwright/.auth/admin.json storage state).
 */

test.use({ storageState: 'playwright/.auth/admin.json' });

test.describe('Admin Visibility Configuration', () => {
  test.describe('Admin Plugins Page', () => {
    test('loads with Plugins and Templates tabs', async ({ page }) => {
      await page.goto('/admin/plugins');

      // Verify page title / header
      await expect(page.getByText('Launch Experience')).toBeVisible();
      await expect(
        page.getByText('Configure which plugins and templates are visible to users.')
      ).toBeVisible();

      // Verify tabs are present
      await expect(page.getByRole('tab', { name: /Plugins/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Templates/i })).toBeVisible();
    });

    test('displays plugin rows with visibility and core controls', async ({ page }) => {
      await page.goto('/admin/plugins');

      // Wait for plugins to load
      await page.waitForSelector('[aria-label*="Toggle visibility"]', {
        timeout: 10000,
      });

      // Should have at least one plugin row with visibility toggle
      const visibilityToggles = page.locator('[aria-label*="Toggle visibility"]');
      await expect(visibilityToggles.first()).toBeVisible();

      // Should have core toggle buttons
      const coreButtons = page.getByRole('button', { name: /Make Core|Remove Core/i });
      await expect(coreButtons.first()).toBeVisible();
    });

    test('toggling visibility enables Save button', async ({ page }) => {
      await page.goto('/admin/plugins');

      // Wait for plugins to load
      await page.waitForSelector('[aria-label*="Toggle visibility"]', {
        timeout: 10000,
      });

      // Save button should be disabled initially
      const saveButton = page.getByRole('button', { name: /Save Changes/i });
      await expect(saveButton).toBeDisabled();

      // Click a visibility toggle
      const firstToggle = page.locator('[aria-label*="Toggle visibility"]').first();
      await firstToggle.click();

      // Save button should now be enabled
      await expect(saveButton).toBeEnabled();
    });

    test('save changes shows success message', async ({ page }) => {
      await page.goto('/admin/plugins');

      await page.waitForSelector('[aria-label*="Toggle visibility"]', {
        timeout: 10000,
      });

      // Toggle a plugin visibility
      const firstToggle = page.locator('[aria-label*="Toggle visibility"]').first();
      await firstToggle.click();

      // Save
      const saveButton = page.getByRole('button', { name: /Save Changes/i });
      await saveButton.click();

      // Wait for success message
      await expect(
        page.locator('text=/updated|configuration/i')
      ).toBeVisible({ timeout: 10000 });
    });

    test('core toggle still works alongside visibility', async ({ page }) => {
      await page.goto('/admin/plugins');

      await page.waitForSelector('[aria-label*="Toggle visibility"]', {
        timeout: 10000,
      });

      // Find a non-core plugin and toggle it to core
      const makeCoreButton = page.getByRole('button', { name: /Make Core/i }).first();
      if (await makeCoreButton.isVisible()) {
        await makeCoreButton.click();

        const saveButton = page.getByRole('button', { name: /Save Changes/i });
        await expect(saveButton).toBeEnabled();
      }
    });
  });

  test.describe('Templates Tab', () => {
    test('switches to Templates tab and loads templates', async ({ page }) => {
      await page.goto('/admin/plugins');

      // Click Templates tab
      const templatesTab = page.getByRole('tab', { name: /Templates/i });
      await templatesTab.click();

      // Wait for templates to load or show empty state
      await page.waitForTimeout(2000);

      // Should show either template rows or empty state
      const hasTemplates = await page.locator('[aria-label*="Toggle visibility"]').count();
      const hasEmptyState = await page.getByText(/No gateway templates found/i).isVisible().catch(() => false);

      expect(hasTemplates > 0 || hasEmptyState).toBeTruthy();
    });

    test('template visibility toggle enables save', async ({ page }) => {
      await page.goto('/admin/plugins');

      const templatesTab = page.getByRole('tab', { name: /Templates/i });
      await templatesTab.click();

      await page.waitForTimeout(2000);

      const visibilityToggles = page.locator('[aria-label*="Toggle visibility"]');
      const toggleCount = await visibilityToggles.count();

      if (toggleCount > 0) {
        const saveButton = page.getByRole('button', { name: /Save Changes/i });
        await expect(saveButton).toBeDisabled();

        await visibilityToggles.first().click();

        await expect(saveButton).toBeEnabled();
      }
    });
  });

  test.describe('Search functionality', () => {
    test('plugin search filters the list', async ({ page }) => {
      await page.goto('/admin/plugins');

      await page.waitForSelector('[aria-label*="Toggle visibility"]', {
        timeout: 10000,
      });

      const searchInput = page.getByPlaceholder('Search plugins...');
      await expect(searchInput).toBeVisible();

      // Type a search query that should filter results
      await searchInput.fill('zzz-nonexistent-plugin');
      await page.waitForTimeout(500);

      // Should show "No plugins match your search"
      await expect(
        page.getByText(/No plugins match your search/i)
      ).toBeVisible();
    });
  });
});
