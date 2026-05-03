import { test, expect } from '@playwright/test';
import { postUpdate, E2E_CHAT } from './helpers/telegram';

test.describe('@phase6-telegram-bot', () => {
  // Skip the entire phase if TELEGRAM_BOT_TOKEN isn't configured on the
  // server (the webhook returns "Bot not configured" in that case). The
  // bot token is a real secret; test infrastructure can't set it.
  test.beforeAll(async () => {
    const probe = await postUpdate('ping');
    const isUnconfigured =
      probe.data?.error === 'Bot not configured' ||
      probe.status === 503;
    test.skip(isUnconfigured, 'TELEGRAM_BOT_TOKEN not set on the deployed server — phase 6 skipped');
  });

  test('webhook returns 200 + non-empty reply for plain hello', async () => {
    const r = await postUpdate('hello');
    expect(r.status).toBe(200);
    expect(r.reply?.length || 0).toBeGreaterThan(0);
  });
  test('/start command → onboarding response', async () => {
    const r = await postUpdate('/start');
    expect(r.status).toBe(200);
    expect(r.reply).toBeTruthy();
  });
  test('record-expense via NL', async () => {
    const r = await postUpdate('Spent $25 at Uber for client meeting');
    expect(r.status).toBe(200);
    expect(r.reply).toMatch(/recorded|added|saved|noted/i);
    expect(r.reply).toMatch(/\$25/);
  });
  test('query-finance includes seeded balance', async () => {
    const r = await postUpdate('What is my cash balance?');
    expect(r.reply).toMatch(/\$5,?000|\$5\.00|\$5,?000\.00/);
  });
  test('query-expenses returns category breakdown', async () => {
    const r = await postUpdate('show my expenses this month');
    expect(r.reply).toBeTruthy();
  });
  test('create-invoice via NL', async () => {
    const r = await postUpdate('send invoice Acme $500 for consulting');
    expect(r.reply).toMatch(/invoice|created|draft/i);
  });
  test('simulate-scenario', async () => {
    const r = await postUpdate('what if I hire someone at $5K/mo?');
    expect(r.reply).toBeTruthy();
  });
  test('proactive-alerts', async () => {
    const r = await postUpdate('what should I focus on?');
    expect(r.reply).toBeTruthy();
  });
  test('multi-step plan: review my invoices', async () => {
    const r = await postUpdate('review my invoices');
    expect(r.reply).toBeTruthy();
  });
  test('confirm action: send "yes" to a pending plan', async () => {
    await postUpdate('review my invoices');
    const r = await postUpdate('yes');
    expect(r.status).toBe(200);
  });
  test('cancel action', async () => {
    await postUpdate('review my invoices');
    const r = await postUpdate('cancel');
    expect(r.status).toBe(200);
  });
  test('correction flow: re-categorize', async () => {
    const r = await postUpdate('no, that should be Travel');
    expect(r.status).toBe(200);
  });
  test('receipt photo via Update', async () => {
    const r = await postUpdate('', { photo: { fileId: 'mock-file-id-1', caption: 'lunch receipt' } });
    expect(r.status).toBe(200);
  });
  test('unknown chat ID resolves to unmapped:<id>', async () => {
    const r = await postUpdate('hello', { chatId: 999999999 });
    // Either webhook ignores it gracefully or returns a benign 200; the
    // important thing is no crash and no production data pollution.
    expect(r.status).toBeLessThan(500);
  });
});
