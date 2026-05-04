/**
 * Estimates — list + create.
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
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const clientId = params.get('clientId');

    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;

    const estimates = await db.abEstimate.findMany({
      where,
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: estimates });
  } catch (err) {
    console.error('[agentbook-invoice/estimates GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface CreateEstimateBody {
  clientId?: string;
  amountCents?: number;
  description?: string;
  validUntil?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateEstimateBody;
    const { clientId, amountCents, description, validUntil } = body;

    if (!clientId || !amountCents || !description) {
      return NextResponse.json(
        { success: false, error: 'clientId, amountCents, and description are required' },
        { status: 400 },
      );
    }

    const client = await db.abClient.findFirst({ where: { id: clientId, tenantId } });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const expiryDate = validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 86_400_000);

    const estimate = await db.$transaction(async (tx) => {
      const est = await tx.abEstimate.create({
        data: { tenantId, clientId, amountCents, description, validUntil: expiryDate },
      });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'estimate.created',
          actor: 'agent',
          action: { estimateId: est.id, clientId, amountCents },
        },
      });
      return est;
    });

    return NextResponse.json({ success: true, data: estimate }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-invoice/estimates POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
