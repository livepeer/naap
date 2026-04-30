/**
 * Weekly Review Cron — Sends weekly financial summary on Mondays.
 * Vercel cron: "0 14 * * 1" (2 PM UTC Monday)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';


export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let processed = 0;

    const tenants = await db.abTenantConfig.findMany();

    for (const tenant of tenants) {
      const tenantId = tenant.userId;

      // Aggregate weekly expenses
      const weeklyExpenses = await db.abExpense.aggregate({
        where: { tenantId, date: { gte: weekAgo }, isPersonal: false },
        _sum: { amountCents: true },
        _count: true,
      });

      // Aggregate weekly invoices created
      const weeklyInvoices = await db.abInvoice.aggregate({
        where: { tenantId, issuedDate: { gte: weekAgo } },
        _sum: { amountCents: true },
        _count: true,
      });

      // Aggregate weekly payments received
      const weeklyPayments = await db.abPayment.aggregate({
        where: { tenantId, date: { gte: weekAgo } },
        _sum: { amountCents: true },
        _count: true,
      });

      // Count overdue invoices
      const overdueCount = await db.abInvoice.count({
        where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] }, dueDate: { lt: now } },
      });

      // Missing receipts this week
      const missingReceipts = await db.abExpense.count({
        where: { tenantId, receiptUrl: null, date: { gte: weekAgo } },
      });

      // Emit weekly review event for proactive engine
      await db.abEvent.create({
        data: {
          tenantId,
          eventType: 'proactive.weekly_review',
          actor: 'system',
          action: {
            period_start: weekAgo.toISOString(),
            period_end: now.toISOString(),
            expenses_cents: weeklyExpenses._sum.amountCents || 0,
            expense_count: weeklyExpenses._count || 0,
            invoiced_cents: weeklyInvoices._sum.amountCents || 0,
            invoice_count: weeklyInvoices._count || 0,
            payments_cents: weeklyPayments._sum.amountCents || 0,
            payment_count: weeklyPayments._count || 0,
            overdue_invoices: overdueCount,
            missing_receipts: missingReceipts,
          },
        },
      });

      processed++;
    }

    return NextResponse.json({
      success: true,
      processed,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.error('Weekly review cron error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
