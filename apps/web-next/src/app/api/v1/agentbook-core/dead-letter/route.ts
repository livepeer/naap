/**
 * Admin endpoint: list dead-letter rows for the current tenant (PR 23).
 *
 * Tenant-scoped — the admin UI only sees rows that belong to the
 * caller's tenant. Rows with a NULL tenantId (tenant resolution
 * failed at webhook time) are also returned to the admin so they
 * can be inspected and manually replayed.
 *
 * Defaults to "open only" (resolvedAt IS NULL); pass `?status=all`
 * to also include resolved rows.
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
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? 'open';
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

    const where: Record<string, unknown> = {
      // Show this tenant's rows + globally-orphaned rows (tenantId is null)
      // so the admin can rescue messages whose tenant resolution failed.
      OR: [{ tenantId }, { tenantId: null }],
    };
    if (status !== 'all') {
      where.resolvedAt = null;
    }

    const rows = await db.abWebhookDeadLetter.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error('[agentbook-core/dead-letter GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
