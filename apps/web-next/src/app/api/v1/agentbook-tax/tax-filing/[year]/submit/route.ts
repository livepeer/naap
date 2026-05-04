/**
 * E-file a tax filing via the tax-efiling helper.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { submitFiling } from '@agentbook-tax/tax-efiling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { year } = await params;
    const taxYear = parseInt(year, 10);
    const result = await submitFiling(tenantId, taxYear);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[agentbook-tax/tax-filing/:year/submit] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
