/**
 * Invoice clients — list + create.
 *
 * Native port of the legacy plugin Express handlers. Used both by the
 * web client list and the create-invoice agent skill (which looks up
 * the client by name before creating the invoice).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { withSoftDelete, parseIncludeDeleted } from '@/lib/agentbook-soft-delete';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const includeDeleted = parseIncludeDeleted(request.nextUrl.searchParams);
    const clients = await db.abClient.findMany({
      where: withSoftDelete({ tenantId }, includeDeleted),
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ success: true, data: clients });
  } catch (err) {
    console.error('[agentbook-invoice/clients GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface CreateClientBody {
  name?: string;
  email?: string;
  address?: string;
  defaultTerms?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateClientBody;
    const { name, email, address, defaultTerms } = body;
    if (!name) {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    const client = await db.$transaction(async (tx) => {
      const c = await tx.abClient.create({
        data: {
          tenantId,
          name,
          email: email || null,
          address: address || null,
          defaultTerms: defaultTerms || 'net-30',
        },
      });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'client.created',
          actor: 'agent',
          action: { clientId: c.id, name },
        },
      });
      return c;
    });

    return NextResponse.json({ success: true, data: client }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-invoice/clients POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
