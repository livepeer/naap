/**
 * Autopilot status — derive trust phase from learning-event accuracy and
 * tenant tenure, then auto-adjust the bookkeeper agent's autoApprove flag.
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
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const monthsActive = config
      ? Math.floor((Date.now() - config.createdAt.getTime()) / (30 * 86_400_000))
      : 0;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const [corrections, confirmations] = await Promise.all([
      db.abLearningEvent.count({
        where: { tenantId, eventType: 'correction', createdAt: { gte: thirtyDaysAgo } },
      }),
      db.abLearningEvent.count({
        where: { tenantId, eventType: 'confirmation', createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);
    const total = corrections + confirmations;
    const accuracy = total > 0 ? confirmations / total : 0.5;
    const trustLevel = Math.min(1, monthsActive / 6) * 0.4 + accuracy * 0.6;
    const phase =
      trustLevel > 0.9 ? 'autopilot' :
      trustLevel > 0.7 ? 'confident' :
      trustLevel > 0.4 ? 'learning' : 'training';

    if (phase === 'confident' || phase === 'autopilot') {
      await db.abAgentConfig.upsert({
        where: { tenantId_agentId: { tenantId, agentId: 'bookkeeper' } },
        update: { autoApprove: true },
        create: { tenantId, agentId: 'bookkeeper', autoApprove: true },
      });
    } else if (phase === 'training') {
      await db.abAgentConfig.upsert({
        where: { tenantId_agentId: { tenantId, agentId: 'bookkeeper' } },
        update: { autoApprove: false },
        create: { tenantId, agentId: 'bookkeeper', autoApprove: false },
      });
    }

    return NextResponse.json({
      success: true,
      data: { trustLevel, trustPhase: phase, accuracy, monthsActive, corrections, confirmations },
    });
  } catch (err) {
    console.error('[agentbook-core/autopilot] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
