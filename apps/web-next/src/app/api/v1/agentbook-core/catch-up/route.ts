/**
 * Catch-me-up summary endpoint (PR 20).
 *
 * GET /api/v1/agentbook-core/catch-up?since=ISO
 *
 * Returns a tenant-scoped CatchUpSummary covering activity in
 * `[since, now)`. Drives both the bot's "catch me up" reply and the
 * web `/agentbook?catchup=1` banner.
 *
 * `since` parsing:
 *   • ISO-8601 (recommended) — `?since=2026-05-01T00:00:00Z`
 *   • Missing or unparseable → defaults to 24h ago. We don't 400 on
 *     a bad query string because the bot/banner should still produce
 *     a useful summary; the worst case is the window is wider than
 *     intended.
 *
 * Sanitised 500: any unexpected error returns a generic message —
 * never echoes the underlying exception (DB schema, etc.) to the
 * client.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { buildCatchUp } from '@/lib/agentbook-catch-up';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseSince(raw: string | null): Date {
  if (!raw) return new Date(Date.now() - ONE_DAY_MS);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    // Don't 400 — fall back to the 24h default so the caller still
    // gets a useful summary.
    return new Date(Date.now() - ONE_DAY_MS);
  }
  return parsed;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const sinceAt = parseSince(request.nextUrl.searchParams.get('since'));

    const summary = await buildCatchUp({ tenantId, sinceAt });

    return NextResponse.json({
      success: true,
      data: { sinceAt: sinceAt.toISOString(), ...summary },
    });
  } catch (err) {
    // Sanitised — never leak the underlying error to the client.
    console.error('[agentbook-core/catch-up GET] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to build catch-up summary' },
      { status: 500 },
    );
  }
}
