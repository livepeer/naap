/**
 * Expense by vendor — top spend, sorted descending.
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

    const expenses = await db.abExpense.findMany({
      where,
      select: { vendorId: true, amountCents: true },
    });

    const vendorTotals = new Map<string, number>();
    const vendorCounts = new Map<string, number>();
    for (const e of expenses) {
      if (!e.vendorId) continue;
      vendorTotals.set(e.vendorId, (vendorTotals.get(e.vendorId) || 0) + e.amountCents);
      vendorCounts.set(e.vendorId, (vendorCounts.get(e.vendorId) || 0) + 1);
    }

    const vendorIds = Array.from(vendorTotals.keys());
    const vendors = await db.abVendor.findMany({ where: { id: { in: vendorIds } } });
    const nameMap = new Map(vendors.map((v) => [v.id, v.name]));

    const result = Array.from(vendorTotals.entries())
      .map(([id, total]) => ({
        vendorId: id,
        vendorName: nameMap.get(id) || 'Unknown',
        totalCents: total,
        count: vendorCounts.get(id) || 0,
      }))
      .sort((a, b) => b.totalCents - a.totalCents);

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[agentbook-tax/reports/expense-by-vendor] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
