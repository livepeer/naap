/**
 * Tax package summary — gross income, total expenses, net income,
 * expense-by-category breakdown, receipt coverage, ready-to-file flag.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const yearParam = request.nextUrl.searchParams.get('year');
    const taxYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31);

    const revenueAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'revenue' },
      select: { id: true },
    });
    const revLines = await db.abJournalLine.findMany({
      where: {
        accountId: { in: revenueAccounts.map((a) => a.id) },
        entry: { tenantId, date: { gte: yearStart, lte: yearEnd } },
      },
    });
    const gross = revLines.reduce((s, l) => s + l.creditCents, 0);

    const expenseAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense' },
    });
    const categories: { category: string; amountCents: number }[] = [];
    let totalExp = 0;
    for (const a of expenseAccounts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      const amount = lines.reduce((s, l) => s + l.debitCents, 0);
      if (amount > 0) {
        categories.push({ category: a.taxCategory || a.name, amountCents: amount });
        totalExp += amount;
      }
    }

    const [allExp, withReceipts] = await Promise.all([
      db.abExpense.count({
        where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false },
      }),
      db.abExpense.count({
        where: {
          tenantId,
          date: { gte: yearStart, lte: yearEnd },
          isPersonal: false,
          receiptUrl: { not: null },
        },
      }),
    ]);

    const missing: string[] = [];
    if (allExp > 0 && withReceipts / allExp < 0.8) {
      missing.push(`${allExp - withReceipts} expenses without receipts`);
    }
    if (gross === 0) missing.push('No revenue recorded');

    return NextResponse.json({
      success: true,
      data: {
        jurisdiction: config?.jurisdiction || 'us',
        taxYear,
        grossIncomeCents: gross,
        totalExpensesCents: totalExp,
        netIncomeCents: gross - totalExp,
        expensesByCategory: categories.sort((a, b) => b.amountCents - a.amountCents),
        receiptCoverage: allExp > 0 ? withReceipts / allExp : 0,
        readyToFile: missing.length === 0,
        missingItems: missing,
      },
    });
  } catch (err) {
    console.error('[agentbook-core/tax-package] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
