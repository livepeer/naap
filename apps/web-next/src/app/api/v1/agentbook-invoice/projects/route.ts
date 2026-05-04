/**
 * Projects — list (with hours) + create.
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
    const projects = await db.abProject.findMany({
      where: { tenantId, status: { not: 'archived' } },
      include: { timeEntries: { select: { durationMinutes: true, billed: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const result = projects.map((p) => {
      const totalMinutes = p.timeEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const billedMinutes = p.timeEntries
        .filter((e) => e.billed)
        .reduce((s, e) => s + (e.durationMinutes || 0), 0);
      const { timeEntries: _drop, ...rest } = p;
      void _drop;
      return {
        ...rest,
        totalHours: Math.round(totalMinutes / 6) / 10,
        billedHours: Math.round(billedMinutes / 6) / 10,
        unbilledHours: Math.round((totalMinutes - billedMinutes) / 6) / 10,
      };
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[agentbook-invoice/projects GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface CreateProjectBody {
  name?: string;
  clientId?: string;
  description?: string;
  hourlyRateCents?: number;
  budgetHours?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateProjectBody;
    const { name, clientId, description, hourlyRateCents, budgetHours } = body;
    if (!name) {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }
    try {
      const project = await db.abProject.create({
        data: { tenantId, name, clientId, description, hourlyRateCents, budgetHours },
      });
      return NextResponse.json({ success: true, data: project }, { status: 201 });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
        return NextResponse.json({ success: false, error: 'Project name already exists' }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('[agentbook-invoice/projects POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
