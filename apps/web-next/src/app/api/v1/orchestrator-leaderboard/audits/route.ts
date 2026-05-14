/**
 * GET /api/v1/orchestrator-leaderboard/audits — list recent refresh audits
 *
 * Query params:
 *   limit  — max rows to return (1–100, default 20)
 *   cursor — opaque cursor (audit id) for keyset pagination
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const user = await validateSession(token);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
  const cursor = url.searchParams.get('cursor') || undefined;

  try {
    const audits = await prisma.leaderboardRefreshAudit.findMany({
      orderBy: { refreshedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = audits.length > limit;
    const items = hasMore ? audits.slice(0, limit) : audits;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({
      success: true,
      data: items.map((a) => ({
        id: a.id,
        refreshedAt: a.refreshedAt.toISOString(),
        refreshedBy: a.refreshedBy,
        durationMs: a.durationMs,
        membershipSource: a.membershipSource,
        totalOrchestrators: a.totalOrchestrators,
        totalCapabilities: a.totalCapabilities,
        perSource: a.perSource,
        conflicts: a.conflicts,
        dropped: a.dropped,
        warnings: a.warnings,
      })),
      pagination: { nextCursor, hasMore },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list audits';
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
