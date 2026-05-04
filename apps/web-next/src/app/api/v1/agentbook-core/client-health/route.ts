/**
 * Client health — per-client lifetime value, effective hourly rate,
 * payment reliability, and a risk recommendation.
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
    const clients = await db.abClient.findMany({ where: { tenantId } });
    const totalBilled = clients.reduce((s, c) => s + c.totalBilledCents, 0);

    const result = await Promise.all(
      clients.map(async (c) => {
        const share = totalBilled > 0 ? c.totalBilledCents / totalBilled : 0;
        const outstanding = c.totalBilledCents - c.totalPaidCents;

        const timeEntries = await db.abTimeEntry.findMany({
          where: { tenantId, clientId: c.id, endedAt: { not: null } },
        });
        const totalMinutes = timeEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
        const totalHours = totalMinutes / 60;
        const effectiveRateCents = totalHours > 0 ? Math.round(c.totalBilledCents / totalHours) : 0;

        const paidInvoices = await db.abInvoice.findMany({
          where: { tenantId, clientId: c.id, status: 'paid' },
          include: { payments: true },
        });
        const onTime = paidInvoices.filter((inv) => {
          if (!inv.payments.length) return false;
          return inv.payments[0].date <= inv.dueDate;
        }).length;
        const reliability = paidInvoices.length > 0 ? onTime / paidInvoices.length : 1;
        const daysList = paidInvoices
          .filter((inv) => inv.payments.length > 0)
          .map((inv) =>
            Math.ceil((inv.payments[0].date.getTime() - inv.issuedDate.getTime()) / 86_400_000),
          );
        const avgDays = daysList.length > 0
          ? Math.round(daysList.reduce((s, d) => s + d, 0) / daysList.length)
          : 30;

        let risk: 'low' | 'moderate' | 'high' = 'low';
        let recommendation = `${c.name} is a healthy client.`;
        const avgClientBilled = totalBilled / Math.max(1, clients.length);
        if (effectiveRateCents > 0 && effectiveRateCents < avgClientBilled * 0.7) {
          risk = 'high';
          recommendation = 'Effective rate below average. Consider rate increase.';
        } else if (reliability < 0.7) {
          risk = 'moderate';
          recommendation = `Payment reliability ${Math.round(reliability * 100)}%. Consider shorter terms.`;
        }

        return {
          clientId: c.id,
          clientName: c.name,
          lifetimeValueCents: c.totalBilledCents,
          outstandingCents: outstanding,
          revenueShare: share,
          effectiveRateCents,
          totalHours: Math.round(totalHours * 10) / 10,
          paymentReliability: reliability,
          avgDaysToPay: avgDays,
          riskLevel: risk,
          recommendation,
        };
      }),
    );

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[agentbook-core/client-health] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
