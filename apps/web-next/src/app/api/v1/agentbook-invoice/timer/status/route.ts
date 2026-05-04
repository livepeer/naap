/**
 * Timer status — currently running timer (if any) and elapsed minutes.
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
    const running = await db.abTimeEntry.findFirst({
      where: { tenantId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!running) {
      return NextResponse.json({ success: true, data: { running: false } });
    }
    const elapsedMinutes = Math.round((Date.now() - running.startedAt.getTime()) / 60_000);
    return NextResponse.json({
      success: true,
      data: { running: true, entry: running, elapsedMinutes },
    });
  } catch (err) {
    console.error('[agentbook-invoice/timer/status] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
