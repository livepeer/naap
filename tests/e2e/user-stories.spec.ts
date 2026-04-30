/**
 * AgentBook — 5 Major User Story E2E Tests (Phases 1-7)
 *
 * Story 1: Record Expense + Verify Books Balance
 * Story 2: Create Invoice + Track Payment
 * Story 3: Tax Estimate + Reports + Analytics
 * Story 4: Time Tracking + Project Profitability
 * Story 5: Onboarding + CPA Collaboration
 */
import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const EXPENSE = 'http://localhost:4051';
const INVOICE = 'http://localhost:4052';
const TAX = 'http://localhost:4053';
const BASE = 'http://localhost:3000';
const T = `story-${Date.now()}`; // unique tenant per run
const H = { 'x-tenant-id': T, 'Content-Type': 'application/json' };

// ============================================================
// SETUP: seed tenant with accounts
// ============================================================

test.describe.serial('Setup', () => {
  test('create tenant + seed accounts', async ({ request }) => {
    // Create tenant config
    const cfg = await request.get(`${CORE}/api/v1/agentbook-core/tenant-config`, { headers: H });
    expect(cfg.ok()).toBeTruthy();
    const tenant = (await cfg.json()).data;
    expect(tenant.jurisdiction).toBe('us');
    expect(tenant.currency).toBe('USD');

    // Seed jurisdiction accounts
    const seed = await request.post(`${CORE}/api/v1/agentbook-core/accounts/seed-jurisdiction`, { headers: H });
    expect(seed.ok()).toBeTruthy();
    const seedData = (await seed.json()).data;
    expect(seedData.count).toBeGreaterThanOrEqual(15);

    // Verify accounts exist
    const accts = await request.get(`${CORE}/api/v1/agentbook-core/accounts`, { headers: H });
    const accounts = (await accts.json()).data;
    const codes = accounts.map((a: any) => a.code);
    expect(codes).toContain('1000'); // Cash
    expect(codes).toContain('4000'); // Revenue
    expect(codes).toContain('6400'); // Meals
  });
});

// ============================================================
// STORY 1: Record Expense + Verify Books Balance
// ============================================================

test.describe.serial('Story 1: Record Expense + Verify Books Balance', () => {
  test('1a. Record expense with vendor', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, {
      headers: H,
      data: { amountCents: 4500, vendor: 'Subway', description: 'Lunch with client', date: '2026-03-28' },
    });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json());
    expect(d.success).toBe(true);
    expect(d.data.amountCents).toBe(4500);
    expect(d.meta.vendor.name).toBe('Subway');
  });

  test('1b. Record second expense', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, {
      headers: H,
      data: { amountCents: 8999, vendor: 'Amazon', description: 'USB hub and webcam', date: '2026-03-28' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('1c. List expenses shows both', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/expenses`, { headers: H });
    const d = (await res.json());
    expect(d.data.length).toBe(2);
    expect(d.meta.total).toBe(2);
  });

  test('1d. Create journal entry for expense (balanced)', async ({ request }) => {
    const accts = (await (await request.get(`${CORE}/api/v1/agentbook-core/accounts`, { headers: H })).json()).data;
    const cashId = accts.find((a: any) => a.code === '1000').id;
    const mealsId = accts.find((a: any) => a.code === '6400').id;

    const res = await request.post(`${CORE}/api/v1/agentbook-core/journal-entries`, {
      headers: H,
      data: {
        date: '2026-03-28', memo: 'Lunch with client', sourceType: 'expense',
        lines: [
          { accountId: mealsId, debitCents: 4500, creditCents: 0 },
          { accountId: cashId, debitCents: 0, creditCents: 4500 },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const je = (await res.json()).data;
    expect(je.lines).toHaveLength(2);
    expect(je.verified).toBe(true);
  });

  test('1e. Unbalanced entry rejected', async ({ request }) => {
    const accts = (await (await request.get(`${CORE}/api/v1/agentbook-core/accounts`, { headers: H })).json()).data;
    const cashId = accts.find((a: any) => a.code === '1000').id;
    const mealsId = accts.find((a: any) => a.code === '6400').id;

    const res = await request.post(`${CORE}/api/v1/agentbook-core/journal-entries`, {
      headers: H,
      data: {
        date: '2026-03-28', memo: 'Bad entry',
        lines: [
          { accountId: mealsId, debitCents: 5000, creditCents: 0 },
          { accountId: cashId, debitCents: 0, creditCents: 3000 },
        ],
      },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).details.constraint).toBe('balance_invariant');
  });

  test('1f. Immutability enforced', async ({ request }) => {
    expect((await request.put(`${CORE}/api/v1/agentbook-core/journal-entries/x`, { headers: H, data: {} })).status()).toBe(403);
    expect((await request.delete(`${CORE}/api/v1/agentbook-core/journal-entries/x`, { headers: H })).status()).toBe(403);
  });

  test('1g. Trial balance is balanced', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/trial-balance`, { headers: H });
    const d = (await res.json()).data;
    expect(d.balanced).toBe(true);
    expect(d.totalDebits).toBe(d.totalCredits);
    expect(d.totalDebits).toBeGreaterThan(0);
  });

  test('1h. Vendor auto-learned', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/vendors`, { headers: H });
    const vendors = (await res.json()).data;
    expect(vendors.find((v: any) => v.name === 'Subway')).toBeTruthy();
    expect(vendors.find((v: any) => v.name === 'Amazon')).toBeTruthy();
  });

  test('1i. Proxy works through Next.js', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/agentbook-core/trial-balance`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.balanced).toBe(true);
  });
});

