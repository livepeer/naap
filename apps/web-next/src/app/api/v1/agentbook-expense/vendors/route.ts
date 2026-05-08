/**
 * Expense vendors — list (sorted by transaction count desc).
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
    const vendors = await db.abVendor.findMany({
      where: withSoftDelete({ tenantId }, includeDeleted),
      orderBy: { transactionCount: 'desc' },
    });
    return NextResponse.json({ success: true, data: vendors });
  } catch (err) {
    console.error('[agentbook-expense/vendors GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
