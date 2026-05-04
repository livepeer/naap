/**
 * Close a fiscal period — locks the year/month so no new journal
 * entries can be posted into it. Idempotent.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string; month: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const p = await params;
    const year = parseInt(p.year, 10);
    const month = parseInt(p.month, 10);

    const period = await db.$transaction(async (tx) => {
      const fp = await tx.abFiscalPeriod.upsert({
        where: { tenantId_year_month: { tenantId, year, month } },
        update: { status: 'closed', closedAt: new Date(), closedBy: tenantId },
        create: {
          tenantId,
          year,
          month,
          status: 'closed',
          closedAt: new Date(),
          closedBy: tenantId,
        },
      });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'period.closed',
          actor: 'human',
          action: { year, month },
        },
      });
      return fp;
    });

    return NextResponse.json({ success: true, data: period });
  } catch (err) {
    console.error('[agentbook-core/fiscal-periods/:year/:month/close] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
