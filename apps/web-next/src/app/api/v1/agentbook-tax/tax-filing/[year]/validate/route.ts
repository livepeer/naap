/**
 * Validate a tax filing — checks every required field is populated and
 * cross-form invariants hold.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { validateFiling } from '@agentbook-tax/tax-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { year } = await params;
    const taxYear = parseInt(year, 10);
    const filing = await db.abTaxFiling.findFirst({
      where: { tenantId, taxYear, filingType: 'personal_return' },
    });
    if (!filing) {
      return NextResponse.json({ success: false, error: 'No filing found' }, { status: 404 });
    }
    const result = validateFiling((filing.forms as Record<string, unknown>) || {});
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[agentbook-tax/tax-filing/:year/validate] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
