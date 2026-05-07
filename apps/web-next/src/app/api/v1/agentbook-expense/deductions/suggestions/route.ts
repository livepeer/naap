/**
 * PR 12 — list deduction suggestions for the current tenant.
 *
 * Query: ?status=open|applied|dismissed (defaults to all). Sorted by
 * confidence DESC then createdAt DESC. Tenant-scoped via the standard
 * `resolveAgentbookTenant` helper.
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
    const status = request.nextUrl.searchParams.get('status');

    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;

    const rows = await db.abDeductionSuggestion.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json({
      success: true,
      data: {
        suggestions: rows,
        summary: {
          total: rows.length,
          open: rows.filter((r) => r.status === 'open').length,
          applied: rows.filter((r) => r.status === 'applied').length,
          dismissed: rows.filter((r) => r.status === 'dismissed').length,
        },
      },
    });
  } catch (err) {
    console.error('[agentbook-expense/deductions/suggestions] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load suggestions' },
      { status: 500 },
    );
  }
}
