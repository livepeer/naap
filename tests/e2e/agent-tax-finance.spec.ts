import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('Tax & Finance Agent Skills', () => {
  test('tax-estimate: "how much tax do I owe?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'how much tax do I owe?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-estimate');
  });

  test('quarterly-payments: "show quarterly tax payments"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show quarterly tax payments', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('quarterly-payments');
  });

  test('tax-deductions: "what deductions can I claim?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'what deductions can I claim?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-deductions');
  });

  test('pnl-report: "show profit and loss"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show profit and loss', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('pnl-report');
  });

  test('balance-sheet: "show balance sheet"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my balance sheet', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('balance-sheet');
  });

  test('cashflow-report: "how long will my cash last?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'how long will my cash last?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('cashflow-report');
  });

  test('financial-snapshot: "financial summary"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'give me a financial summary', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('financial-snapshot');
  });

  test('money-moves: "what should I do with my money?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'what money moves should I make?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('money-moves');
  });

  test('bank-reconciliation: "check reconciliation status"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'check bank reconciliation status', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('bank-reconciliation');
  });
});
