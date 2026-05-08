/**
 * Budget by-id — DELETE + PUT (PR 8).
 *
 * The Budgets web page wires its trash-can buttons to DELETE and its
 * Edit modal to PUT. Both routes are tenant-scoped so a user can never
 * touch another tenant's budget by guessing an id.
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

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    // Capture the row before delete so the audit log shows what was lost.
    // Soft-delete (PR 26): only act on live rows.
    const existing = await db.abBudget.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }
    // Tenant-scoped soft-delete: updateMany with both id + tenantId so a
    // mismatched tenant returns count=0 instead of 500'ing on missing row.
    const r = await db.abBudget.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (r.count === 0) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }
    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'budget.delete',
      entityType: 'AbBudget',
      entityId: id,
      before: {
        amountCents: existing.amountCents,
        categoryId: existing.categoryId,
        categoryName: existing.categoryName,
        period: existing.period,
        alertPercent: existing.alertPercent,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[agentbook-expense/budgets/:id DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

interface BudgetUpdateBody {
  amountCents?: number;
  categoryName?: string;
  alertPercent?: number;
}

export async function PUT(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as BudgetUpdateBody;
    const data: Record<string, unknown> = {};
    if (typeof body.amountCents === 'number' && body.amountCents > 0) data.amountCents = body.amountCents;
    if (typeof body.categoryName === 'string' && body.categoryName.trim()) {
      data.categoryName = body.categoryName.trim();
    }
    if (typeof body.alertPercent === 'number' && body.alertPercent > 0 && body.alertPercent <= 100) {
      data.alertPercent = body.alertPercent;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: 'no editable fields' }, { status: 400 });
    }

    // Soft-delete (PR 26): edits only apply to live rows.
    const existing = await db.abBudget.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }
    const updated = await db.abBudget.update({ where: { id }, data });
    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'budget.update',
      entityType: 'AbBudget',
      entityId: id,
      before: {
        amountCents: existing.amountCents,
        categoryName: existing.categoryName,
        alertPercent: existing.alertPercent,
      },
      after: {
        amountCents: updated.amountCents,
        categoryName: updated.categoryName,
        alertPercent: updated.alertPercent,
      },
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-expense/budgets/:id PUT] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
