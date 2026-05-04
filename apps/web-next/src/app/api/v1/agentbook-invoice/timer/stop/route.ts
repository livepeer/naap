/**
 * Stop the running timer (if any).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const running = await db.abTimeEntry.findFirst({
      where: { tenantId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!running) {
      return NextResponse.json({ success: false, error: 'No running timer' }, { status: 404 });
    }

    const dur = Math.max(1, Math.round((Date.now() - running.startedAt.getTime()) / 60_000));
    const updated = await db.abTimeEntry.update({
      where: { id: running.id },
      data: { endedAt: new Date(), durationMinutes: dur },
    });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'time.logged',
        actor: 'agent',
        action: { entryId: updated.id, minutes: dur },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-invoice/timer/stop] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
