/**
 * Invoice detail — native Next.js route.
 *
 * GET   — full row + payments + balance.
 * PATCH — limited edit (issuedDate, dueDate, currency, status). PR 10
 *         adds this so the activity log can show "edited invoice X"
 *         events alongside create / send / pay.
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;

    const invoice = await db.abInvoice.findFirst({
      where: { id, tenantId },
      include: { lines: true, payments: true, client: true },
    });

    if (!invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);

    return NextResponse.json({
      success: true,
      data: {
        ...invoice,
        totalPaidCents: totalPaid,
        balanceDueCents: invoice.amountCents - totalPaid,
      },
    });
  } catch (err) {
    console.error('[agentbook-invoice/invoices/:id] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface InvoicePatchBody {
  issuedDate?: string;
  dueDate?: string;
  currency?: string;
  status?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as InvoicePatchBody;

    const existing = await db.abInvoice.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.issuedDate !== undefined) data.issuedDate = new Date(body.issuedDate);
    if (body.dueDate !== undefined) data.dueDate = new Date(body.dueDate);
    if (body.currency !== undefined) data.currency = body.currency;
    if (body.status !== undefined) data.status = body.status;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: 'no editable fields' }, { status: 400 });
    }

    const updated = await db.abInvoice.update({ where: { id }, data });

    // Build the before/after with the same shape so the diff is sparse.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (body.issuedDate !== undefined) {
      before.issuedDate = existing.issuedDate;
      after.issuedDate = updated.issuedDate;
    }
    if (body.dueDate !== undefined) {
      before.dueDate = existing.dueDate;
      after.dueDate = updated.dueDate;
    }
    if (body.currency !== undefined) {
      before.currency = existing.currency;
      after.currency = updated.currency;
    }
    if (body.status !== undefined) {
      before.status = existing.status;
      after.status = updated.status;
    }
    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'invoice.update',
      entityType: 'AbInvoice',
      entityId: id,
      before,
      after,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-invoice/invoices/:id PATCH] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
