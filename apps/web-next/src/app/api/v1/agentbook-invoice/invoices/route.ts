/**
 * Invoice list + create — native Next.js route.
 *
 * GET: list with status/date/client filters.
 * POST: create with line items, AR/Revenue journal entry, client total
 * update, and audit event in a single transaction.
 *
 * Detail (`/:id`), state transitions (`send`, `void`, `remind`, payments,
 * recurring) still 501 via the generic proxy until each is ported.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { audit } from '@/lib/agentbook-audit';
import { inferSource, inferActor } from '@/lib/agentbook-audit-context';
import { withSoftDelete, parseIncludeDeleted } from '@/lib/agentbook-soft-delete';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const clientId = params.get('clientId');
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    const limit = parseInt(params.get('limit') || '50', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    const includeDeleted = parseIncludeDeleted(params);
    const baseWhere: Record<string, unknown> = { tenantId };
    if (status) baseWhere.status = status;
    if (clientId) baseWhere.clientId = clientId;
    if (startDate || endDate) {
      const issuedDate: Record<string, Date> = {};
      if (startDate) issuedDate.gte = new Date(startDate);
      if (endDate) issuedDate.lte = new Date(endDate);
      baseWhere.issuedDate = issuedDate;
    }
    const where = withSoftDelete(baseWhere, includeDeleted);

    const [invoices, total] = await Promise.all([
      db.abInvoice.findMany({
        where,
        include: { lines: true, client: true },
        orderBy: { issuedDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.abInvoice.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: invoices,
      pagination: { total, limit, offset },
    });
  } catch (err) {
    console.error('[agentbook-invoice/invoices GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface InvoiceLine {
  description?: string;
  quantity?: number;
  rateCents: number;
}

interface CreateInvoiceBody {
  clientId?: string;
  issuedDate?: string;
  dueDate?: string;
  lines?: InvoiceLine[];
  status?: string;
  currency?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateInvoiceBody;
    const { clientId, issuedDate, dueDate, lines, status, currency } = body;

    if (!clientId || !lines || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { success: false, error: 'clientId and at least one line item are required' },
        { status: 400 },
      );
    }

    const client = await db.abClient.findFirst({ where: { id: clientId, tenantId } });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const lineItems = lines.map((l) => ({
      description: l.description || '',
      quantity: l.quantity || 1,
      rateCents: l.rateCents,
      amountCents: Math.round((l.quantity || 1) * l.rateCents),
    }));
    const totalAmountCents = lineItems.reduce((sum, l) => sum + l.amountCents, 0);

    const year = new Date(issuedDate || Date.now()).getFullYear();
    const lastInvoice = await db.abInvoice.findFirst({
      where: { tenantId, number: { startsWith: `INV-${year}-` } },
      orderBy: { number: 'desc' },
    });

    let nextSeq = 1;
    if (lastInvoice) {
      const parts = lastInvoice.number.split('-');
      nextSeq = parseInt(parts[2], 10) + 1;
    }
    const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;

    const [arAccount, revenueAccount] = await Promise.all([
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1100' } } }),
      db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '4000' } } }),
    ]);

    if (!arAccount || !revenueAccount) {
      return NextResponse.json(
        {
          success: false,
          error: 'AR account (1100) or Revenue account (4000) not found. Ensure chart of accounts is seeded.',
        },
        { status: 422 },
      );
    }

    try {
      const invoice = await db.$transaction(async (tx) => {
        const journalEntry = await tx.abJournalEntry.create({
          data: {
            tenantId,
            date: new Date(issuedDate || Date.now()),
            memo: `Invoice ${invoiceNumber} to ${client.name}`,
            sourceType: 'invoice',
            verified: true,
            lines: {
              create: [
                { accountId: arAccount.id, debitCents: totalAmountCents, creditCents: 0, description: `AR - Invoice ${invoiceNumber}` },
                { accountId: revenueAccount.id, debitCents: 0, creditCents: totalAmountCents, description: `Revenue - Invoice ${invoiceNumber}` },
              ],
            },
          },
        });

        const inv = await tx.abInvoice.create({
          data: {
            tenantId,
            clientId,
            number: invoiceNumber,
            amountCents: totalAmountCents,
            currency: currency || 'USD',
            issuedDate: new Date(issuedDate || Date.now()),
            dueDate: new Date(dueDate || Date.now()),
            status: status || 'draft',
            journalEntryId: journalEntry.id,
            lines: { create: lineItems },
          },
          include: { lines: true },
        });

        await tx.abJournalEntry.update({ where: { id: journalEntry.id }, data: { sourceId: inv.id } });
        await tx.abClient.update({
          where: { id: clientId },
          data: { totalBilledCents: { increment: totalAmountCents } },
        });

        await tx.abEvent.create({
          data: {
            tenantId,
            eventType: 'invoice.created',
            actor: 'agent',
            action: {
              invoiceId: inv.id,
              number: invoiceNumber,
              clientId,
              amountCents: totalAmountCents,
              lineCount: lineItems.length,
            },
            constraintsPassed: ['balance_invariant'],
            verificationResult: 'passed',
          },
        });

        return inv;
      });
      // PR 10 — structured audit row alongside the loose AbEvent.
      await audit({
        tenantId,
        source: inferSource(request),
        actor: await inferActor(request),
        action: 'invoice.create',
        entityType: 'AbInvoice',
        entityId: invoice.id,
        after: {
          number: invoice.number,
          clientId,
          amountCents: totalAmountCents,
          currency: invoice.currency,
          status: invoice.status,
          issuedDate: invoice.issuedDate,
          dueDate: invoice.dueDate,
          lineCount: lineItems.length,
        },
      });
      return NextResponse.json({ success: true, data: invoice }, { status: 201 });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
        return NextResponse.json({ success: false, error: 'Invoice number already exists' }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('[agentbook-invoice/invoices POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
