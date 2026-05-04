/**
 * Update a recurring invoice schedule (status / frequency / template).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface TemplateLine {
  description?: string;
  quantity?: number;
  rateCents: number;
}

interface UpdateBody {
  status?: string;
  frequency?: string;
  templateLines?: TemplateLine[];
  daysToPay?: number;
  autoSend?: boolean;
  nextDue?: string;
  endDate?: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as UpdateBody;

    const existing = await db.abRecurringInvoice.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Recurring invoice not found' },
        { status: 404 },
      );
    }

    const update: Record<string, unknown> = {};
    if (body.status) update.status = body.status;
    if (body.frequency) update.frequency = body.frequency;
    if (body.templateLines) {
      update.templateLines = body.templateLines;
      update.totalCents = body.templateLines.reduce(
        (s, l) => s + Math.round((l.quantity || 1) * l.rateCents),
        0,
      );
    }
    if (body.daysToPay !== undefined) update.daysToPay = body.daysToPay;
    if (body.autoSend !== undefined) update.autoSend = body.autoSend;
    if (body.nextDue) update.nextDue = new Date(body.nextDue);
    if (body.endDate) update.endDate = new Date(body.endDate);

    const updated = await db.abRecurringInvoice.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-invoice/recurring-invoices/:id PUT] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
