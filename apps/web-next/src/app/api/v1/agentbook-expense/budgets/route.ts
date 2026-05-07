/**
 * Budgets — list + upsert.
 *
 * Upsert key is (tenantId, categoryId, period) so re-POSTing the same
 * category replaces the limit instead of duplicating.
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
    const budgets = await db.abBudget.findMany({
      where: { tenantId },
      orderBy: { categoryName: 'asc' },
    });
    return NextResponse.json({ success: true, data: budgets });
  } catch (err) {
    console.error('[agentbook-expense/budgets GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface BudgetBody {
  amountCents?: number;
  categoryId?: string;
  categoryName?: string;
  period?: string;
  alertPercent?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as BudgetBody;
    const { amountCents, categoryId, categoryName, period, alertPercent } = body;

    if (!amountCents || amountCents <= 0) {
      return NextResponse.json({ success: false, error: 'amountCents required' }, { status: 400 });
    }

    // Prisma rejects null in a compound-unique upsert; fall back to
    // findFirst + create-or-update.
    const resolvedPeriod = period || 'monthly';
    const existing = await db.abBudget.findFirst({
      where: { tenantId, categoryId: categoryId ?? null, period: resolvedPeriod },
    });
    const budget = existing
      ? await db.abBudget.update({
          where: { id: existing.id },
          data: { amountCents, categoryName, alertPercent: alertPercent || 80 },
        })
      : await db.abBudget.create({
          data: {
            tenantId,
            amountCents,
            categoryId: categoryId ?? null,
            categoryName: categoryName || 'Total',
            period: resolvedPeriod,
            alertPercent: alertPercent || 80,
          },
        });

    return NextResponse.json({ success: true, data: budget });
  } catch (err) {
    console.error('[agentbook-expense/budgets POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
