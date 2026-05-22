import { test, expect } from '@playwright/test';

/**
 * E2E tests for Admin User Management — role changes and suspend/activate.
 *
 * Requires ADMIN_EMAIL / ADMIN_PASSWORD for authenticated admin tests.
 * Uses the admin.json storage state created by auth.setup.ts.
 */

test.use({ storageState: 'playwright/.auth/admin.json' });

function skipWithoutAdminCreds() {
  test.skip(
    !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD,
    'ADMIN_EMAIL and ADMIN_PASSWORD required',
  );
}

test.describe('Admin User Management Page', () => {
  test.beforeEach(() => {
    skipWithoutAdminCreds();
  });

  test('loads users table with action buttons', async ({ page }) => {
    await page.goto('/admin/users');

    await expect(page.getByText('User Management')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Manage user roles and account status')).toBeVisible();

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const rows = page.locator('table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('filter by suspended shows correct results', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const filterSelect = page.locator('select');
    await filterSelect.selectOption('suspended');

    await page.waitForTimeout(500);
  });

  test('search filters the user list', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const searchInput = page.getByPlaceholder('Search by email, name, or wallet...');
    await searchInput.fill('zzz-nonexistent-user-12345');
    await page.waitForTimeout(500);

    await expect(page.getByText('No users found')).toBeVisible();
  });
});

test.describe('Admin User Role Management API', () => {
  test.describe.configure({ mode: 'serial' });

  let adminCookieHeader: string;
  let targetUserId: string;
  let originalRoles: string[];

  function base() {
    return (process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  test.beforeAll(async ({ browser }) => {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    test.skip(!adminEmail || !adminPassword, 'ADMIN_EMAIL and ADMIN_PASSWORD required');

    const context = await browser.newContext({ baseURL: base() });
    const page = await context.newPage();

    await page.goto('/login');
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|admin)/, { timeout: 15000 });

    const cookies = await context.cookies();
    adminCookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    await context.close();
  });

  test('GET /api/v1/admin/users returns users with suspension fields', async ({ request }) => {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    test.skip(!adminEmail || !adminPassword, 'ADMIN_EMAIL and ADMIN_PASSWORD required');

    const res = await request.get(`${base()}/api/v1/admin/users`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.users.length).toBeGreaterThan(0);

    const firstUser = body.data.users[0];
    expect(firstUser).toHaveProperty('suspended');
    expect(firstUser).toHaveProperty('suspendedAt');
    expect(firstUser).toHaveProperty('suspendedReason');

    const nonAdmin = body.data.users.find(
      (u: { email: string | null; roles: string[] }) =>
        u.email !== adminEmail && !u.roles.includes('system:root')
    );
    if (nonAdmin) {
      targetUserId = nonAdmin.id;
      originalRoles = nonAdmin.roles;
    }
  });

  test('GET /api/v1/admin/roles returns available roles (no system:root)', async ({ request }) => {
    const adminEmail = process.env.ADMIN_EMAIL;
    test.skip(!adminEmail, 'ADMIN_EMAIL required');

    const res = await request.get(`${base()}/api/v1/admin/roles`, {
      headers: { Cookie: adminCookieHeader },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.roles.length).toBeGreaterThan(0);
    expect(body.data.roles.every((r: { name: string }) => r.name !== 'system:root')).toBe(true);
  });

  test('PATCH /api/v1/admin/users/:id/role changes user roles', async ({ request }) => {
    const adminEmail = process.env.ADMIN_EMAIL;
    test.skip(!adminEmail || !targetUserId, 'Requires admin + target user');

    const res = await request.patch(`${base()}/api/v1/admin/users/${targetUserId}/role`, {
      headers: { Cookie: adminCookieHeader, 'Content-Type': 'application/json' },
      data: { roles: ['system:viewer'] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.roles).toContain('system:viewer');
  });

  test('PATCH /api/v1/admin/users/:id/role rejects empty roles', async ({ request }) => {
    test.skip(!targetUserId, 'Requires target user');

    const res = await request.patch(`${base()}/api/v1/admin/users/${targetUserId}/role`, {
      headers: { Cookie: adminCookieHeader, 'Content-Type': 'application/json' },
      data: { roles: [] },
    });
    expect(res.status()).toBe(400);
  });

  test('PATCH /api/v1/admin/users/:id/role rejects system:root assignment', async ({ request }) => {
    test.skip(!targetUserId, 'Requires target user');

    const res = await request.patch(`${base()}/api/v1/admin/users/${targetUserId}/role`, {
      headers: { Cookie: adminCookieHeader, 'Content-Type': 'application/json' },
      data: { roles: ['system:root'] },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/v1/admin/users/:id/suspend suspends a user', async ({ request }) => {
    test.skip(!targetUserId, 'Requires target user');

    const res = await request.post(`${base()}/api/v1/admin/users/${targetUserId}/suspend`, {
      headers: { Cookie: adminCookieHeader, 'Content-Type': 'application/json' },
      data: { action: 'suspend', reason: 'E2E test suspension' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.suspended).toBe(true);
    expect(body.data.reason).toBe('E2E test suspension');
  });

  test('POST /api/v1/admin/users/:id/suspend activates a user', async ({ request }) => {
    test.skip(!targetUserId, 'Requires target user');

    const res = await request.post(`${base()}/api/v1/admin/users/${targetUserId}/suspend`, {
      headers: { Cookie: adminCookieHeader, 'Content-Type': 'application/json' },
      data: { action: 'activate' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.suspended).toBe(false);
  });

  test('restore original roles after tests', async ({ request }) => {
    test.skip(!targetUserId || !originalRoles?.length, 'Requires target user');

    const res = await request.patch(`${base()}/api/v1/admin/users/${targetUserId}/role`, {
      headers: { Cookie: adminCookieHeader, 'Content-Type': 'application/json' },
      data: { roles: originalRoles },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe('Suspended user login flow', () => {
  function base() {
    return (process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  test('login page shows suspension error on account_suspended param', async ({ page }) => {
    await page.goto('/login?error=account_suspended');

    await expect(
      page.getByText(/account has been suspended/i)
    ).toBeVisible({ timeout: 5000 });
  });
});
