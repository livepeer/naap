/**
 * Invoice send — flip status to "sent", emit event.
 *
 * Email delivery is deferred until the email provider port lands;
 * the legacy handler also separates state-transition from email send.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { audit } from '@/lib/agentbook-audit';
import { inferSource, inferActor } from '@/lib/agentbook-audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;

    const invoice = await db.abInvoice.findFirst({ where: { id, tenantId } });
    if (!invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status === 'void') {
      return NextResponse.json({ success: false, error: 'Cannot send a voided invoice' }, { status: 422 });
    }
    if (invoice.status === 'paid') {
      return NextResponse.json({ success: false, error: 'Invoice is already paid' }, { status: 422 });
    }

    const updated = await db.$transaction(async (tx) => {
      const inv = await tx.abInvoice.update({
        where: { id },
        data: { status: 'sent' },
      });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'invoice.sent',
          actor: 'agent',
          action: { invoiceId: invoice.id, number: invoice.number },
        },
      });
      return inv;
    });

    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'invoice.send',
      entityType: 'AbInvoice',
      entityId: id,
      before: { status: invoice.status },
      after: { status: updated.status, number: invoice.number },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-invoice/invoices/:id/send] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
