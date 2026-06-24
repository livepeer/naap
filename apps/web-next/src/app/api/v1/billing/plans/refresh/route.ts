/**
 * POST /api/v1/orchestrator-leaderboard-adjacent billing plan-spec sync (P4).
 *
 *   POST /api/v1/billing/plans/refresh
 *   auth: Authorization: Bearer <CRON_SECRET>   (same pattern as plans/refresh)
 *
 * Cron-triggered PULL sync: for each enabled `ProviderInstance`, pull its
 * published plans into `ProviderPlan` rows and auto-generate per-app
 * `DiscoveryPlan`s (Deliverable 2). Gated by `plan_spec_sync` (default OFF):
 * with the flag OFF the handler is a strict no-op (`{ skipped: true }`) — no
 * ProviderInstance is read, no sync runs, discovery is unchanged. Idempotent +
 * graceful by construction (see `syncAllProviderInstancePlans`).
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';

import { verifyCronAuth } from '@/lib/orchestrator-leaderboard/cron-auth';
import { syncAllProviderInstancePlans } from '@/lib/billing/plan-spec-sync';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  try {
    const result = await syncAllProviderInstancePlans();
    if (!result.enabled) {
      return NextResponse.json({ success: true, data: { skipped: true, reason: 'flag_off' } });
    }
    const plansUpserted = result.instances.reduce((n, i) => n + i.plansUpserted, 0);
    const discoveryPlansUpserted = result.instances.reduce(
      (n, i) => n + i.discoveryPlansUpserted,
      0,
    );
    return NextResponse.json({
      success: true,
      data: {
        skipped: false,
        instances: result.instances.length,
        plansUpserted,
        discoveryPlansUpserted,
      },
    });
  } catch (err) {
    console.error('[billing/plans/refresh] syncAllProviderInstancePlans failed:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
