/**
 * Time entries — log manually + list with filters.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CreateEntryBody {
  description?: string;
  minutes?: number;
  projectId?: string;
  clientId?: string;
  date?: string;
  hourlyRateCents?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateEntryBody;
    const { description, minutes, projectId, clientId, date, hourlyRateCents } = body;
    if (!minutes || minutes <= 0) {
      return NextResponse.json({ success: false, error: 'minutes must be positive' }, { status: 400 });
    }

    const entryDate = date ? new Date(date) : new Date();
    const startedAt = new Date(entryDate.getTime() - minutes * 60_000);

    const entry = await db.abTimeEntry.create({
      data: {
        tenantId,
        projectId,
        clientId,
        description: description || 'Time entry',
        startedAt,
        endedAt: entryDate,
        durationMinutes: minutes,
        hourlyRateCents,
      },
    });

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-invoice/time-entries POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const params = request.nextUrl.searchParams;
    const projectId = params.get('projectId');
    const clientId = params.get('clientId');
    const billed = params.get('billed');
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    const limit = parseInt(params.get('limit') || '50', 10);

    const where: Record<string, unknown> = { tenantId };
    if (projectId) where.projectId = projectId;
    if (clientId) where.clientId = clientId;
    if (billed !== null) where.billed = billed === 'true';
    if (startDate || endDate) {
      const startedAt: Record<string, Date> = {};
      if (startDate) startedAt.gte = new Date(startDate);
      if (endDate) startedAt.lte = new Date(endDate);
      where.startedAt = startedAt;
    }

    const entries = await db.abTimeEntry.findMany({
      where,
      include: { project: { select: { name: true } } },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    const totalMinutes = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);

    return NextResponse.json({
      success: true,
      data: entries,
      meta: { totalMinutes, totalHours: Math.round(totalMinutes / 6) / 10 },
    });
  } catch (err) {
    console.error('[agentbook-invoice/time-entries GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
