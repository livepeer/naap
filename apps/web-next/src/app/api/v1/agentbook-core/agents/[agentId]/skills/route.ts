/**
 * Agent skill bindings — base skills + tenant-specific bindings.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BASE_SKILLS: Record<string, string[]> = {
  bookkeeper: ['expense-recording', 'receipt-ocr', 'bank-sync', 'pattern-learning', 'anomaly-detection'],
  'tax-strategist': ['tax-estimation', 'deduction-hunting', 'tax-forms', 'year-end-closing'],
  collections: ['invoice-creation', 'time-tracking', 'earnings-projection'],
  insights: ['expense-analytics', 'financial-copilot', 'pattern-learning'],
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { agentId } = await params;
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const base = (BASE_SKILLS[agentId] || []).map((s) => ({
      skillName: s,
      source: 'base',
      enabled: true,
    }));
    const dbBindings = await db.abAgentSkillBinding.findMany({
      where: { tenantId, agentId },
      orderBy: { priority: 'desc' },
    });
    const all = [
      ...base,
      ...dbBindings.map((b) => ({ skillName: b.skillName, source: b.source, enabled: b.enabled })),
    ];
    return NextResponse.json({
      success: true,
      data: { agentId, jurisdiction: config?.jurisdiction || 'us', skills: all },
    });
  } catch (err) {
    console.error('[agentbook-core/agents/:agentId/skills GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface BindBody {
  skillName?: string;
  source?: string;
  priority?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { agentId } = await params;
    const body = (await request.json().catch(() => ({}))) as BindBody;
    const { skillName, source, priority } = body;
    if (!skillName) {
      return NextResponse.json({ success: false, error: 'skillName is required' }, { status: 400 });
    }

    const binding = await db.abAgentSkillBinding.upsert({
      where: { tenantId_agentId_skillName: { tenantId, agentId, skillName } },
      update: { source, priority, enabled: true },
      create: {
        tenantId,
        agentId,
        skillName,
        source: source || 'marketplace',
        priority: priority || 50,
      },
    });
    return NextResponse.json({ success: true, data: binding });
  } catch (err) {
    console.error('[agentbook-core/agents/:agentId/skills POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
