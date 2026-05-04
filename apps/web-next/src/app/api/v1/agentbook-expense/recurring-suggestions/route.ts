/**
 * Recurring-expense suggestions — find vendors with 3+ similar-amount
 * expenses in the last 6 months and infer a frequency.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Suggestion {
  vendorId: string;
  vendorName: string;
  avgAmountCents: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  occurrences: number;
  avgIntervalDays: number;
  lastExpenseDate: Date;
  categoryId: string | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const expenses = await db.abExpense.findMany({
      where: { tenantId, vendorId: { not: null }, date: { gte: sixMonthsAgo }, isPersonal: false },
      orderBy: { date: 'asc' },
    });

    const byVendor: Record<string, typeof expenses> = {};
    for (const e of expenses) {
      if (!e.vendorId) continue;
      if (!byVendor[e.vendorId]) byVendor[e.vendorId] = [];
      byVendor[e.vendorId].push(e);
    }

    const existingRules = await db.abRecurringRule.findMany({
      where: { tenantId, active: true },
    });
    const existingVendorIds = new Set(existingRules.map((r) => r.vendorId));

    const suggestions: Suggestion[] = [];

    for (const [vendorId, vendorExpenses] of Object.entries(byVendor)) {
      if (vendorExpenses.length < 3) continue;
      if (existingVendorIds.has(vendorId)) continue;

      const amounts = vendorExpenses.map((e) => e.amountCents);
      const avgAmount = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
      const allSimilar = amounts.every((a) => Math.abs(a - avgAmount) / avgAmount < 0.2);
      if (!allSimilar) continue;

      const dates = vendorExpenses.map((e) => e.date.getTime()).sort();
      const intervals: number[] = [];
      for (let i = 1; i < dates.length; i++) {
        intervals.push((dates[i] - dates[i - 1]) / 86_400_000);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      let frequency: Suggestion['frequency'] = 'monthly';
      if (avgInterval < 10) frequency = 'weekly';
      else if (avgInterval < 21) frequency = 'biweekly';
      else if (avgInterval > 80) frequency = 'quarterly';
      else if (avgInterval > 300) frequency = 'annual';

      const vendor = await db.abVendor.findFirst({ where: { id: vendorId } });

      suggestions.push({
        vendorId,
        vendorName: vendor?.name || 'Unknown',
        avgAmountCents: avgAmount,
        frequency,
        occurrences: vendorExpenses.length,
        avgIntervalDays: Math.round(avgInterval),
        lastExpenseDate: vendorExpenses[vendorExpenses.length - 1].date,
        categoryId: vendorExpenses[0].categoryId,
      });
    }

    suggestions.sort((a, b) => b.occurrences - a.occurrences);

    return NextResponse.json({ success: true, data: suggestions });
  } catch (err) {
    console.error('[agentbook-expense/recurring-suggestions] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
