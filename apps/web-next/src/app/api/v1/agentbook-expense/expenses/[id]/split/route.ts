/**
 * Split an expense into business / personal portions, validating
 * the splits sum to the original amount.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface SplitRow {
  categoryId?: string;
  amountCents?: number;
  isPersonal?: boolean;
  description?: string;
}

interface SplitBody {
  splits?: SplitRow[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as SplitBody;
    const splits = body.splits;

    if (!splits || !Array.isArray(splits) || splits.length < 2) {
      return NextResponse.json({ success: false, error: 'At least 2 splits are required' }, { status: 400 });
    }

    const expense = await db.abExpense.findFirst({ where: { id, tenantId } });
    if (!expense) {
      return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
    }

    const totalSplit = splits.reduce((s, sp) => s + (sp.amountCents || 0), 0);
    if (totalSplit !== expense.amountCents) {
      return NextResponse.json(
        {
          success: false,
          error: `Split amounts (${totalSplit}) must equal expense amount (${expense.amountCents})`,
        },
        { status: 422 },
      );
    }

    const splitRecords = await db.$transaction(async (tx) => {
      await tx.abExpenseSplit.deleteMany({ where: { expenseId: expense.id } });

      const records: Awaited<ReturnType<typeof tx.abExpenseSplit.create>>[] = [];
      for (const sp of splits) {
        const record = await tx.abExpenseSplit.create({
          data: {
            expenseId: expense.id,
            categoryId: sp.categoryId || expense.categoryId,
            amountCents: sp.amountCents || 0,
            isPersonal: sp.isPersonal || false,
            description: sp.description || null,
          },
        });
        records.push(record);
      }

      const personalAmount = splits
        .filter((s) => s.isPersonal)
        .reduce((sum, s) => sum + (s.amountCents || 0), 0);
      await tx.abExpense.update({
        where: { id: expense.id },
        data: { isPersonal: personalAmount > expense.amountCents / 2 },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'expense.split',
          actor: 'user',
          action: {
            expenseId: expense.id,
            splitCount: splits.length,
            personalAmount,
            businessAmount: expense.amountCents - personalAmount,
          },
        },
      });

      return records;
    });

    return NextResponse.json({
      success: true,
      data: { expenseId: expense.id, splits: splitRecords },
    });
  } catch (err) {
    console.error('[agentbook-expense/expenses/:id/split] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
