import { test, expect } from '@playwright/test';

const INVOICE_API = 'http://localhost:4052';
const BASE_URL = 'http://localhost:3000';
const TENANT = 'p7-e2e-test';
const H = { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' };

test.describe('Phase 7: Projects', () => {
  test('create project', async ({ request }) => {
    const name = `E2E Project ${Date.now()}`;
    const res = await request.post(`${INVOICE_API}/api/v1/agentbook-invoice/projects`, {
      headers: H, data: { name, hourlyRateCents: 15000 },
    });
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.data.name).toBe(name);
    expect(d.data.hourlyRateCents).toBe(15000);
  });

  test('list projects', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/projects`, { headers: H });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.length).toBeGreaterThanOrEqual(1);
  });

  test('project profitability', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/project-profitability`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.data[0]).toHaveProperty('totalHours');
    expect(d.data[0]).toHaveProperty('effectiveRateCents');
  });
});

test.describe('Phase 7: Timer', () => {
  test('start timer', async ({ request }) => {
    const res = await request.post(`${INVOICE_API}/api/v1/agentbook-invoice/timer/start`, {
      headers: H, data: { description: 'E2E timer test' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.description).toBe('E2E timer test');
  });

  test('timer status shows running', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/timer/status`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.data.running).toBe(true);
  });

  test('stop timer', async ({ request }) => {
    const res = await request.post(`${INVOICE_API}/api/v1/agentbook-invoice/timer/stop`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.data.durationMinutes).toBeGreaterThanOrEqual(0);
  });

  test('timer status shows not running', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/timer/status`, { headers: H });
    const d = await res.json();
    expect(d.data.running).toBe(false);
  });
});

test.describe('Phase 7: Time Entries', () => {
  test('log time manually', async ({ request }) => {
    const res = await request.post(`${INVOICE_API}/api/v1/agentbook-invoice/time-entries`, {
      headers: H, data: { description: 'Manual entry', minutes: 120 },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.durationMinutes).toBe(120);
  });

  test('list time entries', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/time-entries`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.data.length).toBeGreaterThanOrEqual(1);
    expect(d.meta).toHaveProperty('totalMinutes');
    expect(d.meta).toHaveProperty('totalHours');
  });

  test('unbilled summary', async ({ request }) => {
    const res = await request.get(`${INVOICE_API}/api/v1/agentbook-invoice/unbilled-summary`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});

test.describe('Phase 7: Proxy', () => {
  test('timer through Next.js proxy', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-invoice/timer/status`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });

  test('projects through Next.js proxy', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/agentbook-invoice/projects`, { headers: H });
    expect(res.ok()).toBeTruthy();
  });
});
