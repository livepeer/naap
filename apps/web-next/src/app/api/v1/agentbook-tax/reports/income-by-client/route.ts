/**
 * Income by client — total billed / paid / outstanding per client.
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
    const clients = await db.abClient.findMany({ where: { tenantId } });
    const result = clients
      .map((c) => ({
        clientId: c.id,
        clientName: c.name,
        totalBilledCents: c.totalBilledCents,
        totalPaidCents: c.totalPaidCents,
        outstandingCents: c.totalBilledCents - c.totalPaidCents,
      }))
      .sort((a, b) => b.totalBilledCents - a.totalBilledCents);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[agentbook-tax/reports/income-by-client] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
