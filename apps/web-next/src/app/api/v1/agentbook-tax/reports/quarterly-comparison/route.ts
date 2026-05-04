/**
 * Quarterly comparison — revenue / expenses / net per quarter for a year.
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
    const yearParam = request.nextUrl.searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

    const [revenueAccts, expenseAccts] = await Promise.all([
      db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' }, select: { id: true } }),
      db.abAccount.findMany({ where: { tenantId, accountType: 'expense' }, select: { id: true } }),
    ]);

    const quarters: { quarter: string; revenueCents: number; expensesCents: number; netCents: number }[] = [];

    for (let q = 1; q <= 4; q++) {
      const start = new Date(year, (q - 1) * 3, 1);
      const end = new Date(year, q * 3, 0);

      let rev = 0;
      for (const a of revenueAccts) {
        const lines = await db.abJournalLine.findMany({
          where: { accountId: a.id, entry: { tenantId, date: { gte: start, lte: end } } },
        });
        rev += lines.reduce((s, l) => s + l.creditCents, 0);
      }
      let exp = 0;
      for (const a of expenseAccts) {
        const lines = await db.abJournalLine.findMany({
          where: { accountId: a.id, entry: { tenantId, date: { gte: start, lte: end } } },
        });
        exp += lines.reduce((s, l) => s + l.debitCents, 0);
      }
      quarters.push({
        quarter: `Q${q} ${year}`,
        revenueCents: rev,
        expensesCents: exp,
        netCents: rev - exp,
      });
    }

    return NextResponse.json({ success: true, data: quarters });
  } catch (err) {
    console.error('[agentbook-tax/reports/quarterly-comparison] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
