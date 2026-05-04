/**
 * Fiscal periods — list (year/month).
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
    const periods = await db.abFiscalPeriod.findMany({
      where: { tenantId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return NextResponse.json({ success: true, data: periods });
  } catch (err) {
    console.error('[agentbook-core/fiscal-periods] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
