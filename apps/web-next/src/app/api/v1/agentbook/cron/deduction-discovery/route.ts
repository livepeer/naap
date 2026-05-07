/**
 * Deduction-discovery cron — weekly fan-out (PR 12).
 *
 * Vercel cron: "0 12 * * 1" (Mondays 12:00 UTC). For every tenant that
 * has at least one expense, run the rules engine and persist any
 * high-confidence suggestions to AbDeductionSuggestion. The morning
 * digest the next day surfaces them.
 *
 * Auth: Bearer-gated by CRON_SECRET using a timing-safe compare,
 * matching the plaid-sync cron (PR 3) pattern. We sanitize 500s and
 * never echo Prisma internals back to the caller.
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { runDeductionDiscovery } from '@/lib/agentbook-deduction-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function safeCompareBearer(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Bounded fan-out. Failures inside `fn` are swallowed so a single bad
 * tenant doesn't sink the whole batch; we count them in the response.
 */
async function processAll<T, R>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    const batch = items.slice(i, i + n);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value);
    }
  }
  return results;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authHeader = request.headers.get('authorization');
    if (
      process.env.CRON_SECRET &&
      !safeCompareBearer(authHeader, process.env.CRON_SECRET)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // We only consider tenants with at least one expense in the last
    // ~70 days — anything older won't trigger any rule anyway, and
    // skipping them keeps the fan-out short on a fresh database.
    const since = new Date(Date.now() - 70 * 86_400_000);
    const tenantRows = await db.abExpense.findMany({
      where: { date: { gte: since } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    let totalCreated = 0;
    let errorCount = 0;
    const tenantStats: Record<string, { created: number; errors: number }> = {};

    await processAll(tenantRows, 5, async (row) => {
      try {
        const r = await runDeductionDiscovery(row.tenantId);
        totalCreated += r.created;
        const t = (tenantStats[row.tenantId] ??= { created: 0, errors: 0 });
        t.created += r.created;
      } catch (err) {
        errorCount++;
        const t = (tenantStats[row.tenantId] ??= { created: 0, errors: 0 });
        t.errors++;
        console.error(
          '[cron/deduction-discovery] tenant', row.tenantId, 'failed:', err,
        );
      }
    });

    // Per-tenant audit so users see when discovery ran.
    for (const tenantId of Object.keys(tenantStats)) {
      await db.abEvent
        .create({
          data: {
            tenantId,
            eventType: 'deduction.discovery_completed',
            actor: 'system',
            action: tenantStats[tenantId],
          },
        })
        .catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      tenantsProcessed: tenantRows.length,
      created: totalCreated,
      errorCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cron/deduction-discovery] failed:', err);
    return NextResponse.json(
      { error: 'Deduction discovery failed' },
      { status: 500 },
    );
  }
}
