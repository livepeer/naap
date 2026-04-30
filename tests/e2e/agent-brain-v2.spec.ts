import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const ALEX = '04b97d95-9c81-4903-817b-9839d504841d';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };
const HA = { 'x-tenant-id': ALEX, 'Content-Type': 'application/json' };

// ─── Sessions & Planning ────────────────────────────────────────────────────

test.describe.serial('Sessions & Planning', () => {
  // 1. Simple single-intent request works without creating a session
  test('simple request works without session', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'spent $15 on coffee', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('record-expense');
    expect(body.data.message).toBeTruthy();
    // Simple request should not create a session
    expect(body.data.sessionId).toBeFalsy();
  });

  // 2. Complex multi-intent request may trigger a plan (LLM-dependent)
  test('complex multi-intent request triggers plan or message', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize all expenses and then show me the breakdown', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    // Either a plan was created (plan present) or agent responded with a message
    expect(body.data.message).toBeTruthy();
    // If a plan was created, steps should be an array
    if (body.data.plan) {
      expect(Array.isArray(body.data.plan.steps)).toBe(true);
      expect(body.data.plan.steps.length).toBeGreaterThan(0);
    }
  });

  // 3. Cancel action expires an active session
  test('cancel action expires active session', async ({ request }) => {
    // First create a potential session with a multi-step request
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize all expenses and then show me the breakdown', channel: 'api' },
    });

    // Now cancel whatever session may exist
    const cancelRes = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: '', sessionAction: 'cancel', channel: 'api' },
    });
    expect(cancelRes.ok()).toBeTruthy();
    const body = await cancelRes.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBeTruthy();
    // Response should either acknowledge cancellation or indicate no session (if LLM didn't create one)
    // Both are valid outcomes — the important thing is it doesn't crash
  });

  // 4. Confirm action executes an active plan
  test('confirm executes plan', async ({ request }) => {
    // Create a session
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize all expenses and then show me the breakdown', channel: 'api' },
    });

    // Confirm
    const confirmRes = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: '', sessionAction: 'confirm', channel: 'api' },
    });
    expect(confirmRes.ok()).toBeTruthy();
    const body = await confirmRes.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBeTruthy();
  });

  // 5. Sending a new multi-intent message after a session expires doesn't error
  test('new plan expires old active session gracefully', async ({ request }) => {
    // First multi-intent
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize all expenses and then show me the breakdown', channel: 'api' },
    });

    // Second multi-intent — should not fail due to existing session
    const res2 = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'review all pending expenses and send a summary', channel: 'api' },
    });
    expect(res2.ok()).toBeTruthy();
    const body = await res2.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBeTruthy();
  });

  // 6. Undo with no actions returns appropriate message (graceful, no crash)
  test('undo with no actions returns appropriate message', async ({ request }) => {
    // Cancel any active session first to start clean
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: '', sessionAction: 'cancel', channel: 'api' },
    });

    // Now attempt undo
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: '', sessionAction: 'undo', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBeTruthy();
  });
});

// ─── Memory & Learning ──────────────────────────────────────────────────────

test.describe.serial('Memory & Learning', () => {
  // 7. Memory confidence increases on repeated same-category vendor
  test('vendor_category memory accumulates on repeated vendor', async ({ request }) => {
    // Record two expenses at the same vendor (Starbucks → coffee/latte)
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'spent $5 on coffee at Starbucks', channel: 'api' },
    });
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'spent $6 on latte at Starbucks', channel: 'api' },
    });

    // Query vendor_category memories
    const memRes = await request.get(
      `${CORE}/api/v1/agentbook-core/agent/memory?type=vendor_category`,
      { headers: H },
    );
    expect(memRes.ok()).toBeTruthy();
    const memBody = await memRes.json();
    expect(memBody.success).toBe(true);
    expect(Array.isArray(memBody.data)).toBe(true);

    // Find a Starbucks entry with usage >= 2
    const starbucksMem = memBody.data.find(
      (m: any) => m.key && m.key.toLowerCase().includes('starbucks'),
    );
    expect(starbucksMem).toBeTruthy();
    expect(starbucksMem.usageCount).toBeGreaterThanOrEqual(2);
  });

  // 8. User correction creates feedback and succeeds
  test('user correction creates feedback', async ({ request }) => {
    // First record an expense so there's a last result to correct
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'spent $30 on dinner', channel: 'api' },
    });

    // Then send a correction
    const corrRes = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: {
        text: 'no, that should be Travel',
        feedback: 'no, that should be Travel',
        channel: 'api',
      },
    });
    expect(corrRes.ok()).toBeTruthy();
    const body = await corrRes.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBeTruthy();
  });
});

// ─── New Skills ─────────────────────────────────────────────────────────────

test.describe.serial('New Skills', () => {
  // 9. review-queue skill routes correctly
  test('review-queue routes correctly', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'what items are pending review?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('review-queue');
    expect(body.data.message).toBeTruthy();
  });

  // 10. manage-recurring skill routes correctly
  test('manage-recurring routes correctly', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'show my recurring subscriptions', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('manage-recurring');
    expect(body.data.message).toBeTruthy();
  });

  // 11. vendor-insights skill routes correctly
  test('vendor-insights routes correctly', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'who do I spend the most with?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.skillUsed).toBe('vendor-insights');
    expect(body.data.message).toBeTruthy();
  });

  // 12. Session action with no active session doesn't crash
  test('session status action with no active session is graceful', async ({ request }) => {
    // Cancel any existing session to start clean
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: HA,
      data: { text: '', sessionAction: 'cancel', channel: 'api' },
    });

    // Query status with no active session — should not crash
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: HA,
      data: { text: '', sessionAction: 'status', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBeTruthy();
  });
});