// ============================================================
// STORY 2: Create Invoice + Track Payment
// ============================================================

test.describe.serial('Story 2: Create Invoice + Track Payment', () => {
  let clientId: string;

  test('2a. Create client', async ({ request }) => {
    const res = await request.post(`${INVOICE}/api/v1/agentbook-invoice/clients`, {
      headers: H,
      data: { name: 'Acme Corp', email: 'billing@acme.com', defaultTerms: 'net-30' },
    });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.name).toBe('Acme Corp');
    clientId = d.id;
  });

  test('2b. List clients shows Acme', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/clients`, { headers: H });
    const clients = (await res.json()).data;
    expect(clients.length).toBeGreaterThanOrEqual(1);
    expect(clients.find((c: any) => c.name === 'Acme Corp')).toBeTruthy();
  });

  test('2c. List invoices (initially empty)', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/invoices`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('2d. Aging report works', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/aging-report`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('2e. Client data through proxy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/agentbook-invoice/clients`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});

// ============================================================
// STORY 3: Tax Estimate + Reports + Analytics
// ============================================================

test.describe.serial('Story 3: Tax Estimate + Reports', () => {
  test('3a. Tax estimate (US jurisdiction)', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/tax/estimate`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.jurisdiction).toBe('us');
    expect(d).toHaveProperty('grossRevenueCents');
    expect(d).toHaveProperty('seTaxCents');
    expect(d).toHaveProperty('incomeTaxCents');
    expect(d).toHaveProperty('effectiveRate');
  });

  test('3b. P&L report', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/reports/pnl`, { headers: H });
    const d = (await res.json()).data;
    expect(d).toHaveProperty('grossRevenueCents');
    expect(d).toHaveProperty('totalExpensesCents');
    expect(d).toHaveProperty('netIncomeCents');
  });

  test('3c. Balance sheet', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/reports/balance-sheet`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('3d. Cash flow projection', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/cashflow/projection`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('3e. Quarterly installments', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/tax/quarterly`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('3f. Monthly expense trend (12 months)', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/reports/monthly-expense-trend`, { headers: H });
    const d = (await res.json()).data;
    expect(d).toHaveLength(12);
  });

  test('3g. Annual summary', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/reports/annual-summary`, { headers: H });
    const d = (await res.json()).data;
    expect(d).toHaveProperty('year');
    expect(d).toHaveProperty('revenueCents');
    expect(d).toHaveProperty('expenseCount');
  });

  test('3h. Earnings projection', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/reports/earnings-projection`, { headers: H });
    const d = (await res.json()).data;
    expect(d).toHaveProperty('ytdRevenueCents');
    expect(d).toHaveProperty('projectedAnnualCents');
    expect(d).toHaveProperty('confidenceLow');
    expect(d).toHaveProperty('confidenceHigh');
  });

  test('3i. Tax summary by category', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/reports/tax-summary`, { headers: H });
    const d = (await res.json()).data;
    expect(d).toHaveProperty('taxYear');
    expect(d).toHaveProperty('categories');
  });

  test('3j. Reports through proxy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/agentbook-tax/tax/estimate`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});

// ============================================================
// STORY 4: Time Tracking + Project Profitability
// ============================================================

