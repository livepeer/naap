/**
 * Invoice payments — record payment, post journal entry, update invoice
 * status if fully paid. Native port of the legacy plugin handler.
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

interface CreatePaymentBody {
  invoiceId?: string;
  amountCents?: number;
  method?: string;
  date?: string;
  stripePaymentId?: string;
  feesCents?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreatePaymentBody;
    const { invoiceId, amountCents, method, date, stripePaymentId, feesCents } = body;

    if (!invoiceId || !amountCents || amountCents <= 0) {
      return NextResponse.json(
        { success: false, error: 'invoiceId and positive amountCents are required' },
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
      return NextResponse.json({ success: false, error: 'Cannot pay a voided invoice' }, { status: 422 });
    }

    const existingPaid = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
    const remainingBalance = invoice.amountCents - existingPaid;
    if (amountCents > remainingBalance) {
      return NextResponse.json(
        {
          success: false,
          error: `Payment amount (${amountCents}) exceeds remaining balance (${remainingBalance})`,
        },
        { status: 422 },
      );
    }

    const fees = feesCents || 0;
    const fullyPaid = existingPaid + amountCents >= invoice.amountCents;

    const [arAccount, cashAccount, feesAccount] = await Promise.all([
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1100' } } }),
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1000' } } }),
      fees > 0
        ? db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '5200' } } })
        : Promise.resolve(null),
    ]);

    if (!arAccount || !cashAccount) {
      return NextResponse.json(
        {
          success: false,
          error: 'AR account (1100) or Cash account (1000) not found. Ensure chart of accounts is seeded.',
        },
        { status: 422 },
      );
    }

    const payment = await db.$transaction(async (tx) => {
      const journalLines: Array<{
        accountId: string;
        debitCents: number;
        creditCents: number;
        description: string;
      }> = [
        { accountId: cashAccount.id, debitCents: amountCents, creditCents: 0, description: `Cash received - Invoice ${invoice.number}` },
        { accountId: arAccount.id, debitCents: 0, creditCents: amountCents, description: `AR payment - Invoice ${invoice.number}` },
      ];
      if (fees > 0 && feesAccount) {
        journalLines.push(
          { accountId: feesAccount.id, debitCents: fees, creditCents: 0, description: `Payment processing fees - Invoice ${invoice.number}` },
          { accountId: cashAccount.id, debitCents: 0, creditCents: fees, description: `Fees deducted from cash - Invoice ${invoice.number}` },
        );
      }

      const journalEntry = await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(date || Date.now()),
          memo: `Payment for Invoice ${invoice.number}`,
          sourceType: 'payment',
          verified: true,
          lines: { create: journalLines },
        },
      });

      const pmt = await tx.abPayment.create({
        data: {
          tenantId,
          invoiceId,
          amountCents,
          method: method || 'manual',
          date: new Date(date || Date.now()),
          stripePaymentId: stripePaymentId || null,
          feesCents: fees,
          journalEntryId: journalEntry.id,
        },
      });

      await tx.abJournalEntry.update({ where: { id: journalEntry.id }, data: { sourceId: pmt.id } });

      if (fullyPaid) {
        await tx.abInvoice.update({ where: { id: invoiceId }, data: { status: 'paid' } });
      }

      await tx.abClient.update({
        where: { id: invoice.clientId },
        data: { totalPaidCents: { increment: amountCents } },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'payment.received',
          actor: 'agent',
          action: {
            paymentId: pmt.id,
            invoiceId,
            invoiceNumber: invoice.number,
            amountCents,
            method: method || 'manual',
            feesCents: fees,
            fullyPaid,
            clientId: invoice.clientId,
            clientName: invoice.client.name,
          },
          constraintsPassed: ['balance_invariant'],
          verificationResult: 'passed',
        },
      });

      return pmt;
    });

    // PR 10 — audit the payment + the invoice status flip if it became paid.
    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'payment.create',
      entityType: 'AbPayment',
      entityId: payment.id,
      after: {
        invoiceId,
        invoiceNumber: invoice.number,
        amountCents,
        method: payment.method,
        feesCents: fees,
        fullyPaid,
      },
    });
    if (fullyPaid) {
      await audit({
        tenantId,
        source: inferSource(request),
        actor: await inferActor(request),
        action: 'invoice.mark_paid',
        entityType: 'AbInvoice',
        entityId: invoiceId,
        before: { status: invoice.status },
        after: { status: 'paid', number: invoice.number, paymentId: payment.id },
      });
    }

    return NextResponse.json({ success: true, data: payment }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-invoice/payments POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
