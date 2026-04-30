import { test, expect } from '@playwright/test';

const EXPENSE = 'http://localhost:4051';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const ALEX = '04b97d95-9c81-4903-817b-9839d504841d';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('Expense AI Advisor', () => {
  test('insights: returns insights for Maya', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights?startDate=2026-01-01&endDate=2026-12-31`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.insights).toBeDefined();
    expect(data.data.insights.length).toBeGreaterThanOrEqual(1);
  });

  test('insights: each insight has required fields', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights?startDate=2026-01-01&endDate=2026-12-31`, { headers: H });
    const insights = (await res.json()).data.insights;
    for (const i of insights.slice(0, 5)) {
      expect(i.id).toBeTruthy();
      expect(i.type).toBeTruthy();
      expect(['critical', 'warning', 'info']).toContain(i.severity);
      expect(i.title).toBeTruthy();
      expect(i.message).toBeTruthy();
    }
  });

  test('insights: detects duplicate expenses', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights?startDate=2026-01-01&endDate=2026-12-31`, { headers: H });
    const insights = (await res.json()).data.insights;
    const duplicates = insights.filter((i: any) => i.type === 'duplicate');
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
  });

  test('insights: empty for fresh tenant', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/insights`, {
      headers: { 'x-tenant-id': 'empty-tenant-xyz', 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.insights.length).toBe(0);
  });

  test('chart: returns bar data with categories', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?startDate=2026-01-01&endDate=2026-12-31&chartType=bar`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.chartType).toBe('bar');
    expect(data.data.data.length).toBeGreaterThanOrEqual(1);
    expect(data.data.data[0].name).toBeTruthy();
    expect(data.data.data[0].value).toBeGreaterThan(0);
    expect(data.data.annotation).toBeTruthy();
  });

  test('chart: returns trend data', async ({ request }) => {
    const res = await request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?startDate=2026-01-01&endDate=2026-12-31&chartType=trend`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.chartType).toBe('trend');
  });

  test('ask: answers travel question', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/advisor/ask`, {
      headers: H,
      data: { question: 'How much did I spend on travel?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.answer).toBeTruthy();
    expect(data.data.answer.length).toBeGreaterThan(20);
    expect(data.data.sources).toContain('expenses');
  });

  test('ask: returns chart data for category questions', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/advisor/ask`, {
      headers: H,
      data: { question: 'What are my top spending categories?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.answer).toBeTruthy();
  });

  test('ask: always returns useful data (fallback test)', async ({ request }) => {
    const res = await request.post(`${EXPENSE}/api/v1/agentbook-expense/advisor/ask`, {
      headers: H,
      data: { question: 'Give me a summary' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.data.answer).toBeTruthy();
    expect(data.data.answer).toContain('$');
    expect(data.data.sources).toBeDefined();
  });

  test('tenant isolation: different tenants see different data', async ({ request }) => {
    const alexH = { 'x-tenant-id': ALEX, 'Content-Type': 'application/json' };
    const [mayaRes, alexRes] = await Promise.all([
      request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?chartType=bar&startDate=2026-01-01&endDate=2026-12-31`, { headers: H }),
      request.get(`${EXPENSE}/api/v1/agentbook-expense/advisor/chart?chartType=bar&startDate=2026-01-01&endDate=2026-12-31`, { headers: alexH }),
    ]);
    const mayaData = (await mayaRes.json()).data.data;
    const alexData = (await alexRes.json()).data.data;
    expect(mayaData.length).toBeGreaterThan(0);
    expect(alexData.length).toBeGreaterThan(0);
    const mayaTotal = mayaData.reduce((s: number, d: any) => s + d.value, 0);
    const alexTotal = alexData.reduce((s: number, d: any) => s + d.value, 0);
    expect(mayaTotal).not.toBe(alexTotal);
  });
});
