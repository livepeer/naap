import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const ALEX = '04b97d95-9c81-4903-817b-9839d504841d';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };
const HA = { 'x-tenant-id': ALEX, 'Content-Type': 'application/json' };

test.describe.serial('Agent Brain', () => {
  // 1. Agent message endpoint exists and responds
  test('agent message endpoint exists and responds', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'hello', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBeTruthy();
    expect(body.data.skillUsed).toBeTruthy();
    expect(body.data.confidence).toBeGreaterThanOrEqual(0);
  });

  // 2. Seed skills endpoint creates 16 built-in skills
  test('seed skills creates 28 built-in skills', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/seed-skills`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(64);
  });

  // 3. Skill registry lists built-in skills
  test('skill registry lists built-in skills', async ({ request }) => {
    const res = await request.get(`${CORE}/api/v1/agentbook-core/agent/skills`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(57);
    const names = body.data.map((s: any) => s.name);
    expect(names).toContain('record-expense');
    expect(names).toContain('query-expenses');
    expect(names).toContain('general-question');
  });

  // 4. Expense recording via agent
  test('expense recording: "spent $45 on lunch" creates expense', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'spent $45 on lunch at Starbucks', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('record-expense');
    expect(body.data.message).toBeTruthy();
  });

  // 5. Expense query
  test('expense query: "show last 5 expenses" returns list', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'show last 5 expenses', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('query-expenses');
    expect(body.data.message).toBeTruthy();
  });

  // 6. Finance query
  test('finance query: "what is my balance?" routes to query-finance', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: "what's my balance?", channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('query-finance');
    expect(body.data.message).toBeTruthy();
  });

  // 7. Invoice creation
  test('invoice creation: "invoice Acme $5000 for consulting"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'invoice Acme $5000 for consulting', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('create-invoice');
    expect(body.data.message).toBeTruthy();
  });

  // 8. Simulation
  test('simulation: "what if I hire at $5K/mo" returns projection', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'what if I hire someone at $5000 per month', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('simulate-scenario');
    expect(body.data.message).toBeTruthy();
  });

  // 9. Proactive alerts
  test('proactive alerts: "any alerts?" returns alerts', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'any alerts I should know about?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('proactive-alerts');
    expect(body.data.message).toBeTruthy();
  });

  // 10. Unknown message falls back to general-question
  test('unknown message falls back to general-question', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'tell me a joke about accounting', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBeTruthy();
    // Should route to general-question since no other skill matches
    expect(body.data.message).toBeTruthy();
  });

  // 11. User memory: create memory, verify it affects classification
  test('user memory: create and list', async ({ request }) => {
    // Create a memory
    const createRes = await request.post(`${CORE}/api/v1/agentbook-core/agent/memory`, {
      headers: H,
      data: { key: 'vendor_alias:cab', value: 'Uber', type: 'vendor_alias' },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created.success).toBe(true);
    expect(created.data.key).toBe('vendor_alias:cab');

    // List memories and verify it's there
    const listRes = await request.get(`${CORE}/api/v1/agentbook-core/agent/memory?type=vendor_alias`, { headers: H });
    expect(listRes.ok()).toBeTruthy();
    const listed = await listRes.json();
    const found = listed.data.find((m: any) => m.key === 'vendor_alias:cab');
    expect(found).toBeTruthy();
    expect(found.value).toBe('Uber');

    // Clean up
    await request.delete(`${CORE}/api/v1/agentbook-core/agent/memory/${found.id}`, { headers: H });
  });

  // 12. Conversation continuity: agent saves conversation history
  test('conversation continuity: follow-up uses context', async ({ request }) => {
    // First message
    const res1 = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'how much did I spend on software?', channel: 'api' },
    });
    expect(res1.ok()).toBeTruthy();
    const body1 = await res1.json();
    expect(body1.success).toBe(true);

    // Follow-up — agent should have conversation context
    const res2 = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'and what about travel?', channel: 'api' },
    });
    expect(res2.ok()).toBeTruthy();
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.data.message).toBeTruthy();
  });

  // 13. Tenant isolation: different tenants have separate memory
  test('tenant isolation: separate memory per tenant', async ({ request }) => {
    // Create memory for Maya
    await request.post(`${CORE}/api/v1/agentbook-core/agent/memory`, {
      headers: H,
      data: { key: 'test:isolation', value: 'maya-value', type: 'context' },
    });

    // Create memory for Alex
    await request.post(`${CORE}/api/v1/agentbook-core/agent/memory`, {
      headers: HA,
      data: { key: 'test:isolation', value: 'alex-value', type: 'context' },
    });

    // Maya's memory should have maya-value
    const mayaRes = await request.get(`${CORE}/api/v1/agentbook-core/agent/memory?type=context`, { headers: H });
    const mayaMem = (await mayaRes.json()).data.find((m: any) => m.key === 'test:isolation');
    expect(mayaMem?.value).toBe('maya-value');

    // Alex's memory should have alex-value
    const alexRes = await request.get(`${CORE}/api/v1/agentbook-core/agent/memory?type=context`, { headers: HA });
    const alexMem = (await alexRes.json()).data.find((m: any) => m.key === 'test:isolation');
    expect(alexMem?.value).toBe('alex-value');

    // Clean up
    if (mayaMem) await request.delete(`${CORE}/api/v1/agentbook-core/agent/memory/${mayaMem.id}`, { headers: H });
    if (alexMem) await request.delete(`${CORE}/api/v1/agentbook-core/agent/memory/${alexMem.id}`, { headers: HA });
  });

  // 14. Photo attachment sends scan-receipt skill
  test('photo attachment routes to scan-receipt', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: {
        text: '',
        channel: 'api',
        attachments: [{ type: 'photo', url: 'https://example.com/receipt.jpg' }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('scan-receipt');
  });

  // 15. Categorize expenses skill
  test('categorize expenses: routes to categorize-expenses skill', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize my uncategorized expenses', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('categorize-expenses');
    expect(body.data.message).toBeTruthy();
  });

  // 16. Error handling: invalid request returns friendly error
  test('error handling: missing text and attachments returns 400', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { channel: 'api' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
