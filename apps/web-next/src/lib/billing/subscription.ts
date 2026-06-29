/**
 * Subscription resolution foundation (NAAP P1, multi-subscription model).
 *
 * P1 adds the `Subscription` model + a nullable `DevApiKey.subscriptionId`. This
 * module is the FLAG-GATED foundation that turns a key's `subscriptionId` into a
 * `Subscription` row. It is intentionally NOT wired into the native-key resolver
 * or the validation front door yet — that per-key resolution wiring lands in a
 * later phase. Exposing it now lets P1 ship the model + an availability
 * invariant without changing any live resolution path.
 *
 * Zero regression: when `multi_subscription` is OFF, or the key has no
 * `subscriptionId`, this returns a `legacy` resolution so callers stay on
 * today's `key → team → single billingAccountRef` path. Never logs secrets.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { isFeatureEnabled, MULTI_SUBSCRIPTION_FLAG } from '@/lib/feature-flags';

export { MULTI_SUBSCRIPTION_FLAG } from '@/lib/feature-flags';

/** Active subscription status — others fail closed to the legacy path. */
export const SUBSCRIPTION_STATUS_ACTIVE = 'active';

/** Minimal `Subscription` shape resolution needs (subset of the Prisma row). */
export interface SubscriptionRecord {
  id: string;
  teamId: string;
  providerInstanceId: string;
  providerPlanId: string | null;
  accountId: string;
  status: string;
  appId: string | null;
}

/** Why a key fell back to the legacy (today's) resolution path. */
export type LegacyReason =
  | 'flag_off' // multi_subscription OFF
  | 'no_subscription' // key has a null subscriptionId
  | 'subscription_missing' // subscriptionId set but no row found
  | 'subscription_inactive' // row found but status != active
  | 'error'; // DB unavailable / lookup threw

export type SubscriptionResolution =
  | { mode: 'legacy'; reason: LegacyReason }
  | { mode: 'subscription'; subscription: SubscriptionRecord };

/**
 * Resolve the `Subscription` a key is linked to, when the multi-subscription
 * model is enabled.
 *
 *  - `multi_subscription` OFF → `{ mode: 'legacy', reason: 'flag_off' }`
 *    (the table is never read).
 *  - null `subscriptionId`     → `{ mode: 'legacy', reason: 'no_subscription' }`.
 *  - row missing / not active  → `legacy` (fail closed to today's path).
 *  - active row                → `{ mode: 'subscription', subscription }`.
 *
 * Callers treat any `legacy` result as "use today's team → single account
 * resolution", so existing keys (null subscriptionId) are byte-for-byte
 * unchanged. Never throws — DB errors degrade to `legacy`.
 */
export async function resolveSubscriptionForKey(
  key: {
    subscriptionId: string | null;
  },
  teamId?: string | null,
): Promise<SubscriptionResolution> {
  let flagOn = false;
  try {
    // Team-scoped when a `teamId` is supplied (the key's owning team); falls back
    // to the global value otherwise — byte-identical to today for existing keys.
    flagOn = await isFeatureEnabled(MULTI_SUBSCRIPTION_FLAG, teamId);
  } catch {
    flagOn = false;
  }

  if (!flagOn) {
    return { mode: 'legacy', reason: 'flag_off' };
  }
  if (!key.subscriptionId) {
    return { mode: 'legacy', reason: 'no_subscription' };
  }

  try {
    const row = await prisma.subscription.findUnique({
      where: { id: key.subscriptionId },
      select: {
        id: true,
        teamId: true,
        providerInstanceId: true,
        providerPlanId: true,
        accountId: true,
        status: true,
        appId: true,
      },
    });

    if (!row) {
      return { mode: 'legacy', reason: 'subscription_missing' };
    }
    if (row.status !== SUBSCRIPTION_STATUS_ACTIVE) {
      return { mode: 'legacy', reason: 'subscription_inactive' };
    }
    return { mode: 'subscription', subscription: row };
  } catch {
    return { mode: 'legacy', reason: 'error' };
  }
}
