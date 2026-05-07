/**
 * Estimate detail / edit / delete (PR 7).
 *
 * • GET    — return the estimate + its client.
 * • PATCH  — edit fields (only when status='pending').
 * • DELETE — remove (only when status in pending|declined|expired).
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

interface PatchBody {
  amountCents?: number;
  description?: string;
  validUntil?: string;
  clientId?: string;
}

const EDITABLE_STATUSES = new Set(['pending']);
const DELETABLE_STATUSES = new Set(['pending', 'declined', 'expired']);

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const estimate = await db.abEstimate.findFirst({
      where: { id, tenantId },
      include: { client: true },
    });
    if (!estimate) {
      return NextResponse.json({ success: false, error: 'Estimate not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      data: { ...estimate, number: formatEstimateNumber(estimate) },
    });
  } catch (err) {
    console.error('[agentbook-invoice/estimates/[id] GET] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PatchBody;

    const existing = await db.abEstimate.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Estimate not found' }, { status: 404 });
    }
    if (!EDITABLE_STATUSES.has(existing.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot edit estimate with status=${existing.status}` },
        { status: 409 },
      );
    }

    const data: Record<string, unknown> = {};
    if (typeof body.amountCents === 'number' && body.amountCents > 0) {
      data.amountCents = body.amountCents;
    }
    if (typeof body.description === 'string' && body.description.trim()) {
      data.description = body.description.trim();
    }
    if (typeof body.validUntil === 'string') {
      const d = new Date(body.validUntil);
      if (!isNaN(d.getTime())) data.validUntil = d;
    }
    if (typeof body.clientId === 'string' && body.clientId.trim()) {
      // Validate the client belongs to this tenant before swapping.
      const c = await db.abClient.findFirst({ where: { id: body.clientId, tenantId } });
      if (!c) {
        return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
      }
      data.clientId = body.clientId;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No editable fields supplied' },
        { status: 400 },
      );
    }

    const updated = await db.abEstimate.update({
      where: { id },
      data,
      include: { client: true },
    });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'estimate.updated',
        actor: 'user',
        action: { estimateId: id, fields: Object.keys(data) },
      },
    });

    return NextResponse.json({
      success: true,
      data: { ...updated, number: formatEstimateNumber(updated) },
    });
  } catch (err) {
    console.error('[agentbook-invoice/estimates/[id] PATCH] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const existing = await db.abEstimate.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Estimate not found' }, { status: 404 });
    }
    if (!DELETABLE_STATUSES.has(existing.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot delete estimate with status=${existing.status}` },
        { status: 409 },
      );
    }
    await db.abEstimate.delete({ where: { id } });
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'estimate.deleted',
        actor: 'user',
        action: { estimateId: id, previousStatus: existing.status },
      },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[agentbook-invoice/estimates/[id] DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
