/**
 * Agents — list the four built-in agents (bookkeeper, tax-strategist,
 * collections, insights) with tenant-specific config overrides.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const AGENTS = [
  { id: 'bookkeeper', name: 'Bookkeeper', description: 'Expense recording, categorization, reconciliation', skills: ['expense-recording', 'receipt-ocr', 'bank-sync', 'pattern-learning'] },
  { id: 'tax-strategist', name: 'Tax Strategist', description: 'Tax estimation, deductions, quarterly payments, forms', skills: ['tax-estimation', 'deduction-hunting', 'tax-forms', 'year-end-closing'] },
  { id: 'collections', name: 'Collections', description: 'Invoice follow-up, payment prediction, time billing', skills: ['invoice-creation', 'earnings-projection', 'time-tracking'] },
  { id: 'insights', name: 'Insights', description: 'Analytics, patterns, projections, financial advice', skills: ['expense-analytics', 'financial-copilot', 'pattern-learning'] },
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const configs = await db.abAgentConfig.findMany({ where: { tenantId } });
    const configMap = new Map(configs.map((c) => [c.agentId, c]));
    const result = AGENTS.map((a) => ({
      ...a,
      config: configMap.get(a.id) || {
        aggressiveness: 0.5,
        autoApprove: false,
        notificationFrequency: 'daily',
        modelTier: 'fast',
        enabled: true,
      },
    }));
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[agentbook-core/agents] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
