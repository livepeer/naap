/**
 * Update an agent's per-tenant config (aggressiveness / autoApprove /
 * notificationFrequency / modelTier / enabled).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface ConfigBody {
  aggressiveness?: number;
  autoApprove?: boolean;
  notificationFrequency?: string;
  modelTier?: string;
  enabled?: boolean;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { agentId } = await params;
    const body = (await request.json().catch(() => ({}))) as ConfigBody;
    const { aggressiveness, autoApprove, notificationFrequency, modelTier, enabled } = body;

    const update: Record<string, unknown> = {};
    if (aggressiveness !== undefined) update.aggressiveness = aggressiveness;
    if (autoApprove !== undefined) update.autoApprove = autoApprove;
    if (notificationFrequency) update.notificationFrequency = notificationFrequency;
    if (modelTier) update.modelTier = modelTier;
    if (enabled !== undefined) update.enabled = enabled;

    const config = await db.abAgentConfig.upsert({
      where: { tenantId_agentId: { tenantId, agentId } },
      update,
      create: {
        tenantId,
        agentId,
        aggressiveness: aggressiveness ?? 0.5,
        autoApprove: autoApprove ?? false,
        notificationFrequency: notificationFrequency || 'daily',
        modelTier: modelTier || 'fast',
      },
    });
    return NextResponse.json({ success: true, data: config });
  } catch (err) {
    console.error('[agentbook-core/agents/:agentId/config] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
