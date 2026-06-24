/**
 * Per-key discovery selection (NAAP P4, Deliverable 2 §4.4).
 *
 * Closes the "which discovery does THIS api key get?" hop. Reusing the P2
 * binding, the presented `naap_` key resolves
 *
 *     key → Subscription → ProviderPlan → DiscoveryPlan
 *
 * and this module turns the resolved subscription into the per-app discovery
 * URL the orchestrator-leaderboard already serves
 * (`/api/v1/orchestrator-leaderboard/plans/{discoveryPlanId}/python-gateway`).
 * The validate front door surfaces that URL as an ADDITIVE response field; the
 * actual signer/SDK auto-config wiring is P5.
 *
 * Zero regression: gated by `plan_spec_sync` (default OFF). With the flag OFF,
 * a subscription without `providerPlanId`, or no matching/enabled auto
 * `DiscoveryPlan`, this returns null and the validate response is byte-for-byte
 * today's (no `discovery` field). Never throws — any error degrades to null.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { isFeatureEnabled, PLAN_SPEC_SYNC_FLAG } from '@/lib/feature-flags';

import { buildAutoDiscoveryPlanId } from './auto-discovery-plan';
import type { SubscriptionRecord } from './subscription';

/** Resolved per-key discovery: the auto DiscoveryPlan id + its python-gateway URL. */
export interface KeyDiscoveryResolution {
  discoveryPlanId: string;
  url: string;
}

/** Build the per-app discovery (python-gateway) URL for a DiscoveryPlan id. */
export function buildDiscoveryUrl(discoveryPlanId: string): string {
  return `/api/v1/orchestrator-leaderboard/plans/${encodeURIComponent(discoveryPlanId)}/python-gateway`;
}

/**
 * Resolve the per-app discovery URL for a subscription, selected by its
 * `key → Subscription → ProviderPlan → DiscoveryPlan` chain.
 *
 *  - `plan_spec_sync` OFF        → null (table never read; today's behavior).
 *  - subscription w/o plan id    → null (no synced plan to key off).
 *  - no matching/enabled plan    → null (graceful — e.g. sync hasn't run yet).
 *  - matching enabled plan       → `{ discoveryPlanId, url }`.
 *
 * Never throws — DB errors degrade to null so the validate front door is never
 * hard-failed by discovery resolution.
 */
export async function resolveKeyDiscovery(
  subscription: Pick<SubscriptionRecord, 'providerInstanceId' | 'providerPlanId'>,
): Promise<KeyDiscoveryResolution | null> {
  if (!subscription.providerPlanId) {
    return null;
  }

  let flagOn = false;
  try {
    flagOn = await isFeatureEnabled(PLAN_SPEC_SYNC_FLAG);
  } catch {
    flagOn = false;
  }
  if (!flagOn) {
    return null;
  }

  const billingPlanId = buildAutoDiscoveryPlanId(
    subscription.providerInstanceId,
    subscription.providerPlanId,
  );

  try {
    const plan = await prisma.discoveryPlan.findUnique({
      where: { billingPlanId },
      select: { id: true, enabled: true },
    });
    if (!plan || !plan.enabled) {
      return null;
    }
    return { discoveryPlanId: plan.id, url: buildDiscoveryUrl(plan.id) };
  } catch {
    return null;
  }
}
