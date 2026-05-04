/**
 * Onboarding progress — 7-step flow with completion tracking.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const STEPS = [
  { id: 'business_type', title: 'Choose your business type', description: 'Freelancer, sole proprietor, or consultant?', order: 0 },
  { id: 'jurisdiction', title: 'Set your country & region', description: 'US, Canada, UK, or Australia?', order: 1 },
  { id: 'currency', title: 'Set your currency', description: 'USD, CAD, GBP, EUR, or AUD?', order: 2 },
  { id: 'accounts', title: 'Set up chart of accounts', description: 'Based on your tax jurisdiction', order: 3 },
  { id: 'bank', title: 'Connect your bank', description: 'Link via Plaid for auto-import', order: 4 },
  { id: 'first_expense', title: 'Record your first expense', description: 'Snap a receipt or type an expense', order: 5 },
  { id: 'telegram', title: 'Connect Telegram', description: 'Proactive notifications on the go', order: 6 },
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    let progress = await db.abOnboardingProgress.findUnique({ where: { tenantId } });
    if (!progress) {
      progress = await db.abOnboardingProgress.create({ data: { tenantId } });
    }

    const completedSet = new Set(progress.completedSteps);
    const steps = STEPS.map((s) => ({ ...s, completed: completedSet.has(s.id) }));
    const completedCount = steps.filter((s) => s.completed).length;

    return NextResponse.json({
      success: true,
      data: {
        steps,
        currentStep: progress.currentStep,
        percentComplete: STEPS.length > 0 ? completedCount / STEPS.length : 0,
        isComplete: completedCount === STEPS.length,
      },
    });
  } catch (err) {
    console.error('[agentbook-core/onboarding] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
