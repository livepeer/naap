/**
 * Annual summary — full year P&L + counts (expenses, invoices, clients,
 * vendors).
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
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const [expenseCount, invoiceCount, clientCount, vendorCount, revenueAccts, expenseAccts] =
      await Promise.all([
        db.abExpense.count({
          where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false },
        }),
        db.abInvoice.count({ where: { tenantId, issuedDate: { gte: yearStart, lte: yearEnd } } }),
        db.abClient.count({ where: { tenantId } }),
        db.abVendor.count({ where: { tenantId } }),
        db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' }, select: { id: true } }),
        db.abAccount.findMany({ where: { tenantId, accountType: 'expense' }, select: { id: true } }),
      ]);

    let totalRevenue = 0;
    for (const a of revenueAccts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      totalRevenue += lines.reduce((s, l) => s + l.creditCents, 0);
    }
    let totalExpenses = 0;
    for (const a of expenseAccts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      totalExpenses += lines.reduce((s, l) => s + l.debitCents, 0);
    }

    return NextResponse.json({
      success: true,
      data: {
        year,
        revenueCents: totalRevenue,
        expensesCents: totalExpenses,
        netIncomeCents: totalRevenue - totalExpenses,
        expenseCount,
        invoiceCount,
        clientCount,
        vendorCount,
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/reports/annual-summary] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
