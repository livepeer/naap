/**
 * Idempotent seed for the dedicated nightly e2e user.
 *
 * Usage (from CI or locally):
 *   npm run seed:e2e
 *
 * Or invoke via internal endpoint (used by the GHA workflow):
 *   POST /api/v1/e2e-test/reset-e2e-user
 *   Header: x-e2e-reset-token: <E2E_RESET_TOKEN>
 *
 * NOTE: The plan/spec docs reference the path as `/api/v1/__test/reset-e2e-user`,
 * but Next.js excludes any folder starting with `_` from App Router routing
 * (see https://nextjs.org/docs — "private folders"). The folder is therefore
 * named `e2e-test` so the route is actually reachable.
 *
 * Always operates on the fixed E2E_USER_ID UUID. Production users untouched.
 */

import { prisma as db } from '@naap/database';

const E2E_USER_ID = 'b9a80acd-fa14-4209-83a9-03231513fa8f';
const E2E_USER_EMAIL = 'e2e@agentbook.test';

interface ResetResult {
  userId: string;
  expensesCreated: number;
  invoicesCreated: number;
  clientsCreated: number;
}

export async function resetE2eUser(): Promise<ResetResult> {
  await db.user.upsert({
    where: { id: E2E_USER_ID },
    create: { id: E2E_USER_ID, email: E2E_USER_EMAIL, displayName: 'E2E Nightly' },
    update: { displayName: 'E2E Nightly', email: E2E_USER_EMAIL },
  });

  await ensurePassword(E2E_USER_ID, process.env.E2E_USER_PASSWORD || 'e2e-nightly-2026');

  await db.abTenantConfig.upsert({
    where: { userId: E2E_USER_ID },
    create: {
      userId: E2E_USER_ID,
      jurisdiction: 'us',
      timezone: 'America/New_York',
      currency: 'USD',
      dailyDigestEnabled: true,
    },
    update: { dailyDigestEnabled: true },
  });

  const tenantId = E2E_USER_ID;

  // Wipe in FK-safe order: leaf rows first.
  await db.abInvoiceLine.deleteMany({ where: { invoice: { tenantId } } }).catch(() => {});
  await db.abPayment.deleteMany({ where: { tenantId } }).catch(() => {});
  await db.abInvoice.deleteMany({ where: { tenantId } }).catch(() => {});
  await db.abClient.deleteMany({ where: { tenantId } }).catch(() => {});
  await db.abExpense.deleteMany({ where: { tenantId } }).catch(() => {});
  await db.abJournalLine.deleteMany({ where: { entry: { tenantId } } }).catch(() => {});
  await db.abJournalEntry.deleteMany({ where: { tenantId } }).catch(() => {});
  await db.abAccount.deleteMany({ where: { tenantId } }).catch(() => {});
  await db.abConversation.deleteMany({ where: { tenantId } }).catch(() => {});
  await db.abAgentSession.deleteMany({ where: { tenantId } }).catch(() => {});

  // Default chart of accounts
  const accounts = await Promise.all([
    db.abAccount.create({ data: { tenantId, code: '1010', name: 'Cash',                accountType: 'asset',   isActive: true } }),
    db.abAccount.create({ data: { tenantId, code: '1200', name: 'Accounts Receivable', accountType: 'asset',   isActive: true } }),
    db.abAccount.create({ data: { tenantId, code: '4000', name: 'Revenue',             accountType: 'revenue', isActive: true } }),
    db.abAccount.create({ data: { tenantId, code: '5000', name: 'General Expense',     accountType: 'expense', isActive: true } }),
    db.abAccount.create({ data: { tenantId, code: '5100', name: 'Travel',              accountType: 'expense', isActive: true } }),
    db.abAccount.create({ data: { tenantId, code: '3000', name: 'Equity',              accountType: 'equity',  isActive: true } }),
  ]);
  const cashAccount    = accounts.find(a => a.code === '1010')!;
  const equityAccount  = accounts.find(a => a.code === '3000')!;
  const expenseAccount = accounts.find(a => a.code === '5000')!;
  const travelAccount  = accounts.find(a => a.code === '5100')!;

  // Opening journal entry: $5,000 cash → equity
  await db.abJournalEntry.create({
    data: {
      tenantId,
      date: daysAgo(45),
      memo: 'Opening balance',
      sourceType: 'manual',
      lines: { create: [
        { tenantId, accountId: cashAccount.id,   debitCents: 500000, creditCents: 0 }, // G-009
        { tenantId, accountId: equityAccount.id, debitCents: 0,      creditCents: 500000 }, // G-009
      ] },
    },
  });

  // Three clients
  const acme  = await db.abClient.create({ data: { tenantId, name: 'Acme Corp', email: 'billing@acme.test', defaultTerms: 'net-30' } });
  const beta  = await db.abClient.create({ data: { tenantId, name: 'Beta Inc',  email: 'finance@beta.test', defaultTerms: 'net-30' } });
  const gamma = await db.abClient.create({ data: { tenantId, name: 'Gamma LLC', email: 'ap@gamma.test',     defaultTerms: 'net-15' } });

  // Five expenses (one missing receipt)
  const expensesData = [
    { date: daysAgo(2),  amountCents: 2800,  description: 'Uber to client meeting',    categoryId: travelAccount.id, receiptUrl: 'https://e2e.test/r/1.jpg' },
    { date: daysAgo(7),  amountCents: 4500,  description: 'AWS October bill',          categoryId: expenseAccount.id, receiptUrl: 'https://e2e.test/r/2.pdf' },
    { date: daysAgo(12), amountCents: 12000, description: 'Co-working space monthly',  categoryId: expenseAccount.id, receiptUrl: 'https://e2e.test/r/3.pdf' },
    { date: daysAgo(20), amountCents: 6800,  description: 'Conference ticket',         categoryId: travelAccount.id, receiptUrl: null as string | null },
    { date: daysAgo(25), amountCents: 1500,  description: 'Client lunch',              categoryId: expenseAccount.id, receiptUrl: 'https://e2e.test/r/5.jpg' },
  ];
  for (const e of expensesData) {
    await db.abExpense.create({
      data: {
        tenantId,
        date: e.date,
        amountCents: e.amountCents,
        description: e.description,
        categoryId: e.categoryId,
        isPersonal: false,
        receiptUrl: e.receiptUrl,
        source: 'manual',
      },
    });
  }

  // Four invoices: draft / sent (due 7d) / sent overdue (due 30d ago) / paid
  await db.abInvoice.create({
    data: { tenantId, clientId: acme.id, number: 'INV-E2E-DRAFT', status: 'draft', amountCents: 80000, currency: 'USD', issuedDate: new Date(), dueDate: daysFromNow(30) },
  });
  await db.abInvoice.create({
    data: { tenantId, clientId: beta.id, number: 'INV-E2E-SENT', status: 'sent', amountCents: 120000, currency: 'USD', issuedDate: daysAgo(23), dueDate: daysFromNow(7) },
  });
  await db.abInvoice.create({
    data: { tenantId, clientId: gamma.id, number: 'INV-E2E-OVERDUE', status: 'sent', amountCents: 95000, currency: 'USD', issuedDate: daysAgo(60), dueDate: daysAgo(30) },
  });
  const paid = await db.abInvoice.create({
    data: { tenantId, clientId: acme.id, number: 'INV-E2E-PAID', status: 'paid', amountCents: 60000, currency: 'USD', issuedDate: daysAgo(40), dueDate: daysAgo(10) },
  });
  await db.abPayment.create({
    data: { tenantId, invoiceId: paid.id, amountCents: 60000, date: daysAgo(5), method: 'bank_transfer' },
  });

  return { userId: E2E_USER_ID, expensesCreated: expensesData.length, invoicesCreated: 4, clientsCreated: 3 };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function ensurePassword(userId: string, password: string): Promise<void> {
  const crypto = await import('node:crypto');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  const passwordHash = `${salt}:${hash}`;
  await db.user.update({ where: { id: userId }, data: { passwordHash } });
}

// CLI entry — fires when invoked via `tsx scripts/seed-e2e-user.ts`
const isCli =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  import.meta.url === new URL(process.argv[1], 'file://').href;

if (isCli) {
  resetE2eUser()
    .then((r) => {
      console.log('[seed-e2e-user] reset complete:', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed-e2e-user] failed:', err);
      process.exit(1);
    });
}
