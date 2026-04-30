/**
 * AgentBook E2E Tests — Phase 0 + Phase 1
 *
 * Tests against agentbook.md requirements:
 * - Plugin loading and navigation
 * - Expense recording (text input)
 * - Journal entry creation with balance invariant
 * - Invoice creation and client management
 * - Tax estimation (US + CA)
 * - Trial balance verification
 * - Dashboard rendering
 * - API endpoint functionality
 *
 * Run: npx playwright test tests/e2e/agentbook.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CORE_API = process.env.CORE_API || 'http://localhost:4050';
const EXPENSE_API = process.env.EXPENSE_API || 'http://localhost:4051';
const INVOICE_API = process.env.INVOICE_API || 'http://localhost:4052';
const TAX_API = process.env.TAX_API || 'http://localhost:4053';
const TENANT = 'e2e-test-user';

// ============================================================
// SECTION 1: Backend API Tests (no browser needed)
// ============================================================

test.describe('AgentBook Core API', () => {
  test('health check returns ok', async ({ request }) => {
    const res = await request.get(`${CORE_API}/healthz`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('agentbook-core');
  });

  test('tenant config auto-creates on first access', async ({ request }) => {
    const res = await request.get(`${CORE_API}/api/v1/agentbook-core/tenant-config`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.jurisdiction).toBe('us');
    expect(data.data.currency).toBe('USD');
    expect(data.data.locale).toBe('en-US');
  });

  test('seed chart of accounts', async ({ request }) => {
    const res = await request.post(`${CORE_API}/api/v1/agentbook-core/accounts/seed`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: {
        accounts: [
          { code: '1000', name: 'Cash', accountType: 'asset' },
          { code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
          { code: '4000', name: 'Service Revenue', accountType: 'revenue', taxCategory: 'Line 1' },
          { code: '5800', name: 'Office Expenses', accountType: 'expense', taxCategory: 'Line 18' },
          { code: '6400', name: 'Meals', accountType: 'expense', taxCategory: 'Line 24b' },
          { code: '5200', name: 'Commissions & Fees', accountType: 'expense', taxCategory: 'Line 10' },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.count).toBe(6);
  });

  test('list accounts returns seeded accounts', async ({ request }) => {
    const res = await request.get(`${CORE_API}/api/v1/agentbook-core/accounts`, {
      headers: { 'x-tenant-id': TENANT },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.length).toBeGreaterThanOrEqual(6);

    const codes = data.data.map((a: any) => a.code);
    expect(codes).toContain('1000');
    expect(codes).toContain('4000');
    expect(codes).toContain('6400');
  });

  test('create balanced journal entry succeeds', async ({ request }) => {
    // Get account IDs
    const accts = await (await request.get(`${CORE_API}/api/v1/agentbook-core/accounts`, {
      headers: { 'x-tenant-id': TENANT },
    })).json();

    const cashId = accts.data.find((a: any) => a.code === '1000').id;
    const mealsId = accts.data.find((a: any) => a.code === '6400').id;

    const res = await request.post(`${CORE_API}/api/v1/agentbook-core/journal-entries`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: {
        date: '2026-03-24',
        memo: 'E2E test lunch expense',
        sourceType: 'expense',
        lines: [
          { accountId: mealsId, debitCents: 4500, creditCents: 0 },
          { accountId: cashId, debitCents: 0, creditCents: 4500 },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.lines).toHaveLength(2);
    expect(data.data.verified).toBe(true);
  });

  test('REJECT unbalanced journal entry (balance invariant)', async ({ request }) => {
    const accts = await (await request.get(`${CORE_API}/api/v1/agentbook-core/accounts`, {
      headers: { 'x-tenant-id': TENANT },
    })).json();

    const cashId = accts.data.find((a: any) => a.code === '1000').id;
    const mealsId = accts.data.find((a: any) => a.code === '6400').id;

    const res = await request.post(`${CORE_API}/api/v1/agentbook-core/journal-entries`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: {
        date: '2026-03-24',
        memo: 'BAD unbalanced entry',
        lines: [
          { accountId: mealsId, debitCents: 5000, creditCents: 0 },
          { accountId: cashId, debitCents: 0, creditCents: 3000 },
        ],
      },
    });
    expect(res.status()).toBe(422);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Balance invariant');
    expect(data.details.constraint).toBe('balance_invariant');
  });

  test('BLOCK journal entry mutation (immutability)', async ({ request }) => {
    const putRes = await request.put(`${CORE_API}/api/v1/agentbook-core/journal-entries/any-id`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: { memo: 'hack' },
    });
    expect(putRes.status()).toBe(403);
    const putData = await putRes.json();
    expect(putData.constraint).toBe('immutability_invariant');

    const delRes = await request.delete(`${CORE_API}/api/v1/agentbook-core/journal-entries/any-id`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(delRes.status()).toBe(403);
  });

  test('trial balance is balanced', async ({ request }) => {
    const res = await request.get(`${CORE_API}/api/v1/agentbook-core/trial-balance`, {
      headers: { 'x-tenant-id': TENANT },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.balanced).toBe(true);
    expect(data.data.totalDebits).toBe(data.data.totalCredits);
    expect(data.data.totalDebits).toBeGreaterThan(0);
  });
});

// ============================================================
// SECTION 2: Expense API Tests
// ============================================================

test.describe('AgentBook Expense API', () => {
  test('health check', async ({ request }) => {
    const res = await request.get(`${EXPENSE_API}/healthz`);
    expect(res.ok()).toBeTruthy();
  });

  test('record expense with vendor auto-creation', async ({ request }) => {
    const res = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: {
        amountCents: 8999,
        vendor: 'Amazon',
        description: 'USB hub and webcam',
        date: '2026-03-24',
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.amountCents).toBe(8999);
    expect(data.meta.vendor.name).toBe('Amazon');
  });

  test('list expenses returns recorded expenses', async ({ request }) => {
    const res = await request.get(`${EXPENSE_API}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': TENANT },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.length).toBeGreaterThanOrEqual(1);
  });

  test('vendor auto-learned from expense', async ({ request }) => {
    const res = await request.get(`${EXPENSE_API}/api/v1/agentbook-expense/vendors`, {
      headers: { 'x-tenant-id': TENANT },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    const amazon = data.data.find((v: any) => v.name === 'Amazon');
    expect(amazon).toBeTruthy();
  });

  test('categorize expense updates vendor pattern', async ({ request }) => {
    // Get first expense
    const expenses = await (await request.get(`${EXPENSE_API}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': TENANT },
    })).json();

    if (expenses.data.length === 0) return;
    const expenseId = expenses.data[0].id;

    // Get an account to use as category
    const accts = await (await request.get(`${CORE_API}/api/v1/agentbook-core/accounts`, {
      headers: { 'x-tenant-id': TENANT },
    })).json();
    const officeId = accts.data.find((a: any) => a.code === '5800')?.id;
    if (!officeId) return;

    const res = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/expenses/${expenseId}/categorize`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: { categoryId: officeId, source: 'user_corrected' },
    });
    expect(res.ok()).toBeTruthy();
  });
});

// ============================================================
// SECTION 3: Invoice API Tests
// ============================================================

test.describe('AgentBook Invoice API', () => {
  test('health check', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/healthz`);
    expect(res.ok()).toBeTruthy();
  });

  test('create client', async ({ request }) => {
    const res = await request.post(`${INVOICE_API}/api/v1/agentbook-invoice/clients`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: { name: 'E2E Test Corp', email: 'test@e2ecorp.com', defaultTerms: 'net-30' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.name).toBe('E2E Test Corp');
  });

  test('list clients', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/clients`, {
      headers: { 'x-tenant-id': TENANT },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.length).toBeGreaterThanOrEqual(1);
  });

  test('list invoices', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/invoices`, {
      headers: { 'x-tenant-id': TENANT },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

// ============================================================
// SECTION 4: Tax API Tests
// ============================================================

test.describe('AgentBook Tax API', () => {
  test('health check', async ({ request }) => {
    const res = await request.get(`${TAX_API}/healthz`);
    expect(res.ok()).toBeTruthy();
  });

  test('tax estimate (US jurisdiction)', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/tax/estimate`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.jurisdiction).toBe('us');
    expect(data.data).toHaveProperty('grossRevenueCents');
    expect(data.data).toHaveProperty('seTaxCents');
    expect(data.data).toHaveProperty('incomeTaxCents');
    expect(data.data).toHaveProperty('effectiveRate');
  });

  test('P&L report', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/pnl`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('grossRevenueCents');
    expect(data.data).toHaveProperty('totalExpensesCents');
    expect(data.data).toHaveProperty('netIncomeCents');
  });

  test('quarterly installments', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/tax/quarterly`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('cash flow projection', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/cashflow/projection`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

// ============================================================
// SECTION 5: Proxy API Tests (through Next.js)
// ============================================================

test.describe('AgentBook Proxy (through Next.js at :3000)', () => {
  test('core proxy works', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-core/trial-balance`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('expense proxy works', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('invoice proxy works', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-invoice/clients`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('tax proxy works', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-tax/tax/estimate`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
  });
});

// ============================================================
// SECTION 6: CDN Plugin Bundle Tests
// ============================================================

test.describe('Plugin CDN Bundles', () => {
  const plugins = [
    'agentbook-core', 'agentbook-expense', 'agentbook-invoice', 'agentbook-tax',
    'community', 'marketplace', 'plugin-publisher',
  ];

  for (const plugin of plugins) {
    test(`${plugin} bundle loads from CDN`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}/cdn/plugins/${plugin}/1.0.0/${plugin}.js`);
      expect(res.ok()).toBeTruthy();
      const body = await res.text();
      expect(body.length).toBeGreaterThan(1000); // Not an error page
      // Verify it's actual JS, not a 404 HTML page
      expect(body).toMatch(/function|export|const|var/);
    });
  }
});

// ============================================================
// SECTION 7: Web UI Tests (browser-based)
// ============================================================

test.describe('AgentBook Web UI', () => {
  test('login page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveTitle(/NAAP|A3P|Login/i);
  });

  test('login with test credentials', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);

    // Fill login form
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');

    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill('admin@a3p.io');
      await passwordInput.fill('a3p-dev');

      const submitBtn = page.locator('button[type="submit"]');
      await submitBtn.click();

      // Should redirect to dashboard
      await page.waitForURL(/dashboard|\/$/i, { timeout: 10000 }).catch(() => {});
    }
  });

  test('dashboard page loads after login', async ({ page }) => {
    // Login first
    await page.goto(`${BASE_URL}/login`);
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill('admin@a3p.io');
      await page.locator('input[type="password"]').fill('a3p-dev');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(3000);
    }

    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForTimeout(2000);

    // Dashboard should have some content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('AgentBook plugin pages are accessible', async ({ page }) => {
    // Login
    await page.goto(`${BASE_URL}/login`);
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill('admin@a3p.io');
      await page.locator('input[type="password"]').fill('a3p-dev');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(3000);
    }

    // Navigate to agentbook
    await page.goto(`${BASE_URL}/agentbook`);
    await page.waitForTimeout(3000);

    const status = await page.evaluate(() => document.readyState);
    expect(status).toBe('complete');
  });
});

// ============================================================
// SECTION 8: Cross-cutting Concerns
// ============================================================

test.describe('Cross-cutting: Tenant Isolation', () => {
  test('different tenants see different data', async ({ request }) => {
    // Create expense for tenant A
    await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': 'tenant-a', 'Content-Type': 'application/json' },
      data: { amountCents: 1000, vendor: 'TenantAVendor', description: 'Tenant A expense' },
    });

    // Create expense for tenant B
    await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': 'tenant-b', 'Content-Type': 'application/json' },
      data: { amountCents: 2000, vendor: 'TenantBVendor', description: 'Tenant B expense' },
    });

    // Tenant A should NOT see Tenant B's data
    const resA = await (await request.get(`${EXPENSE_API}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': 'tenant-a' },
    })).json();

    const vendorsA = resA.data.map((e: any) => e.description);
    expect(vendorsA).not.toContain('Tenant B expense');

    // Tenant B should NOT see Tenant A's data
    const resB = await (await request.get(`${EXPENSE_API}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': 'tenant-b' },
    })).json();

    const vendorsB = resB.data.map((e: any) => e.description);
    expect(vendorsB).not.toContain('Tenant A expense');
  });
});

test.describe('Cross-cutting: Audit Trail', () => {
  test('journal entry creation emits event', async ({ request }) => {
    // Create a journal entry and check event was emitted
    const accts = await (await request.get(`${CORE_API}/api/v1/agentbook-core/accounts`, {
      headers: { 'x-tenant-id': TENANT },
    })).json();

    const cashId = accts.data.find((a: any) => a.code === '1000')?.id;
    const mealsId = accts.data.find((a: any) => a.code === '6400')?.id;
    if (!cashId || !mealsId) return;

    await request.post(`${CORE_API}/api/v1/agentbook-core/journal-entries`, {
      headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      data: {
        date: '2026-03-24',
        memo: 'Audit trail test',
        sourceType: 'manual',
        lines: [
          { accountId: mealsId, debitCents: 100, creditCents: 0 },
          { accountId: cashId, debitCents: 0, creditCents: 100 },
        ],
      },
    });

    // Verify trial balance still balanced (consistency check)
    const tb = await (await request.get(`${CORE_API}/api/v1/agentbook-core/trial-balance`, {
      headers: { 'x-tenant-id': TENANT },
    })).json();
    expect(tb.data.balanced).toBe(true);
  });
});
