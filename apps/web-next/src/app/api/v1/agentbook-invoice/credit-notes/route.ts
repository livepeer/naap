/**
 * Credit notes — list + create. Posts a reversing journal entry and
 * decrements the client's totalBilledCents.
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
    const creditNotes = await db.abCreditNote.findMany({
      where: { tenantId },
      include: { invoice: { select: { number: true, clientId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: creditNotes });
  } catch (err) {
    console.error('[agentbook-invoice/credit-notes GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface CreateCreditNoteBody {
  invoiceId?: string;
  amountCents?: number;
  reason?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateCreditNoteBody;
    const { invoiceId, amountCents, reason } = body;

    if (!invoiceId || !amountCents || amountCents <= 0 || !reason) {
      return NextResponse.json(
        { success: false, error: 'invoiceId, amountCents (positive), and reason are required' },
        { status: 400 },
      );
    }

    const invoice = await db.abInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { payments: true, client: true },
    });
    if (!invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status === 'void') {
      return NextResponse.json({ success: false, error: 'Cannot credit a voided invoice' }, { status: 422 });
    }

    const totalPaid = invoice.payments.reduce((s, p) => s + p.amountCents, 0);
    const balance = invoice.amountCents - totalPaid;
    if (amountCents > balance) {
      return NextResponse.json(
        { success: false, error: `Credit amount (${amountCents}) exceeds remaining balance (${balance})` },
        { status: 422 },
      );
    }

    const year = new Date().getFullYear();
    const lastCN = await db.abCreditNote.findFirst({
      where: { tenantId, number: { startsWith: `CN-${year}-` } },
      orderBy: { number: 'desc' },
    });
    let cnSeq = 1;
    if (lastCN) cnSeq = parseInt(lastCN.number.split('-')[2], 10) + 1;
    const cnNumber = `CN-${year}-${String(cnSeq).padStart(4, '0')}`;

    const [arAccount, revenueAccount] = await Promise.all([
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1100' } } }),
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '4000' } } }),
    ]);
    if (!arAccount || !revenueAccount) {
      return NextResponse.json({ success: false, error: 'AR/Revenue accounts not found' }, { status: 422 });
    }

    const creditNote = await db.$transaction(async (tx) => {
      const je = await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(),
          memo: `Credit note ${cnNumber} against ${invoice.number}`,
          sourceType: 'credit_note',
          verified: true,
          lines: {
            create: [
              { accountId: revenueAccount.id, debitCents: amountCents, creditCents: 0, description: `Revenue reversal - ${cnNumber}` },
              { accountId: arAccount.id, debitCents: 0, creditCents: amountCents, description: `AR reduction - ${cnNumber}` },
            ],
          },
        },
      });

      const cn = await tx.abCreditNote.create({
        data: {
          tenantId,
          invoiceId,
          number: cnNumber,
          amountCents,
          reason,
          journalEntryId: je.id,
        },
      });

      await tx.abClient.update({
        where: { id: invoice.clientId },
        data: { totalBilledCents: { decrement: amountCents } },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'credit_note.created',
          actor: 'agent',
          action: { creditNoteId: cn.id, number: cnNumber, invoiceId, amountCents, reason },
        },
      });

      return cn;
    });

    return NextResponse.json({ success: true, data: creditNote }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-invoice/credit-notes POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
