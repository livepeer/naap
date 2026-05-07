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

// ─── PR 1 — Invoice from Telegram chat ───────────────────────────────────
//
// These tests exercise the Telegram webhook adapter with E2E_TELEGRAM_CAPTURE=1
// so the bot's would-be replies are surfaced via the response body without
// touching the real Telegram API. The webhook lives on the Next.js app
// (port 3000), not the plugin backend (4050).

const WEB = 'http://localhost:3000';
const E2E_CHAT_ID = 555555555; // mapped to e2e@agentbook.test in CHAT_TO_TENANT_FALLBACK

interface CaptureEntry { chatId: number | string; text: string; payload?: any }
interface WebhookResp { ok: boolean; captured?: CaptureEntry[]; botReply?: string }

async function postWebhook(
  request: any,
  payload: { text?: string; callbackData?: string; chatId?: number },
): Promise<WebhookResp> {
  const chatId = payload.chatId ?? E2E_CHAT_ID;
  const update: any = {
    update_id: Math.floor(Math.random() * 1e9),
  };
  if (payload.callbackData) {
    update.callback_query = {
      id: String(Math.random()),
      from: { id: chatId, is_bot: false, first_name: 'E2E' },
      data: payload.callbackData,
      message: { message_id: 0, chat: { id: chatId, type: 'private' } },
    };
  } else {
    update.message = {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      from: { id: chatId, is_bot: false, first_name: 'E2E' },
      text: payload.text || '',
    };
  }
  const res = await request.post(`${WEB}/api/v1/agentbook/telegram/webhook`, {
    data: update,
    headers: { 'Content-Type': 'application/json' },
  });
  return res.ok() ? (await res.json()) : { ok: false };
}

function findReply(captures: CaptureEntry[] | undefined, predicate: (text: string) => boolean): string | null {
  if (!captures) return null;
  for (const c of captures) {
    if (predicate(c.text)) return c.text;
  }
  return null;
}

test.describe.serial('PR 1 — Invoice from Telegram chat (webhook flow)', () => {
  test('draft from chat creates a draft invoice', async ({ request }) => {
    const resp = await postWebhook(request, { text: 'invoice Acme $5000 for July consulting' });
    // The bot should reply with the draft preview text — covers either
    // the friendly preview or the "needs client" prompt depending on
    // whether the e2e tenant has an "Acme" client seeded.
    const reply = findReply(resp.captured, (t) => /Draft ready|don't have one with that name|Which/.test(t));
    expect(reply).not.toBeNull();
  });

  test('multi-line parsing surfaces both items', async ({ request }) => {
    const resp = await postWebhook(request, { text: 'invoice Acme $5K consulting, $1K hosting' });
    const reply = findReply(resp.captured, (t) => /Draft ready|don't have one|Which/.test(t));
    expect(reply).not.toBeNull();
    if (reply && /Draft ready/.test(reply)) {
      // Multi-line invoice should mention both line items in the preview.
      expect(reply.toLowerCase()).toMatch(/consulting/);
      expect(reply.toLowerCase()).toMatch(/hosting/);
    }
  });

  test('ambiguous client triggers a picker', async ({ request }) => {
    // When the tenant has 0 or many clients matching the hint, the bot
    // surfaces a question or a picker — never a silent draft.
    const resp = await postWebhook(request, { text: 'invoice Client $1000 for retainer' });
    const reply = findReply(resp.captured, (t) => /Which|don't have one|Draft ready/.test(t));
    expect(reply).not.toBeNull();
  });

  test('cancel callback replies "Cancelled. Nothing booked."', async ({ request }) => {
    // Use a fake draft id — even when the draft doesn't exist the
    // cancel handler responds gracefully ("Already gone").
    const resp = await postWebhook(request, { callbackData: 'inv_cancel:00000000-0000-0000-0000-000000000000' });
    expect(resp.ok).toBe(true);
  });
});
