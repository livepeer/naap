/**
 * Soft-delete restoration endpoint (PR 26).
 *
 * POST /api/v1/agentbook-core/restore/:entityType/:id
 *
 *   entityType ∈ {expense, invoice, client, vendor, budget, mileage}
 *
 * Sets `deletedAt = null` on the row when:
 *   1. it exists in the caller's tenant,
 *   2. it is currently soft-deleted (deletedAt IS NOT NULL),
 *   3. the soft-delete is within the 90-day restore window.
 *
 * Returns:
 *   200 — restored
 *   404 — entity not found / wrong tenant / not deleted
 *   422 — past the 90-day window (housekeeping cron will purge)
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { audit } from '@/lib/agentbook-audit';
import { inferSource, inferActor } from '@/lib/agentbook-audit-context';
import { canRestore, RESTORE_WINDOW_DAYS } from '@/lib/agentbook-soft-delete';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type EntityType = 'expense' | 'invoice' | 'client' | 'vendor' | 'budget' | 'mileage';

const ENTITIES: Record<EntityType, { auditType: string }> = {
  expense: { auditType: 'AbExpense' },
  invoice: { auditType: 'AbInvoice' },
  client: { auditType: 'AbClient' },
  vendor: { auditType: 'AbVendor' },
  budget: { auditType: 'AbBudget' },
  mileage: { auditType: 'AbMileageEntry' },
};

function isEntityType(s: string): s is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITIES, s);
}

/**
 * Lookup-then-clear-deletedAt against the right table. Centralised so
 * the route handler stays small and we don't duplicate the same
 * findFirst/update pair six times.
 */
async function findDeleted(
  entityType: EntityType,
  id: string,
  tenantId: string,
): Promise<{ deletedAt: Date | null } | null> {
  const where = { id, tenantId };
  switch (entityType) {
    case 'expense':
      return db.abExpense.findFirst({ where, select: { deletedAt: true } });
    case 'invoice':
      return db.abInvoice.findFirst({ where, select: { deletedAt: true } });
    case 'client':
      return db.abClient.findFirst({ where, select: { deletedAt: true } });
    case 'vendor':
      return db.abVendor.findFirst({ where, select: { deletedAt: true } });
    case 'budget':
      return db.abBudget.findFirst({ where, select: { deletedAt: true } });
    case 'mileage':
      return db.abMileageEntry.findFirst({ where, select: { deletedAt: true } });
  }
}

async function clearDeletedAt(
  entityType: EntityType,
  id: string,
  tenantId: string,
): Promise<void> {
  // Use updateMany so the tenant scope is enforced server-side — a
  // mismatched tenant returns count=0 instead of throwing on missing row.
  switch (entityType) {
    case 'expense':
      await db.abExpense.updateMany({ where: { id, tenantId }, data: { deletedAt: null } });
      return;
    case 'invoice':
      await db.abInvoice.updateMany({ where: { id, tenantId }, data: { deletedAt: null } });
      return;
    case 'client':
      await db.abClient.updateMany({ where: { id, tenantId }, data: { deletedAt: null } });
      return;
    case 'vendor':
      await db.abVendor.updateMany({ where: { id, tenantId }, data: { deletedAt: null } });
      return;
    case 'budget':
      await db.abBudget.updateMany({ where: { id, tenantId }, data: { deletedAt: null } });
      return;
    case 'mileage':
      await db.abMileageEntry.updateMany({ where: { id, tenantId }, data: { deletedAt: null } });
      return;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { entityType, id } = await params;

    if (!isEntityType(entityType)) {
      return NextResponse.json(
        {
          success: false,
          error: `unknown entityType '${entityType}' — must be one of: ${Object.keys(ENTITIES).join(', ')}`,
        },
        { status: 400 },
      );
    }

    const row = await findDeleted(entityType, id, tenantId);
    if (!row) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }
    if (row.deletedAt === null) {
      return NextResponse.json(
        { success: false, error: 'row is not deleted; nothing to restore' },
        { status: 404 },
      );
    }

    const now = new Date();
    if (!canRestore(row.deletedAt, now)) {
      return NextResponse.json(
        {
          success: false,
          error: `restore window expired — soft-deleted ${RESTORE_WINDOW_DAYS}d ago or earlier`,
          deletedAt: row.deletedAt,
          windowDays: RESTORE_WINDOW_DAYS,
        },
        { status: 422 },
      );
    }

    await clearDeletedAt(entityType, id, tenantId);

    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: `${entityType}.restore`,
      entityType: ENTITIES[entityType].auditType,
      entityId: id,
      before: { deletedAt: row.deletedAt },
      after: { deletedAt: null },
    });

    return NextResponse.json({ success: true, data: { id, entityType } });
  } catch (err) {
    console.error('[agentbook-core/restore POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
