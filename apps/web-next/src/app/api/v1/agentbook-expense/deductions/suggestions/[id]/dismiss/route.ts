/**
 * PR 12 — dismiss a deduction suggestion.
 *
 * POST /agentbook-expense/deductions/suggestions/[id]/dismiss
 *   • Flips status to 'dismissed' and stamps expiresAt = now + 90d so
 *     the dedupe window inside `runDeductionDiscovery` suppresses any
 *     re-fire from the same rule against the same expense.
 *   • Audited (PR 10).
 *
 * 404 on cross-tenant access. 422 if already in a terminal state.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { audit } from '@/lib/agentbook-audit';
import { inferSource, inferActor } from '@/lib/agentbook-audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DISMISS_WINDOW_MS = 90 * 86_400_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;

    const suggestion = await db.abDeductionSuggestion.findFirst({
      where: { id, tenantId },
    });
    if (!suggestion) {
      return NextResponse.json(
        { success: false, error: 'Suggestion not found' },
        { status: 404 },
      );
    }
    if (suggestion.status === 'applied' || suggestion.status === 'dismissed') {
      return NextResponse.json(
        { success: false, error: `Suggestion already ${suggestion.status}` },
        { status: 422 },
      );
    }

    const expiresAt = new Date(Date.now() + DISMISS_WINDOW_MS);
    const dismissed = await db.abDeductionSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'dismissed', expiresAt },
    });

    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'deduction.dismiss',
      entityType: 'AbDeductionSuggestion',
      entityId: suggestion.id,
      before: { status: suggestion.status, expiresAt: suggestion.expiresAt },
      after: { status: dismissed.status, expiresAt: dismissed.expiresAt },
    });

    return NextResponse.json({
      success: true,
      data: {
        suggestionId: dismissed.id,
        status: dismissed.status,
        expiresAt: dismissed.expiresAt,
      },
    });
  } catch (err) {
    console.error('[deductions/suggestions/dismiss] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to dismiss suggestion' },
      { status: 500 },
    );
  }
}
