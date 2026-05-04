/**
 * Bank transactions — list with optional matchStatus filter.
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
    const status = params.get('status');
    const limit = parseInt(params.get('limit') || '50', 10);

    const where: Record<string, unknown> = { tenantId };
    if (status) where.matchStatus = status;

    const transactions = await db.abBankTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: limit,
    });
    return NextResponse.json({ success: true, data: transactions });
  } catch (err) {
    console.error('[agentbook-expense/bank-transactions] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
