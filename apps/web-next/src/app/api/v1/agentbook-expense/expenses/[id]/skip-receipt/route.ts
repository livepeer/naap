/**
 * PR 16 — Skip-receipt action.
 *
 * POST `/agentbook-expense/expenses/:id/skip-receipt`
 *
 * Marks an expense as `receiptStatus='skipped'` so it falls out of the
 * morning-digest "missing receipts" section. Tenant-scoped + audited; the
 * 500 path returns a sanitized message so we don't leak Prisma internals.
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;

    const existing = await db.abExpense.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
    }

    // Idempotent: already-skipped is a no-op success so retries are safe.
    if (existing.receiptStatus === 'skipped') {
      return NextResponse.json({ success: true, data: existing, message: 'Already skipped' });
    }

    const updated = await db.abExpense.update({
      where: { id },
      data: { receiptStatus: 'skipped' },
    });

    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'expense.receipt_skip',
      entityType: 'AbExpense',
      entityId: id,
      before: { receiptStatus: existing.receiptStatus },
      after: { receiptStatus: updated.receiptStatus },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-expense/expenses/:id/skip-receipt] failed:', err);
    // Sanitized 500 — don't leak Prisma error details to the wire.
    return NextResponse.json(
      { success: false, error: 'Failed to skip receipt' },
      { status: 500 },
    );
  }
}
