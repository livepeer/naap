/**
 * Dashboard snapshot — record a snapshot.requested event so the
 * proactive engine can pick it up and deliver to Telegram.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface SnapshotData {
  assets?: number;
  revenue?: number;
  expenses?: number;
  netIncome?: number;
  balanced?: boolean;
}

interface SnapshotBody {
  type?: string;
  data?: SnapshotData;
}

function fmt(cents: number | undefined): string {
  const amount = Math.abs(cents || 0) / 100;
  const sign = (cents || 0) < 0 ? '-' : '';
  return `${sign}$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function formatSnapshotMessage(data: SnapshotData | undefined): string {
  return [
    '📊 <b>Financial Snapshot</b>',
    '',
    `🏦 Cash: <b>${fmt(data?.assets)}</b>`,
    `📈 Revenue: ${fmt(data?.revenue)}`,
    `📉 Expenses: ${fmt(data?.expenses)}`,
    `💰 Net Income: <b>${fmt(data?.netIncome)}</b>`,
    '',
    data?.balanced ? '✅ Books balanced' : '⚠️ Books out of balance',
    '',
    `<i>Generated ${new Date().toLocaleString()}</i>`,
  ].join('\n');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as SnapshotBody;
    const { type, data } = body;

    const highlight = {
      type: type || 'dashboard_highlight',
      tenant_id: tenantId,
      generated_at: new Date().toISOString(),
      summary: data,
      telegram_message: formatSnapshotMessage(data),
    };

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'snapshot.requested',
        actor: 'human',
        action: highlight as never,
      },
    });

    return NextResponse.json({ success: true, data: highlight });
  } catch (err) {
    console.error('[agentbook-core/snapshot] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
