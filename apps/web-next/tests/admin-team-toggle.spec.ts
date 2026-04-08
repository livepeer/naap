import { test, expect } from '@playwright/test';

/**
 * E2E tests for Admin Feature Flag — Teams Toggle
 *
 * Verifies that an admin can toggle the enableTeams feature flag on/off
 * and that the Teams UI (sidebar link, teams page) responds accordingly.
 *
 * Requires admin authentication (uses playwright/.auth/admin.json storage state).
 */

test.use({ storageState: 'playwright/.auth/admin.json' });

test.describe('Admin Team Feature Toggle @pre-release @teams', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Not signed in as admin — set ADMIN_EMAIL / ADMIN_PASSWORD');
    }
  });

  test('admin settings page shows feature flags with toggles', async ({ page }) => {
    await page.goto('/admin/settings');

    await expect(page.getByText('Platform Settings')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Manage feature flags that control platform capabilities')
    ).toBeVisible();

    // Should show at least one flag row with a toggle switch
    const switches = page.locator('button[role="switch"]');
    await expect(switches.first()).toBeVisible({ timeout: 10_000 });

    // The enableTeams flag row should be present
    await expect(page.getByText('Teams', { exact: false })).toBeVisible();
    await expect(page.locator('.font-mono').filter({ hasText: 'enableTeams' })).toBeVisible();
  });

  test('toggling a flag enables Save Changes button', async ({ page }) => {
    await page.goto('/admin/settings');

    await page.locator('button[role="switch"]').first().waitFor({ timeout: 10_000 });

    // Save button should be disabled initially
    const saveButton = page.getByRole('button', { name: /Save Changes/i });
    await expect(saveButton).toBeDisabled();

    // Toggle the enableTeams flag
    const teamsRow = page.locator('div').filter({ has: page.locator('.font-mono', { hasText: 'enableTeams' }) });
    const teamsToggle = teamsRow.locator('button[role="switch"]');
    await teamsToggle.click();

    // Save button should now be enabled
    await expect(saveButton).toBeEnabled();
  });

  test('disable teams: sidebar hides Teams link and /teams shows disabled', async ({ page }) => {
    test.setTimeout(90_000);

    // Step 1: Go to admin settings and ensure Teams is OFF
    await page.goto('/admin/settings');
    await page.locator('button[role="switch"]').first().waitFor({ timeout: 10_000 });

    const teamsRow = page.locator('div').filter({ has: page.locator('.font-mono', { hasText: 'enableTeams' }) });
    const teamsToggle = teamsRow.locator('button[role="switch"]');
    const isCurrentlyEnabled = await teamsToggle.getAttribute('aria-checked') === 'true';

    if (isCurrentlyEnabled) {
      await teamsToggle.click();
      const saveButton = page.getByRole('button', { name: /Save Changes/i });
      await saveButton.click();
      await expect(page.getByText(/Updated/i)).toBeVisible({ timeout: 10_000 });
    }

    // Step 2: Navigate to dashboard and check sidebar
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // The "More" section may need expanding; look for the Teams link in the sidebar
    const sidebar = page.locator('aside');
    const teamsLink = sidebar.getByRole('link', { name: 'Teams' });
    await expect(teamsLink).not.toBeVisible({ timeout: 10_000 });

    // Step 3: Navigate directly to /teams and verify disabled message
    await page.goto('/teams');
    await expect(page.getByText('Teams feature is disabled')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Teams have been disabled by your administrator')
    ).toBeVisible();
  });

  test('enable teams: sidebar shows Teams link and /teams works', async ({ page }) => {
    test.setTimeout(90_000);

    // Step 1: Go to admin settings and ensure Teams is ON
    await page.goto('/admin/settings');
    await page.locator('button[role="switch"]').first().waitFor({ timeout: 10_000 });

    const teamsRow = page.locator('div').filter({ has: page.locator('.font-mono', { hasText: 'enableTeams' }) });
    const teamsToggle = teamsRow.locator('button[role="switch"]');
    const isCurrentlyEnabled = await teamsToggle.getAttribute('aria-checked') === 'true';

    if (!isCurrentlyEnabled) {
      await teamsToggle.click();
      const saveButton = page.getByRole('button', { name: /Save Changes/i });
      await saveButton.click();
      await expect(page.getByText(/Updated/i)).toBeVisible({ timeout: 10_000 });
    }

    // Step 2: Navigate to dashboard and expand "More" section to find Teams link
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Expand "More" section if collapsed
    const moreButton = page.locator('aside').getByRole('button', { name: /More/i });
    if (await moreButton.isVisible()) {
      await moreButton.click();
    }

    const sidebar = page.locator('aside');
    const teamsLink = sidebar.getByRole('link', { name: 'Teams' });
    await expect(teamsLink).toBeVisible({ timeout: 10_000 });

    // Step 3: Navigate to /teams and verify it shows the teams list page
    await page.goto('/teams');
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15_000 });

    // Valid states when teams are enabled:
    // 1. "No teams yet" heading (user has no teams)
    // 2. Team cards in list (.space-y-3 h3)
    // 3. "Create" button visible
    const noTeams = page.getByRole('heading', { name: 'No teams yet' });
    const teamCards = page.locator('.space-y-3 h3');
    const createButton = page.getByRole('button', { name: /Create/i });
    await expect(
      noTeams.or(teamCards.first()).or(createButton),
      'Expected teams page to show either "No teams yet", team cards, or a Create button'
    ).toBeVisible({ timeout: 15_000 });
  });
});
