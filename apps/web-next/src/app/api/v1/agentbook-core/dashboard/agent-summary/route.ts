/**
 * Dashboard /agent-summary — native Next.js route.
 *
 * Returns a 1–2 sentence judgment line summarizing the user's current
 * financial situation. Currently uses the deterministic counts string;
 * the LLM moat (Gemini call) can be wired later when a Next.js-side
 * Gemini helper exists. Cached 15 min per tenant in a process-local Map.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantId } from '../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

interface SummaryFacts {
  overdueCount: number;
  overdueAmountCents: number;
  taxDaysOut: number | null;
}

interface SummaryResult {
  summary: string;
  generatedAt: string;
  source: 'llm' | 'fallback';
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { value: SummaryResult; expiresAt: number }>();

function fmtUSD(cents: number): string {
  return '$' + Math.abs(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function buildDeterministicSummary(f: SummaryFacts): string {
  const parts: string[] = [];
  if (f.overdueCount > 0) {
    parts.push(`${f.overdueCount} invoice${f.overdueCount === 1 ? '' : 's'} overdue (${fmtUSD(f.overdueAmountCents)})`);
  }
  if (f.taxDaysOut !== null && f.taxDaysOut <= 14) {
    parts.push(`Tax payment in ${f.taxDaysOut} days`);
  }
  return parts.length === 0 ? 'All clear ☕' : parts.join('. ') + '.';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveTenantId(request);
    const params = request.nextUrl.searchParams;
    const facts: SummaryFacts = {
      overdueCount: parseInt(params.get('overdueCount') || '0', 10),
      overdueAmountCents: parseInt(params.get('overdueAmountCents') || '0', 10),
      taxDaysOut: params.get('taxDaysOut') !== null ? parseInt(params.get('taxDaysOut')!, 10) : null,
    };

    const cached = cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ success: true, data: cached.value });
    }

    const result: SummaryResult = {
      summary: buildDeterministicSummary(facts),
      generatedAt: new Date().toISOString(),
      source: 'fallback',
    };
    cache.set(tenantId, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[dashboard/agent-summary] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
