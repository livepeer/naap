/**
 * POST /agentbook-invoice/estimates/[id]/decline — pending → declined.
 * Idempotent on already-declined estimates.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { formatEstimateNumber } from '@/lib/agentbook-estimate-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const existing = await db.abEstimate.findFirst({
      where: { id, tenantId },
      include: { client: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Estimate not found' }, { status: 404 });
    }
    if (existing.status === 'declined') {
      return NextResponse.json({
        success: true,
        data: { ...existing, number: formatEstimateNumber(existing) },
      });
    }
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Cannot decline estimate with status=${existing.status}` },
        { status: 409 },
      );
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.abEstimate.update({
        where: { id },
        data: { status: 'declined' },
        include: { client: true },
      });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'estimate.declined',
          actor: 'user',
          action: { estimateId: id, clientId: u.clientId },
        },
      });
      return u;
    });

    return NextResponse.json({
      success: true,
      data: { ...updated, number: formatEstimateNumber(updated) },
    });
  } catch (err) {
    console.error('[agentbook-invoice/estimates/[id]/decline POST] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
