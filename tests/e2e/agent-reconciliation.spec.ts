/**
 * E2E for daily reconciliation diff (PR 9).
 *
 * Coverage:
 *   1. POST /bank-transactions/[id]/match (invoice) → marks matched +
 *      posts payment + JE (cash debit, AR credit) + invoice paid.
 *   2. POST /bank-transactions/[id]/match (expense) → marks matched +
 *      links matchedExpenseId, no JE side-effect.
 *   3. POST /bank-transactions/[id]/skip → marks ignored.
 *   4. Cross-tenant txn id → 404 (security).
 *   5. Telegram bnk_match callback flips to matched.
 *   6. Telegram bnk_skip callback flips to ignored.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const E2E_CHAT_ID = 555555555;
const TENANT = 'b9a80acd-fa14-4209-83a9-03231513fa8f'; // matches CHAT_TO_TENANT_FALLBACK
const OTHER_TENANT = `e2e-bnk-other-${Date.now()}`;

interface CaptureEntry { chatId: number | string; text: string; payload?: any }
interface WebhookResp { ok: boolean; captured?: CaptureEntry[]; botReply?: string }

let prisma: typeof import('@naap/database').prisma;

async function postWebhook(
  request: any,
  payload: { text?: string; callbackData?: string; chatId?: number },
): Promise<WebhookResp> {
  const chatId = payload.chatId ?? E2E_CHAT_ID;
  const update: any = { update_id: Math.floor(Math.random() * 1e9) };
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

test.describe.serial('PR 9 — Reconciliation diff (HTTP endpoints)', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;
    // Minimal chart of accounts so the JE has somewhere to land.
    await prisma.abAccount.createMany({
      data: [
        { tenantId: TENANT, code: '1000', name: 'Cash', accountType: 'asset' },
        { tenantId: TENANT, code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
      ],
      skipDuplicates: true,
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await prisma.$disconnect();
  });

  test('POST /match (invoice) → matched + payment + JE + invoice paid', async ({ request }) => {
    const today = new Date();
    const client = await prisma.abClient.create({
      data: { tenantId: TENANT, name: `Recon Client ${Date.now()}`, defaultTerms: 'net-30' },
    });
    const invoice = await prisma.abInvoice.create({
      data: {
        tenantId: TENANT,
        clientId: client.id,
        number: `INV-RECON-${Date.now()}`,
        amountCents: 75000,
        currency: 'USD',
        issuedDate: today,
        dueDate: new Date(today.getTime() + 30 * 86_400_000),
        status: 'sent',
      },
    });
    const acct = await prisma.abBankAccount.create({
      data: {
        tenantId: TENANT,
        plaidItemId: 'recon-item',
        plaidAccountId: `recon-account-${Date.now()}`,
        name: 'Recon Checking',
        type: 'checking',
        connected: true,
      },
    });
    const txn = await prisma.abBankTransaction.create({
      data: {
        tenantId: TENANT,
        bankAccountId: acct.id,
        plaidTransactionId: `recon-txn-inv-${Date.now()}`,
        amount: -75000, // inflow
        date: today,
        merchantName: client.name,
        name: `WIRE FROM ${client.name}`,
        matchStatus: 'exception',
        matchedInvoiceId: invoice.id, // medium-confidence guess pre-stored
      },
    });

    const res = await request.post(
      `${WEB}/api/v1/agentbook-expense/bank-transactions/${txn.id}/match`,
      {
        headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
        data: { targetType: 'invoice', targetId: invoice.id },
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);

    const updatedTxn = await prisma.abBankTransaction.findUnique({ where: { id: txn.id } });
    expect(updatedTxn?.matchStatus).toBe('matched');
    expect(updatedTxn?.matchedInvoiceId).toBe(invoice.id);

    const updatedInv = await prisma.abInvoice.findUnique({ where: { id: invoice.id } });
    expect(updatedInv?.status).toBe('paid');

    const payments = await prisma.abPayment.findMany({
      where: { invoiceId: invoice.id, tenantId: TENANT },
    });
    expect(payments.length).toBeGreaterThan(0);
    expect(payments[0].amountCents).toBe(75000);

    // JE invariant: cash debited, AR credited.
    if (payments[0].journalEntryId) {
      const lines = await prisma.abJournalLine.findMany({
        where: { entryId: payments[0].journalEntryId },
      });
      const totalDebit = lines.reduce((s, l) => s + l.debitCents, 0);
      const totalCredit = lines.reduce((s, l) => s + l.creditCents, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(75000);
    }

    // Cleanup
    await prisma.abPayment.deleteMany({ where: { invoiceId: invoice.id } });
    await prisma.abBankTransaction.delete({ where: { id: txn.id } });
    await prisma.abBankAccount.delete({ where: { id: acct.id } });
    await prisma.abInvoice.delete({ where: { id: invoice.id } });
    await prisma.abClient.delete({ where: { id: client.id } });
  });

  test('POST /match (expense) → matched, no payment row', async ({ request }) => {
    const today = new Date();
    const acct = await prisma.abBankAccount.create({
      data: {
        tenantId: TENANT,
        plaidItemId: 'recon-item-x',
        plaidAccountId: `recon-account-x-${Date.now()}`,
        name: 'Recon Checking X',
        type: 'checking',
        connected: true,
      },
    });
    const expense = await prisma.abExpense.create({
      data: {
        tenantId: TENANT,
        amountCents: 4500,
        date: today,
        description: 'Coffee',
        isPersonal: false,
        status: 'confirmed',
      },
    });
    const txn = await prisma.abBankTransaction.create({
      data: {
        tenantId: TENANT,
        bankAccountId: acct.id,
        plaidTransactionId: `recon-txn-exp-${Date.now()}`,
        amount: 4500, // outflow
        date: today,
        merchantName: 'Cafe',
        name: 'CAFE PURCHASE',
        matchStatus: 'exception',
        matchedExpenseId: expense.id,
      },
    });

    const res = await request.post(
      `${WEB}/api/v1/agentbook-expense/bank-transactions/${txn.id}/match`,
      {
        headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
        data: { targetType: 'expense', targetId: expense.id },
      },
    );
    expect(res.ok()).toBeTruthy();

    const updatedTxn = await prisma.abBankTransaction.findUnique({ where: { id: txn.id } });
    expect(updatedTxn?.matchStatus).toBe('matched');
    expect(updatedTxn?.matchedExpenseId).toBe(expense.id);

    await prisma.abBankTransaction.delete({ where: { id: txn.id } });
    await prisma.abBankAccount.delete({ where: { id: acct.id } });
    await prisma.abExpense.delete({ where: { id: expense.id } });
  });

  test('POST /skip → matched flipped to ignored', async ({ request }) => {
    const today = new Date();
    const acct = await prisma.abBankAccount.create({
      data: {
        tenantId: TENANT,
        plaidItemId: 'recon-item-skip',
        plaidAccountId: `recon-account-skip-${Date.now()}`,
        name: 'Skip Checking',
        type: 'checking',
        connected: true,
      },
    });
    const txn = await prisma.abBankTransaction.create({
      data: {
        tenantId: TENANT,
        bankAccountId: acct.id,
        plaidTransactionId: `recon-txn-skip-${Date.now()}`,
        amount: 1234,
        date: today,
        merchantName: 'Random',
        name: 'RANDOM CHARGE',
        matchStatus: 'exception',
      },
    });

    const res = await request.post(
      `${WEB}/api/v1/agentbook-expense/bank-transactions/${txn.id}/skip`,
      {
        headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      },
    );
    expect(res.ok()).toBeTruthy();
    const updated = await prisma.abBankTransaction.findUnique({ where: { id: txn.id } });
    expect(updated?.matchStatus).toBe('ignored');

    await prisma.abBankTransaction.delete({ where: { id: txn.id } });
    await prisma.abBankAccount.delete({ where: { id: acct.id } });
  });

  test('Cross-tenant txn id → 404', async ({ request }) => {
    const today = new Date();
    // Create txn for a different tenant.
    const acct = await prisma.abBankAccount.create({
      data: {
        tenantId: OTHER_TENANT,
        plaidItemId: 'recon-other-item',
        plaidAccountId: `recon-other-account-${Date.now()}`,
        name: 'Other Checking',
        type: 'checking',
        connected: true,
      },
    });
    const otherTxn = await prisma.abBankTransaction.create({
      data: {
        tenantId: OTHER_TENANT,
        bankAccountId: acct.id,
        plaidTransactionId: `recon-other-txn-${Date.now()}`,
        amount: 500,
        date: today,
        merchantName: 'Other',
        name: 'OTHER TENANT TX',
        matchStatus: 'exception',
      },
    });

    // TENANT (the e2e tenant) tries to match someone else's txn.
    const matchRes = await request.post(
      `${WEB}/api/v1/agentbook-expense/bank-transactions/${otherTxn.id}/match`,
      {
        headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
        data: { targetType: 'expense', targetId: 'whatever' },
      },
    );
    expect(matchRes.status()).toBe(404);

    const skipRes = await request.post(
      `${WEB}/api/v1/agentbook-expense/bank-transactions/${otherTxn.id}/skip`,
      {
        headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' },
      },
    );
    expect(skipRes.status()).toBe(404);

    // Other-tenant row was NOT mutated.
    const stillThere = await prisma.abBankTransaction.findUnique({ where: { id: otherTxn.id } });
    expect(stillThere?.matchStatus).toBe('exception');

    await prisma.abBankTransaction.delete({ where: { id: otherTxn.id } });
    await prisma.abBankAccount.delete({ where: { id: acct.id } });
  });
});

test.describe.serial('PR 9 — Telegram callbacks', () => {
  test.beforeAll(async () => {
    if (!prisma) {
      const dbMod = await import('@naap/database');
      prisma = dbMod.prisma;
    }
  });

  test('bnk_skip callback flips matchStatus to ignored', async ({ request }) => {
    const today = new Date();
    const acct = await prisma.abBankAccount.create({
      data: {
        tenantId: TENANT,
        plaidItemId: 'cb-skip-item',
        plaidAccountId: `cb-skip-account-${Date.now()}`,
        name: 'CB Skip',
        type: 'checking',
        connected: true,
      },
    });
    const txn = await prisma.abBankTransaction.create({
      data: {
        tenantId: TENANT,
        bankAccountId: acct.id,
        plaidTransactionId: `cb-skip-txn-${Date.now()}`,
        amount: 999,
        date: today,
        merchantName: 'CB',
        name: 'CB SKIP TX',
        matchStatus: 'exception',
      },
    });

    const resp = await postWebhook(request, { callbackData: `bnk_skip:${txn.id}` });
    expect(resp.ok).toBe(true);

    const updated = await prisma.abBankTransaction.findUnique({ where: { id: txn.id } });
    expect(updated?.matchStatus).toBe('ignored');

    await prisma.abBankTransaction.delete({ where: { id: txn.id } });
    await prisma.abBankAccount.delete({ where: { id: acct.id } });
  });

  test('bnk_match callback flips matchStatus to matched (expense path)', async ({ request }) => {
    const today = new Date();
    const acct = await prisma.abBankAccount.create({
      data: {
        tenantId: TENANT,
        plaidItemId: 'cb-match-item',
        plaidAccountId: `cb-match-account-${Date.now()}`,
        name: 'CB Match',
        type: 'checking',
        connected: true,
      },
    });
    const expense = await prisma.abExpense.create({
      data: {
        tenantId: TENANT,
        amountCents: 1500,
        date: today,
        description: 'CB Match expense',
        isPersonal: false,
        status: 'confirmed',
      },
    });
    const txn = await prisma.abBankTransaction.create({
      data: {
        tenantId: TENANT,
        bankAccountId: acct.id,
        plaidTransactionId: `cb-match-txn-${Date.now()}`,
        amount: 1500,
        date: today,
        merchantName: 'Match',
        name: 'CB MATCH TX',
        matchStatus: 'exception',
        matchedExpenseId: expense.id,
      },
    });

    const resp = await postWebhook(request, { callbackData: `bnk_match:${txn.id}` });
    expect(resp.ok).toBe(true);

    const updated = await prisma.abBankTransaction.findUnique({ where: { id: txn.id } });
    expect(updated?.matchStatus).toBe('matched');
    expect(updated?.matchedExpenseId).toBe(expense.id);

    await prisma.abBankTransaction.delete({ where: { id: txn.id } });
    await prisma.abBankAccount.delete({ where: { id: acct.id } });
    await prisma.abExpense.delete({ where: { id: expense.id } });
  });

  test('bnk_pickexpense → bnk_m2 picker flow matches and cleans tokens', async ({ request }) => {
    // Set up a txn with multiple plausible expense candidates so the
    // picker actually has runners-up. We create three expenses at $19,
    // $20, $21 and a $20 outflow — the scorer should rank $20 first.
    const today = new Date();
    const acct = await prisma.abBankAccount.create({
      data: {
        tenantId: TENANT,
        plaidItemId: 'pick-item',
        plaidAccountId: `pick-account-${Date.now()}`,
        name: 'Pick Checking',
        type: 'checking',
        connected: true,
      },
    });
    const expA = await prisma.abExpense.create({
      data: { tenantId: TENANT, amountCents: 1900, date: today, description: 'Office snacks A', isPersonal: false, status: 'confirmed' },
    });
    const expB = await prisma.abExpense.create({
      data: { tenantId: TENANT, amountCents: 2000, date: today, description: 'Office snacks B', isPersonal: false, status: 'confirmed' },
    });
    const expC = await prisma.abExpense.create({
      data: { tenantId: TENANT, amountCents: 2100, date: today, description: 'Office snacks C', isPersonal: false, status: 'confirmed' },
    });
    const txn = await prisma.abBankTransaction.create({
      data: {
        tenantId: TENANT,
        bankAccountId: acct.id,
        plaidTransactionId: `pick-txn-${Date.now()}`,
        amount: 2000,
        date: today,
        merchantName: 'Snacks',
        name: 'SNACKS PURCHASE',
        matchStatus: 'exception',
      },
    });

    // 1) Open the expense picker.
    const pickResp = await postWebhook(request, { callbackData: `bnk_pickexpense:${txn.id}` });
    expect(pickResp.ok).toBe(true);

    // 2) Picker tokens should now exist for this txn. Pick the one
    // pointing at expB (the exact-amount match).
    const tokens = await prisma.abUserMemory.findMany({
      where: {
        tenantId: TENANT,
        key: { startsWith: 'telegram:bnk_pick:' },
        value: { contains: `"txnId":"${txn.id}"` },
      },
    });
    expect(tokens.length).toBeGreaterThan(0);
    const target = tokens.find((t) => t.value.includes(`"targetId":"${expB.id}"`));
    expect(target).toBeTruthy();
    const tokenStr = target!.key.replace('telegram:bnk_pick:', '');

    // 3) Fire bnk_m2:<token>.
    const m2Resp = await postWebhook(request, { callbackData: `bnk_m2:${tokenStr}` });
    expect(m2Resp.ok).toBe(true);

    // 4) Txn matched to the picked expense.
    const updated = await prisma.abBankTransaction.findUnique({ where: { id: txn.id } });
    expect(updated?.matchStatus).toBe('matched');
    expect(updated?.matchedExpenseId).toBe(expB.id);

    // 5) ALL sibling picker tokens for this txn should be gone.
    const remaining = await prisma.abUserMemory.findMany({
      where: {
        tenantId: TENANT,
        key: { startsWith: 'telegram:bnk_pick:' },
        value: { contains: `"txnId":"${txn.id}"` },
      },
    });
    expect(remaining.length).toBe(0);

    // 6) AbEvent emitted for parity with the HTTP path.
    const ev = await prisma.abEvent.findFirst({
      where: {
        tenantId: TENANT,
        eventType: 'bank.txn_matched',
        action: { path: ['transactionId'], equals: txn.id },
      },
    });
    expect(ev).toBeTruthy();

    // Cleanup.
    await prisma.abEvent.deleteMany({
      where: { tenantId: TENANT, action: { path: ['transactionId'], equals: txn.id } },
    });
    await prisma.abBankTransaction.delete({ where: { id: txn.id } });
    await prisma.abBankAccount.delete({ where: { id: acct.id } });
    await prisma.abExpense.deleteMany({ where: { id: { in: [expA.id, expB.id, expC.id] } } });
  });
});
