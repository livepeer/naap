/**
 * Bank reconciliation detail — counts + the most recent 20 unmatched
 * exception transactions.
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
    const [total, matched, exceptions, pending, unmatched] = await Promise.all([
      db.abBankTransaction.count({ where: { tenantId } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'matched' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'exception' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'pending' } }),
      db.abBankTransaction.findMany({
        where: { tenantId, matchStatus: 'exception' },
        orderBy: { date: 'desc' },
        take: 20,
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        total,
        matched,
        exceptions,
        pending,
        matchRate: total > 0 ? matched / total : 0,
        unmatchedDetail: unmatched,
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/reports/bank-reconciliation] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
