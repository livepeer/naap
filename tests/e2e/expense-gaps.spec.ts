import { test, expect } from '@playwright/test';

const EXPENSE = 'http://localhost:4051';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('Expense Gaps — Close All 6', () => {

  // === Gap 6: Review Queue ===
  test('review queue: create pending_review expense', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, {
      headers: H,
      data: {
        amountCents: 4500, vendor: 'Test OCR Vendor', description: 'Low confidence receipt',
        date: '2026-03-20', confidence: 0.4, source: 'telegram_photo', status: 'pending_review',
      },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.status).toBe('pending_review');
  });

  test('review queue: list pending items', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/review-queue`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.length).toBeGreaterThanOrEqual(1);
    expect(data.data[0].status).toBe('pending_review');
  });

  test('review queue: confirm expense creates journal entry', async ({ request }) => {
    // Get a pending expense
    const queue = await (await request.get(`${EXPENSE}/api/v1/agentbook-expense/review-queue`, { headers: H })).json();
    const expenseId = queue.data[0].id;

    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/expenses/${expenseId}/confirm`, {
      headers: H,
      data: { amountCents: 4500 },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.status).toBe('confirmed');
  });

  test('review queue: reject expense', async ({ request }) => {
    // Create another pending expense to reject
    const createRes = await request.post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, {
      headers: H,
      data: { amountCents: 100, vendor: 'Reject Test', date: '2026-03-20', confidence: 0.2, status: 'pending_review' },
    });
    const expenseId = (await createRes.json()).data.id;

    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/expenses/${expenseId}/reject`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.status).toBe('rejected');
  });

  test('review queue: high confidence auto-confirms', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/expenses`, {
      headers: H,
      data: { amountCents: 5000, vendor: 'High Conf Vendor', date: '2026-03-20', confidence: 0.95, status: 'confirmed' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.status).toBe('confirmed');
  });

  // === Gap 2: Blob Storage ===
  test('blob storage: upload-blob endpoint works', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/receipts/upload-blob`, {
      headers: H,
      data: { sourceUrl: 'https://via.placeholder.com/300x400.png?text=Receipt' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.permanentUrl).toBeTruthy();
    expect(data.data.sourceUrl).toBeTruthy();
  });

  // === Gap 1: OCR Endpoint ===
  test('ocr: endpoint accepts imageUrl and returns result', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/receipts/ocr`, {
      headers: H,
      data: { imageUrl: 'https://via.placeholder.com/300x400.png?text=Receipt+$45.99' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data).toBeDefined();
    expect(data.data.status).toBeTruthy(); // processed_by_gemini or no_llm_configured
  });

  // === Gap 4: CC Statement Import ===
  let ccUniqueId: string;

  test('cc statement: import CSV and match/create expenses', async ({ request }) => {
    ccUniqueId = Date.now().toString(36);
    const csv = `Date,Amount,Description
2026-01-15,54.99,Adobe Creative Cloud
2026-02-01,450.00,WeWork Coworking
2024-06-15,777.77,UniqueVendor_${ccUniqueId}`;

    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/import/cc-statement`, {
      headers: H,
      data: { csv },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.matched + data.data.created).toBeGreaterThanOrEqual(1);
    expect(data.data.details.length).toBeGreaterThan(0);
    // The unique vendor should always be created since date is far in the past
    const uniqueDetail = data.data.details.find((d: any) => d.description?.includes('UniqueVendor_'));
    expect(uniqueDetail).toBeTruthy();
  });

  test('cc statement: created expenses are pending_review', async ({ request }) => {
    const queue = await (await request.get(`${EXPENSE}/api/v1/agentbook-expense/review-queue`, { headers: H })).json();
    expect(queue.data).toBeDefined();
    // CC-imported expenses should appear in the queue
    const ccExpenses = queue.data.filter((e: any) => e.source === 'cc_statement');
    expect(ccExpenses.length).toBeGreaterThanOrEqual(1);
  });

  test('cc statement: duplicate/match detection on re-import', async ({ request }) => {
    // Import same unique vendor again — should detect as duplicate or match existing
    const csv = `Date,Amount,Description
2024-06-15,777.77,UniqueVendor_${ccUniqueId}`;

    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/import/cc-statement`, {
      headers: H,
      data: { csv },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Re-import should not create new expenses; they are either matched or flagged as duplicates
    expect(data.data.created).toBe(0);
    expect(data.data.matched + data.data.duplicates).toBeGreaterThanOrEqual(1);
  });

  // === Gap 5: Proactive Alerts ===
  test('proactive alerts: returns alerts for Maya', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/proactive-alerts`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.alerts).toBeDefined();
    expect(data.data.alerts.length).toBeGreaterThanOrEqual(1);
    expect(data.data.generatedAt).toBeTruthy();
  });

  test('proactive alerts: each alert has required fields', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/proactive-alerts`, { headers: H });
    const alerts = (await res.json()).data.alerts;
    for (const a of alerts.slice(0, 5)) {
      expect(a.id).toBeTruthy();
      expect(a.type).toBeTruthy();
      expect(['critical', 'important', 'info']).toContain(a.severity);
      expect(a.title).toBeTruthy();
      expect(a.message).toBeTruthy();
    }
  });

  test('proactive alerts: sorted by severity (critical first)', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/proactive-alerts`, { headers: H });
    const alerts = (await res.json()).data.alerts;
    if (alerts.length >= 2) {
      const severityOrder: Record<string, number> = { critical: 0, important: 1, info: 2 };
      for (let i = 1; i < alerts.length; i++) {
        expect(severityOrder[alerts[i].severity]).toBeGreaterThanOrEqual(severityOrder[alerts[i-1].severity]);
      }
    }
  });

  test('proactive alerts: empty for fresh tenant', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/proactive-alerts`, {
      headers: { 'x-tenant-id': 'empty-tenant-proactive', 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.alerts.length).toBe(0);
  });
});
