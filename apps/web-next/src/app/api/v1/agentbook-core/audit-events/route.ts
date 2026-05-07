/**
 * GET /agentbook-core/audit-events — list structured audit rows for the
 * current tenant (PR 10).
 *
 * Filters (all optional, all AND'd):
 *   • actor=user | bot | cron | api  (matches the prefix — 'user' hits
 *                                     every 'user:<id>' actor)
 *   • action=invoice.create          (exact match)
 *   • entityType=AbInvoice
 *   • entityId=<id>
 *   • startDate / endDate (ISO)
 *   • limit (default 50, max 200), offset
 *
 * Always tenant-scoped. The page renders before/after diffs so we
 * pass them through as-is — they were already redacted at write time.
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
    const params = request.nextUrl.searchParams;

    const actor = params.get('actor');
    const action = params.get('action');
    const entityType = params.get('entityType');
    const entityId = params.get('entityId');
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    const limit = Math.min(parseInt(params.get('limit') || '50', 10), 200);
    const offset = parseInt(params.get('offset') || '0', 10);

    const where: Record<string, unknown> = { tenantId };
    if (actor) {
      // 'user' is a prefix because actor strings look like 'user:<id>'.
      // 'bot' / 'cron' / 'api' are exact strings, but startsWith is
      // safe for both since none of them is a prefix of another.
      where.actor = { startsWith: actor };
    }
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (startDate || endDate) {
      const createdAt: Record<string, Date> = {};
      if (startDate) createdAt.gte = new Date(startDate);
      if (endDate) createdAt.lte = new Date(endDate);
      where.createdAt = createdAt;
    }

    const [events, total] = await Promise.all([
      db.abAuditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.abAuditEvent.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: events,
      meta: { total, limit, offset },
    });
  } catch (err) {
    console.error('[agentbook-core/audit-events GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
