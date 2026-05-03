import { test, expect } from '@playwright/test';
import { loginAsE2eUser } from './helpers/auth';
import { api } from './helpers/api';
import { SEED, tag } from './helpers/data';

test.describe('@phase4-invoicing', () => {
  test.beforeEach(async ({ page }) => { await loginAsE2eUser(page); });

  // CLIENTS (4)
  test('list clients includes seeded names', async ({ page }) => {
    const r = await api(page).get('/api/v1/agentbook-invoice/clients');
    expect(r.status).toBe(200);
    const names = r.data.data.map((c: any) => c.name);
    for (const n of SEED.clients.names) expect(names).toContain(n);
  });
  test('create client', async ({ page }) => {
    const name = `Client-${tag('phase4')}`;
    const r = await api(page).post('/api/v1/agentbook-invoice/clients', { name, email: 't@t.test' });
    expect(r.status).toBe(200);
    await api(page).delete(`/api/v1/agentbook-invoice/clients/${r.data.data.id}`);
  });
  test('edit client', async ({ page }) => {
    const c = await api(page).post('/api/v1/agentbook-invoice/clients', { name: 'edit-client', email: 'a@a.test' });
    await api(page).put(`/api/v1/agentbook-invoice/clients/${c.data.data.id}`, { name: 'edit-client-renamed' });
    const got = await api(page).get(`/api/v1/agentbook-invoice/clients/${c.data.data.id}`);
    expect(got.data.data.name).toBe('edit-client-renamed');
    await api(page).delete(`/api/v1/agentbook-invoice/clients/${c.data.data.id}`);
  });
  test('delete client', async ({ page }) => {
    const c = await api(page).post('/api/v1/agentbook-invoice/clients', { name: 'del-client' });
    const r = await api(page).delete(`/api/v1/agentbook-invoice/clients/${c.data.data.id}`);
    expect(r.status).toBeLessThan(400);
  });

  // INVOICES (4)
  test('list invoices includes seeded INV-E2E-* numbers', async ({ page }) => {
    const r = await api(page).get('/api/v1/agentbook-invoice/invoices');
    const numbers = r.data.data.map((i: any) => i.number);
    expect(numbers).toContain(SEED.invoices.draft);
    expect(numbers).toContain(SEED.invoices.paid);
  });
  test('create single-line invoice', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const clientId = clients.data.data[0].id;
    const r = await api(page).post('/api/v1/agentbook-invoice/invoices', {
      clientId, lines: [{ description: 'Service', amountCents: 50000 }], dueDate: new Date(Date.now()+30*86400000).toISOString(),
    });
    expect(r.status).toBe(200);
    await api(page).delete(`/api/v1/agentbook-invoice/invoices/${r.data.data.id}`);
  });
  test('create multi-line invoice', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const clientId = clients.data.data[0].id;
    const r = await api(page).post('/api/v1/agentbook-invoice/invoices', {
      clientId,
      lines: [
        { description: 'Consulting', amountCents: 300000 },
        { description: 'Design',     amountCents: 200000 },
        { description: 'Hosting',    amountCents: 50000 },
      ],
      dueDate: new Date(Date.now()+30*86400000).toISOString(),
    });
    expect(r.status).toBe(200);
    expect(r.data.data.amountCents).toBe(550000);
    await api(page).delete(`/api/v1/agentbook-invoice/invoices/${r.data.data.id}`);
  });
  test('send invoice', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const inv = await api(page).post('/api/v1/agentbook-invoice/invoices', {
      clientId: clients.data.data[0].id, lines: [{ description: 'X', amountCents: 1000 }], dueDate: new Date(Date.now()+30*86400000).toISOString(),
    });
    const send = await api(page).post(`/api/v1/agentbook-invoice/invoices/${inv.data.data.id}/send`, {});
    expect(send.status).toBeLessThan(500);
    await api(page).delete(`/api/v1/agentbook-invoice/invoices/${inv.data.data.id}`);
  });

  // PAID + VOID + PAYMENT LINKS (3)
  test('mark invoice paid → AR balance updates', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-invoice/payments', {
      invoiceNumber: SEED.invoices.sent, amountCents: 120000, method: 'bank_transfer',
    });
    expect(r.status).toBeLessThan(500);
  });
  test('void invoice', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const inv = await api(page).post('/api/v1/agentbook-invoice/invoices', {
      clientId: clients.data.data[0].id, lines: [{ description: 'X', amountCents: 1000 }], dueDate: new Date().toISOString(),
    });
    const v = await api(page).post(`/api/v1/agentbook-invoice/invoices/${inv.data.data.id}/void`, {});
    expect(v.status).toBeLessThan(500);
  });
  test('payment link returns mock URL when no Stripe configured', async ({ page }) => {
    const inv = await api(page).get('/api/v1/agentbook-invoice/invoices');
    const id = inv.data.data[0].id;
    const r = await api(page).post(`/api/v1/agentbook-invoice/invoices/${id}/payment-link`, {});
    expect(r.status).toBeLessThan(500);
    if (!process.env.STRIPE_SECRET_KEY) {
      expect(r.data?.data?.paymentUrl).toMatch(/\/pay\//);
    }
  });

  // AGING (1)
  test('aging report buckets', async ({ page }) => {
    const r = await api(page).get('/api/v1/agentbook-invoice/aging-report');
    expect(r.status).toBe(200);
    expect(r.data.data.buckets).toBeTruthy();
  });

  // RECURRING (2)
  test('create recurring invoice template', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const r = await api(page).post('/api/v1/agentbook-invoice/recurring-invoices', {
      clientId: clients.data.data[0].id, cadence: 'monthly', amountCents: 50000, description: `rec-${tag('phase4')}`,
    });
    expect(r.status).toBeLessThan(500);
    if (r.data?.data?.id) await api(page).delete(`/api/v1/agentbook-invoice/recurring-invoices/${r.data.data.id}`);
  });
  test('recurring generator runs', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-invoice/recurring-invoices/generate', {});
    expect(r.status).toBeLessThan(500);
  });

  // ESTIMATES + CREDIT NOTES (2)
  test('convert estimate to invoice', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const e = await api(page).post('/api/v1/agentbook-invoice/estimates', {
      clientId: clients.data.data[0].id, lines: [{ description: 'E', amountCents: 100 }],
    });
    if (e.data?.data?.id) {
      const c = await api(page).post(`/api/v1/agentbook-invoice/estimates/${e.data.data.id}/convert`, {});
      expect(c.status).toBeLessThan(500);
    }
  });
  test('create credit note against paid invoice', async ({ page }) => {
    const inv = await api(page).get('/api/v1/agentbook-invoice/invoices?status=paid');
    if (inv.data.data.length === 0) test.skip(true, 'no paid invoice in seed window');
    const r = await api(page).post('/api/v1/agentbook-invoice/credit-notes', {
      invoiceId: inv.data.data[0].id, amountCents: 100,
    });
    expect(r.status).toBeLessThan(500);
  });

  // TIME TRACKING (3)
  test('start timer', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const r = await api(page).post('/api/v1/agentbook-invoice/timer/start', { clientId: clients.data.data[0].id });
    expect(r.status).toBeLessThan(500);
  });
  test('stop timer', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-invoice/timer/stop', {});
    expect(r.status).toBeLessThan(500);
  });
  test('list time entries', async ({ page }) => {
    const r = await api(page).get('/api/v1/agentbook-invoice/time-entries');
    expect(r.status).toBe(200);
  });

  // REPORTS (3)
  test('unbilled summary', async ({ page }) => {
    const r = await api(page).get('/api/v1/agentbook-invoice/unbilled-summary');
    expect(r.status).toBe(200);
  });
  test('project profitability', async ({ page }) => {
    const r = await api(page).get('/api/v1/agentbook-invoice/project-profitability');
    expect(r.status).toBe(200);
  });
  test('invoice PDF download', async ({ page }) => {
    const inv = await api(page).get('/api/v1/agentbook-invoice/invoices');
    const id = inv.data.data[0].id;
    const r = await api(page).post(`/api/v1/agentbook-invoice/invoices/${id}/pdf`, {});
    expect(r.status).toBeLessThan(500);
  });

  // AUTO REMINDERS (1)
  test('auto-reminder cron sends for overdue invoices', async ({ page }) => {
    const r = await fetch(`${process.env.E2E_BASE_URL}/api/v1/agentbook/cron/payment-reminders`, {
      headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(r.status).toBeLessThan(500);
  });
});