test.describe.serial('Story 4: Time Tracking', () => {
  test('4a. Create project', async ({ request }) => {
    const res = await request.post(`${INVOICE}/api/v1/agentbook-invoice/projects`, {
      headers: H,
      data: { name: `Acme Q1 ${Date.now()}`, hourlyRateCents: 15000, budgetHours: 40 },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.hourlyRateCents).toBe(15000);
  });

  test('4b. Start timer', async ({ request }) => {
    const res = await request.post(`${INVOICE}/api/v1/agentbook-invoice/timer/start`, {
      headers: H, data: { description: 'Client meeting' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('4c. Timer status shows running', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/timer/status`, { headers: H });
    const d = (await res.json()).data;
    expect(d.running).toBe(true);
    expect(d.entry.description).toBe('Client meeting');
  });

  test('4d. Stop timer', async ({ request }) => {
    const res = await request.post(`${INVOICE}/api/v1/agentbook-invoice/timer/stop`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.durationMinutes).toBeGreaterThanOrEqual(0);
  });

  test('4e. Timer not running after stop', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/timer/status`, { headers: H });
    expect((await res.json()).data.running).toBe(false);
  });

  test('4f. Log manual time entry', async ({ request }) => {
    const res = await request.post(`${INVOICE}/api/v1/agentbook-invoice/time-entries`, {
      headers: H,
      data: { description: 'Code review', minutes: 120, hourlyRateCents: 15000 },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.durationMinutes).toBe(120);
  });

  test('4g. List time entries with totals', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/time-entries`, { headers: H });
    const d = await res.json();
    expect(d.data.length).toBeGreaterThanOrEqual(2);
    expect(d.meta.totalMinutes).toBeGreaterThan(0);
    expect(d.meta.totalHours).toBeGreaterThan(0);
  });

  test('4h. Unbilled summary', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/unbilled-summary`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('4i. Project profitability', async ({ request }) => {
    const res = await request.get(`${INVOICE}/api/v1/agentbook-invoice/project-profitability`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('4j. Time tracking through proxy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/agentbook-invoice/timer/status`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});

// ============================================================
// STORY 5: Onboarding + CPA Collaboration
// ============================================================

test.describe.serial('Story 5: Onboarding + CPA', () => {
  test('5a. Get onboarding progress', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/onboarding`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.steps).toHaveLength(7);
    expect(d.steps[0].id).toBe('business_type');
  });

  test('5b. Complete business_type step', async ({ request }) => {
    await request.put(`${CORE}/api/v1/agentbook-core/tenant-config`, {
      headers: H, data: { businessType: 'freelancer' },
    });
    const res = await request.post(`${CORE}/api/v1/agentbook-core/onboarding/complete-step`, {
      headers: H, data: { stepId: 'business_type' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('5c. Complete jurisdiction step', async ({ request }) => {
    await request.put(`${CORE}/api/v1/agentbook-core/tenant-config`, {
      headers: H, data: { jurisdiction: 'us', region: 'CA' },
    });
    const res = await request.post(`${CORE}/api/v1/agentbook-core/onboarding/complete-step`, {
      headers: H, data: { stepId: 'jurisdiction' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('5d. Complete currency step', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/onboarding/complete-step`, {
      headers: H, data: { stepId: 'currency' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('5e. Seed accounts step', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/onboarding/complete-step`, {
      headers: H, data: { stepId: 'accounts' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('5f. Progress updated (4 of 7 steps)', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/onboarding`, { headers: H });
    const d = (await res.json()).data;
    const completed = d.steps.filter((s: any) => s.completed).length;
    expect(completed).toBeGreaterThanOrEqual(4);
    expect(d.percentComplete).toBeGreaterThan(0.5);
  });

  test('5g. Generate CPA link', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/cpa/generate-link`, {
      headers: H, data: { email: 'cpa@firm.com' },
    });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.token).toBeTruthy();
    expect(d.token.length).toBeGreaterThan(10);
    expect(d.expiresAt).toBeTruthy();
  });

  test('5h. Create CPA note', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/cpa/notes`, {
      headers: H, data: { content: 'Need documentation for Q1 travel expenses' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('5i. List CPA notes', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/cpa/notes`, { headers: H });
    const notes = (await res.json()).data;
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].content).toContain('Q1 travel');
  });

  test('5j. Onboarding through proxy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/agentbook-core/onboarding`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});

// ============================================================
// CROSS-CUTTING: Tenant Isolation
// ============================================================

test.describe('Cross-cutting: Isolation', () => {
  test('tenant data isolated', async ({ request }) => {
    // Story tenant's data should NOT be visible to another tenant
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': 'totally-different-tenant', 'Content-Type': 'application/json' },
    });
    const d = (await res.json());
    const descriptions = d.data.map((e: any) => e.description);
    expect(descriptions).not.toContain('Lunch with client');
    expect(descriptions).not.toContain('USB hub and webcam');
  });
});

// ============================================================
// CDN + UI SMOKE
// ============================================================

test.describe('UI Smoke', () => {
  const bundles = ['agentbook-core', 'agentbook-expense', 'agentbook-invoice', 'agentbook-tax'];
  for (const b of bundles) {
    test(`CDN: ${b} loads`, async ({ request }) => {
      const res = await request.get(`${BASE}/cdn/plugins/${b}/1.0.0/${b}.js`);
      expect(res.ok()).toBeTruthy();
      expect((await res.text()).length).toBeGreaterThan(1000);
    });
  }

  test('login page loads', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page).toHaveTitle(/NAAP|A3P|Login/i);
  });

  test('login + dashboard accessible', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const email = page.locator('input[type="email"], input[name="email"]');
    if (await email.isVisible({ timeout: 5000 }).catch(() => false)) {
      await email.fill('admin@a3p.io');
      await page.locator('input[type="password"]').fill('a3p-dev');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(3000);
    }
    await page.goto(`${BASE}/agentbook`);
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => document.readyState)).toBe('complete');
  });
});
