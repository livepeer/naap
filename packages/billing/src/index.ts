export type {
  FeatureFlag,
  UsageDimension,
  SubscriptionStatus,
  PlanFeatures,
  PlanQuotas,
} from './types.js';

export { resolveAccountId } from './account-resolver.js';
export { planCache, PlanCache, type CachedPlan } from './cache.js';
export { getCurrentPlan, getCurrentPlanStrict, _resetCacheForTests, type CurrentPlan } from './plans.js';
export { canUseFeature } from './features.js';
export { checkQuota, incrementUsage, getUsage, type QuotaCheck } from './quotas.js';

import { planCache } from './cache.js';

/**
 * Webhook hook — call from the Stripe webhook handler whenever a
 * subscription is created/updated/deleted so the next entitlement check
 * refreshes from the DB rather than returning a stale cache value.
 */
export function invalidateAccount(accountId: string): void {
  planCache.invalidate(accountId);
}
