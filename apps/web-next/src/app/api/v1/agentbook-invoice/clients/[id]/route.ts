/**
 * Client detail (with stats) + update.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { withSoftDelete, parseIncludeDeleted } from '@/lib/agentbook-soft-delete';

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
    const includeDeleted = parseIncludeDeleted(request.nextUrl.searchParams);

    const client = await db.abClient.findFirst({
      where: withSoftDelete({ id, tenantId }, includeDeleted),
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

    // Soft-delete (PR 26): edits only apply to live rows.
    const existing = await db.abClient.findFirst({ where: { id, tenantId, deletedAt: null } });
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

/**
 * Soft-delete (PR 26): mark `deletedAt` instead of removing the row.
 * The client's invoices/estimates are not cascaded — they keep their
 * `clientId`. The list endpoint default-filters deleted clients; the
 * 90-day housekeeping cron eventually purges them.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const existing = await db.abClient.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    await db.abClient.update({ where: { id }, data: { deletedAt: new Date() } });

    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[agentbook-invoice/clients/:id DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
