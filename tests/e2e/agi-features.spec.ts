import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const BASE = 'http://localhost:3000';
const T = `agi-${Date.now()}`;
const H = { 'x-tenant-id': T, 'Content-Type': 'application/json' };

test.describe.serial('AGI Feature Tests', () => {
  test('setup: create tenant + seed accounts + add data', async ({ request }) => {
    await request.get(`${CORE}/api/v1/agentbook-core/tenant-config`, { headers: H });
    await request.post(`${CORE}/api/v1/agentbook-core/accounts/seed-jurisdiction`, { headers: H });

    // Add revenue journal entry
    const accts = (await (await request.get(`${CORE}/api/v1/agentbook-core/accounts`, { headers: H })).json()).data;
    const cashId = accts.find((a: any) => a.code === '1000')?.id;
    const revId = accts.find((a: any) => a.code === '4000')?.id;
    if (cashId && revId) {
      await request.post(`${CORE}/api/v1/agentbook-core/journal-entries`, {
        headers: H, data: { date: '2026-06-15', memo: 'Revenue', sourceType: 'invoice',
          lines: [{ accountId: cashId, debitCents: 5000000, creditCents: 0 }, { accountId: revId, debitCents: 0, creditCents: 5000000 }] },
      });
    }
  });

  test('Feature 2: conversational memory — ask about revenue', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/ask`, {
      headers: H, data: { question: 'How much revenue do I have?' },
    });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.answer).toContain('$');
    expect(d.data.totalRevenueCents).toBeGreaterThan(0);
  });

  test('Feature 2: ask about expenses', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/ask`, {
      headers: H, data: { question: 'How much did I spend?' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.answer).toBeTruthy();
  });

  test('Feature 2: ask about cash balance', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/ask`, {
      headers: H, data: { question: 'What is my cash balance?' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.answer).toContain('$');
  });

  test('Feature 3: money moves analysis', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/money-moves`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const moves = (await res.json()).data;
    expect(Array.isArray(moves)).toBe(true);
  });

  test('Feature 4: tax package generation', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/tax-package?year=2026`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const pkg = (await res.json()).data;
    expect(pkg).toHaveProperty('jurisdiction');
    expect(pkg).toHaveProperty('grossIncomeCents');
    expect(pkg).toHaveProperty('netIncomeCents');
    expect(pkg).toHaveProperty('expensesByCategory');
    expect(pkg).toHaveProperty('receiptCoverage');
    expect(pkg).toHaveProperty('readyToFile');
    expect(pkg).toHaveProperty('missingItems');
  });

  test('Feature 5: client health intelligence', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/client-health`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = (await res.json()).data;
    expect(Array.isArray(data)).toBe(true);
  });

  test('Feature 7: autopilot status', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/autopilot`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d).toHaveProperty('trustLevel');
    expect(d).toHaveProperty('trustPhase');
    expect(d).toHaveProperty('accuracy');
    expect(d.trustPhase).toMatch(/training|learning|confident|autopilot/);
  });

  test('Feature 2: ask through proxy', async ({ request }) => {
    const res = await request.post(`${BASE}/api/v1/agentbook-core/ask`, {
      headers: H, data: { question: 'What is my tax estimate?' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('Feature 4: tax package through proxy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/agentbook-core/tax-package?year=2026`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});
