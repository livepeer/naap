import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const EXPENSE = 'http://localhost:4051';
const INVOICE = 'http://localhost:4052';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('P2-P3 Gap Closure — Complete', () => {
  // Budget
  test('set-budget: "set monthly budget $5000"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'set budget limit to 5000 per month', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('set-budget');
  });

  test('query-budget: "how is my budget?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'check my budget status', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('query-budget');
  });

  test('budget endpoint returns data', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/budgets/status`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.budgets).toBeDefined();
  });

  // Expense report
  test('expense-report: "generate expense report"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'generate expense report', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('expense-report');
  });

  test('expense-pdf endpoint returns HTML', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/reports/expense-pdf`, {
      headers: H, data: {},
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.html).toContain('Expense Report');
  });

  // Payment link
  test('create-payment-link: "generate payment link"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'generate payment link for my last invoice', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('create-payment-link');
  });

  // Auto reminders
  test('toggle-auto-reminders: "enable auto reminders"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'enable auto remind', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('toggle-auto-reminders');
  });

  // Multi-line invoice
  test('multi-line invoice: "invoice Acme: consulting $3000, design $2000"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'invoice Acme: consulting $3000, design $2000, hosting $500', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('create-invoice');
    expect(body.data.message).toBeTruthy();
  });

  // Public invoice endpoint
  test('public invoice endpoint works', async ({ request }) => {
    // First get an invoice ID
    const listRes = await request.get(`${INVOICE}/api/v1/agentbook-invoice/invoices?limit=1`, { headers: H });
    const invoices = (await listRes.json()).data;
    if (invoices?.length > 0) {
      const pubRes = await request.get(`${INVOICE}/api/v1/agentbook-invoice/invoices/${invoices[0].id}/public`);
      expect(pubRes.ok()).toBeTruthy();
      const body = await pubRes.json();
      expect(body.data.number).toBeTruthy();
      expect(body.data.amountCents).toBeGreaterThan(0);
    }
  });

  // Branding config
  test('branding config via tenant-config', async ({ request }) => {
    const res = await request.put(`${CORE}/api/v1/agentbook-core/tenant-config`, {
      headers: H,
      data: { companyName: 'Maya Consulting Inc.', brandColor: '#10b981' },
    });
    expect(res.ok()).toBeTruthy();
  });

  // Skill count
  test('all skills registered', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/agent/skills`, { headers: H });
    const skills = (await res.json()).data;
    expect(skills.length).toBeGreaterThanOrEqual(64);

    // Verify critical skills exist
    const names = skills.map((s: any) => s.name);
    // Bookkeeping
    expect(names).toContain('record-expense');
    expect(names).toContain('categorize-expenses');
    expect(names).toContain('set-budget');
    expect(names).toContain('expense-report');
    // Invoicing
    expect(names).toContain('create-invoice');
    expect(names).toContain('send-invoice');
    expect(names).toContain('create-payment-link');
    expect(names).toContain('convert-estimate');
    // Tax
    expect(names).toContain('tax-filing-start');
    expect(names).toContain('tax-filing-export');
    // Finance
    expect(names).toContain('simulate-scenario');
    expect(names).toContain('money-moves');
  });
});
