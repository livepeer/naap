/**
 * Receipt audit — split business expenses by whether they have a
 * receipt URL on file, with the missing list returned.
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
    const params = request.nextUrl.searchParams;
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');

    const where: Record<string, unknown> = { tenantId, isPersonal: false };
    if (startDate || endDate) {
      const date: Record<string, Date> = {};
      if (startDate) date.gte = new Date(startDate);
      if (endDate) date.lte = new Date(endDate);
      where.date = date;
    }

    const expenses = await db.abExpense.findMany({ where, orderBy: { date: 'desc' } });
    const withReceipt = expenses.filter((e) => e.receiptUrl);
    const withoutReceipt = expenses.filter((e) => !e.receiptUrl);

    return NextResponse.json({
      success: true,
      data: {
        total: expenses.length,
        withReceipt: withReceipt.length,
        withoutReceipt: withoutReceipt.length,
        coveragePercent: expenses.length > 0 ? withReceipt.length / expenses.length : 0,
        missingReceipts: withoutReceipt.map((e) => ({
          id: e.id,
          date: e.date,
          amountCents: e.amountCents,
          description: e.description,
        })),
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/reports/receipt-audit] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
