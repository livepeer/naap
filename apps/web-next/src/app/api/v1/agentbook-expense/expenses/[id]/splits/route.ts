/**
 * List splits for an expense.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await resolveAgentbookTenant(request);
    const { id } = await params;
    const splits = await db.abExpenseSplit.findMany({
      where: { expenseId: id },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ success: true, data: splits });
  } catch (err) {
    console.error('[agentbook-expense/expenses/:id/splits] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
