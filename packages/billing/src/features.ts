import type { FeatureFlag } from './types.js';
import { getCurrentPlanStrict } from './plans.js';

/**
 * Hot-path entitlement check. < 1ms on cache hit.
 *
 * Status handling:
 *   • active / trialing — grant if feature flag is true
 *   • past_due — still granted (Stripe runs a 7-day dunning grace
 *     during which we keep features lit so the user can retry payment)
 *   • canceled / incomplete — degrade to no premium features
 *
 * Fails open on errors: returns true. Better to grant access than to
 * brick the Telegram bot for everyone on a transient DB blip.
 */
export async function canUseFeature(tenantId: string, feature: FeatureFlag): Promise<boolean> {
  try {
    const cur = await getCurrentPlanStrict(tenantId);
    if (cur.status === 'canceled' || cur.status === 'incomplete') return false;
    return cur.plan.features[feature] === true;
  } catch (err) {
    console.warn('[billing] canUseFeature failed open:', err);
    return true;
  }
}
