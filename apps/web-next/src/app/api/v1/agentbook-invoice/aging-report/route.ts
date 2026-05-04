/**
 * AR aging report — group outstanding invoices into 5 age buckets.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface AgingEntry {
  invoiceId: string;
  number: string;
  clientId: string;
  clientName: string;
  amountCents: number;
  balanceDueCents: number;
  issuedDate: Date;
  dueDate: Date;
  daysOverdue: number;
}

type Bucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const now = new Date();

    const invoices = await db.abInvoice.findMany({
      where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
      include: { payments: true, client: true },
    });

    const buckets: Record<Bucket, AgingEntry[]> = {
      current: [],
      '1-30': [],
      '31-60': [],
      '61-90': [],
      '90+': [],
    };
    const bucketTotals: Record<Bucket, number> = {
      current: 0,
      '1-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };

    for (const inv of invoices) {
      const totalPaid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
      const balanceDue = inv.amountCents - totalPaid;
      if (balanceDue <= 0) continue;

      const daysOverdue = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000);

      const entry: AgingEntry = {
        invoiceId: inv.id,
        number: inv.number,
        clientId: inv.clientId,
        clientName: inv.client.name,
        amountCents: inv.amountCents,
        balanceDueCents: balanceDue,
        issuedDate: inv.issuedDate,
        dueDate: inv.dueDate,
        daysOverdue: Math.max(0, daysOverdue),
      };

      let bucket: Bucket;
      if (daysOverdue <= 0) bucket = 'current';
      else if (daysOverdue <= 30) bucket = '1-30';
      else if (daysOverdue <= 60) bucket = '31-60';
      else if (daysOverdue <= 90) bucket = '61-90';
      else bucket = '90+';

      buckets[bucket].push(entry);
      bucketTotals[bucket] += balanceDue;
    }

    const totalOutstanding = Object.values(bucketTotals).reduce((s, v) => s + v, 0);

    return NextResponse.json({
      success: true,
      data: {
        buckets,
        totals: bucketTotals,
        totalOutstandingCents: totalOutstanding,
        asOfDate: now.toISOString(),
      },
    });
  } catch (err) {
    console.error('[agentbook-invoice/aging-report] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
