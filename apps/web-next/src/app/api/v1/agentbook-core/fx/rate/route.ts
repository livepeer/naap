/**
 * GET /api/v1/agentbook-core/fx/rate?from=EUR&to=USD
 *
 * Returns the current FX rate (today's, with stale fallback). Used by
 * the web invoice form to preview "Will be converted at $X.XX rate"
 * when the user picks a non-tenant currency.
 *
 * Tenant-scoped only insofar as the tenant must be authenticated. The
 * rate cache itself is global (currencies don't differ by tenant).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { getRate } from '@/lib/agentbook-fx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CCY_RE = /^[A-Z]{3}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Auth via tenant resolution — fails fast for unauthenticated callers.
    await resolveAgentbookTenant(request);

    const { searchParams } = new URL(request.url);
    const from = (searchParams.get('from') || '').toUpperCase();
    const to = (searchParams.get('to') || '').toUpperCase();

    if (!CCY_RE.test(from) || !CCY_RE.test(to)) {
      return NextResponse.json(
        { success: false, error: 'Invalid currency code; expected 3-letter ISO 4217.' },
        { status: 400 },
      );
    }

    const rate = await getRate(from, to);
    if (!rate) {
      return NextResponse.json(
        { success: false, error: `No rate available for ${from}->${to}.` },
        { status: 503 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        from: rate.from,
        to: rate.to,
        rate: rate.rate,
        date: rate.date.toISOString(),
        source: rate.source,
      },
    });
  } catch (err) {
    console.error('[agentbook-core/fx/rate GET] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to look up FX rate.' },
      { status: 500 },
    );
  }
}
