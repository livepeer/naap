/**
 * Cash flow projection — current cash + expected inflows from
 * outstanding invoices − expected outflows from active recurring
 * rules across 30/60/90 day windows.
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
    const now = new Date();

    const cashAccount = await db.abAccount.findUnique({
      where: { tenantId_code: { tenantId, code: '1000' } },
    });

    let currentCashCents = 0;
    if (cashAccount) {
      const cashAgg = await db.abJournalLine.aggregate({
        where: {
          accountId: cashAccount.id,
          entry: { tenantId, date: { lte: now } },
        },
        _sum: { debitCents: true, creditCents: true },
      });
      currentCashCents = (cashAgg._sum.debitCents || 0) - (cashAgg._sum.creditCents || 0);
    }

    const recurringRules = await db.abRecurringRule.findMany({
      where: { tenantId, active: true },
    });

    const calcRecurringExpenses = (days: number): number => {
      let total = 0;
      const windowEnd = new Date(now.getTime() + days * 86_400_000);
      for (const rule of recurringRules) {
        let nextDate = new Date(rule.nextExpected);
        while (nextDate <= windowEnd) {
          if (nextDate >= now) total += rule.amountCents;
          switch (rule.frequency) {
            case 'weekly':
              nextDate = new Date(nextDate.getTime() + 7 * 86_400_000);
              break;
            case 'biweekly':
              nextDate = new Date(nextDate.getTime() + 14 * 86_400_000);
              break;
            case 'monthly':
              nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
              break;
            case 'annual':
              nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), nextDate.getDate());
              break;
            default:
              nextDate = new Date(windowEnd.getTime() + 1);
          }
        }
      }
      return total;
    };

    const outstandingInvoices = await db.abInvoice.findMany({
      where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
    });

    const calcExpectedIncome = (days: number): { totalCents: number; invoiceCount: number } => {
      const windowEnd = new Date(now.getTime() + days * 86_400_000);
      let total = 0;
      let count = 0;
      for (const inv of outstandingInvoices) {
        const expectedPayDate = inv.status === 'overdue' ? now : inv.dueDate;
        if (expectedPayDate <= windowEnd) {
          total += inv.amountCents;
          count++;
        }
      }
      return { totalCents: total, invoiceCount: count };
    };

    const buildProjection = (days: number) => {
      const expectedIncome = calcExpectedIncome(days);
      const expectedExpenses = calcRecurringExpenses(days);
      return {
        days,
        expectedIncome,
        expectedExpenses,
        projectedCashCents: currentCashCents + expectedIncome.totalCents - expectedExpenses,
      };
    };

    const projections = [buildProjection(30), buildProjection(60), buildProjection(90)];

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'cashflow.projection.generated',
        actor: 'agent',
        action: {
          currentCashCents,
          recurringRuleCount: recurringRules.length,
          outstandingInvoiceCount: outstandingInvoices.length,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        asOfDate: now.toISOString(),
        currentCashCents,
        outstandingInvoices: outstandingInvoices.map((inv) => ({
          id: inv.id,
          number: inv.number,
          amountCents: inv.amountCents,
          dueDate: inv.dueDate,
          status: inv.status,
        })),
        recurringExpenses: recurringRules.map((r) => ({
          id: r.id,
          amountCents: r.amountCents,
          frequency: r.frequency,
          nextExpected: r.nextExpected,
        })),
        projections,
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/cashflow/projection] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
