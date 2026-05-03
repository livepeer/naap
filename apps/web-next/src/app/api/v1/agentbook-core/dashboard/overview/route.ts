/**
 * Dashboard /overview — minimal native Next.js route.
 *
 * Computes only the slices the new dashboard actually consumes:
 *   • cashToday from asset accounts
 *   • attention queue (overdue invoices, tax window, missing receipts,
 *     books-out-of-balance)
 *   • next-moments (overdue invoice payments + auto-detected recurring)
 *   • recurring outflows (auto-detected from expense history)
 *   • this-month metrics (Rev/Exp/Net + prior month)
 *   • isBrandNew flag
 *
 * Intentionally omitted (returns null/empty for the dashboard to handle):
 *   • cashflow projection (30-day forecasting math) — V2
 *   • quarterly tax estimate calc — V2
 *   • unbilled time aggregate — V2
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import {
  rankAttention,
  buildNextMoments,
  detectRecurringFromHistory,
  resolveTenantId,
  type AttentionItem,
  type NextMoment,
  type RecurringOutflow,
} from '../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveTenantId(request);
    const today = new Date();

    const [
      assetAccounts,
      overdueInvoices,
      upcomingInvoices,
      missingReceiptsCount,
      mtdExpenses,
      mtdRevenue,
      prevExpenses,
      prevRevenue,
      expenseCount,
      invoiceCount,
      ninetyDayExpenses,
    ] = await Promise.all([
      // Cash today: sum of asset-account journal-line balances
      db.abAccount.findMany({
        where: { tenantId, accountType: 'asset', isActive: true },
        select: { id: true, balance: true },
      }),

      // Overdue invoices
      db.abInvoice.findMany({
        where: { tenantId, status: { in: ['sent', 'overdue', 'viewed'] }, dueDate: { lt: today } },
        select: { id: true, dueDate: true, amountCents: true, client: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),

      // Upcoming invoices (next 30 days)
      db.abInvoice.findMany({
        where: {
          tenantId,
          status: { in: ['sent', 'viewed'] },
          dueDate: { gte: today, lte: daysFromNow(30) },
        },
        select: { id: true, dueDate: true, amountCents: true, client: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),

      // Missing receipts count (last 60 days)
      db.abExpense.count({
        where: {
          tenantId,
          isPersonal: false,
          receiptUrl: null,
          date: { gte: daysAgo(60) },
        },
      }),

      // MTD expense aggregate
      db.abExpense.aggregate({
        where: { tenantId, isPersonal: false, date: { gte: startOfMonth(today) } },
        _sum: { amountCents: true },
      }),

      // MTD revenue aggregate (paid invoices this month)
      db.abPayment.aggregate({
        where: { tenantId, date: { gte: startOfMonth(today) } },
        _sum: { amountCents: true },
      }),

      // Prior-month expense
      db.abExpense.aggregate({
        where: {
          tenantId,
          isPersonal: false,
          date: { gte: startOfPrevMonth(today), lt: startOfMonth(today) },
        },
        _sum: { amountCents: true },
      }),

      // Prior-month revenue
      db.abPayment.aggregate({
        where: {
          tenantId,
          date: { gte: startOfPrevMonth(today), lt: startOfMonth(today) },
        },
        _sum: { amountCents: true },
      }),

      // Brand-new flag
      db.abExpense.count({ where: { tenantId } }),
      db.abInvoice.count({ where: { tenantId } }),

      // 90-day expense window for recurring-outflow detection
      db.abExpense.findMany({
        where: { tenantId, isPersonal: false, date: { gte: daysAgo(90) } },
        select: { id: true, vendor: true, description: true, amountCents: true, date: true },
      }),
    ]);

    const cashToday = assetAccounts.reduce((s, a) => s + (a.balance || 0), 0);

    const overdueForRanking = overdueInvoices.map((i) => ({
      id: i.id,
      client: i.client?.name || 'Client',
      daysOverdue: Math.max(1, Math.round((today.getTime() - i.dueDate.getTime()) / 86_400_000)),
      amountCents: i.amountCents,
    }));

    const upcomingForMoments = upcomingInvoices.map((i) => ({
      client: i.client?.name || 'Client',
      amountCents: i.amountCents,
      daysOut: Math.max(0, Math.round((i.dueDate.getTime() - today.getTime()) / 86_400_000)),
      sourceId: i.id,
    }));

    const recurring = detectRecurringFromHistory(
      ninetyDayExpenses.map((e) => ({
        id: e.id,
        vendor: e.vendor || e.description || '',
        amountCents: e.amountCents,
        date: e.date,
      })),
      today,
    );
    const recurringWithDays = recurring.map((r) => ({
      ...r,
      daysOut: Math.max(0, Math.round((new Date(r.nextExpectedDate).getTime() - today.getTime()) / 86_400_000)),
    }));

    const attention: AttentionItem[] = rankAttention({
      overdue: overdueForRanking,
      taxQuarterly: null,
      unbilled: null,
      booksOutOfBalance: false,
      missingReceiptsCount,
    });

    const nextMoments: NextMoment[] = buildNextMoments({
      upcomingInvoices: upcomingForMoments,
      tax: null,
      recurring: recurringWithDays.filter((r) => r.daysOut <= 30),
    });

    const monthMtd = {
      revenueCents: mtdRevenue._sum.amountCents || 0,
      expenseCents: mtdExpenses._sum.amountCents || 0,
      netCents: (mtdRevenue._sum.amountCents || 0) - (mtdExpenses._sum.amountCents || 0),
    };
    const monthPrev = {
      revenueCents: prevRevenue._sum.amountCents || 0,
      expenseCents: prevExpenses._sum.amountCents || 0,
      netCents: (prevRevenue._sum.amountCents || 0) - (prevExpenses._sum.amountCents || 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        cashToday,
        projection: null,             // V2: cashflow forecast
        nextMoments,
        attention,
        recurringOutflows: recurring as RecurringOutflow[],
        monthMtd: monthMtd.revenueCents > 0 || monthMtd.expenseCents > 0 ? monthMtd : null,
        monthPrev: monthPrev.revenueCents > 0 || monthPrev.expenseCents > 0 ? monthPrev : null,
        isBrandNew: expenseCount === 0 && invoiceCount === 0,
      },
    });
  } catch (err) {
    console.error('[dashboard/overview] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfPrevMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
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
