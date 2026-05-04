/**
 * Tax-category summary — expenses grouped by Schedule C / T2125 line.
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
    const taxYearParam = request.nextUrl.searchParams.get('taxYear');
    const year = taxYearParam ? parseInt(taxYearParam, 10) : new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const accounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense', isActive: true },
    });
    const result: { taxCategory: string; accountName: string; totalCents: number }[] = [];

    for (const acct of accounts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      const total = lines.reduce((s, l) => s + l.debitCents, 0);
      if (total > 0) {
        result.push({
          taxCategory: acct.taxCategory || 'Other',
          accountName: acct.name,
          totalCents: total,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taxYear: year,
        categories: result.sort((a, b) => b.totalCents - a.totalCents),
        totalCents: result.reduce((s, r) => s + r.totalCents, 0),
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/reports/tax-summary] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
