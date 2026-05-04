/**
 * Budget status — current-month spending vs each budget limit.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const budgets = await db.abBudget.findMany({ where: { tenantId } });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const result = await Promise.all(
      budgets.map(async (budget) => {
        const where: Record<string, unknown> = {
          tenantId,
          date: { gte: monthStart, lte: monthEnd },
          isPersonal: false,
        };
        if (budget.categoryId) where.categoryId = budget.categoryId;
        const agg = await db.abExpense.aggregate({
          _sum: { amountCents: true },
          where,
        });
        const spentCents = agg._sum.amountCents || 0;
        return {
          ...budget,
          spentCents,
          percent: Math.round((spentCents / Math.max(1, budget.amountCents)) * 100),
        };
      }),
    );

    return NextResponse.json({
      success: true,
      data: {
        budgets: result,
        period: 'monthly',
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
      },
    });
  } catch (err) {
    console.error('[agentbook-expense/budgets/status] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
