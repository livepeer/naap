/**
 * Monthly expense trend — last 12 months totals.
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
    const months: { month: string; totalCents: number }[] = [];

    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const expenses = await db.abExpense.findMany({
        where: { tenantId, isPersonal: false, date: { gte: start, lte: end } },
        select: { amountCents: true },
      });
      months.push({
        month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        totalCents: expenses.reduce((s, e) => s + e.amountCents, 0),
      });
    }

    return NextResponse.json({ success: true, data: months });
  } catch (err) {
    console.error('[agentbook-tax/reports/monthly-expense-trend] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
