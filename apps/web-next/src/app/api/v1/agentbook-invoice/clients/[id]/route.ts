/**
 * Client detail (with stats) + update.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

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

    const client = await db.abClient.findFirst({
      where: { id, tenantId },
      include: {
        invoices: { orderBy: { issuedDate: 'desc' }, take: 10, include: { lines: true } },
        estimates: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const outstandingInvoices = await db.abInvoice.count({
      where: { clientId: client.id, tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...client,
        stats: {
          outstandingInvoices,
          totalBilledCents: client.totalBilledCents,
          totalPaidCents: client.totalPaidCents,
          balanceCents: client.totalBilledCents - client.totalPaidCents,
          avgDaysToPay: client.avgDaysToPay,
        },
      },
    });
  } catch (err) {
    console.error('[agentbook-invoice/clients/:id GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface UpdateClientBody {
  name?: string;
  email?: string;
  address?: string;
  defaultTerms?: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as UpdateClientBody;

    const existing = await db.abClient.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email;
    if (body.address !== undefined) data.address = body.address;
    if (body.defaultTerms !== undefined) data.defaultTerms = body.defaultTerms;

    const client = await db.$transaction(async (tx) => {
      const c = await tx.abClient.update({ where: { id }, data });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'client.updated',
          actor: 'agent',
          action: { clientId: c.id, changes: body as never },
        },
      });
      return c;
    });

    return NextResponse.json({ success: true, data: client });
  } catch (err) {
    console.error('[agentbook-invoice/clients/:id PUT] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
