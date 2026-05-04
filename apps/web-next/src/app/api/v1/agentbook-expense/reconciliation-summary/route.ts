/**
 * Bank reconciliation summary — counts of matched / exception / pending
 * transactions and an overall match rate.
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
    const [total, matched, exceptions, pending] = await Promise.all([
      db.abBankTransaction.count({ where: { tenantId } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'matched' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'exception' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'pending' } }),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        totalTransactions: total,
        matched,
        exceptions,
        pending,
        matchRate: total > 0 ? matched / total : 0,
      },
    });
  } catch (err) {
    console.error('[agentbook-expense/reconciliation-summary] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
