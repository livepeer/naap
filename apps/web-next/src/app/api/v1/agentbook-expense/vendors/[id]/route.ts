/**
 * Expense vendor detail.
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
    const vendor = await db.abVendor.findFirst({
      where: withSoftDelete({ id, tenantId }, includeDeleted),
    });
    if (!vendor) {
      return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: vendor });
  } catch (err) {
    console.error('[agentbook-expense/vendors/:id] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Soft-delete (PR 26): mark `deletedAt` instead of removing the row.
 * Existing expenses retain their `vendorId` and continue to render
 * (the expense list joins vendor by id). Restore via
 * `/agentbook-core/restore/vendor/[id]` within 90 days.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const existing = await db.abVendor.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 });
    }
    await db.abVendor.update({ where: { id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[agentbook-expense/vendors/:id DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
