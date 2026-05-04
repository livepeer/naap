/**
 * AR aging detail — every outstanding invoice with its age bucket.
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
    const invoices = await db.abInvoice.findMany({
      where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
      include: { client: true, payments: true },
      orderBy: { dueDate: 'asc' },
    });

    const now = new Date();
    const detail = invoices.map((inv) => {
      const paidCents = inv.payments.reduce((s, p) => s + p.amountCents, 0);
      const balanceCents = inv.amountCents - paidCents;
      const daysOverdue = Math.max(
        0,
        Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000),
      );
      const bucket =
        daysOverdue <= 0 ? 'current' :
        daysOverdue <= 30 ? '1-30' :
        daysOverdue <= 60 ? '31-60' :
        daysOverdue <= 90 ? '61-90' : '90+';
      return {
        invoiceNumber: inv.number,
        clientName: inv.client?.name,
        amountCents: inv.amountCents,
        paidCents,
        balanceCents,
        dueDate: inv.dueDate,
        daysOverdue,
        bucket,
      };
    });

    const buckets: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const d of detail) buckets[d.bucket] = (buckets[d.bucket] || 0) + d.balanceCents;

    return NextResponse.json({
      success: true,
      data: {
        detail,
        buckets,
        totalOutstandingCents: detail.reduce((s, d) => s + d.balanceCents, 0),
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/reports/ar-aging-detail] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
