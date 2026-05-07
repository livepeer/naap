/**
 * PR 12 — apply a deduction suggestion.
 *
 * POST /agentbook-expense/deductions/suggestions/[id]/apply
 *   • Marks the linked AbExpense as deductible and writes the snapshot
 *     taxCategory line.
 *   • Flips the suggestion to status='applied'.
 *   • Audits both writes (PR 10).
 *
 * 404 on cross-tenant access. 422 if the suggestion is already
 * applied/dismissed or has no linked expense.
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
      // Tenant-scoped 404 — same shape an unknown id would produce, so
      // a cross-tenant probe can't tell whether the row exists.
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

    let expenseAfter: { id: string; isDeductible: boolean; taxCategory: string | null } | null = null;

    if (suggestion.expenseId) {
      const expense = await db.abExpense.findFirst({
        where: { id: suggestion.expenseId, tenantId },
        select: { id: true, isDeductible: true, taxCategory: true },
      });
      if (!expense) {
        return NextResponse.json(
          { success: false, error: 'Linked expense not found' },
          { status: 422 },
        );
      }
      const updated = await db.abExpense.update({
        where: { id: expense.id },
        data: {
          isDeductible: suggestion.suggestedDeductible,
          ...(suggestion.suggestedTaxCategory ? { taxCategory: suggestion.suggestedTaxCategory } : {}),
        },
        select: { id: true, isDeductible: true, taxCategory: true },
      });
      expenseAfter = updated;

      await audit({
        tenantId,
        source: inferSource(request),
        actor: await inferActor(request),
        action: 'expense.mark_deductible',
        entityType: 'AbExpense',
        entityId: expense.id,
        before: { isDeductible: expense.isDeductible, taxCategory: expense.taxCategory },
        after: { isDeductible: updated.isDeductible, taxCategory: updated.taxCategory },
      });
    }

    const applied = await db.abDeductionSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'applied' },
    });

    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'deduction.apply',
      entityType: 'AbDeductionSuggestion',
      entityId: suggestion.id,
      before: { status: suggestion.status },
      after: { status: applied.status, ruleId: suggestion.ruleId, expenseId: suggestion.expenseId },
    });

    return NextResponse.json({
      success: true,
      data: {
        suggestionId: applied.id,
        status: applied.status,
        expense: expenseAfter,
      },
    });
  } catch (err) {
    console.error('[deductions/suggestions/apply] failed:', err);
    // Sanitized — don't leak Prisma internals back to the client.
    return NextResponse.json(
      { success: false, error: 'Failed to apply suggestion' },
      { status: 500 },
    );
  }
}
