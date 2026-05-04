/**
 * Unbilled time summary — group billable/unbilled time by client with
 * an estimated dollar value at the entry's hourly rate.
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
    const entries = await db.abTimeEntry.findMany({
      where: { tenantId, billable: true, billed: false, endedAt: { not: null } },
    });

    const groups = new Map<string, { minutes: number; entries: number; rateCents: number }>();
    for (const e of entries) {
      const key = e.clientId || 'no-client';
      const g = groups.get(key) || { minutes: 0, entries: 0, rateCents: e.hourlyRateCents || 0 };
      g.minutes += e.durationMinutes || 0;
      g.entries += 1;
      if (e.hourlyRateCents) g.rateCents = e.hourlyRateCents;
      groups.set(key, g);
    }

    const clientIds = Array.from(groups.keys()).filter((k) => k !== 'no-client');
    const clients = await db.abClient.findMany({ where: { id: { in: clientIds } } });
    const nameMap = new Map(clients.map((c) => [c.id, c.name]));

    const result = Array.from(groups.entries()).map(([cid, g]) => ({
      clientId: cid,
      clientName: nameMap.get(cid) || 'No Client',
      totalMinutes: g.minutes,
      totalHours: Math.round(g.minutes / 6) / 10,
      hourlyRateCents: g.rateCents,
      unbilledAmountCents: Math.round((g.minutes / 60) * g.rateCents),
      entries: g.entries,
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[agentbook-invoice/unbilled-summary] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
