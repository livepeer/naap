/**
 * Expense detail + edit.
 *
 * GET — full row + resolved vendor name + category name/code + splits.
 * PUT — patch amountCents, categoryId, description, isPersonal, date.
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const includeDeleted = parseIncludeDeleted(request.nextUrl.searchParams);

    const expense = await db.abExpense.findFirst({
      where: withSoftDelete({ id, tenantId }, includeDeleted),
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!expense) {
      return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
    }

    let categoryName: string | null = null;
    let categoryCode: string | null = null;
    if (expense.categoryId) {
      const cat = await db.abAccount.findFirst({ where: { id: expense.categoryId } });
      if (cat) {
        categoryName = cat.name;
        categoryCode = cat.code;
      }
    }

    const splits = await db.abExpenseSplit.findMany({ where: { expenseId: expense.id } });

    return NextResponse.json({
      success: true,
      data: {
        ...expense,
        vendorName: expense.vendor?.name || null,
        categoryName,
        categoryCode,
        splits,
      },
    });
  } catch (err) {
    console.error('[agentbook-expense/expenses/:id GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface UpdateExpenseBody {
  amountCents?: number;
  categoryId?: string;
  description?: string;
  isPersonal?: boolean;
  date?: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as UpdateExpenseBody;
    // Soft-delete (PR 26): edits only apply to live rows.
    const existing = await db.abExpense.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.amountCents !== undefined) data.amountCents = body.amountCents;
    if (body.categoryId !== undefined) data.categoryId = body.categoryId;
    if (body.description !== undefined) data.description = body.description;
    if (body.isPersonal !== undefined) data.isPersonal = body.isPersonal;
    if (body.date !== undefined) data.date = new Date(body.date);

    const updated = await db.abExpense.update({ where: { id }, data });

    // PR 10 — audit only the fields the caller actually touched.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (body.amountCents !== undefined) {
      before.amountCents = existing.amountCents; after.amountCents = updated.amountCents;
    }
    if (body.categoryId !== undefined) {
      before.categoryId = existing.categoryId; after.categoryId = updated.categoryId;
    }
    if (body.description !== undefined) {
      before.description = existing.description; after.description = updated.description;
    }
    if (body.isPersonal !== undefined) {
      before.isPersonal = existing.isPersonal; after.isPersonal = updated.isPersonal;
    }
    if (body.date !== undefined) {
      before.date = existing.date; after.date = updated.date;
    }
    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'expense.update',
      entityType: 'AbExpense',
      entityId: id,
      before,
      after,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-expense/expenses/:id PUT] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Same shape as PUT — accept both verbs so the new audit-aware web
  // pages (PR 10) can use the more REST-idiomatic verb.
  return PUT(request, ctx);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    // Soft-delete (PR 26): only act on live rows; treat already-deleted as 404
    // so callers can't keep stamping new `deletedAt` values onto the same row.
    const existing = await db.abExpense.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
    }

    await db.abExpense.update({ where: { id }, data: { deletedAt: new Date() } });

    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'expense.delete',
      entityType: 'AbExpense',
      entityId: id,
      before: {
        amountCents: existing.amountCents,
        vendorId: existing.vendorId,
        categoryId: existing.categoryId,
        date: existing.date,
        description: existing.description,
        isPersonal: existing.isPersonal,
      },
    });

    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[agentbook-expense/expenses/:id DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
