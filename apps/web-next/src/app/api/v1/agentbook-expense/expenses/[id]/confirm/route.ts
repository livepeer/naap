/**
 * Confirm a pending expense — transition status to "confirmed",
 * post a double-entry journal if a category is assigned and the
 * expense is business-only.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface ConfirmBody {
  amountCents?: number;
  categoryId?: string;
  description?: string;
  vendorName?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as ConfirmBody;

    const expense = await db.abExpense.findFirst({ where: { id, tenantId } });
    if (!expense) {
      return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
    }
    if (expense.status === 'confirmed') {
      return NextResponse.json({ success: true, data: expense, message: 'Already confirmed' });
    }

    let journalEntryId = expense.journalEntryId;
    const finalCategoryId = body.categoryId || expense.categoryId;
    const finalAmount = body.amountCents || expense.amountCents;
    const finalDescription = body.description || expense.description;

    if (!journalEntryId && finalCategoryId && !expense.isPersonal) {
      const cashAccount = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
      if (cashAccount) {
        const je = await db.abJournalEntry.create({
          data: {
            tenantId,
            date: expense.date,
            memo: `Expense: ${finalDescription || 'Confirmed expense'}`,
            sourceType: 'expense',
            sourceId: expense.id,
            verified: true,
            lines: {
              create: [
                { tenantId, accountId: finalCategoryId, debitCents: finalAmount, creditCents: 0, description: finalDescription || 'Expense' }, // G-009
                { tenantId, accountId: cashAccount.id, debitCents: 0, creditCents: finalAmount, description: 'Payment' }, // G-009
              ],
            },
          },
        });
        journalEntryId = je.id;
      }
    }

    const updateData: Record<string, unknown> = { status: 'confirmed', journalEntryId };
    if (body.amountCents) updateData.amountCents = body.amountCents;
    if (body.categoryId) updateData.categoryId = body.categoryId;
    if (body.description) updateData.description = body.description;

    const updated = await db.abExpense.update({ where: { id }, data: updateData });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'expense.confirmed',
        actor: 'user',
        action: { expenseId: id, amountCents: finalAmount },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-expense/expenses/:id/confirm] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
