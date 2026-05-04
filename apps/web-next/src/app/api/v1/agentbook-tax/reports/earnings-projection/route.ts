/**
 * Earnings projection — linear extrapolation of YTD revenue with a
 * confidence band that narrows as more months elapse.
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
    const year = new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const now = new Date();
    const monthsElapsed = now.getMonth() + now.getDate() / 30;

    const revenueAccts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'revenue' },
      select: { id: true },
    });
    const revIds = revenueAccts.map((a) => a.id);

    const lines = await db.abJournalLine.findMany({
      where: { accountId: { in: revIds }, entry: { tenantId, date: { gte: yearStart } } },
    });
    const ytdRevenue = lines.reduce((s, l) => s + l.creditCents, 0);

    const monthlyRate = monthsElapsed > 0 ? ytdRevenue / monthsElapsed : 0;
    const projected = Math.round(monthlyRate * 12);
    const uncertainty = Math.max(0.05, 0.2 * (1 - monthsElapsed / 12));

    return NextResponse.json({
      success: true,
      data: {
        ytdRevenueCents: ytdRevenue,
        projectedAnnualCents: projected,
        confidenceLow: Math.round(projected * (1 - uncertainty)),
        confidenceHigh: Math.round(projected * (1 + uncertainty)),
        monthsOfData: Math.floor(monthsElapsed),
        methodology: `Linear extrapolation from ${Math.floor(monthsElapsed)} months (±${Math.round(uncertainty * 100)}%)`,
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/reports/earnings-projection] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
