import { test, expect } from '@playwright/test';

/**
 * Teams tests use the chromium project's storageState (populated by auth.setup.ts).
 * When E2E_USER_* credentials are set, that setup performs a real login, so the
 * browser context already has a session — no need to login again in beforeEach.
 */
test.describe('Teams @pre-release @teams', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/login')) {
      test.skip(true, 'Not signed in — set E2E_USER_EMAIL / E2E_USER_PASSWORD for team E2E');
    }
  });

  test('teams list and API', async ({ page, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');

    const listRes = await page.request.get(`${baseURL}/api/v1/teams`);
    expect(listRes.ok(), `GET /api/v1/teams → ${listRes.status()}`).toBeTruthy();

    await page.goto('/teams');
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 30_000 });

    const noTeams = page.getByRole('heading', { name: 'No teams yet' });
    const teamCards = page.locator('.space-y-3 h3');
    await expect(noTeams.or(teamCards.first())).toBeVisible({ timeout: 30_000 });
  });

  test('team detail, members, settings, marketplace deep link', async ({ page, baseURL }) => {
    test.skip(!baseURL, 'baseURL required');
    test.setTimeout(90_000);

    const envTeamId = process.env.E2E_TEAM_ID?.trim();
    let teamId = envTeamId || '';
    let teamName = 'E2E Team';

    await page.goto('/teams');
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 30_000 });

    if (!teamId) {
      const firstTeamCard = page.locator('.space-y-3 h3').first();
      const hasTeam = await firstTeamCard.isVisible().catch(() => false);
      if (!hasTeam) {
        test.skip(true, 'No teams for this user; set E2E_TEAM_ID or create a team');
        return;
      }
      teamName = (await firstTeamCard.textContent())?.trim() || 'Team';
      await firstTeamCard.click();
      await page.waitForURL(/\/teams\/[^/]+$/, { timeout: 15_000 });
      const m = page.url().match(/\/teams\/([^/?#]+)/);
      teamId = m?.[1] || '';
    } else {
      await page.goto(`/teams/${teamId}`);
    }

    expect(teamId.length).toBeGreaterThan(0);

    await expect(page.getByRole('heading', { name: teamName, exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Installed Plugins' })).toBeVisible();

    await page.getByRole('button', { name: 'Members' }).click();
    await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/members`));
    await expect(page.getByRole('heading', { name: 'Team Members' })).toBeVisible({
      timeout: 30_000,
    });

    const inviteVisible = await page.getByRole('button', { name: 'Invite Member' }).isVisible();
    if (inviteVisible) {
      await page.getByRole('button', { name: 'Invite Member' }).click();
      await expect(page.getByRole('heading', { name: 'Invite Team Member' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
    }

    await page.goto(`/teams/${teamId}/settings`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const denied = page.getByText(/do not have permission to access team settings/i);
    const general = page.getByRole('heading', { name: 'General Settings' });
    await expect(denied.or(general)).toBeVisible({ timeout: 30_000 });

    await page.goto(
      `/marketplace?teamId=${encodeURIComponent(teamId)}&teamName=${encodeURIComponent(teamName)}`,
    );
    await expect(page.getByText(/Managing plugins for team:/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(teamName, { exact: true })).toBeVisible();
  });

  test('workspace switcher lists Workspaces', async ({ page }) => {
    await page.goto('/dashboard');
    const trigger = page.locator('aside').getByRole('button').first();
    await trigger.click();
    await expect(page.getByText('Workspaces', { exact: true })).toBeVisible({ timeout: 10_000 });
    const personalOption = page.locator('[class*="rounded-md"]').filter({ hasText: /^Personal$/ }).first();
    await expect(personalOption).toBeVisible();
  });
});
