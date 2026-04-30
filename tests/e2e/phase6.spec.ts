/**
 * AgentBook Phase 6 E2E Tests — Production Hardening
 * Tests: onboarding, CPA portal, 10 new reports, Plaid/Stripe/OCR endpoints
 */
import { test, expect } from '@playwright/test';

const CORE_API = process.env.CORE_API || 'http://localhost:4050';
const EXPENSE_API = process.env.EXPENSE_API || 'http://localhost:4051';
const TAX_API = process.env.TAX_API || 'http://localhost:4053';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TENANT = 'p6-e2e-test';
const H = { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' };

// ============================================================
// Onboarding Flow
// ============================================================

test.describe('Phase 6: Onboarding', () => {
  test('get onboarding progress (auto-creates)', async ({ request }) => {
    const res = await request.get(`${CORE_API}/api/v1/agentbook-core/onboarding`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.steps).toHaveLength(7);
    expect(data.data.percentComplete).toBeGreaterThanOrEqual(0);
  });

  test('complete onboarding step', async ({ request }) => {
    const res = await request.post(`${CORE_API}/api/v1/agentbook-core/onboarding/complete-step`, {
      headers: H, data: { stepId: 'business_type' },
    });
    expect(res.ok()).toBeTruthy();

    // Verify progress updated
    const progress = await (await request.get(`${CORE_API}/api/v1/agentbook-core/onboarding`, { headers: H })).json();
    expect(progress.data.steps.find((s: any) => s.id === 'business_type').completed).toBe(true);
    expect(progress.data.percentComplete).toBeGreaterThan(0);
  });

  test('seed jurisdiction accounts', async ({ request }) => {
    const res = await request.post(`${CORE_API}/api/v1/agentbook-core/accounts/seed-jurisdiction`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.count).toBeGreaterThanOrEqual(15); // US default has ~21 accounts
  });
});

// ============================================================
// CPA Collaboration
// ============================================================

test.describe('Phase 6: CPA Portal', () => {
  test('generate CPA link', async ({ request }) => {
    const res = await request.post(`${CORE_API}/api/v1/agentbook-core/cpa/generate-link`, {
      headers: H, data: { email: 'cpa@test.com' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.token).toBeTruthy();
    expect(data.data.expiresAt).toBeTruthy();
  });

  test('create and list CPA notes', async ({ request }) => {
    await request.post(`${CORE_API}/api/v1/agentbook-core/cpa/notes`, {
      headers: H, data: { content: 'Need receipt for $2,800 office equipment' },
    });

    const res = await request.get(`${CORE_API}/api/v1/agentbook-core/cpa/notes`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.length).toBeGreaterThanOrEqual(1);
    expect(data.data[0].content).toContain('receipt');
  });
});

// ============================================================
// Additional Reports (10 new)
// ============================================================

test.describe('Phase 6: Additional Reports', () => {
  test('AR aging detail', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/ar-aging-detail`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('buckets');
    expect(data.data).toHaveProperty('totalOutstandingCents');
  });

  test('expense by vendor', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/expense-by-vendor`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).success).toBe(true);
  });

  test('income by client', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/income-by-client`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).success).toBe(true);
  });

  test('tax summary by category', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/tax-summary`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('taxYear');
    expect(data.data).toHaveProperty('categories');
  });

  test('monthly expense trend', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/monthly-expense-trend`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveLength(12); // 12 months
  });

  test('quarterly comparison', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/quarterly-comparison`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveLength(4); // 4 quarters
  });

  test('annual summary', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/annual-summary`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('year');
    expect(data.data).toHaveProperty('revenueCents');
    expect(data.data).toHaveProperty('expenseCount');
  });

  test('receipt audit log', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/receipt-audit`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('total');
    expect(data.data).toHaveProperty('coveragePercent');
    expect(data.data).toHaveProperty('missingReceipts');
  });

  test('bank reconciliation detail', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/bank-reconciliation`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('total');
    expect(data.data).toHaveProperty('matchRate');
  });

  test('earnings projection', async ({ request }) => {
    const res = await request.get(`${TAX_API}/api/v1/agentbook-tax/reports/earnings-projection`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('ytdRevenueCents');
    expect(data.data).toHaveProperty('projectedAnnualCents');
    expect(data.data).toHaveProperty('confidenceLow');
    expect(data.data).toHaveProperty('confidenceHigh');
  });
});

// ============================================================
// Plaid Integration
// ============================================================

test.describe('Phase 6: Plaid Integration', () => {
  test('create Plaid link token', async ({ request }) => {
    const res = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/plaid/create-link-token`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.linkToken).toBeTruthy();
    expect(data.data.environment).toBe('sandbox');
  });

  test('exchange Plaid token + create bank account', async ({ request }) => {
    const res = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/plaid/exchange-token`, {
      headers: H, data: { publicToken: 'public-sandbox-test', institutionName: 'Test Bank' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.institution).toBe('Test Bank');
    expect(data.data.connected).toBe(true);
  });

  test('list bank accounts', async ({ request }) => {
    const res = await request.get(`${EXPENSE_API}/api/v1/agentbook-expense/bank-accounts`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.length).toBeGreaterThanOrEqual(1);
  });

  test('trigger bank sync', async ({ request }) => {
    const res = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/bank-sync`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('accountsSynced');
  });

  test('reconciliation summary', async ({ request }) => {
    const res = await request.get(`${EXPENSE_API}/api/v1/agentbook-expense/reconciliation-summary`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('matchRate');
  });
});

// ============================================================
// Stripe Integration
// ============================================================

test.describe('Phase 6: Stripe Webhook', () => {
  test('process Stripe webhook (idempotent)', async ({ request }) => {
    const eventId = `evt_test_${Date.now()}`;

    // First call
    const res1 = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/stripe/webhook`, {
      headers: H, data: { id: eventId, type: 'payment_intent.succeeded', amount: 50000 },
    });
    expect(res1.ok()).toBeTruthy();

    // Second call (duplicate) — should still succeed (idempotent)
    const res2 = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/stripe/webhook`, {
      headers: H, data: { id: eventId, type: 'payment_intent.succeeded', amount: 50000 },
    });
    expect(res2.ok()).toBeTruthy();
    const data2 = await res2.json();
    expect(data2.message).toBe('Already processed');
  });
});

// ============================================================
// Receipt OCR Endpoint
// ============================================================

test.describe('Phase 6: Receipt OCR', () => {
  test('OCR endpoint active and returns structured response', async ({ request }) => {
    const res = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/receipts/ocr`, {
      headers: H, data: { imageUrl: 'https://example.com/receipt.jpg' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toHaveProperty('amount_cents');
    expect(data.data).toHaveProperty('vendor');
    expect(data.data).toHaveProperty('confidence');
    expect(data.data).toHaveProperty('status');
  });

  test('OCR requires imageUrl', async ({ request }) => {
    const res = await request.post(`${EXPENSE_API}/api/v1/agentbook-expense/receipts/ocr`, {
      headers: H, data: {},
    });
    expect(res.status()).toBe(400);
  });
});

// ============================================================
// Proxy Through Next.js
// ============================================================

test.describe('Phase 6: Proxy Regression', () => {
  test('onboarding through proxy', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-core/onboarding`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('new reports through proxy', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-tax/reports/annual-summary`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('plaid through proxy', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/v1/agentbook-expense/plaid/create-link-token`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});
