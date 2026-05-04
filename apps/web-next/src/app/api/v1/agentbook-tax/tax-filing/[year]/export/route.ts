/**
 * Export a tax filing as JSON or printable HTML.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { exportFiling } from '@agentbook-tax/tax-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ExportBody {
  format?: 'pdf' | 'json';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { year } = await params;
    const taxYear = parseInt(year, 10);
    const body = (await request.json().catch(() => ({}))) as ExportBody;
    const format = body.format || 'json';

    const result = await exportFiling(tenantId, taxYear, format);
    if (result.success && format === 'pdf' && (result.data as { html?: string })?.html) {
      return new NextResponse((result.data as { html: string }).html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[agentbook-tax/tax-filing/:year/export] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
