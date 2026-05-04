/**
 * Start a timer. Auto-stops any running timer first.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface StartBody {
  description?: string;
  projectId?: string;
  clientId?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as StartBody;
    const { description, projectId, clientId } = body;

    const running = await db.abTimeEntry.findFirst({ where: { tenantId, endedAt: null } });
    if (running) {
      const dur = Math.max(1, Math.round((Date.now() - running.startedAt.getTime()) / 60_000));
      await db.abTimeEntry.update({
        where: { id: running.id },
        data: { endedAt: new Date(), durationMinutes: dur },
      });
    }

    let rateCents: number | null = null;
    if (projectId) {
      const project = await db.abProject.findFirst({ where: { id: projectId, tenantId } });
      rateCents = project?.hourlyRateCents ?? null;
    }

    const entry = await db.abTimeEntry.create({
      data: {
        tenantId,
        projectId,
        clientId,
        description: description || 'Working',
        startedAt: new Date(),
        hourlyRateCents: rateCents,
      },
    });

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-invoice/timer/start] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
