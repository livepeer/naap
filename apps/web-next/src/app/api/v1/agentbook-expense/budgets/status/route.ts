/**
 * Budget status — current-period spend vs each budget limit.
 *
 * Delegates to the budget monitor lib so quarterly/annual budgets
 * compute the right window (PR 8). For monthly budgets the math is
 * identical to the previous month-only implementation but now stays
 * tenant-timezone aware.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { getBudgetProgress } from '@/lib/agentbook-budget-monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const budgets = await db.abBudget.findMany({
      where: { tenantId },
      orderBy: { categoryName: 'asc' },
    });
    const progress = await getBudgetProgress(tenantId);
    const byId = new Map(progress.map((p) => [p.budgetId, p]));

    const result = budgets.map((b) => {
      const p = byId.get(b.id);
      return {
        ...b,
        spentCents: p?.spentCents ?? 0,
        percent: p?.percent ?? 0,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        budgets: result,
        period: 'mixed',
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
