/**
 * Proactive money-moves — three deterministic suggestions:
 *   1. Cash cushion thin (< 2 months runway)
 *   2. Revenue concentration risk (one client > 50% of billed)
 *   3. Tax-bracket proximity (within $5k of jumping to next bracket)
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Move {
  type: string;
  urgency: 'critical' | 'important' | 'informational';
  title: string;
  description: string;
  impactCents: number;
}

const US_BRACKETS = [
  { min: 0, max: 1_160_000, rate: 0.10 },
  { min: 1_160_000, max: 4_712_500, rate: 0.12 },
  { min: 4_712_500, max: 10_052_500, rate: 0.22 },
  { min: 10_052_500, max: 19_190_000, rate: 0.24 },
  { min: 19_190_000, max: null as number | null, rate: 0.32 },
];

const CA_BRACKETS = [
  { min: 0, max: 5_737_500, rate: 0.15 },
  { min: 5_737_500, max: 11_475_000, rate: 0.205 },
  { min: 11_475_000, max: 15_846_800, rate: 0.26 },
  { min: 15_846_800, max: 22_170_800, rate: 0.29 },
  { min: 22_170_800, max: null as number | null, rate: 0.33 },
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const moves: Move[] = [];

    const cash = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
    if (cash) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: cash.id, entry: { tenantId } },
      });
      const balance = lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
      const threeMonthsAgo = new Date(Date.now() - 90 * 86_400_000);
      const expenses = await db.abExpense.aggregate({
        where: { tenantId, isPersonal: false, date: { gte: threeMonthsAgo } },
        _sum: { amountCents: true },
      });
      const monthlyExp = (expenses._sum.amountCents || 0) / 3;
      if (monthlyExp > 0 && balance / monthlyExp < 2) {
        moves.push({
          type: 'cash_cushion',
          urgency: balance / monthlyExp < 1 ? 'critical' : 'important',
          title: 'Cash cushion thin',
          description: `${(balance / monthlyExp).toFixed(1)} months runway`,
          impactCents: Math.round(monthlyExp * 3 - balance),
        });
      }
    }

    const clients = await db.abClient.findMany({ where: { tenantId } });
    const totalRev = clients.reduce((s, c) => s + c.totalBilledCents, 0);
    if (totalRev > 0) {
      const top = [...clients].sort((a, b) => b.totalBilledCents - a.totalBilledCents)[0];
      if (top && top.totalBilledCents / totalRev > 0.5) {
        moves.push({
          type: 'revenue_cliff',
          urgency: 'important',
          title: `${top.name} = ${Math.round((top.totalBilledCents / totalRev) * 100)}% of revenue`,
          description: 'Diversification recommended',
          impactCents: top.totalBilledCents,
        });
      }
    }

    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const estimate = await db.abTaxEstimate.findFirst({
      where: { tenantId },
      orderBy: { calculatedAt: 'desc' },
    });
    if (estimate && estimate.netIncomeCents > 0) {
      const brackets = (config?.jurisdiction || 'us') === 'ca' ? CA_BRACKETS : US_BRACKETS;
      for (let i = 0; i < brackets.length - 1; i++) {
        const b = brackets[i];
        if (b.max && estimate.netIncomeCents > b.min && estimate.netIncomeCents < b.max) {
          const gap = b.max - estimate.netIncomeCents;
          if (gap < 500_000 && gap > 0) {
            const nextRate = brackets[i + 1].rate;
            const savings = Math.round(gap * (nextRate - b.rate));
            moves.push({
              type: 'optimal_timing',
              urgency: 'informational',
              title: `$${(gap / 100).toFixed(0)} from next tax bracket`,
              description: `Prepay $${(gap / 100).toFixed(0)} in deductible expenses before year-end to stay in the ${(b.rate * 100).toFixed(0)}% bracket and save ~$${(savings / 100).toFixed(0)}.`,
              impactCents: savings,
            });
            break;
          }
        }
      }
    }

    return NextResponse.json({ success: true, data: moves });
  } catch (err) {
    console.error('[agentbook-core/money-moves] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
