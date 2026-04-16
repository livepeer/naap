import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('Invoice Agent — Query Skills', () => {
  test('query-invoices: "show my invoices"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my invoices', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('query-invoices');
    expect(body.data.message).toBeTruthy();
  });

  test('aging-report: "who owes me money?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'who owes me money?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('aging-report');
  });

  test('query-clients: "show my clients"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my clients', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('query-clients');
  });

  test('query-estimates: "show pending estimates"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my pending estimates', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('query-estimates');
  });

  test('timer-status: "is my timer running?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'is my timer running?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('timer-status');
  });

  test('unbilled-summary: "show unbilled time"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show unbilled time', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('unbilled-summary');
  });
});

test.describe.serial('Invoice Agent — Action Skills', () => {
  test('create-invoice: "invoice Acme $5000 for consulting"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'invoice Acme $5000 for consulting', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('create-invoice');
    expect(body.data.message).toBeTruthy();
  });

  test('send-invoice: "send that invoice"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'send that invoice', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('send-invoice');
  });

  test('record-payment: "got $5000 from Acme"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'got $5000 from Acme', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('record-payment');
  });

  test('create-estimate: "estimate TechCorp $3000 for web design"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'estimate TechCorp $3000 for web design', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('create-estimate');
  });

  test('start-timer: "start timer for TechCorp"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'start timer for TechCorp project', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('start-timer');
  });

  test('stop-timer: "stop timer"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'stop timer', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('stop-timer');
  });

  test('send-reminder: "send payment reminders"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'send payment reminders', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('send-reminder');
  });
});

test.describe.serial('Invoice Agent — Multi-Step', () => {
  test('multi-step: "invoice and send" triggers plan or executes', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'invoice Acme $5000 for consulting and then send it', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.plan || body.data.message).toBeTruthy();
  });

  test('send-reminder with no overdue returns friendly message', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'send payment reminders', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('send-reminder');
    expect(body.data.message).toBeTruthy();
  });
});
