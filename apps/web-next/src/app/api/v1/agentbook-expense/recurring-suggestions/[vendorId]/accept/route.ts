/**
 * Accept a recurring-expense suggestion — create the AbRecurringRule
 * with a next-expected date based on frequency.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface AcceptBody {
  amountCents?: number;
  frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vendorId: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { vendorId } = await params;
    const body = (await request.json().catch(() => ({}))) as AcceptBody;
    const { amountCents, frequency = 'monthly' } = body;

    if (!amountCents || amountCents <= 0) {
      return NextResponse.json(
        { success: false, error: 'amountCents must be a positive integer' },
        { status: 400 },
      );
    }

    const vendor = await db.abVendor.findFirst({ where: { id: vendorId, tenantId } });
    if (!vendor) {
      return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 });
    }

    const nextExpected = new Date();
    switch (frequency) {
      case 'weekly': nextExpected.setDate(nextExpected.getDate() + 7); break;
      case 'biweekly': nextExpected.setDate(nextExpected.getDate() + 14); break;
      case 'monthly': nextExpected.setMonth(nextExpected.getMonth() + 1); break;
      case 'quarterly': nextExpected.setMonth(nextExpected.getMonth() + 3); break;
      case 'annual': nextExpected.setFullYear(nextExpected.getFullYear() + 1); break;
    }

    const rule = await db.abRecurringRule.create({
      data: { tenantId, vendorId, amountCents, frequency, nextExpected },
    });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'recurring_rule.created_from_suggestion',
        actor: 'user',
        action: { ruleId: rule.id, vendorId, vendorName: vendor.name, amountCents, frequency },
      },
    });

    return NextResponse.json({ success: true, data: rule }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-expense/recurring-suggestions/:vendorId/accept] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
