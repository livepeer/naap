/**
 * Void an invoice — flip status, post a reversing journal entry,
 * decrement client totalBilledCents. Refuses if there are payments.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

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

    const invoice = await db.abInvoice.findFirst({
      where: { id, tenantId },
      include: { payments: true },
    });
    if (!invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status === 'void') {
      return NextResponse.json({ success: false, error: 'Invoice is already voided' }, { status: 422 });
    }
    if (invoice.status === 'paid') {
      return NextResponse.json({ success: false, error: 'Cannot void a paid invoice' }, { status: 422 });
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
    if (totalPaid > 0) {
      return NextResponse.json(
        { success: false, error: 'Cannot void invoice with existing payments. Refund payments first.' },
        { status: 422 },
      );
    }

    const [arAccount, revenueAccount] = await Promise.all([
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1100' } } }),
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '4000' } } }),
    ]);
    if (!arAccount || !revenueAccount) {
      return NextResponse.json(
        { success: false, error: 'AR/Revenue accounts not found' },
        { status: 422 },
      );
    }

    const updated = await db.$transaction(async (tx) => {
      await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(),
          memo: `VOID - Reverse Invoice ${invoice.number}`,
          sourceType: 'invoice',
          sourceId: invoice.id,
          verified: true,
          lines: {
            create: [
              { accountId: arAccount.id, debitCents: 0, creditCents: invoice.amountCents, description: `Reverse AR - Invoice ${invoice.number}` },
              { accountId: revenueAccount.id, debitCents: invoice.amountCents, creditCents: 0, description: `Reverse Revenue - Invoice ${invoice.number}` },
            ],
          },
        },
      });

      const inv = await tx.abInvoice.update({
        where: { id: invoice.id },
        data: { status: 'void' },
      });

      await tx.abClient.update({
        where: { id: invoice.clientId },
        data: { totalBilledCents: { decrement: invoice.amountCents } },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'invoice.voided',
          actor: 'agent',
          action: {
            invoiceId: invoice.id,
            number: invoice.number,
            amountCents: invoice.amountCents,
          },
          constraintsPassed: ['balance_invariant'],
          verificationResult: 'passed',
        },
      });

      return inv;
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-invoice/invoices/:id/void] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
