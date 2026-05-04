/**
 * Mark an onboarding step as complete and bump the current-step pointer.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CompleteBody {
  stepId?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CompleteBody;
    const { stepId } = body;
    if (!stepId) {
      return NextResponse.json({ success: false, error: 'stepId is required' }, { status: 400 });
    }

    let progress = await db.abOnboardingProgress.findUnique({ where: { tenantId } });
    if (!progress) {
      progress = await db.abOnboardingProgress.create({ data: { tenantId } });
    }

    const completedSteps = [...new Set([...progress.completedSteps, stepId])];
    const currentStep = Math.min(completedSteps.length, 6);

    await db.abOnboardingProgress.update({
      where: { tenantId },
      data: {
        completedSteps,
        currentStep,
        ...(stepId === 'bank' && { bankConnected: true }),
        ...(stepId === 'accounts' && { accountsSeeded: true }),
        ...(stepId === 'first_expense' && { firstExpense: true }),
        ...(stepId === 'telegram' && { telegramConnected: true }),
        ...(completedSteps.length === 7 && { completedAt: new Date() }),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[agentbook-core/onboarding/complete-step] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
