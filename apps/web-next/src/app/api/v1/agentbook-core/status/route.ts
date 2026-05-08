/**
 * Status snapshot endpoint (PR 22).
 *
 * GET /api/v1/agentbook-core/status
 *
 * Returns a tenant-scoped StatusSnapshot covering bot reachability,
 * database latency, last bank sync, last morning digest, open CPA
 * requests, and the most-recent ≤3 error events. Drives both the
 * Telegram `/status` reply and the web status panel.
 *
 * Sanitised 500: any unexpected error returns a generic message —
 * never echoes the underlying exception to the client. This is the
 * one endpoint where a 500 is most likely to be the most useful
 * signal (DB unreachable), so we still attempt to return whatever
 * fragments we can rather than throw.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { getStatusSnapshot } from '@/lib/agentbook-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const snapshot = await getStatusSnapshot(tenantId);
    return NextResponse.json({ success: true, data: snapshot });
  } catch (err) {
    // Sanitised — never leak the underlying error to the client.
    console.error('[agentbook-core/status GET] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to build status snapshot' },
      { status: 500 },
    );
  }
}
