/**
 * Tax filing submission status.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { checkFilingStatus } from '@agentbook-tax/tax-efiling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { year } = await params;
    const taxYear = parseInt(year, 10);
    const result = await checkFilingStatus(tenantId, taxYear);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[agentbook-tax/tax-filing/:year/status] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
